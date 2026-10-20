/**
 * 回放路径（F6、F6b、R13）：按已选分支从回放计划走出线性帧序列，并回答分支选择的组合问题。
 * 已选分支是「分支点 ID → 选项序号」；分支点不在路径上、序号越界的选择被忽略。
 */
import type { BranchPoint, Frame, PlanNode, ScenarioPlan } from './plan'

export type Choices = ReadonlyMap<string, number>

export interface ResolvedPath {
  frames: Frame[]
  /** 路径截止处未选分支的分支点（F6） */
  pending?: BranchPoint
  /** 路径上依次经过的分支点 */
  points: BranchPoint[]
}

export function resolvePath(plan: ScenarioPlan, choices: Choices): ResolvedPath {
  const frames: Frame[] = []
  const points: BranchPoint[] = []
  let pending: BranchPoint | undefined
  const walk = (nodes: readonly PlanNode[]): boolean => {
    for (const n of nodes) {
      if (n.kind === 'frame') {
        frames.push(n.frame)
        continue
      }
      const c = choices.get(n.point.id)
      if (c === undefined || c < 0 || c >= n.options.length) {
        pending = n.point
        return false
      }
      points.push(n.point)
      if (!walk(n.options[c])) return false
    }
    return true
  }
  walk(plan.nodes)
  return { frames, pending, points }
}

/** F6b：在某个分支点选择或改选；改选会丢弃路径上该分支点之后的选择，选同一项不丢弃 */
export function chooseBranch(plan: ScenarioPlan, choices: Choices, pointId: string, option: number): Map<string, number> {
  const point = plan.points.get(pointId)
  if (!point || option < 0 || option >= point.options.length) return new Map(choices)
  if (choices.get(pointId) === option) return new Map(choices)
  const { points } = resolvePath(plan, choices)
  const at = points.findIndex(p => p.id === pointId)
  // 只保留路径上它之前的选择；不在当前路径上的分支点（尚未到达）同样保留之前的
  const before = at >= 0 ? points.slice(0, at) : points
  const next = new Map<string, number>()
  for (const p of before) next.set(p.id, choices.get(p.id)!)
  next.set(pointId, option)
  return next
}

/** 从根到某帧要经过的分支选择（分支点 → 选项），按经过的先后；帧不在计划中时为 null */
function routeTo(plan: ScenarioPlan, frameId: string): [string, number][] | null {
  const find = (nodes: readonly PlanNode[], route: [string, number][]): [string, number][] | null => {
    for (const n of nodes) {
      if (n.kind === 'frame') {
        if (n.frame.id === frameId) return route
        continue
      }
      for (let k = 0; k < n.options.length; k++) {
        const r = find(n.options[k], [...route, [n.point.id, k]])
        if (r) return r
      }
    }
    return null
  }
  return find(plan.nodes, [])
}

/**
 * R13：到达某帧需要的分支选择。当前路径已经过它时原样返回（保留现有选择）；否则沿路径依次改选：
 * 包住它的分支点选它所在的选项，它之前尚未选择的分支点保留已有选择、没有时取第一个选项。
 */
export function choicesFor(plan: ScenarioPlan, choices: Choices, frameId: string): Map<string, number> | null {
  if (!plan.frames.has(frameId)) return null
  const route = new Map(routeTo(plan, frameId)!)
  let next = new Map(choices)
  for (let guard = 0; guard <= plan.points.size; guard++) {
    const r = resolvePath(plan, next)
    if (r.frames.some(f => f.id === frameId)) return next
    const wrong = r.points.find(p => route.has(p.id) && next.get(p.id) !== route.get(p.id))
    if (wrong) next = chooseBranch(plan, next, wrong.id, route.get(wrong.id)!)
    else if (r.pending) next = chooseBranch(plan, next, r.pending.id, route.get(r.pending.id) ?? choices.get(r.pending.id) ?? 0)
    else return null
  }
  return null
}

/** F6c：路径上依次经过的分支点的选择（URL 按此有序编码） */
export function choiceList(plan: ScenarioPlan, choices: Choices): number[] {
  return resolvePath(plan, choices).points.map(p => choices.get(p.id)!)
}

/** F6c：由有序的选项序号恢复已选分支；多余或越界的序号被丢弃 */
export function choicesFromList(plan: ScenarioPlan, list: readonly number[]): Map<string, number> {
  const choices = new Map<string, number>()
  for (const option of list) {
    const { pending } = resolvePath(plan, choices)
    if (!pending || !Number.isInteger(option) || option < 0 || option >= pending.options.length) break
    choices.set(pending.id, option)
  }
  return choices
}
