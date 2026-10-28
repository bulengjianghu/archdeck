/**
 * 节点注记的位置表（L37，第十四轮 F16，ADR-0043）：每槽只表一个维度，同一种注记永远在同一个位置；
 * 写字的注记静息态每个节点最多 REST_MARKS 个，超出的按优先级收起，悬停或选中该节点时全部出现。
 */
import type { NodeData } from './types'

/** L37：槽与它只表的那一个维度（位置相对节点；「计入」= 写字、受静息态上限约束） */
export const NODE_MARK_SLOTS = [
  { slot: 'name', where: '名称行（内）', dimension: '身份', marks: ['边界角色', '类别', '环编号'], counted: false },
  { slot: 'drill', where: '右上角（内）', dimension: '下钻', marks: ['⌄ N'], counted: false },
  { slot: 'edge', where: '左缘（内）', dimension: '稳定度', marks: ['色条'], counted: false },
  { slot: 'corner', where: '右下角（内）', dimension: '热度', marks: ['色块'], counted: false },
  { slot: 'top-left', where: '上边左', dimension: '状态', marks: ['新增 / 修改', '△ N', '组装根', '影响面方向与距离'], counted: true },
  { slot: 'top-right', where: '上边右', dimension: '端口', marks: ['端口记号', '表面点阵'], counted: false },
  { slot: 'bottom-left', where: '下边左', dimension: '量', marks: ['入 · 出 · 表面'], counted: true },
  { slot: 'bottom-right', where: '下边右', dimension: '没画出来的线', marks: ['共用 ×N', '另直连 N'], counted: true },
  { slot: 'outside', where: '外侧', dimension: '界外', marks: ['界外 入 N · 出 M'], counted: true },
] as const

/** L37：静息态每个节点写字的注记上限（负责人 2026-10-28：3） */
export const REST_MARKS = 3

/** L37：受上限约束的注记，按优先级自高到低（环编号虽在名称行，也写字、计入） */
export const REST_PRIORITY = ['state', 'cycle', 'metrics', 'unseen', 'cross'] as const
export type RestMark = (typeof REST_PRIORITY)[number]

/** 这个节点上出现了哪些受上限约束的注记 */
export function presentMarks(d: NodeData): RestMark[] {
  const has: Record<RestMark, boolean> = {
    state: !!(d.change || d.touched || d.assemblyRoot || d.impact),
    cycle: d.cycle !== undefined,
    metrics: !!d.metrics,
    unseen: !!(d.sharedCount || d.direct),
    cross: !!d.crossFold,
  }
  return REST_PRIORITY.filter(k => has[k])
}

/**
 * L37：静息态收起超出上限的注记——open（悬停或选中该节点）时全部出现；否则按优先级留前 REST_MARKS 个，其余记进 restHidden。
 * 只标记、不删数据：稳定度色条跟着节点走，不随「量」收起。
 */
export function restMarks(d: NodeData, open: boolean): NodeData {
  const present = presentMarks(d)
  if (open || present.length <= REST_MARKS) return d
  return { ...d, restHidden: present.slice(REST_MARKS) }
}

/** L37：一个注记此刻是否显示 */
export const markShown = (d: Pick<NodeData, 'restHidden'>, k: RestMark): boolean => !d.restHidden?.includes(k)
