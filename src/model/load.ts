/**
 * Loader：解析 YAML / JSON（同一解析器，S8）、按 JSON Schema 检查单文件格式、把多个文件合并成一个模型。
 *
 * 单文件格式不合法时整份文件跳过并报错；跨文件的引用完整性交给 validate.ts。
 * 草图文件（intent/*.yaml、designs/<设计>/sketches/<mount>.yaml，X1）先于其他文件进入：草图里的实体既作为普通实体进模型，又整份记入 model.sketches 供核验；
 * 其他文件对草图实体只能补充（往下挂子模块、补草图没写的字段），对草图已写的字段给出不同的值即重定义，报错并以草图为准。
 * 草图格式 v2（X9、X10，ADR-0025）：非根草图的模块挂在 mount 下；草图的 abstraction 是挂载点模块对内的原则；from、layout 不进模型。
 */
import Ajv, { type ErrorObject } from 'ajv'
import { LineCounter, parseDocument, type Document } from 'yaml'
import schema from '../../schema/arch-file.schema.json'
import { LEGACY_RELATION_TYPES, REMOVED_RELATION_TYPE, ROOT_MOUNT } from './types'
import { isSketchFile } from './intent/types'
import type {
  ActorEntity,
  ArchFileDef,
  ArchModel,
  DataStructureDef,
  DataStructureEntity,
  InterfaceDef,
  InterfaceEntity,
  Issue,
  ModuleDef,
  LegacyRelationType,
  ModuleEntity,
  ModuleRole,
  RawFile,
  RelationDef,
  RelationEntity,
  RelationType,
  ReviewedEntry,
  ScenarioEntity,
  SketchEntity,
  SourceLoc,
  Step,
  StepDef,
  SystemDef,
} from './types'

/** 未声明 system 时使用的默认根 */
export const DEFAULT_SYSTEM: SystemDef = { id: 'system', name: '系统' }

const ajv = new Ajv({ allErrors: true, strict: false })
const validateFile = ajv.compile<ArchFileDef>(schema)

export interface LoadResult {
  model: ArchModel
  issues: Issue[]
}

