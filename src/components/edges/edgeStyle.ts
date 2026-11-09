/**
 * 关系线的视觉映射（L10、ADR-0018、ADR-0029）：颜色 = 关系类型（四类各一色相，查询低饱和 + 半透明，未分类中性灰），线宽 = 聚合条数三档；
 * 线型 = 行为还是依赖（L18，ADR-0035）：交互与回放临时线实线，依赖类的线（代码依赖叠加线、组装叠加、承载缺段）虚线，时间耦合波浪线是唯一例外；
 * 事实状态与异常写在标签位（L26），不进线型。插座记号（L12）= 经端口。画布的 RouteEdge 与「显示」面板的示意线（LineSwatch）共用，图例与画布同一套样式。
 */
import type { RelationType } from '@/model'
import type { RouteEdgeData } from '@/layout/canvas'

/** 决定一条线怎么画的字段；RouteEdgeData 直接满足它，图例只给需要的几个 */
export type StrokeLook = Partial<Pick<RouteEdgeData, 'temp' | 'violated' | 'play' | 'muted' | 'dim' | 'weight' | 'factState'>> & {
  type?: RelationType
}

/** 线宽档位（px）：聚合条数 1 / 2–4 / ≥5；只表条数，不随类型变（T0 裁决 2：查询只「淡」不「细」） */
export const WIDTH = [1.5, 2.5, 3.5] as const
/** L10：查询的半透明——与低饱和的颜色一起把查询「淡」下去；乘在聚焦变淡等透明度上 */
export const QUERY_OPACITY = 0.6
/** L18：依赖的虚线——结构边、代码依赖叠加线、组装叠加、承载段与缺段同一种 */
export const DASHED = '6 4'
/** F6：分支预览线的不透明度（实线，降低不透明度与走过的边区分） */
export const PREVIEW_OPACITY = 0.6

/** L18（ADR-0035）：这条线是依赖（虚线）——代码依赖叠加线（K9）、组装叠加（O12）、承载缺段（L22）；其余线都是交互（实线） */
export const isDependencyLine = (d: Pick<StrokeLook, 'temp'>): boolean => d.temp === 'code' || d.temp === 'assembly' || d.temp === 'carrier-gap'
/**
 * 箭头（L10：实心 = 同步，空心「V」= 异步）：大小随线宽档走，14 / 16 / 18 px；
 * 形状画在 10×10 的 viewBox 里，底边在 x = 1、尖端在 x = 9，标记的参考点在底边中点——线回缩一个箭头深度后接在底边上，尖端落在原终点。
 */
export type ArrowKind = 'closed' | 'open'
export const ARROW_PATH: Record<ArrowKind, string> = { closed: 'M1,1 L9,5 L1,9 Z', open: 'M1,1 L9,5 L1,9' }
export const arrowSize = (weight: 1 | 2 | 3 = 1): number => 12 + weight * 2
/** L20②（ADR-0036 返工）：接到端口点的一端的记号尺寸——比最细一档小，宽 8px，点距压到 9px 时 16 个并排也互不压住 */
export const DOT_ARROW = 10
/** 尖端到底边的距离（px） */
export const arrowDepth = (size: number): number => (size * 8) / 10

/**
 * L12 插座记号：开口半圆，凸向目标、开口朝发起方，顶点略过箭头尖端，把箭头「插」在里面（与箭头叠放、不替换箭头）。
 * 半径随箭头大小；标记坐标的原点即走线终点（箭头尖端），x 轴沿走线方向。
 */
export const socketRadius = (size: number): number => size * 0.6
export const SOCKET_OVERSHOOT = 2
export function socketPath(size: number): string {
  const r = socketRadius(size)
  const cx = SOCKET_OVERSHOOT - r
  return `M${cx},${-r} A${r},${r} 0 0 1 ${cx},${r}`
}

/** 回放当前步骤：强调色底线上走一串浅色短点（P10） */
export const FLOW = { baseWidth: 4, width: 1.6, dash: '3 9' } as const

/** J5：耦合线——灰色波浪线，无依赖无关系的更深色 */
export type CoupleLook = StrokeLook & { isolated?: boolean }

export function strokeColor(d: CoupleLook): string {
  if (d.temp === 'couple') return d.isolated ? 'var(--edge-couple-strong)' : 'var(--edge-couple)'
  if (d.temp === 'code') return d.violated ? 'var(--danger)' : 'var(--edge-code)'
  if (d.temp === 'assembly') return 'var(--assembly)'
  if (d.temp === 'unmodeled') return 'var(--danger)'
  if (d.temp === 'carrier-gap') return 'var(--warning)'
  if (d.play === 'preview') return 'var(--warning)'
  if (d.muted) return 'var(--text-3)'
  return `var(--rel-${d.type ?? 'calls'})`
}

/** L10：查询「淡」——关系边的透明度再乘 QUERY_OPACITY；临时线种类（代码依赖、耦合、未建模）与灰化的不按类型 */
const typeAlpha = (d: CoupleLook): number => (d.type === 'queries' && !d.muted ? QUERY_OPACITY : 1)

export function strokeStyle(d: CoupleLook) {
  const stroke = strokeColor(d)
  if (d.temp === 'couple') return { stroke, strokeWidth: d.isolated ? 2 : 1.5, strokeLinecap: 'round' as const, opacity: d.dim ? 0.12 : 0.9 }
  // 依赖类的线：虚线（L18）
  if (d.temp === 'code') return { stroke, strokeWidth: 2, strokeDasharray: DASHED, opacity: d.dim ? 0.12 : 0.95 }
  if (d.temp === 'assembly') return { stroke, strokeWidth: 1.8, strokeDasharray: DASHED, opacity: d.dim ? 0.12 : 0.9 }
  // L22：承载缺段——警示色虚线（缺的是一段依赖）
  if (d.temp === 'carrier-gap') return { stroke, strokeWidth: 1.6, strokeDasharray: DASHED, opacity: 0.95 }
  // P11：未建模是一次交互，只是没建模——红色实线
  if (d.temp === 'unmodeled') return { stroke, strokeWidth: 1.5, opacity: d.play === 'preview' ? PREVIEW_OPACITY : 0.9 }
  // 交互：实线（L10、L18）；经由上层（P15）、分支预览（F6）同样是交互，预览降低不透明度
  return {
    stroke,
    strokeWidth: WIDTH[(d.weight ?? 1) - 1],
    opacity: (d.dim ? 0.12 : d.muted ? 0.45 : 1) * typeAlpha(d) * (d.play === 'preview' ? PREVIEW_OPACITY : 1),
  }
}
