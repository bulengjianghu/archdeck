/**
 * Validator：跨文件检查引用完整性与结构约束。
 *
 * 不抛异常：有问题的实体被剔除或修剪，返回一份可以安全建索引的模型 + 问题列表。
 * - error：实体被剔除（重复 ID、父模块不存在、关系端点无效……）
 * - warning：实体保留，有问题的引用被去掉，或只是提醒补全内容
 */
import type { ActorEntity, ArchModel, Issue, ModuleEntity, RelationEntity, RulesDef, ScenarioEntity, SourceLoc, Step } from './types'
import { buildIndex } from './indexer'
import { bindRelation, forEachStep, mapChildren } from './scenario'

export interface ValidateResult {
  model: ArchModel
  issues: Issue[]
}

export function validate(input: ArchModel): ValidateResult {
  const issues: Issue[] = []
  const err = (code: string, message: string, src?: SourceLoc) => issues.push({ severity: 'error', code, message, ...src })
  const warn = (code: string, message: string, src?: SourceLoc) => issues.push({ severity: 'warning', code, message, ...src })
  const rootId = input.system.id

  // ── 模块：ID 唯一、父模块存在、无环 ──
  const modules = new Map<string, ModuleEntity>()
  for (const m of input.modules) {
    if (m.id === rootId) err('module-id-is-system', `模块 ID「${m.id}」与系统根 ID 相同`, m.src)
    else if (modules.has(m.id)) err('duplicate-module', `模块 ID「${m.id}」重复，首次定义在 ${modules.get(m.id)!.src.file}`, m.src)
    else modules.set(m.id, { ...m })
  }
  // 父模块不存在：剔除，其后代随之失去父模块，反复剔除直到稳定
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
  // 父链成环（跨文件用 parent 互相指向时可能出现）
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

  // ── 外部参与者：ID 唯一，不与模块、系统根重复（M3、A1）──
  const actors = new Map<string, ActorEntity>()
  for (const a of input.actors) {
    if (a.id === rootId || modules.has(a.id) || input.modules.some(m => m.id === a.id)) err('actor-id-conflict', `参与者 ID「${a.id}」与模块或系统根重复`, a.src)
    else if (actors.has(a.id)) err('duplicate-actor', `参与者 ID「${a.id}」重复，首次定义在 ${actors.get(a.id)!.src.file}`, a.src)
    else actors.set(a.id, { ...a })
  }
  const isEndpoint = (id: string) => modules.has(id) || actors.has(id)

  // ── 接口、数据结构：ID 唯一 ──
  const interfaces = dedupe(input.interfaces, 'interface', err)
  const dataStructures = dedupe(input.dataStructures, 'data-structure', err)

  // ── 模块内引用 ──
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

  // ── 层 ──
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

  // ── 关系 ──
  const isAncestor = (anc: string, id: string): boolean => {
    let cur = modules.get(id)?.parentId
    while (cur !== undefined && cur !== rootId) {
      if (cur === anc) return true
      cur = modules.get(cur)?.parentId
    }
    return false
  }
  const relations: RelationEntity[] = []
  const relationIds = new Set<string>()
  for (const r0 of input.relations) {
    const r = { ...r0, payload: [...r0.payload] }
    if (relationIds.has(r.id)) {
      err('duplicate-relation', `关系 ID「${r.id}」重复`, r.src)
      continue
    }
    const badEnd = [r.from, r.to].find(id => !isEndpoint(id))
    if (badEnd !== undefined) {
      err('unknown-endpoint', `关系「${r.id}」的端点「${badEnd}」不存在`, r.src)
      continue
    }
    if (r.from === r.to) {
      err('self-relation', `关系「${r.id}」的两端是同一个模块`, r.src)
      continue
    }
    if (actors.has(r.from) && actors.has(r.to)) {
      err('actor-relation', `关系「${r.id}」的两端都是外部参与者，系统内没有端点`, r.src)
      continue
    }
    if (isAncestor(r.from, r.to) || isAncestor(r.to, r.from)) {
      err('ancestor-relation', `关系「${r.id}」连接了祖先与后代（${r.from} / ${r.to}），包含关系已由模块树表达`, r.src)
      continue
    }
    if (r.interface && !interfaces.has(r.interface)) {
      warn('unknown-interface', `关系「${r.id}」引用的接口「${r.interface}」不存在`, r.src)
      r.interface = undefined
    }
    r.payload = keepKnown(r.payload, dataStructures, id => warn('unknown-data-structure', `关系「${r.id}」引用的数据结构「${id}」不存在`, r.src))
    relationIds.add(r.id)
    relations.push(r)
  }

  const structural: ArchModel = {
    system: input.system,
    modules: [...modules.values()].sort((a, b) => a.seq - b.seq),
    relations,
    interfaces: [...interfaces.values()],
    dataStructures: [...dataStructures.values()],
    actors: [...actors.values()],
    scenarios: [],
    sourceIgnore: input.sourceIgnore ?? [],
    ...(input.sourceLimits ? { sourceLimits: input.sourceLimits } : {}),
    ...(input.rules ? { rules: cleanRules(input.rules, id => modules.has(id), input.rulesSrc, err, warn), rulesSrc: input.rulesSrc } : {}),
  }

  // ── 场景（S5–S13）──
  const scenarios = new Map<string, ScenarioEntity>()
  for (const sc of input.scenarios) {
    if (scenarios.has(sc.id)) err('duplicate-scenario', `场景 ID「${sc.id}」重复，首次定义在 ${scenarios.get(sc.id)!.src.file}`, sc.src)
    else scenarios.set(sc.id, sc)
  }
  const relationMap = new Map(relations.map(r => [r.id, r]))
  for (const [id, sc] of scenarios) {
    const msgIds = new Set<string>()
    const clean = (steps: Step[]): Step[] =>
      steps.flatMap<Step>(s => {
        if (s.kind === 'ref') {
          if (scenarios.has(s.scenario)) return [s]
          err('unknown-ref', `场景「${id}」引用的场景「${s.scenario}」不存在`, s.src)
          return []
        }
        if (!('msg' in s)) return [mapChildren(s, clean)]
        const msg = { ...s.msg, payload: [...s.msg.payload] }
        const badEnd = [msg.from, msg.to].find(x => !isEndpoint(x))
        if (badEnd !== undefined) {
          err('unknown-step-endpoint', `场景「${id}」步骤 ${s.path} 的端点「${badEnd}」不是已声明的模块或参与者`, s.src)
          return []
        }
        if (msg.id !== undefined) {
          if (msgIds.has(msg.id)) {
            err('duplicate-step-id', `场景「${id}」中步骤 id「${msg.id}」重复，已改用路径 ${s.path}`, s.src)
            msg.id = undefined
          } else msgIds.add(msg.id)
        }
        if (msg.relation && !relationMap.has(msg.relation)) {
          warn('unknown-relation', `场景「${id}」步骤 ${s.path} 引用的关系「${msg.relation}」不存在`, s.src)
          msg.relation = undefined
        }
        if (msg.interface && !interfaces.has(msg.interface)) {
          warn('unknown-interface', `场景「${id}」步骤 ${s.path} 引用的接口「${msg.interface}」不存在`, s.src)
          msg.interface = undefined
        }
        msg.payload = keepKnown(msg.payload, dataStructures, x => warn('unknown-data-structure', `场景「${id}」步骤 ${s.path} 引用的数据结构「${x}」不存在`, s.src))
        return [{ ...s, msg }]
      })
    scenarios.set(id, { ...sc, steps: clean(sc.steps) })
  }
  // S6：ref 无循环引用；成环的 ref 步骤被剔除
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

  // S5a、S12：与结构的一致性，与回放共用 bindRelation
  const index = buildIndex(structural)
  const checkBinding = (sc: ScenarioEntity, steps: Step[]): Step[] =>
    steps.map(s => {
      if (!('msg' in s)) return mapChildren(s, x => checkBinding(sc, x))
      const b = bindRelation(index, { kind: s.kind, ...s.msg })
      const where = `场景「${sc.id}」步骤 ${s.path}（${s.msg.from} → ${s.msg.to}）`
      if (b.issue === 'not-runtime') {
        const t = index.relations.get(b.relation!)!.type
        err('step-relation-not-runtime', `${where} 引用了 ${t} 关系「${b.relation}」；步骤只对应运行时关系（calls / dataflow / event）`, s.src)
        return { ...s, msg: { ...s.msg, relation: undefined } }
      }
      if (b.issue === 'mismatch') {
        const r = index.relations.get(b.relation!)!
        err('step-relation-mismatch', `${where} 与引用的关系「${r.id}」（${r.from} → ${r.to}，${r.type}）端点或方向不一致`, s.src)
        return { ...s, msg: { ...s.msg, relation: undefined } }
      }
      if (b.issue === 'unrelated') warn('step-unmodeled', `${where} 在结构图中没有对应关系，两端之间也没有任何关系`, s.src)
      return s
    })
  for (const [id, sc] of scenarios) scenarios.set(id, { ...sc, steps: checkBinding(sc, sc.steps) })

  return { model: { ...structural, scenarios: [...scenarios.values()] }, issues }
}

function dedupe<T extends { id: string; src: SourceLoc }>(
  items: readonly T[],
  label: string,
  err: (code: string, message: string, src?: SourceLoc) => void,
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

/** U1：规则引用不存在的模块提醒并去掉该条（同 M7）；allow 缺 reason 报错并去掉该条 */
function cleanRules(
  rules: RulesDef,
  exists: (id: string) => boolean,
  src: SourceLoc | undefined,
  err: (code: string, message: string, src?: SourceLoc) => void,
  warn: (code: string, message: string, src?: SourceLoc) => void,
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