export function load(files: readonly RawFile[]): LoadResult {
  const issues: Issue[] = []
  const systems: { def: SystemDef; src: SourceLoc }[] = []
  const modules: ModuleEntity[] = []
  const relations: RelationEntity[] = []
  const interfaces: InterfaceEntity[] = []
  const dataStructures: DataStructureEntity[] = []
  const actors: ActorEntity[] = []
  const scenarios: ScenarioEntity[] = []
  const sourceIgnore: string[] = []
  const reviewed: ReviewedEntry[] = []
  let sourceLimits: { def: NonNullable<ArchFileDef['sourceLimits']>; file: string } | undefined
  let rules: { def: NonNullable<ArchFileDef['rules']>; src: SourceLoc } | undefined
  const sketches: SketchEntity[] = []
  /** X1：草图里的实体，按「种类:ID」记住实体与草图写了哪些字段，供其他文件补充时比对 */
  const sketched = new Map<string, { entity: Record<string, unknown>; written: Set<string>; file: string }>()
  /** X10：草图写给挂载点模块的原则（加载完再落到模块上）与非草图文件写过 abstraction 的模块 */
  const mountAbstractions: { mount: string; value: string; src: SourceLoc }[] = []
  const otherAbstraction = new Map<string, SourceLoc>()
  /** M16：intent/roles.yaml 的角色（模块 ID → role 与出处），加载完再落到模块上 */
  const roles: { id: string; role: ModuleRole; src: SourceLoc }[] = []
  let seq = 0

  // X1：草图文件先入；其余按路径排序
  const sorted = [...files].sort((a, b) => Number(isSketchFile(b.path)) - Number(isSketchFile(a.path)) || a.path.localeCompare(b.path))
  for (const file of sorted) {
    const parsed = parseFile(file, issues)
    if (!parsed) continue
    const { data, locate } = parsed
    const sketch = data.sketch
    if (sketch && !isSketchFile(file.path))
      issues.push({
        severity: 'warning',
        code: 'sketch-misplaced',
        message: `草图应放在 intent/<ID>.yaml 或 designs/<设计>/sketches/<mount>.yaml，这里的照常加载`,
        ...locate(['sketch']),
      })

    if (data.system) systems.push({ def: data.system, src: locate(['system']) })

    /**
     * X1：实体已由草图声明时的合并。草图文件之间后者覆盖前者（设计的草图在持久草图之后；矛盾由核验报出）；
     * 其他文件只能补草图没写的字段，对已写字段给出不同的值报 sketch-redefined、以草图为准。返回 true 表示已合并、不再新建实体。
     */
    type Fields = Record<string, unknown>
    const supplement = (kind: string, id: string, def: object, src: SourceLoc, skip: readonly string[]): boolean => {
      const hit = sketched.get(`${kind}:${id}`)
      if (!hit) return false
      const conflicts: string[] = []
      for (const [key, value] of Object.entries(def as Fields)) {
        if (key === 'id' || skip.includes(key) || value === undefined) continue
        if (sketch) {
          hit.entity[key] = value
          hit.written.add(key)
        } else if (!hit.written.has(key)) {
          hit.entity[key] = value
          hit.written.add(key)
        } else if (JSON.stringify(hit.entity[key]) !== JSON.stringify(value)) conflicts.push(key)
      }
      if (conflicts.length)
        issues.push({
          severity: 'error',
          code: 'sketch-redefined',
          message: `「${id}」是草图（${hit.file}）里的实体，这里重定义了它的 ${conflicts.join('、')}（X1：其他文件只能补充草图没写的字段与子树）；以草图为准`,
          ...src,
        })
      return true
    }
    const remember = (kind: string, id: string, entity: object, def: object, skip: readonly string[]) => {
      if (!sketch) return
      const written = new Set(Object.keys(def).filter(k => k !== 'id' && !skip.includes(k) && (def as Fields)[k] !== undefined))
      // 模块的父子关系总由草图决定：挂在根下的也不许别的文件搬走
      if (kind === 'module') written.add('parentId')
      sketched.set(`${kind}:${id}`, { entity: entity as Fields, written, file: file.path })
    }

    const pushModule = (def: ModuleDef, parentId: string | undefined, path: (string | number)[], nested: boolean) => {
      // X11：血缘是设计信息，不进模型
      const { children, parent, from: _from, ...rest } = def
      if (!sketch && rest.abstraction !== undefined) otherAbstraction.set(def.id, locate([...path, 'abstraction']))
      if (nested && parent !== undefined) {
        issues.push({
          severity: 'warning',
          code: 'nested-parent-ignored',
          message: `模块 ${def.id} 是内联子模块，其 parent 字段被忽略（父模块由嵌套位置决定）`,
          ...locate([...path, 'parent']),
        })
      }
      const src = locate(path)
      // parentId 为 undefined 表示挂在系统根下，合并完成后再回填
      const parentOf = nested ? parentId : parent
      const merged = supplement('module', def.id, { ...rest, ...(parentOf !== undefined ? { parentId: parentOf } : {}) }, src, ['children', 'parent'])
      if (!merged) {
        const entity: ModuleEntity = { ...rest, parentId: parentOf as string, seq: seq++, src }
        modules.push(entity)
        remember('module', def.id, entity, { ...rest, ...(parentOf !== undefined ? { parentId: parentOf } : {}) }, ['children', 'parent'])
      }
      children?.forEach((child, i) => pushModule(child, def.id, [...path, 'children', i], true))
    }
    const pushRelation = (r: RelationDef, path: (string | number)[]) => {
      const src = locate(path)
      const payload = r.payload === undefined ? [] : Array.isArray(r.payload) ? r.payload : [r.payload]
      const typed = currentType(r, src, issues)
      // 没写 payload 不算写了：草图里的关系（晋升后的骨架拥有第二级关系）由其他文件补 payload 不是重定义（X1）
      const fields = { ...r, ...typed, ...(r.payload === undefined ? {} : { payload }) }
      if (supplement('relation', r.id, fields, src, [])) return
      // via 原样带入（M20 的旧写法由 Validator 读成四形态）
      const entity = { ...fields, payload, seq: seq++, src } as RelationEntity
      relations.push(entity)
      remember('relation', r.id, entity, fields, [])
    }
    const pushInterface = (x: InterfaceDef, path: (string | number)[]) => {
      const src = locate(path)
      if (supplement('interface', x.id, x, src, [])) return
      const entity: InterfaceEntity = { ...x, src }
      interfaces.push(entity)
      remember('interface', x.id, entity, x, [])
    }
    const pushDataStructure = (x: DataStructureDef, path: (string | number)[]) => {
      const src = locate(path)
      if (supplement('data-structure', x.id, x, src, [])) return
      const entity: DataStructureEntity = { ...x, src }
      dataStructures.push(entity)
      remember('data-structure', x.id, entity, x, [])
    }

    // X1：草图的内容先进模型，再整份记入 sketches 供核验
    if (sketch) {
      // X9：根挂载的模块是层（子模块嵌套）；其余草图的模块挂在 mount 下
      const mount = sketch.mount === ROOT_MOUNT ? undefined : sketch.mount
      sketch.modules?.forEach((m, i) => pushModule(m, mount, ['sketch', 'modules', i], mount !== undefined))
      if (mount && sketch.abstraction !== undefined) mountAbstractions.push({ mount, value: sketch.abstraction, src: locate(['sketch', 'abstraction']) })
      sketch.relations?.forEach((r, i) => pushRelation(r, ['sketch', 'relations', i]))
      sketch.interfaces?.forEach((x, i) => pushInterface(x, ['sketch', 'interfaces', i]))
      sketch.dataStructures?.forEach((x, i) => pushDataStructure(x, ['sketch', 'dataStructures', i]))
      sketches.push({ def: sketch, file: file.path, src: locate(['sketch']), mount: sketch.mount, needsLayout: !sketch.layout })
    }
    if (data.module) pushModule(data.module, undefined, ['module'], false)
    data.modules?.forEach((m, i) => pushModule(m, undefined, ['modules', i], false))

    data.relations?.forEach((r, i) => pushRelation(r, ['relations', i]))
    data.interfaces?.forEach((x, i) => pushInterface(x, ['interfaces', i]))
    data.dataStructures?.forEach((x, i) => pushDataStructure(x, ['dataStructures', i]))
    data.actors?.forEach((x, i) => actors.push({ ...x, seq: seq++, src: locate(['actors', i]) }))
    const pushScenario = (def: NonNullable<ArchFileDef['scenario']>, path: (string | number)[]) => {
      const { steps, ...rest } = def
      scenarios.push({ ...rest, steps: normalizeSteps(steps, [...path, 'steps'], '', locate), seq: seq++, src: locate(path) })
    }
    if (data.scenario) pushScenario(data.scenario, ['scenario'])
    data.scenarios?.forEach((x, i) => pushScenario(x, ['scenarios', i]))
    if (data.sourceIgnore) sourceIgnore.push(...data.sourceIgnore)
    for (const [id, role] of Object.entries(data.roles ?? {})) roles.push({ id, role, src: locate(['roles', id]) })
    // Z1：各文件的确认记录合并（约定只在 reviewed.yaml）
    data.reviewed?.forEach((x, i) => reviewed.push({ ...x, src: locate(['reviewed', i]) }))
    // G20：sourceLimits 只能声明一次，重复时用第一处
    if (data.sourceLimits && sourceLimits)
      issues.push({ severity: 'warning', code: 'duplicate-source-limits', message: `sourceLimits 只能声明一次，已在 ${sourceLimits.file} 声明，这里的被忽略`, ...locate(['sourceLimits']) })
    else if (data.sourceLimits) sourceLimits = { def: data.sourceLimits, file: locate(['sourceLimits']).file }
    // U1：rules 只能声明一次，重复时用第一处
    if (data.rules && rules)
      issues.push({ severity: 'warning', code: 'duplicate-rules', message: `rules 只能声明一次，已在 ${rules.src.file} 声明，这里的被忽略`, ...locate(['rules']) })
    else if (data.rules) rules = { def: data.rules, src: locate(['rules']) }
  }

  let system = DEFAULT_SYSTEM
  if (systems.length === 0) {
    issues.push({ severity: 'warning', code: 'missing-system', message: `没有文件声明 system，使用默认根「${DEFAULT_SYSTEM.name}」` })
  } else {
    system = systems[0].def
    for (const extra of systems.slice(1)) {
      issues.push({ severity: 'error', code: 'duplicate-system', message: `system 只能声明一次，已在 ${systems[0].src.file} 声明`, ...extra.src })
    }
  }
  for (const m of modules) if (m.parentId === undefined) m.parentId = system.id
  // X10：挂载点模块对内的原则以草图为准；非草图文件写了不同的值即重定义
  for (const a of mountAbstractions) {
    const host = modules.find(m => m.id === a.mount)
    if (!host) {
      issues.push({ severity: 'warning', code: 'sketch-mount-missing', message: `草图的挂载点「${a.mount}」不在描述里，它的原则（abstraction）没有落处`, ...a.src })
      continue
    }
    const other = otherAbstraction.get(a.mount)
    if (other && host.abstraction !== undefined && host.abstraction !== a.value)
      issues.push({
        severity: 'error',
        code: 'sketch-redefined',
        message: `「${a.mount}」的原则（abstraction）由挂在它身上的草图（${a.src.file}）写，这里重定义了它（X1、X10）；以草图为准`,
        ...other,
      })
    host.abstraction = a.value
  }
  // 只有草图的版本（草图作为版本，DV-10：没有 modules/）本来就只画了一部分模块：roles 指向本版本没有的模块不提醒
  const sketchOnly = !files.some(f => f.path.startsWith('modules/'))
  applyRoles(roles, modules, sketched, issues, sketchOnly)

  return {
    model: {
      system, modules, relations, interfaces, dataStructures, actors, scenarios, sourceIgnore, reviewed, ...(sourceLimits ? { sourceLimits: sourceLimits.def } : {}),
      ...(rules ? { rules: rules.def, rulesSrc: rules.src } : {}),
      sketches,
    },
    issues,
  }
}

