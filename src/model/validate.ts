/**
 * Validator：跨文件检查引用完整性与结构约束。
 *
 * 不抛异常：有问题的实体被剔除或修剪，返回一份可以安全建索引的模型 + 问题列表。
 * - error：实体被剔除（重复 ID、父模块不存在、关系端点无效……）
 * - warning：实体保留，有问题的引用被去掉，或只是提醒补全内容
 */
import type {
  ActorEntity,
  ArchModel,
  DataStructureEntity,
  InterfaceEntity,
  Issue,
  ModelIndex,
  ModuleEntity,
  RelationEntity,
  ReviewedEntry,
  RulesDef,
  ScenarioEntity,
  SourceLoc,
  Step,
} from './types'
import { buildIndex } from './indexer'
import { bindRelation, forEachStep, mapChildren } from './scenario'

export interface ValidateResult {
  model: ArchModel
  issues: Issue[]
}

type Report = (code: string, message: string, src?: SourceLoc) => void

/** 各实体的检查共用：问题收集与已通过检查的模块、参与者、接口、数据结构 */
interface Checked {
  rootId: string
  err: Report
  warn: Report
  modules: Map<string, ModuleEntity>
  actors: Map<string, ActorEntity>
  interfaces: Map<string, InterfaceEntity>
  dataStructures: Map<string, DataStructureEntity>
}

export function validate(input: ArchModel): ValidateResult {
  const issues: Issue[] = []
  const err: Report = (code, message, src) => issues.push({ severity: 'error', code, message, ...src })
  const warn: Report = (code, message, src) => issues.push({ severity: 'warning', code, message, ...src })
  const rootId = input.system.id

  const modules = checkModules(input, err)
  const actors = checkActors(input, modules, err)
  // ── 接口、数据结构：ID 唯一 ──
  const interfaces = dedupe(input.interfaces, 'interface', err)
  const dataStructures = dedupe(input.dataStructures, 'data-structure', err)
  const c: Checked = { rootId, err, warn, modules, actors, interfaces, dataStructures }
  checkModuleRefs(c)
  checkLayers(c)
  const relations = checkRelations(input, c)

  const structural: ArchModel = {
    system: input.system,
    modules: [...modules.values()].sort((a, b) => a.seq - b.seq),
    relations,
    interfaces: [...interfaces.values()],
    dataStructures: [...dataStructures.values()],
    actors: [...actors.values()],
    scenarios: [],
    sourceIgnore: input.sourceIgnore ?? [],
    reviewed: cleanReviewed(input.reviewed ?? [], id => modules.has(id), warn),
    sketches: input.sketches ?? [],
    ...(input.sourceLimits ? { sourceLimits: input.sourceLimits } : {}),
    ...(input.rules ? { rules: cleanRules(input.rules, id => modules.has(id), input.rulesSrc, err, warn), rulesSrc: input.rulesSrc } : {}),
  }
  const scenarios = checkScenarios(input, c, structural)
  return { model: { ...structural, scenarios }, issues }
}

/** 模块：ID 唯一、父模块存在、无环 */
function checkModules(input: ArchModel, err: Report): Map<string, ModuleEntity> {
  const rootId = input.system.id
  const modules = new Map<string, ModuleEntity>()
  for (const m of input.modules) {
    if (m.id === rootId) err('module-id-is-system', `模块 ID「${m.id}」与系统根 ID 相同`, m.src)
    else if (modules.has(m.id)) err('duplicate-module', `模块 ID「${m.id}」重复，首次定义在 ${modules.get(m.id)!.src.file}`, m.src)
    else modules.set(m.id, { ...m })
  }
  dropOrphans(input, modules, err)
  dropParentCycles(rootId, modules, err)
  // 环上节点删掉后，其后代同样需要剔除
  const reachesRoot = (id: string): boolean => {
    let cur: string | undefined = id
    for (let guard = 0; cur !== undefined && guard <= modules.size; guard++) {
      if (cur === rootId) return true
      cur = modules.get(cur)?.parentId
    }
    return false
  }
  for (const m of [...modules.values()]) if (!reachesRoot(m.id)) modules.delete(m.id)
  return modules
}

