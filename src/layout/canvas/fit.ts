/**
 * 适应画布（V14，ADR-0039 修订 2）：可用区域与视口。纯函数，画布组件量出容器与「显示」面板的尺寸后调用。
 *   可用区域：面板展开时为面板左侧（再让出 FIT.gap），面板左侧不到画布宽度一半时仍用整块画布；收起时为整块画布。
 *   视口：内容外框缩放、居中到可用区域，四周各留 FIT.pad，缩放不超过 FIT.maxZoom。
 */
import type { Box } from '../geometry'

export const FIT = { pad: 0.08, maxZoom: 1.2, gap: 12 }

/** 画布上的一块区域（画布坐标，左上为原点） */
export interface FitArea {
  x: number
  y: number
  w: number
  h: number
}

/**
 * V14：适应用的可用区域。width / height 为画布容器的尺寸；panelLeft 为展开的「显示」面板左边离画布左边的距离（收起时为 null）。
 */
export function fitArea(width: number, height: number, panelLeft: number | null): FitArea {
  if (panelLeft === null) return { x: 0, y: 0, w: width, h: height }
  const w = panelLeft - FIT.gap
  return w < width / 2 ? { x: 0, y: 0, w: width, h: height } : { x: 0, y: 0, w, h: height }
}

/** V14：把内容外框 b 缩放、居中到区域 area 的视口（Vue Flow 的 x、y、zoom） */
export function fitViewport(b: Box, area: FitArea): { x: number; y: number; zoom: number } {
  const zoom = Math.min(FIT.maxZoom, (area.w * (1 - 2 * FIT.pad)) / b.w, (area.h * (1 - 2 * FIT.pad)) / b.h)
  return { x: area.x + (area.w - b.w * zoom) / 2 - b.x * zoom, y: area.y + (area.h - b.h * zoom) / 2 - b.y * zoom, zoom }
}