/**
 * M16：intent/roles.yaml 的角色落到模块上——草图里写了 role 的以草图为准（不同时提醒），没写的取 roles.yaml；
 * 指向不存在的模块提醒（只有草图的版本不提醒）。AI 生成的 modules/ 不写 role（04 §3.2），写了也被 roles.yaml 覆盖。
 */
function applyRoles(
  roles: readonly { id: string; role: ModuleRole; src: SourceLoc }[],
  modules: ModuleEntity[],
  sketched: ReadonlyMap<string, { written: Set<string>; file: string }>,
  issues: Issue[],
  sketchOnly = false,
) {
  const byId = new Map(modules.map(m => [m.id, m]))
  for (const { id, role, src } of roles) {
    const m = byId.get(id)
    if (!m) {
      if (!sketchOnly) issues.push({ severity: 'warning', code: 'roles.unknown-module', message: `roles 里的模块「${id}」不在描述里，这条角色没有落处（M16）`, ...src })
      continue
    }
    const sk = sketched.get(`module:${id}`)
    if (sk?.written.has('role')) {
      if (m.role !== role)
        issues.push({
          severity: 'warning',
          code: 'roles.shadowed',
          message: `「${id}」的 role 已由草图（${sk.file}）写为 ${m.role}，roles 里的 ${role} 不生效（草图为准，M16）`,
          ...src,
        })
      continue
    }
    m.role = role
    m.roleFrom = 'roles'
  }
}

