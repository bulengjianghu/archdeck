/**
 * 关系线的视觉映射（L10、ADR-0018）：颜色 = 关系类型，线型 = 事实状态，线宽 = 聚合条数三档。
 * 画布的 RouteEdge 与「显示」面板的示意线（LineSwatch）共用，图例与画布同一套样式。
 */
import type { RelationType } from '@/model'
import type { RouteEdgeData } from '@/layout/canvas'

/** 决定一条线怎么画的字段；RouteEdgeData 直接满足它，图例只给需要的几个 */
export type StrokeLook = Partial<Pick<RouteEdgeData, 'temp' | 'violated' | 'play' | 'muted' | 'dim' | 'compile' | 'weight' | 'factState'>> & {
  type?: RelationType
}

/** 线宽档位（px）：运行时 / 编译期 */
export const WIDTH = { runtime: [1.5, 2.5, 3.5], compile: [1, 1.75, 2.5] } as const
export const DASHED = '6 4'
export const DOTTED = '0.5 4.5'
/**
 * 箭头（L10：实心 = 同步，空心「V」= 异步，空心三角 = implements）：大小随线宽档走，14 / 16 / 18 px；
 * 形状画在 10×10 的 viewBox 里，底边在 x = 1、尖端在 x = 9，标记的参考点在底边中点——线回缩一个箭头深度后接在底边上，尖端落在原终点。
 */
export type ArrowKind = 'closed' | 'open' | 'triangle'
export const ARROW_PATH: Record<ArrowKind, string> = { closed: 'M1,1 L9,5 L1,9 Z', open: 'M1,1 L9,5 L1,9', triangle: 'M1,1 L9,5 L1,9 Z' }
export const arrowSize = (weight: 1 | 2 | 3 = 1): number => 12 + weight * 2
/** 尖端到底边的距离（px） */
export const arrowDepth = (size: number): number => (size * 8) / 10

/** 回放当前步骤：强调色底线上走一串浅色短点（P10） */
export const FLOW = { baseWidth: 4, width: 1.6, dash: '3 9' } as const

/** J5：耦合线——灰色波浪线，无依赖无关系的更深色 */
export type CoupleLook = StrokeLook & { isolated?: boolean }

export function strokeColor(d: CoupleLook): string {
  if (d.temp === 'couple') return d.isolated ? 'var(--edge-couple-strong)' : 'var(--edge-couple)'
  if (d.temp === 'code') return d.violated ? 'var(--danger)' : 'var(--edge-code)'
  if (d.temp === 'unmodeled') return 'var(--danger)'
  if (d.play === 'preview') return 'var(--warning)'
  if (d.muted) return 'var(--text-3)'
  return `var(--rel-${d.type ?? 'calls'})`
}

export function strokeStyle(d: CoupleLook) {
  const stroke = strokeColor(d)
  if (d.temp === 'couple') return { stroke, strokeWidth: d.isolated ? 2 : 1.5, strokeLinecap: 'round' as const, opacity: d.dim ? 0.12 : 0.9 }
  if (d.temp === 'code') return { stroke, strokeWidth: 2, strokeDasharray: DOTTED, strokeLinecap: 'round' as const, opacity: d.dim ? 0.12 : 0.95 }
  if (d.temp === 'unmodeled') return { stroke, strokeWidth: 1.5, strokeDasharray: '5 5', opacity: d.play === 'preview' ? 0.7 : 0.9 }
  return {
    stroke,
    strokeWidth: WIDTH[d.compile ? 'compile' : 'runtime'][(d.weight ?? 1) - 1],
    // 线型只表事实状态；分支预览与经由上层（P15）的临时线为虚线
    strokeDasharray: d.play === 'preview' || d.temp === 'upper' || d.factState === 'unconfirmed' ? DASHED : undefined,
    opacity: d.dim ? 0.12 : d.muted ? 0.45 : 1,
  }
}
