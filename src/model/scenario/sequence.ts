/**
 * 时序模型（P6、S10a）：当前层次的时序图内容，无坐标。
 * 列出计划全貌：回放路径上的消息正常显示，未选分支与尚未到达的部分也列出（由界面淡化），
 * 单击它们即指向该步（R13）。与回放共用同一套落点与合并规则，路径上的消息与 ScenarioLevelView 一一对应。
 */
import type { LevelView, ModelIndex } from '../types'
import { moduleName } from '../names'
import { hierarchyKey } from '../project'
import { resolvePath } from './path'
import { linearize, mergeEntries, messageKind } from './level'
import type { FragmentTag, ScenarioPlan, Choices, ScenarioLevelView, SequenceParticipant, SequenceMessage, SequenceFragment, SequenceModel } from './types'

export function buildSequence(index: ModelIndex, view: LevelView, plan: ScenarioPlan, choices: Choices, pathView: ScenarioLevelView): SequenceModel {
  const { items } = mergeEntries(index, view, linearize(plan, choices, 'display'))
  const onPath = new Set(resolvePath(plan, choices).points.map(p => p.id))

  const participants: SequenceParticipant[] = []
  const addParticipant = (nodeId: string) => {
    if (participants.some(p => p.nodeId === nodeId)) return
    const boundary = nodeId.startsWith('boundary:')
    const id = boundary ? nodeId.slice('boundary:'.length) : nodeId
    // P13、P14：分层总览中有核心模块的层，其泳道只代表层内其他模块：「<层名> · 其他」，归入该层分组、排在核心模块之后
    const other = view.mode === 'layered' && view.nodes.some(n => n.role === 'core' && n.layerId === nodeId)
    const name = other ? `${moduleName(index, id)} · 其他` : moduleName(index, id)
    if (index.actors.has(id)) {
      participants.push({ nodeId, id, name, kind: 'actor', path: [], key: [], byX: false })
      return
    }
    const m = index.modules.get(id)
    const path = (index.pathOf.get(id) ?? []).slice(1)
    const layer = [...path].reverse().find(p => index.modules.get(p)?.kind === 'layer')
    participants.push({
      nodeId,
      id,
      name,
      kind: boundary ? 'boundary' : 'module',
      parentId: other ? id : m?.parentId,
      path,
      ...(layer ? { layer } : {}),
      key: other ? [...hierarchyKey(index, id), Infinity, 0] : hierarchyKey(index, id),
      byX: !boundary && m?.parentId === view.parentId && m.kind !== 'layer',
    })
  }

  const tagsOf: FragmentTag[][] = []
  const messages: SequenceMessage[] = items.map((it, i) => {
    if (it.kind === 'empty') {
      const point = plan.points.get(it.pointId)!
      tagsOf.push([...point.fragments, { kind: 'alt', id: point.id, label: point.options[it.option].when, branch: it.option }])
      return { index: i, from: '', to: '', kind: 'empty', label: '（无步骤）', frameIds: [], status: it.status }
    }
    const first = it.frames[0]
    tagsOf.push(first.fragments)
    const at = it.at
    // P14：时序图的泳道取 lanes（分层总览中核心模块优先），否则取落点节点
    const [from, to] = at.lanes ? [at.lanes.from, at.lanes.to] : at.kind === 'internal' ? [at.node, at.node] : [at.from, at.to]
    addParticipant(from)
    addParticipant(to)
    const ifName = first.interface ? index.interfaces.get(first.interface)?.name : undefined
    const base = first.label ?? ifName ?? ''
    return {
      index: i,
      from,
      to,
      kind: messageKind(it),
      label: it.frames.length > 1 ? `${base}（${it.frames.length} 步）` : base,
      frameIds: it.frames.map(f => f.id),
      status: it.status,
      ...(it.status === 'path' ? { pathIndex: pathView.messageOf.get(first.id) } : {}),
      ...(at.kind === 'unmodeled' ? { temp: at.kind } : at.kind === 'upper' ? { temp: at.kind, relationId: at.relationId } : {}),
    }
  })

  // 组合框：按实例 ID 汇总覆盖的消息区间；alt / par 再按分支汇总
  const byId = new Map<string, SequenceFragment & { branchMap: Map<number, { first: number; last: number }> }>()
  tagsOf.forEach((tags, i) => {
    tags.forEach((t, depth) => {
      let f = byId.get(t.id)
      if (!f) {
        f = { id: t.id, kind: t.kind, label: t.kind === 'alt' ? '' : t.label, depth, first: i, last: i, collapsed: false, branchMap: new Map() }
        byId.set(t.id, f)
      }
      f.last = i
      if (t.branch !== undefined) {
        const b = f.branchMap.get(t.branch)
        if (b) b.last = i
        else f.branchMap.set(t.branch, { first: i, last: i })
      }
    })
  })
  const fragments: SequenceFragment[] = [...byId.values()].map(({ branchMap, ...f }) => {
    const range = messages.slice(f.first, f.last + 1)
    const collapsed = range.every(m => m.kind === 'internal')
    if (f.kind === 'alt') {
      const point = plan.points.get(f.id)!
      const chosen = (k: number) => (onPath.has(f.id) ? choices.get(f.id) === k : null)
      const branches = point.options.flatMap((o, k) => {
        const r = branchMap.get(k)
        return r ? [{ option: k, label: o.when, chosen: chosen(k), ...r }] : []
      })
      return { ...f, collapsed, branches }
    }
    if (f.kind === 'par') {
      const branches = [...branchMap].sort((a, b) => a[0] - b[0]).map(([k, r]) => ({ option: k, label: '', chosen: true, ...r }))
      return { ...f, collapsed, branches }
    }
    return { ...f, collapsed }
  })
  fragments.sort((a, b) => a.first - b.first || a.depth - b.depth)

  return { participants, messages, fragments }
}

/**
 * R15、R16：模块或参与者在这张时序图中对应的泳道（视图节点 ID）。
 * 参与者为它自己的泳道；模块是当前层次本身或其祖先时没有；否则为它包含的泳道（泳道模块是它自身或其后代），
 * 没有时为包含它的最深泳道（P14：泳道互不包含，分层总览中核心模块优先于「<层名> · 其他」）。
 */
export function lanesOf(index: ModelIndex, sequence: SequenceModel, levelId: string, id: string): Set<string> {
  const lanes = sequence.participants
  if (index.actors.has(id)) return new Set(lanes.filter(p => p.kind === 'actor' && p.id === id).map(p => p.nodeId))
  const path = index.pathOf.get(id)
  if (!path || index.pathOf.get(levelId)?.includes(id)) return new Set()
  const inside = lanes.filter(p => p.kind !== 'actor' && p.path.includes(id))
  if (inside.length) return new Set(inside.map(p => p.nodeId))
  let best: SequenceParticipant | null = null
  for (const p of lanes) if (p.kind !== 'actor' && path.includes(p.id) && (!best || p.path.length > best.path.length)) best = p
  return new Set(best ? [best.nodeId] : [])
}