/** M12：旧名映射为新类型（event 同时翻转两端），每条提醒迁移 */
function currentType(r: RelationDef, src: SourceLoc, issues: Issue[]): Pick<RelationEntity, 'type' | 'from' | 'to'> {
  if (!(r.type in LEGACY_RELATION_TYPES)) return { type: r.type as RelationType, from: r.from, to: r.to }
  const legacy = LEGACY_RELATION_TYPES[r.type as LegacyRelationType]
  issues.push({
    severity: 'warning',
    code: 'relation-type-renamed',
    message: `关系「${r.id}」的类型「${r.type}」已改名为「${legacy.to}」${legacy.flip ? '，箭头改为控制流方向（发布者 → 订阅者），from / to 已按翻转读取' : ''}；请按提醒改为新名${legacy.flip ? '并对调 from / to' : ''}（别名一轮后删除）`,
    ...src,
  })
  return legacy.flip ? { type: legacy.to, from: r.to, to: r.from } : { type: legacy.to, from: r.from, to: r.to }
}

/** 步骤树规整为 Step：记录路径（F2）与出处，payload 规整为数组 */
function normalizeSteps(defs: StepDef[], yamlPath: (string | number)[], prefix: string, locate: ParsedFile['locate']): Step[] {
  return defs.map((def, i) => {
    const at = [...yamlPath, i]
    const path = prefix ? `${prefix}.${i}` : String(i)
    const src = locate(at)
    if ('call' in def || 'async' in def || 'return' in def) {
      const kind = 'call' in def ? 'call' : 'async' in def ? 'async' : 'return'
      const raw = 'call' in def ? def.call : 'async' in def ? def.async : def.return
      const payload = raw.payload === undefined ? [] : Array.isArray(raw.payload) ? raw.payload : [raw.payload]
      return { kind, path, src, msg: { ...raw, payload } }
    }
    if ('alt' in def) {
      return {
        kind: 'alt',
        path,
        src,
        branches: def.alt.map((b, k) => ({ when: b.when, steps: normalizeSteps(b.steps, [...at, 'alt', k, 'steps'], `${path}.alt${k}`, locate) })),
      }
    }
    if ('loop' in def) return { kind: 'loop', path, src, while: def.loop.while, steps: normalizeSteps(def.loop.steps, [...at, 'loop', 'steps'], `${path}.loop`, locate) }
    if ('par' in def) {
      return { kind: 'par', path, src, branches: def.par.map((b, k) => ({ steps: normalizeSteps(b.steps, [...at, 'par', k, 'steps'], `${path}.par${k}`, locate) })) }
    }
    return { kind: 'ref', path, src, scenario: def.ref }
  })
}

