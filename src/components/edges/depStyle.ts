/**
 * 结构边的视觉映射（L16，ADR-0031 裁决 D 与第八轮修订 A5；结构视图私有的通道）：UML 类图惯例，按形态（K14）——
 * 线型：使用虚线、子类实线、端口实现虚线、组装实线；允许边（U16）点线。束取最强形态（L21①）。
 * 端点：使用开口箭头；子类、端口实现在被依赖方一端空心三角；组装在依赖方（组装者）一端实心菱形、被依赖方一端开口箭头。
 * 色相中性；档用明度（交互使用深、值使用中、只引类型浅），四种形态都按档（第八轮：形态与档正交），不用透明度（透明度属共享通道「聚焦变淡」）；
 * 不带档时（第七轮的事实种类、图例示意）组装、子类、端口实现为中性中灰。第七轮的种类名 dependency 与 use 同义。
 * 线宽 = 共享通道「聚合条数」（与交互边同一套 WIDTH；束按束内元素级边条数）。画布的 DepEdge 与「显示」面板的图例（StructureSwatch）共用；
 * 颜色变量（--dep-tier-* / --dep-fact / --dep-allowed）定义在 styles.css，亮色暗色各一套。
 */
import type { DepTier } from '@/model'
import type { DepEdgeKind } from '@/layout/canvas'
import { DASHED, DOTTED, WIDTH } from './edgeStyle'

export interface DepStrokeLook {
  kind: DepEdgeKind
  tier?: DepTier
  weight?: 1 | 2 | 3
  dim?: boolean
}

/** 三档明度：交互使用深、值使用中、只引类型浅 */
export const TIER_COLOR: Readonly<Record<DepTier, string>> = {
  invokes: 'var(--dep-tier-invokes)',
  value: 'var(--dep-tier-value)',
  type: 'var(--dep-tier-type)',
}
/** 组装、子类、端口实现：中性中灰 */
export const FACT_COLOR = 'var(--dep-fact)'
/** U16 允许边的颜色（意图色） */
export const ALLOWED_COLOR = 'var(--dep-allowed)'

/** 使用（第七轮称依赖） */
const isUse = (kind: DepEdgeKind) => kind === 'use' || kind === 'dependency'

export function depColor(d: DepStrokeLook): string {
  if (d.kind === 'allowed') return ALLOWED_COLOR
  if (d.tier) return TIER_COLOR[d.tier]
  if (isUse(d.kind)) return TIER_COLOR.invokes
  return FACT_COLOR
}

/** 线型：使用与端口实现虚线，子类与组装实线，允许边点线 */
export const depDash = (kind: DepEdgeKind): string | undefined => (isUse(kind) || kind === 'implements' ? DASHED : kind === 'allowed' ? DOTTED : undefined)

export function depStroke(d: DepStrokeLook) {
  return {
    stroke: depColor(d),
    strokeWidth: WIDTH[(d.weight ?? 1) - 1],
    strokeDasharray: depDash(d.kind),
    strokeLinecap: d.kind === 'allowed' ? ('round' as const) : undefined,
    opacity: d.dim ? 0.12 : 1,
  }
}

/** 端点记号：终点（被依赖方）开口箭头或空心三角；起点（依赖方）实心菱形（组装） */
export type UmlEnd = 'open' | 'triangle' | 'diamond'
export const depEnds = (kind: DepEdgeKind): { start?: UmlEnd; end: UmlEnd } =>
  kind === 'subclass' || kind === 'implements' ? { end: 'triangle' } : kind === 'assembly' ? { start: 'diamond', end: 'open' } : { end: 'open' }

/** 记号沿线的长度（px）：线在这一端回缩这么多，记号从回缩处画到原端点 */
export function umlDepth(end: UmlEnd, size: number): number {
  if (end === 'diamond') return size * 0.95
  if (end === 'triangle') return size * 0.8
  return (size * 8) / 10
}

/** 记号的半宽（px） */
export const umlHalf = (end: UmlEnd, size: number): number => (end === 'triangle' ? size * 0.45 : end === 'diamond' ? size * 0.3 : size * 0.4)

/**
 * 记号的形状：原点在线回缩后的端点，x 轴指向原端点（终点记号沿走线方向；起点记号由 auto-start-reverse 反向），
 * 记号从 x = 0 画到 x = depth（原端点）：开口箭头与空心三角的尖、菱形的远角落在原端点上。
 */
export function umlPath(end: UmlEnd, size: number): string {
  const d = umlDepth(end, size)
  const h = umlHalf(end, size)
  if (end === 'diamond') return `M0,0 L${d / 2},${-h} L${d},0 L${d / 2},${h} Z`
  if (end === 'triangle') return `M${d},0 L0,${-h} L0,${h} Z`
  return `M0,${-h} L${d},0 L0,${h}`
}
