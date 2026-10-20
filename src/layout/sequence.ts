/**
 * 时序图排布（A7、P9）：给时序模型算坐标。同步、纯函数，不调用 elk。
 * - 外部参与者泳道在最左，与系统内泳道之间画分隔线；其余泳道按结构图中对应节点的横坐标排序，使两张图左右关系一致；
 * - 泳道宽度按名称自适应；消息纵向累加；组合框包住其子消息，按嵌套深度内缩。
 */
import type { SequenceModel } from '@/model'
import type { PositionedView } from './layout'

export interface PositionedSequence {
  model: SequenceModel
  /** 视图节点 ID → 泳道（左边与宽度），按从左到右的顺序 */
  lanes: Map<string, { x: number; w: number }>
  /** 参与者与系统内泳道之间的分隔线 */
  boundaryX?: number
  /** 每条消息箭头的纵坐标 */
  messages: { y: number }[]
  /** 与 model.fragments 一一对应；branchY 为第 2 个起各分支的分隔线纵坐标 */
  fragments: { x: number; y: number; w: number; h: number; branchY: number[] }[]
  size: { w: number; h: number }
}

export const SEQ = { padX: 16, laneGap: 28, minLane: 96, headerH: 40, top: 64, row: 34, rowInternal: 28, rowEmpty: 24, fragHead: 24, branchGap: 22, fragTail: 10 }

/** 名称的大致显示宽度：中文按 13px，其余按 7px */
export function textWidth(s: string): number {
  let w = 0
  for (const ch of s) w += /[⺀-￿]/.test(ch) ? 13 : 7
  return w
}

export function layoutSequence(model: SequenceModel, structure?: PositionedView | null): PositionedSequence {
  const centerX = (nodeId: string) => {
    const b = structure?.nodes.get(nodeId)
    return b ? b.x + b.w / 2 : Infinity
  }
  const seqOf = new Map(model.participants.map((p, i) => [p.nodeId, i]))
  const byX = (a: { nodeId: string }, b: { nodeId: string }) => centerX(a.nodeId) - centerX(b.nodeId) || seqOf.get(a.nodeId)! - seqOf.get(b.nodeId)!
  const actors = model.participants.filter(p => p.kind === 'actor').sort(byX)
  const inner = model.participants.filter(p => p.kind !== 'actor').sort(byX)

  const lanes = new Map<string, { x: number; w: number }>()
  let x = SEQ.padX
  let boundaryX: number | undefined
  for (const p of actors) {
    const w = Math.max(SEQ.minLane, textWidth(p.name) + 28)
    lanes.set(p.nodeId, { x, w })
    x += w + SEQ.laneGap
  }
  if (actors.length && inner.length) {
    boundaryX = x - SEQ.laneGap / 2
    x += 8
  }
  for (const p of inner) {
    const w = Math.max(SEQ.minLane, textWidth(p.name) + 28)
    lanes.set(p.nodeId, { x, w })
    x += w + SEQ.laneGap
  }
  const width = Math.max(x - SEQ.laneGap + SEQ.padX, 240)

  const opening = new Map<number, number[]>()
  const closing = new Map<number, number[]>()
  model.fragments.forEach((f, k) => {
    opening.set(f.first, [...(opening.get(f.first) ?? []), k])
    closing.set(f.last, [...(closing.get(f.last) ?? []), k])
  })
  const fragY = model.fragments.map(() => 0)
  const fragEnd = model.fragments.map(() => 0)
  const branchY: number[][] = model.fragments.map(() => [])

  let y = SEQ.top
  const messages = model.messages.map((m, i) => {
    for (const k of (opening.get(i) ?? []).sort((a, b) => model.fragments[a].depth - model.fragments[b].depth)) {
      fragY[k] = y
      y += SEQ.fragHead
    }
    model.fragments.forEach((f, k) => {
      if (f.branches?.some((b, bi) => bi > 0 && b.first === i)) {
        branchY[k].push(y)
        y += SEQ.branchGap
      }
    })
    const h = m.kind === 'internal' ? SEQ.rowInternal : m.kind === 'empty' ? SEQ.rowEmpty : SEQ.row
    const at = y + h / 2
    y += h
    for (const k of (closing.get(i) ?? []).sort((a, b) => model.fragments[b].depth - model.fragments[a].depth)) {
      y += SEQ.fragTail
      fragEnd[k] = y
    }
    return { y: at }
  })

  const fragments = model.fragments.map((f, k) => {
    const ids = model.messages.slice(f.first, f.last + 1).flatMap(m => (m.kind === 'empty' ? [] : [m.from, m.to]))
    const boxes = (ids.length ? ids : [...lanes.keys()]).map(id => lanes.get(id)).filter((b): b is { x: number; w: number } => !!b)
    const left = boxes.length ? Math.min(...boxes.map(b => b.x)) : SEQ.padX
    const right = boxes.length ? Math.max(...boxes.map(b => b.x + b.w)) : width - SEQ.padX
    const inset = 10 - f.depth * 5
    return { x: left - inset, y: fragY[k], w: right - left + 2 * inset, h: fragEnd[k] - fragY[k], branchY: branchY[k] }
  })

  return { model, lanes, boundaryX, messages, fragments, size: { w: width, h: y + 24 } }
}