interface ParsedFile {
  data: ArchFileDef
  locate: (path: (string | number)[]) => SourceLoc
}

function parseFile(file: RawFile, issues: Issue[]): ParsedFile | null {
  const lineCounter = new LineCounter()
  const doc = parseDocument(file.text, { lineCounter, prettyErrors: false })
  if (doc.errors.length > 0) {
    for (const err of doc.errors) {
      issues.push({
        severity: 'error',
        code: 'yaml-syntax',
        message: `YAML 语法错误：${err.message.split('\n')[0]}`,
        file: file.path,
        line: lineCounter.linePos(err.pos[0]).line,
      })
    }
    return null
  }
  const data = doc.toJS() as unknown
  if (data === null || data === undefined) return null

  const locate = makeLocator(file.path, doc, lineCounter)
  if (upgradeLegacySkeleton(data, file.path))
    issues.push({
      severity: 'warning',
      code: 'sketch-legacy-mount',
      message: '草图没有 mount：一期的骨架（顶层全是层）按根挂载读取（X9）；请加 mount: root',
      ...locate(['sketch']),
    })
  for (const { at, both } of migrateCore(data))
    issues.push({
      severity: 'warning',
      code: 'module.core-legacy',
      message: both
        ? '同时写了旧写法 core 与 role：以 role 为准；请删除 core（M16）'
        : 'core: true 是旧写法，已按 role: core 读取；请改为 role: core（M16）',
      ...locate(at),
    })
  for (const loc of dropRemovedRelations(data).map(locate))
    issues.push({
      severity: 'warning',
      code: 'relation.depends-removed',
      message: `depends 已不是关系类型（ADR-0026），这条关系已丢弃：谁知道谁由代码事实给出；有交互的按三问写 queries / commands / notifies / streams，实现端口的写进接口的 implementedBy（M15）`,
      ...loc,
    })
  if (!validateFile(data)) {
    for (const err of dedupeErrors(validateFile.errors ?? [])) {
      const path = err.instancePath.split('/').slice(1).map(seg => (/^\d+$/.test(seg) ? Number(seg) : seg))
      issues.push({ severity: 'error', code: 'schema', message: `格式错误：${describeSchemaError(err)}（整份文件已跳过）`, ...locate(path) })
    }
    return null
  }
  return { data, locate }
}

/**
 * M16：模块的旧写法 `core`——`core: true` 映射为 `role: core`，`core: false` 去掉；同时写了 role 的以 role 为准。
 * 覆盖文件顶层的 module / modules 与草图的 modules，含内联子模块；返回每处的路径（先取位置、后改写）。
 */
function migrateCore(data: unknown): { at: (string | number)[]; both: boolean }[] {
  const out: { at: (string | number)[]; both: boolean }[] = []
  const visit = (m: unknown, at: (string | number)[]) => {
    if (!m || typeof m !== 'object') return
    const mod = m as { core?: unknown; role?: unknown; children?: unknown }
    if ('core' in mod) {
      const both = mod.role !== undefined
      if (mod.core === true || both) out.push({ at: [...at, 'core'], both })
      if (mod.core === true && !both) mod.role = 'core'
      delete mod.core
    }
    if (Array.isArray(mod.children)) mod.children.forEach((c, i) => visit(c, [...at, 'children', i]))
  }
  if (!data || typeof data !== 'object') return out
  const d = data as { module?: unknown; modules?: unknown; sketch?: { modules?: unknown } }
  visit(d.module, ['module'])
  if (Array.isArray(d.modules)) d.modules.forEach((m, i) => visit(m, ['modules', i]))
  if (d.sketch && Array.isArray(d.sketch.modules)) d.sketch.modules.forEach((m, i) => visit(m, ['sketch', 'modules', i]))
  return out
}