/** 父模块不存在：剔除，其后代随之失去父模块，反复剔除直到稳定 */
function dropOrphans(input: ArchModel, modules: Map<string, ModuleEntity>, err: Report) {
  const rootId = input.system.id
  let changed = true
  while (changed) {
    changed = false
    for (const m of modules.values()) {
      if (m.parentId !== rootId && !modules.has(m.parentId)) {
        if (!input.modules.some(x => x.id === m.parentId)) {
          err('unknown-parent', `模块「${m.id}」的父模块「${m.parentId}」不存在`, m.src)
        }
        modules.delete(m.id)
        changed = true
      }
    }
  }
}

/** 父链成环（跨文件用 parent 互相指向时可能出现） */
function dropParentCycles(rootId: string, modules: Map<string, ModuleEntity>, err: Report) {
  for (const m of [...modules.values()]) {
    const seen = new Set<string>([m.id])
    let cur = m.parentId
    while (cur !== rootId) {
      if (seen.has(cur)) {
        err('parent-cycle', `模块「${m.id}」的父链成环`, m.src)
        modules.delete(m.id)
        break
      }
      seen.add(cur)
      const next = modules.get(cur)
      if (!next) break
      cur = next.parentId
    }
  }
}

/** 外部参与者：ID 唯一，不与模块、系统根重复（M3、A1） */
function checkActors(input: ArchModel, modules: ReadonlyMap<string, ModuleEntity>, err: Report): Map<string, ActorEntity> {
  const actors = new Map<string, ActorEntity>()
  for (const a of input.actors) {
    if (a.id === input.system.id || modules.has(a.id) || input.modules.some(m => m.id === a.id)) err('actor-id-conflict', `参与者 ID「${a.id}」与模块或系统根重复`, a.src)
    else if (actors.has(a.id)) err('duplicate-actor', `参与者 ID「${a.id}」重复，首次定义在 ${actors.get(a.id)!.src.file}`, a.src)
    else actors.set(a.id, { ...a })
  }
  return actors
}

/** 模块内引用：接口、数据结构存在，职责已填；接口的提供方存在 */
function checkModuleRefs({ modules, interfaces, dataStructures, warn }: Checked) {
  for (const m of modules.values()) {
    if (m.provides) m.provides = keepKnown(m.provides, interfaces, id => warn('unknown-interface', `模块「${m.id}」引用的接口「${id}」不存在`, m.src))
    if (m.dataStructures) {
      m.dataStructures = keepKnown(m.dataStructures, dataStructures, id => warn('unknown-data-structure', `模块「${m.id}」引用的数据结构「${id}」不存在`, m.src))
    }
    if (!m.responsibility?.trim()) warn('missing-responsibility', `模块「${m.id}」没有填写职责`, m.src)
  }
  for (const x of interfaces.values()) {
    if (x.owner && !modules.has(x.owner)) {
      warn('unknown-owner', `接口「${x.id}」的提供方「${x.owner}」不存在`, x.src)
      x.owner = undefined
    }
  }
}

/** 层：同级要么都是层、要么都不是；order、abstraction 已填；mayDependOn 只引用同级的层 */
function checkLayers({ modules, warn }: Checked) {
  const childrenOf = new Map<string, ModuleEntity[]>()
  for (const m of modules.values()) {
    const list = childrenOf.get(m.parentId) ?? []
    list.push(m)
    childrenOf.set(m.parentId, list)
  }
  for (const [parentId, kids] of childrenOf) {
    const layers = kids.filter(k => k.kind === 'layer')
    if (layers.length === 0) continue
    if (layers.length !== kids.length) {
      warn('mixed-layer-siblings', `「${parentId}」的子模块中只有一部分是层（kind: layer），不会按分层总览呈现`, layers[0].src)
      continue
    }
    const layerIds = new Set(layers.map(l => l.id))
    for (const l of layers) {
      if (l.order === undefined) warn('layer-missing-order', `层「${l.id}」没有 order，按声明顺序排列`, l.src)
      if (!l.abstraction?.trim()) warn('layer-missing-abstraction', `层「${l.id}」没有填写抽象原则 abstraction`, l.src)
      if (l.mayDependOn) {
        l.mayDependOn = l.mayDependOn.filter(id => {
          if (layerIds.has(id)) return true
          warn('unknown-layer', `层「${l.id}」的 mayDependOn 引用了「${id}」，它不是同级的层`, l.src)
          return false
        })
      }
    }
  }
}

const isEndpoint = (c: Checked, id: string) => c.modules.has(id) || c.actors.has(id)

