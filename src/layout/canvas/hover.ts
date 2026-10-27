/**
 * L25 悬停边看两端（ADR-0034）：悬停的边加悬停晕、提到最上层（且不变淡），两端节点加描边环（类名 `edge-end`）。
 * 画布局部状态，不改选中、不进 URL、不重新布局；其余边与节点原样返回（同一对象），便于 Vue Flow 只更新变的几个。
 */
import { EDGE_Z } from './edges'
import type { CanvasEdge, CanvasNode } from './types'

/** 悬停边的层级：高于回放当前（EDGE_Z.current），不被任何边或选中节点压住 */
export const EDGE_HOVER_Z = EDGE_Z.current + 1

export function withEdgeHover<N extends Pick<CanvasNode, 'id' | 'class'>, E extends CanvasEdge>(
  nodes: readonly N[],
  edges: readonly E[],
  hoverId: string | null,
): { nodes: N[]; edges: E[] } {
  const hit = hoverId ? edges.find(e => e.id === hoverId) : undefined
  if (!hit) return { nodes: [...nodes], edges: [...edges] }
  const ends = new Set([hit.source, hit.target])
  return {
    nodes: nodes.map(n => (ends.has(n.id) ? { ...n, class: [n.class, 'edge-end'].filter(Boolean).join(' ') } : n)),
    edges: edges.map(e => (e === hit ? { ...e, zIndex: EDGE_HOVER_Z, data: { ...e.data, hovered: true, dim: false } } : e)),
  }
}
