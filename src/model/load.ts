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
import { LEGACY_RELATION_TYPES, MIGRATED_RELATION_TYPE, REMOVED_RELATION_TYPE, ROOT_MOUNT } from './types'
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
  SketchDef,
  SketchEntity,
  SourceLoc,
  Step,
  StepDef,
  StrataDef,
  StratumDef,
  StratumEntity,
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
  /** ST（ADR-0052）：各文件的分层声明（父模块 → 层），加载完按「草图为准」合并（mergeStrata） */
  const strata: StrataDecl[] = []
  let seq = 0

  // X1：草图文件先入；其余按路径排序
  const sorted = [...files].sort((a, b) => Number(isSketchFile(b.path)) - Number(isSketchFile(a.path)) || a.path.localeCompare(b.path))
  for (const file of sorted) {
    const parsed = parseFile(file, issues)
    if (!parsed) continue
    const { data, locate, migrated } = parsed
    const sketch = data.sketch
    const pushStrata = (def: StrataDef | undefined, base: (string | number)[], fromSketch: boolean) => {
      for (const [parent, defs] of Object.entries(def ?? {})) {
        const from = migrated.get(`${base.join('.')}|${parent}`)
        const src = locate([...base, parent])
        strata.push({ parent, defs: defs.map((x, i) => ({ def: x, src: from?.get(x.id) ?? { ...src, path: `${src.path}.${i}` } })), src, fromSketch, migrated: !!from })
      }
    }
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
      pushStrata(sketch.strata, ['sketch', 'strata'], true)
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
    pushStrata(data.strata, ['strata'], false)
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
  const mergedStrata = mergeStrata(strata, system.id, issues)

  return {
    model: {
      system, modules, relations, interfaces, dataStructures, actors, scenarios, sourceIgnore, reviewed, ...(sourceLimits ? { sourceLimits: sourceLimits.def } : {}),
      ...(systems.length ? { systemSrc: systems[0].src } : {}),
      ...(rules ? { rules: rules.def, rulesSrc: rules.src } : {}),
      sketches,
      ...(mergedStrata.length ? { strata: mergedStrata } : {}),
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

/**
 * ST（ADR-0052）：各文件的分层声明按父模块合并——根写 root 或系统 ID；同一父模块草图写了的以草图为准（intent/strata.yaml 的同父声明不生效，info），
 * 同为草图或同为非草图文件的后者覆盖前者（提醒）。成员（members 与子模块的 stratum）的归一与校验在 Validator（checkStrata）。
 */
interface StrataDecl {
  parent: string
  defs: { def: StratumDef; src: SourceLoc }[]
  src: SourceLoc
  fromSketch: boolean
  migrated: boolean
}

function mergeStrata(
  decls: readonly StrataDecl[],
  rootId: string,
  issues: Issue[],
): StratumEntity[] {
  const byParent = new Map<string, (typeof decls)[number]>()
  for (const d of decls) {
    const parent = d.parent === ROOT_MOUNT ? rootId : d.parent
    const prev = byParent.get(parent)
    if (prev && prev.fromSketch && !d.fromSketch) {
      issues.push({ severity: 'info', code: 'stratum.shadowed', message: `「${parent}」的分层已由草图（${prev.src.file}）声明，这里的不生效（草图为准）`, ...d.src })
      continue
    }
    // M26：迁移来的旧层可能分在几份文件里（一份一层、或设计草图只写了几层），同 ID 后者覆盖前者、其余合并
    if (prev && prev.fromSketch === d.fromSketch && (prev.migrated || d.migrated)) {
      const ids = new Set(d.defs.map(x => x.def.id))
      byParent.set(parent, { ...d, defs: [...prev.defs.filter(x => !ids.has(x.def.id)), ...d.defs] })
      continue
    }
    // X1：草图之间后者整份覆盖前者（设计的草图在持久草图之后，矛盾由核验报出）；非草图文件重复声明提醒
    if (prev && !prev.fromSketch && !d.fromSketch)
      issues.push({ severity: 'warning', code: 'stratum.redeclared', message: `「${parent}」的分层已在 ${prev.src.file} 声明，这里的覆盖它`, ...d.src })
    byParent.set(parent, d)
  }
  return [...byParent].flatMap(([parent, d]) =>
    d.defs.map(({ def, src }) => {
      const { members, ...rest } = def
      return { ...rest, parent, members: [...(members ?? [])], ...(d.migrated ? { migrated: true as const } : {}), ...(d.fromSketch ? { fromSketch: true as const } : {}), src }
    }),
  )
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
  /** M26：由 kind: layer 迁移出的分层声明（`<strata 的路径>|<父模块>`）→ 层 ID → 原层模块的出处 */
  migrated: Map<string, Map<string, SourceLoc>>
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
  for (const loc of dropRemovedRelations(data, MIGRATED_RELATION_TYPE).map(locate))
    issues.push({
      severity: 'warning',
      code: 'relation.implements-removed',
      message: `implements 已不是关系类型（ADR-0029），这条关系已丢弃：实现端口的写进接口的 implementedBy；有交互的按三问写 queries / commands（M17）`,
      ...loc,
    })
  const migrated = new Map<string, Map<string, SourceLoc>>()
  const moved = migrateLayers(data)
  for (const { at, nested, key, id } of moved) {
    migrated.set(key, (migrated.get(key) ?? new Map()).set(id, locate(at.slice(0, -1))))
    if (nested)
      issues.push({
        severity: 'warning',
        code: 'layer.nested',
        message: '非根层级的 kind: layer 已按「层是分类」读取：成员上提一级、层改为父模块的 strata（M26、ADR-0052）；请改写为 strata',
        ...locate(at),
      })
  }
  // M26：根下的旧层一份文件一条 info（不计入提醒数）
  const roots = moved.filter(x => !x.nested)
  if (roots.length)
    issues.push({ severity: 'info', code: 'layer.migrated', message: `根下的 kind: layer（${roots.map(x => x.id).join('、')}）已读作根的单成员层（M26、ADR-0052）`, ...locate(roots[0].at) })
  if (!validateFile(data)) {
    for (const err of dedupeErrors(validateFile.errors ?? [])) {
      const path = err.instancePath.split('/').slice(1).map(seg => (/^\d+$/.test(seg) ? Number(seg) : seg))
      issues.push({ severity: 'error', code: 'schema', message: `格式错误：${describeSchemaError(err)}（整份文件已跳过）`, ...locate(path) })
    }
    return null
  }
  return { data, locate, migrated }
}

/**
 * M26（ADR-0052）：旧写法 kind: layer 改写为分层声明（先取位置、后改写；不改文件）。
 * - 根下的层（根挂载草图的顶层模块、文件顶层没写 parent 的模块）：读作根的单成员层——层 ID = 模块 ID，name / order / abstraction / mayDependOn 搬到层上
 *   （abstraction 同时留在模块上，作它对内的原则），模块的 kind 记为 subsystem；没写 mayDependOn 的不约束（迁移前即如此）。
 * - 非根层级的层（模块的 children、非根草图的顶层模块）：按「无代码的分组层」溶解——成员上提一级并标 stratum，层变成父模块的层（局部 ID 去掉父模块前缀）。
 * 同一份文件同一父模块的迁移层并入同一份声明（`strata` 已有该父模块的声明时追加）。
 */
function migrateLayers(data: unknown): { at: (string | number)[]; nested: boolean; key: string; id: string }[] {
  const out: { at: (string | number)[]; nested: boolean; key: string; id: string }[] = []
  if (!data || typeof data !== 'object') return out
  type Mod = Record<string, unknown> & { id?: string; kind?: unknown; children?: unknown }
  const isLayer = (m: unknown): m is Mod => !!m && typeof m === 'object' && (m as Mod).kind === 'layer' && typeof (m as Mod).id === 'string'
  const localId = (parent: string, id: string) => (id.startsWith(`${parent}.`) ? id.slice(parent.length + 1) : id)
  const declare = (holder: { strata?: StrataDef }, base: string, parent: string, layer: Mod, members: string[]) => {
    const { id, name, order, abstraction, mayDependOn, designNote } = layer as Mod & StratumDef
    const def: StratumDef = {
      id: parent === ROOT_MOUNT ? id! : localId(parent, id!),
      name: (name as string) ?? id!,
      ...(order !== undefined ? { order } : {}),
      ...(abstraction !== undefined ? { abstraction } : {}),
      ...(mayDependOn !== undefined ? { mayDependOn: (mayDependOn as string[]).map(d => (parent === ROOT_MOUNT ? d : localId(parent, d))) } : {}),
      ...(designNote !== undefined && parent !== ROOT_MOUNT ? { designNote } : {}),
      members,
    }
    holder.strata = holder.strata ?? {}
    ;(holder.strata[parent] = holder.strata[parent] ?? []).push(def)
    return { key: `${base}|${parent}`, id: def.id }
  }
  /** 一组兄弟（父模块 parent）里的嵌套层：溶解为成员，返回新的兄弟列表 */
  const dissolve = (list: unknown[], parent: string, holder: { strata?: StrataDef }, base: string, at: (string | number)[]): unknown[] => {
    const next: unknown[] = []
    list.forEach((m, i) => {
      if (!isLayer(m)) {
        next.push(m)
        return
      }
      const kids = (Array.isArray(m.children) ? m.children : []) as Mod[]
      for (const k of kids) next.push({ ...k, stratum: localId(parent, m.id!) })
      out.push({ at: [...at, i, 'kind'], nested: true, ...declare(holder, base, parent, m, []) })
    })
    return next
  }
  const visit = (m: unknown, holder: { strata?: StrataDef }, base: string, at: (string | number)[]) => {
    if (!m || typeof m !== 'object') return
    const mod = m as Mod
    if (Array.isArray(mod.children)) {
      if (typeof mod.id === 'string' && mod.children.some(isLayer)) mod.children = dissolve(mod.children, mod.id, holder, base, [...at, 'children'])
      ;(mod.children as unknown[]).forEach((c, i) => visit(c, holder, base, [...at, 'children', i]))
    }
  }
  const root = (m: Mod, holder: { strata?: StrataDef }, base: string, at: (string | number)[]) => {
    out.push({ at: [...at, 'kind'], nested: false, ...declare(holder, base, ROOT_MOUNT, m, [m.id!]) })
    m.kind = 'subsystem'
    delete m.order
    delete m.mayDependOn
  }
  const d = data as { module?: unknown; modules?: unknown; sketch?: { mount?: unknown; modules?: unknown; strata?: StrataDef }; strata?: StrataDef }
  const sk = d.sketch && typeof d.sketch === 'object' ? d.sketch : undefined
  if (sk && Array.isArray(sk.modules)) {
    if (sk.mount === ROOT_MOUNT) sk.modules.forEach((m, i) => isLayer(m) && root(m, sk, 'sketch.strata', ['sketch', 'modules', i]))
    else if (typeof sk.mount === 'string' && sk.modules.some(isLayer)) sk.modules = dissolve(sk.modules, sk.mount, sk, 'sketch.strata', ['sketch', 'modules'])
    ;(sk.modules as unknown[]).forEach((m, i) => visit(m, sk, 'sketch.strata', ['sketch', 'modules', i]))
  }
  const top = [...(d.module ? [[d.module, ['module']] as const] : []), ...(Array.isArray(d.modules) ? d.modules.map((m, i) => [m, ['modules', i]] as const) : [])]
  for (const [m, at] of top) {
    if (isLayer(m) && (m as Mod).parent === undefined) root(m as Mod, d, 'strata', [...at])
    visit(m, d, 'strata', [...at])
  }
  return out
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
 * M15 / M17：丢弃已不是关系类型的关系（`depends`、`implements`；文件顶层与草图里的 relations），返回它们在文件中的路径（先取位置、后删除）。
 * 读历史提交的方式：提醒而不整份跳过；schema 里已没有这两个类型。
 */
function dropRemovedRelations(data: unknown, type: string = REMOVED_RELATION_TYPE): (string | number)[][] {
  const at: (string | number)[][] = []
  const sweep = (holder: unknown, base: (string | number)[]) => {
    const list = (holder as { relations?: unknown } | null)?.relations
    if (!Array.isArray(list)) return
    const kept = list.filter((r, i) => {
      const removed = !!r && typeof r === 'object' && (r as { type?: unknown }).type === type
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

/**
 * M26：草图定义里的旧写法 kind: layer 改写为 strata（不改入参，返回新对象；没有旧写法时原样返回）。
 * 草图编辑与校验的入口都先经它，编辑器只认新写法（ADR-0052）。
 */
export function migrateSketch<T extends SketchDef>(def: T): T {
  const has = (list: unknown): boolean =>
    Array.isArray(list) && list.some(m => !!m && typeof m === 'object' && ((m as { kind?: unknown }).kind === 'layer' || has((m as { children?: unknown }).children)))
  if (!has(def.modules)) return def
  const data = { sketch: structuredClone(def) }
  migrateLayers(data)
  return data.sketch
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