/** 关系：ID 唯一、端点有效、不连自身 / 两个参与者 / 祖先与后代；接口与数据结构引用存在 */
function checkRelations(input: ArchModel, c: Checked): RelationEntity[] {
  const relations: RelationEntity[] = []
  const relationIds = new Set<string>()
  let contracts: Set<string> | undefined
  for (const r0 of input.relations) {
    const r = { ...r0, payload: [...r0.payload] }
    if (relationIds.has(r.id)) {
      c.err('duplicate-relation', `关系 ID「${r.id}」重复`, r.src)
      continue
    }
    if (!relationEndsValid(c, r)) continue
    if (r.interface && !c.interfaces.has(r.interface)) {
      c.warn('unknown-interface', `关系「${r.id}」引用的接口「${r.interface}」不存在`, r.src)
      r.interface = undefined
    }
    r.payload = keepKnown(r.payload, c.dataStructures, id => c.warn('unknown-data-structure', `关系「${r.id}」引用的数据结构「${id}」不存在`, r.src))
    // M13：pull 只对 streams 有意义
    if (r.pull !== undefined && r.type !== 'streams') {
      c.warn('pull-not-streams', `关系「${r.id}」是 ${r.type}，pull 只用于 streams（拉取型流），已忽略`, r.src)
      delete r.pull
    }
    // M11：implements 的目标须声明接口
    if (r.type === 'implements' && c.modules.has(r.to) && !(contracts ??= modulesWithInterfaces(c)).has(r.to))
      c.warn('implements-no-interface', `关系「${r.id}」实现「${r.to}」，但它没有声明任何接口（provides 或 owner 为它的接口）；没有可实现的契约时应为 depends，否则补上接口声明`, r.src)
    relationIds.add(r.id)
    relations.push(r)
  }
  return relations
}

/** M11：声明了接口的模块——provides 非空，或是某个接口 owner 的自身或祖先（同 G12 的 moduleInterfaces） */
function modulesWithInterfaces(c: Checked): Set<string> {
  const out = new Set<string>()
  for (const m of c.modules.values()) if (m.provides?.length) out.add(m.id)
  for (const x of c.interfaces.values()) {
    for (let cur: string | undefined = x.owner; cur !== undefined && cur !== c.rootId; cur = c.modules.get(cur)?.parentId) out.add(cur)
  }
  return out
}

/** 关系的两端：报错并返回 false 表示剔除 */
function relationEndsValid(c: Checked, r: RelationEntity): boolean {
  const isAncestor = (anc: string, id: string): boolean => {
    let cur = c.modules.get(id)?.parentId
    while (cur !== undefined && cur !== c.rootId) {
      if (cur === anc) return true
      cur = c.modules.get(cur)?.parentId
    }
    return false
  }
  const badEnd = [r.from, r.to].find(id => !isEndpoint(c, id))
  if (badEnd !== undefined) c.err('unknown-endpoint', `关系「${r.id}」的端点「${badEnd}」不存在`, r.src)
  else if (r.from === r.to) c.err('self-relation', `关系「${r.id}」的两端是同一个模块`, r.src)
  else if (c.actors.has(r.from) && c.actors.has(r.to)) c.err('actor-relation', `关系「${r.id}」的两端都是外部参与者，系统内没有端点`, r.src)
  else if (isAncestor(r.from, r.to) || isAncestor(r.to, r.from)) {
    c.err('ancestor-relation', `关系「${r.id}」连接了祖先与后代（${r.from} / ${r.to}），包含关系已由模块树表达`, r.src)
  } else return true
  return false
}

/** 场景（S5–S13）：ID 唯一、步骤引用有效、ref 无循环、与结构一致 */
function checkScenarios(input: ArchModel, c: Checked, structural: ArchModel): ScenarioEntity[] {
  const scenarios = new Map<string, ScenarioEntity>()
  for (const sc of input.scenarios) {
    if (scenarios.has(sc.id)) c.err('duplicate-scenario', `场景 ID「${sc.id}」重复，首次定义在 ${scenarios.get(sc.id)!.src.file}`, sc.src)
    else scenarios.set(sc.id, sc)
  }
  const relationIds = new Set(structural.relations.map(r => r.id))
  for (const [id, sc] of scenarios) scenarios.set(id, { ...sc, steps: cleanSteps(c, id, sc.steps, scenarios, relationIds) })
  dropCyclicRefs(scenarios, c.err)
  // S5a、S12：与结构的一致性，与回放共用 bindRelation
  const index = buildIndex(structural)
  for (const [id, sc] of scenarios) scenarios.set(id, { ...sc, steps: checkBinding(index, c, sc, sc.steps) })
  return [...scenarios.values()]
}

