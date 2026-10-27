/**
 * L25 悬停边看两端（ADR-0034，第十一轮修订）：悬停的边加衬边与投影、提到最上层（且不变淡），两端节点加描边环（类名 `edge-end`）；
 * 悬停回调边时它配对的正向边减一档（`hoverPair`）同时高亮（L24）。
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
  // L24：悬停回调边时，交来执行器的正向边减一档同时高亮
  const pairs = new Set(hit.data.callbackPairs ?? [])
  // 只认端点正好相反的边（本层同一对节点之间），层间聚合边等含配对关系但端点不同的不亮
  const paired = (e: E) =>
    e !== hit && pairs.size > 0 && e.source === hit.target && e.target === hit.source && e.data.edge.relationIds.some(id => pairs.has(id))
  return {
    nodes: nodes.map(n => (ends.has(n.id) ? { ...n, class: [n.class, 'edge-end'].filter(Boolean).join(' ') } : n)),
    edges: edges.map(e =>
      e === hit
        ? { ...e, zIndex: EDGE_HOVER_Z, data: { ...e.data, hovered: true, dim: false } }
        : paired(e)
          ? { ...e, zIndex: EDGE_HOVER_Z - 1, data: { ...e.data, hoverPair: true, dim: false } }
          : e,
    ),
  }
}
