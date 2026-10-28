/**
 * 结构边的视觉映射（L16，ADR-0031 裁决 D 与第八轮修订 A5、ADR-0035）：依赖一律虚线（L18 共享通道：虚线 = 依赖），允许边（U16）浅一档的虚线；
 * 形态（K14）只靠端点记号（结构视图私有的通道）：使用开口箭头；子类在被依赖方（基类）一端空心三角；端口实现在被依赖方一端空心菱形 ◇（与端口元素记号一致）；
 * 组装在依赖方（组装者）一端实心菱形、被依赖方一端开口箭头。束取最强形态（L21①）。
 * 醒目度跟信息量走（L43，第十四轮 F11）：逐条的例外（L0）用深色、线宽加半档；骨架（L1）一律安静的中灰——色相中性、不表形态与档；
 * 档不再用明度（明度与聚焦变淡的透明度在灰线白底上是同一感知通道，分不开）：只引类型改用点线，交互使用与值使用在画布上不区分（悬停与面板写明）；
 * 对比度只留给聚焦变淡（共享通道）。
 * 线宽 = 共享通道「聚合条数」（与交互边同一套 WIDTH；束按束内元素级边条数）。画布的 DepEdge 与「显示」面板的图例（StructureSwatch）共用；
 * 颜色变量（--dep-tier-* / --dep-fact / --dep-allowed-soft）定义在 styles.css，亮色暗色各一套。
 */
import type { DepTier } from '@/model'
import type { DepEdgeKind } from '@/layout/canvas'
import { DASHED, WIDTH } from './edgeStyle'

export interface DepStrokeLook {
  kind: DepEdgeKind
  tier?: DepTier
  weight?: 1 | 2 | 3
  dim?: boolean
  /** L43：逐条的例外（L0）——深色、线宽加半档 */
  exception?: boolean
}

/** L43：骨架（L1）的安静中灰——形态与档都不改颜色 */
export const SKELETON_COLOR = 'var(--dep-skeleton)'
/** L43：逐条的例外（L0）的深色 */
export const EXCEPTION_COLOR = 'var(--dep-exception)'
/** L43：例外比骨架宽半档（px） */
export const EXCEPTION_EXTRA = 0.75
/** L43：只引类型的点线（档的新通道） */
export const DOTTED = '1.5 3.5'
/** U16 允许边的颜色：意图色浅一档（不用透明度——透明度属共享通道「聚焦变淡」） */
export const ALLOWED_COLOR = 'var(--dep-allowed-soft)'

export function depColor(d: DepStrokeLook): string {
  if (d.kind === 'allowed') return ALLOWED_COLOR
  return d.exception ? EXCEPTION_COLOR : SKELETON_COLOR
}

/** 线型：依赖一律虚线（L18，ADR-0035）；形态不进线型；L43：只引类型档用点线（仍是「断开的线」= 依赖） */
export const depDash = (_kind: DepEdgeKind, tier?: DepTier): string => (tier === 'type' ? DOTTED : DASHED)

export function depStroke(d: DepStrokeLook) {
  return {
    stroke: depColor(d),
    strokeWidth: WIDTH[(d.weight ?? 1) - 1] + (d.exception ? EXCEPTION_EXTRA : 0),
    strokeDasharray: depDash(d.kind, d.tier),
    opacity: d.dim ? 0.12 : 1,
  }
}

/** 端点记号：终点（被依赖方）开口箭头、空心三角（子类）或空心菱形 ◇（端口实现）；起点（依赖方）实心菱形（组装） */
export type UmlEnd = 'open' | 'triangle' | 'port' | 'diamond'
export const depEnds = (kind: DepEdgeKind): { start?: UmlEnd; end: UmlEnd } =>
  kind === 'subclass'
    ? { end: 'triangle' }
    : kind === 'implements'
      ? { end: 'port' }
      : kind === 'assembly'
        ? { start: 'diamond', end: 'open' }
        : { end: 'open' }

const isDiamond = (end: UmlEnd) => end === 'diamond' || end === 'port'

/** 记号沿线的长度（px）：线在这一端回缩这么多，记号从回缩处画到原端点 */
export function umlDepth(end: UmlEnd, size: number): number {
  if (isDiamond(end)) return size * 0.95
  if (end === 'triangle') return size * 0.8
  return (size * 8) / 10
}

/** 记号的半宽（px） */
export const umlHalf = (end: UmlEnd, size: number): number => (end === 'triangle' ? size * 0.45 : isDiamond(end) ? size * 0.3 : size * 0.4)

/**
 * 记号的形状：原点在线回缩后的端点，x 轴指向原端点（终点记号沿走线方向；起点记号由 auto-start-reverse 反向），
 * 记号从 x = 0 画到 x = depth（原端点）：开口箭头与空心三角的尖、两种菱形（◇ 与实心）的远角落在原端点上。
 */
export function umlPath(end: UmlEnd, size: number): string {
  const d = umlDepth(end, size)
  const h = umlHalf(end, size)
  if (isDiamond(end)) return `M0,0 L${d / 2},${-h} L${d},0 L${d / 2},${h} Z`
  if (end === 'triangle') return `M${d},0 L0,${-h} L0,${h} Z`
  return `M0,${-h} L${d},0 L0,${h}`
}