/**
 * M15：丢弃 `type: depends` 的关系（文件顶层与草图里的 relations），返回它们在文件中的路径（先取位置、后删除）。
 * 迁移期的读取方式：提醒而不整份跳过；schema 里已没有 depends。
 */
function dropRemovedRelations(data: unknown): (string | number)[][] {
  const at: (string | number)[][] = []
  const sweep = (holder: unknown, base: (string | number)[]) => {
    const list = (holder as { relations?: unknown } | null)?.relations
    if (!Array.isArray(list)) return
    const kept = list.filter((r, i) => {
      const removed = !!r && typeof r === 'object' && (r as { type?: unknown }).type === REMOVED_RELATION_TYPE
      if (removed) at.push([...base, 'relations', i])
      return !removed
    })
    if (kept.length !== list.length) (holder as { relations: unknown[] }).relations = kept
  }
  if (!data || typeof data !== 'object') return at
  sweep(data, [])
  sweep((data as { sketch?: unknown }).sketch, ['sketch'])
  return at
}

/**
 * X9：一期骨架的读取——intent/ 下没有 mount、顶层模块全是层的草图按根挂载读取（历史提交与设计基线里的骨架都是这个形状）。
 * 其余没有 mount 的草图不升级，按格式错误跳过。返回是否升级了。
 */
function upgradeLegacySkeleton(data: unknown, path: string): boolean {
  const sketch = (data as { sketch?: Record<string, unknown> } | null)?.sketch
  if (!sketch || typeof sketch !== 'object' || 'mount' in sketch || !/(^|\/)intent\/[^/]+\.ya?ml$/.test(path)) return false
  const modules = sketch.modules
  if (!Array.isArray(modules) || !modules.length || !modules.every(m => m && typeof m === 'object' && (m as { kind?: unknown }).kind === 'layer')) return false
  sketch.mount = ROOT_MOUNT
  return true
}

/** X7f：草图定义的形状（按同一份 JSON Schema 检查 { sketch: def }）；返回每处问题的位置与说明 */
export function sketchShapeIssues(def: unknown): { path: string; message: string }[] {
  if (validateFile({ sketch: def })) return []
  return dedupeErrors(validateFile.errors ?? []).map(err => ({ path: err.instancePath.split('/').slice(1).join('.'), message: describeSchemaError(err) }))
}

function makeLocator(file: string, doc: Document, lineCounter: LineCounter) {
  return (path: (string | number)[]): SourceLoc => {
    const node = doc.getIn(path, true) as { range?: [number, number, number] } | undefined
    const offset = node?.range?.[0]
    return { file, path: path.join('.'), line: offset === undefined ? undefined : lineCounter.linePos(offset).line }
  }
}

/**
 * oneOf 等组合关键字会对同一位置报出多条错误，每个位置只保留最有用的一条；
 * 嵌套结构（步骤树）中，深处已有错误时不再报它外层各候选分支的失败
 */
function dedupeErrors(errors: ErrorObject[]): ErrorObject[] {
  const byPath = new Map<string, ErrorObject>()
  for (const e of errors) {
    const prev = byPath.get(e.instancePath)
    if (!prev || prev.keyword === 'oneOf') byPath.set(e.instancePath, e)
  }
  const paths = [...byPath.keys()]
  return [...byPath.values()].filter(e => !paths.some(p => p.startsWith(`${e.instancePath}/`)))
}

const STEP_KEYS = ['call', 'async', 'return', 'alt', 'loop', 'par', 'ref']

function describeSchemaError(err: ErrorObject): string {
  const where = err.instancePath || '(文件顶层)'
  switch (err.keyword) {
    case 'additionalProperties':
      return `${where} 不认识的字段「${(err.params as { additionalProperty: string }).additionalProperty}」`
    case 'required':
      if (/\/steps\/\d+$/.test(err.instancePath) && STEP_KEYS.includes((err.params as { missingProperty: string }).missingProperty)) return `${where} 步骤必须是 call / async / return / alt / loop / par / ref 之一（每个步骤只写一个键）`
      return `${where} 缺少必填字段「${(err.params as { missingProperty: string }).missingProperty}」`
    case 'enum':
      return `${where} 取值必须是 ${(err.params as { allowedValues: unknown[] }).allowedValues.join(' / ')} 之一`
    case 'pattern':
      return `${where} ID 只能包含字母、数字和 . _ : -，且以字母或数字开头`
    default:
      return `${where} ${err.message ?? err.keyword}`
  }
}