/** 步骤：ref 指向存在的场景，端点有效，步骤 id 在场景内唯一，关系、接口、数据结构引用存在 */
function cleanSteps(c: Checked, id: string, steps: Step[], scenarios: ReadonlyMap<string, ScenarioEntity>, relationIds: ReadonlySet<string>): Step[] {
  const msgIds = new Set<string>()
  const clean = (steps: Step[]): Step[] =>
    steps.flatMap<Step>(s => {
      if (s.kind === 'ref') {
        if (scenarios.has(s.scenario)) return [s]
        c.err('unknown-ref', `场景「${id}」引用的场景「${s.scenario}」不存在`, s.src)
        return []
      }
      if (!('msg' in s)) return [mapChildren(s, clean)]
      const msg = cleanMessage(c, id, s, msgIds, relationIds)
      return msg ? [{ ...s, msg }] : []
    })
  return clean(steps)
}

type MessageStep = Extract<Step, { msg: unknown }>

/** 一条消息步骤；端点无效时返回 null（剔除） */
function cleanMessage(c: Checked, id: string, s: MessageStep, msgIds: Set<string>, relationIds: ReadonlySet<string>): MessageStep['msg'] | null {
  const msg = { ...s.msg, payload: [...s.msg.payload] }
  const badEnd = [msg.from, msg.to].find(x => !isEndpoint(c, x))
  if (badEnd !== undefined) {
    c.err('unknown-step-endpoint', `场景「${id}」步骤 ${s.path} 的端点「${badEnd}」不是已声明的模块或参与者`, s.src)
    return null
  }
  if (msg.id !== undefined) {
    if (msgIds.has(msg.id)) {
      c.err('duplicate-step-id', `场景「${id}」中步骤 id「${msg.id}」重复，已改用路径 ${s.path}`, s.src)
      msg.id = undefined
    } else msgIds.add(msg.id)
  }
  if (msg.relation && !relationIds.has(msg.relation)) {
    c.warn('unknown-relation', `场景「${id}」步骤 ${s.path} 引用的关系「${msg.relation}」不存在`, s.src)
    msg.relation = undefined
  }
  if (msg.interface && !c.interfaces.has(msg.interface)) {
    c.warn('unknown-interface', `场景「${id}」步骤 ${s.path} 引用的接口「${msg.interface}」不存在`, s.src)
    msg.interface = undefined
  }
  msg.payload = keepKnown(msg.payload, c.dataStructures, x => c.warn('unknown-data-structure', `场景「${id}」步骤 ${s.path} 引用的数据结构「${x}」不存在`, s.src))
  return msg
}

/** S6：ref 无循环引用；成环的 ref 步骤被剔除 */
function dropCyclicRefs(scenarios: Map<string, ScenarioEntity>, err: Report) {
  const refsOf = (steps: readonly Step[]) => {
    const out: Extract<Step, { kind: 'ref' }>[] = []
    forEachStep(steps, s => s.kind === 'ref' && out.push(s))
    return out
  }
  const cyclic = new Set<Step>()
  const visit = (id: string, stack: string[]) => {
    for (const r of refsOf(scenarios.get(id)!.steps)) {
      if (cyclic.has(r)) continue
      if (r.scenario === id || stack.includes(r.scenario)) {
        err('ref-cycle', `场景「${id}」的 ref 引用「${r.scenario}」形成循环（${[...stack, id, r.scenario].join(' → ')}）`, r.src)
        cyclic.add(r)
      } else visit(r.scenario, [...stack, id])
    }
  }
  for (const id of scenarios.keys()) visit(id, [])
  const dropRefs = (steps: Step[]): Step[] => steps.filter(s => !cyclic.has(s)).map(s => mapChildren(s, dropRefs))
  if (cyclic.size > 0) for (const [id, sc] of scenarios) scenarios.set(id, { ...sc, steps: dropRefs(sc.steps) })
}

