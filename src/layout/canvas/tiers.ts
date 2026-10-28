/**
 * L29（ADR-0038）：普通层次按依赖分层时的背景——浅色层带与层号（≥ 7 个节点且 ≥ 3 层），环组框与环编号（成员之间没有夹着别的节点时）。
 * 只在结构 / 交互视角画（运行视角是舞台，不画）；不参与交互，压在节点与边之下。
 */
import { tierBandLabel } from '../tiers'
import type { SceneContext } from './context'
import { placeNode } from './nodes'
import type { CanvasNode } from './types'

export function tierNodes(ctx: SceneContext): CanvasNode[] {
  const t = ctx.pv.tiers
  if (!t || ctx.st) return []
  const last = t.bands.length - 1
  const base = { moduleId: '', childCount: 0, selected: false, dim: false }
  // 背景不接指针：组框、层带压在节点所在区域，单击、悬停都落到下面的节点与空白
  const passive = (n: CanvasNode): CanvasNode => ({ ...n, style: { ...n.style, pointerEvents: 'none' } })
  return [
    ...t.bands.map((b, i) => {
      const label = tierBandLabel(b.tier, i, last)
      return passive(
        placeNode(
          ctx,
          `tier:${b.tier}`,
          b.box,
          'tier',
          { ...base, name: label, tierBand: { kind: 'band', label, ...(b.labelX !== undefined ? { offset: b.labelX } : {}) } },
          -1,
        ),
      )
    }),
    ...t.groups.map(g =>
      passive(placeNode(ctx, `tier-group:${g.id}`, g.box, 'tier', { ...base, name: `环 ${g.id}`, tierBand: { kind: 'group', label: `环 ${g.id}` } }, -1)),
    ),
  ]
}
