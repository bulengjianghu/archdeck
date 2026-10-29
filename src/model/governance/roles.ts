/**
 * 模块分级的治理（ADR-0027）：疑似共用件的建议（U11）与共用件反向依赖（U12）。
 * 关于被描述系统的知识，页面、lint:model 与 agent 接口共用；只用已有的代码事实（模块依赖 K4 的值使用）与描述。
 */
import { RUNTIME_RELATION_TYPES, isSharedRole, type ModelIndex } from '../types'
import { moduleName } from '../names'
import { within } from './facts'
import { stratumKey } from '../names'
import type { ModuleDep, SharedSuggestion } from './types'

/** U11 ④：名称 / ID 里像工具模块的词（不分大小写；T0 裁决 7：kind: library 无人用，照写但主要按名字） */
export const SHARED_NAME_HINTS: readonly string[] = ['shared', 'util', 'labels', 'contracts']

/** U11、U12：只算值使用（K1 的 uses）的模块依赖 */
const valueUse = (d: ModuleDep) => d.files.some(f => f.uses)

/** 模块所在的层（路径上最近的、父模块声明了分层的祖先所属的层，含自身；全局键，ADR-0052）；没有时为 undefined */
function layerOf(index: ModelIndex, id: string): string | undefined {
  const at = [...(index.pathOf.get(id) ?? [])].reverse().find(p => index.stratumOf.has(p))
  return at === undefined ? undefined : stratumKey(index, index.stratumOf.get(at)!)
}

/** 模块或其祖先是共用件（role: shared / bus）时为那个共用件 */
export function sharedHostOf(index: ModelIndex, id: string): string | undefined {
  return [...(index.pathOf.get(id) ?? [])].reverse().find(p => isSharedRole(index.modules.get(p)?.role))
}

/**
 * U11：疑似共用件——当前版本中没有 role（自身与祖先都不是共用件）的非层模块，同时满足①入度广（依赖它子树的模块来自 ≥2 个不同的层，
 * 或是它的 ≥3 个兄弟模块的子树）、②没有运行时出边（子树内没有指向子树外的交互关系，四类与未分类）、③不在任何场景路径上（子树内没有帧端点）、
 * ④kind: library 或 ID / 名称含 shared、util、labels、contracts（不分大小写）。条件取「且」（议）。按声明顺序。没有代码事实时不调用（K8）。
 */
export function sharedSuggestions(index: ModelIndex, moduleDeps: Iterable<ModuleDep>): SharedSuggestion[] {
  const deps = [...moduleDeps].filter(valueUse)
  const out: SharedSuggestion[] = []
  const modules = [...index.modules.values()].sort((a, b) => a.seq - b.seq)
  for (const m of modules) {
    // 单成员层的成员就是层（ADR-0052），不建议
    if (m.id === index.rootId || index.stratumOf.get(m.id)?.members.length === 1 || m.role || sharedHostOf(index, m.id)) continue
    const text = `${m.id} ${m.name}`.toLowerCase()
    const nameHit = m.kind === 'library' ? 'kind: library' : SHARED_NAME_HINTS.find(w => text.includes(w))
    if (!nameHit) continue
    if ((index.scenariosOf.get(m.id) ?? []).length) continue
    const out0 = index.model.relations.some(r => RUNTIME_RELATION_TYPES.includes(r.type) && within(index, r.from, m.id) && !within(index, r.to, m.id))
    if (out0) continue
    const dependents = [...new Set(deps.filter(d => within(index, d.to, m.id) && !within(index, d.from, m.id)).map(d => d.from))]
    const layers = [...new Set(dependents.map(d => layerOf(index, d)).filter((l): l is string => !!l))]
    const siblings = (index.childrenOf.get(m.parentId) ?? []).filter(s => s !== m.id && dependents.some(d => within(index, d, s)))
    if (layers.length < 2 && siblings.length < 3) continue
    const name = (id: string) => moduleName(index, id)
    out.push({
      module: m.id,
      fanIn: { layers, siblings, dependents },
      nameHit,
      reasons: [
        layers.length >= 2 ? `入度广：被 ${layers.length} 个层的模块使用（${layers.map(name).join('、')}）` : `入度广：被 ${siblings.length} 个兄弟模块使用（${siblings.map(name).join('、')}）`,
        '没有运行时出边：不是任何交互关系（查询、委托、通知、流，迁移期含未分类）的发起方',
        '不在任何场景路径上',
        nameHit === 'kind: library' ? '像工具模块：kind: library' : `像工具模块：名称含「${nameHit}」`,
      ],
    })
  }
  return out
}

/**
 * U12：共用件反向依赖——共用件（role: shared / bus）子树内的模块对子树外、不在任何共用件子树内的模块有值使用的依赖（K4）。
 * 一条模块依赖一条（带文件证据）；不是违规、不进门禁与基线。
 */
export function sharedReverse(index: ModelIndex, moduleDeps: Iterable<ModuleDep>): ModuleDep[] {
  return [...moduleDeps].filter(d => {
    const host = sharedHostOf(index, d.from)
    return !!host && valueUse(d) && !within(index, d.to, host) && !sharedHostOf(index, d.to)
  })
}