/** S5a、S12：步骤引用的关系须是运行时关系且端点方向一致，否则去掉引用；两端之间没有任何关系时提醒 */
function checkBinding(index: ModelIndex, c: Checked, sc: ScenarioEntity, steps: Step[]): Step[] {
  return steps.map(s => {
    if (!('msg' in s)) return mapChildren(s, x => checkBinding(index, c, sc, x))
    const b = bindRelation(index, { kind: s.kind, ...s.msg })
    const where = `场景「${sc.id}」步骤 ${s.path}（${s.msg.from} → ${s.msg.to}）`
    if (b.issue === 'not-runtime') {
      const t = index.relations.get(b.relation!)!.type
      c.err('step-relation-not-runtime', `${where} 引用了 ${t} 关系「${b.relation}」；步骤只对应运行时关系（calls / notifies / streams）`, s.src)
      return { ...s, msg: { ...s.msg, relation: undefined } }
    }
    if (b.issue === 'mismatch') {
      const r = index.relations.get(b.relation!)!
      c.err('step-relation-mismatch', `${where} 与引用的关系「${r.id}」（${r.from} → ${r.to}，${r.type}）端点或方向不一致`, s.src)
      return { ...s, msg: { ...s.msg, relation: undefined } }
    }
    if (b.issue === 'unrelated') c.warn('step-unmodeled', `${where} 在结构图中没有对应关系，两端之间也没有任何关系`, s.src)
    return s
  })
}

function dedupe<T extends { id: string; src: SourceLoc }>(
  items: readonly T[],
  label: string,
  err: Report,
): Map<string, T> {
  const map = new Map<string, T>()
  for (const x of items) {
    if (map.has(x.id)) err(`duplicate-${label}`, `${label === 'interface' ? '接口' : '数据结构'} ID「${x.id}」重复`, x.src)
    else map.set(x.id, { ...x })
  }
  return map
}

function keepKnown(ids: readonly string[], known: Map<string, unknown>, onUnknown: (id: string) => void): string[] {
  return ids.filter(id => {
    if (known.has(id)) return true
    onUnknown(id)
    return false
  })
}

/** Z1：确认记录引用不存在的模块提醒并去掉该条（同 M7）；同一模块多条时取最后一条并提醒 */
function cleanReviewed(entries: readonly ReviewedEntry[], exists: (id: string) => boolean, warn: Report): ReviewedEntry[] {
  const byModule = new Map<string, ReviewedEntry>()
  for (const e of entries) {
    if (!exists(e.module)) {
      warn('unknown-reviewed-module', `确认记录失效：模块 ${e.module} 已改名或删除，请在新模块上重新确认`, e.src)
      continue
    }
    if (byModule.has(e.module)) warn('duplicate-reviewed', `模块「${e.module}」有多条确认记录，取最后一条`, e.src)
    byModule.set(e.module, e)
  }
  return [...byModule.values()]
}

/** U1：规则引用不存在的模块提醒并去掉该条（同 M7）；allow 缺 reason 报错并去掉该条 */
function cleanRules(
  rules: RulesDef,
  exists: (id: string) => boolean,
  src: SourceLoc | undefined,
  err: Report,
  warn: Report,
): RulesDef {
  const known = (ids: readonly string[] | undefined, where: string) =>
    ids?.filter(id => exists(id) || (warn('unknown-rule-module', `${where}引用的模块「${id}」不存在`, src), false))
  const modules = (rules.modules ?? []).flatMap(r => {
    if (!exists(r.module)) {
      warn('unknown-rule-module', `规则引用的模块「${r.module}」不存在，该条被忽略`, src)
      return []
    }
    return [{ ...r, ...(r.mayDependOn ? { mayDependOn: known(r.mayDependOn, `模块「${r.module}」的 mayDependOn `) } : {}) }]
  })
  const allow = (rules.allow ?? []).filter(a => {
    if (!a.reason?.trim()) {
      err('allow-without-reason', `例外 ${a.from} → ${a.to} 没有写 reason，该条被忽略`, src)
      return false
    }
    if (!exists(a.from) || !exists(a.to)) {
      warn('unknown-rule-module', `例外 ${a.from} → ${a.to} 引用的模块不存在，该条被忽略`, src)
      return false
    }
    return true
  })
  const tolerated = known(rules.cycles?.tolerated, 'cycles.tolerated ')
  return {
    ...(rules.layers !== undefined ? { layers: rules.layers } : {}),
    modules,
    allow,
    ...(tolerated ? { cycles: { tolerated } } : {}),
  }
}
