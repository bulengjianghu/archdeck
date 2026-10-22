/**
 * 拖动（C-2、C-5，X7d）：带头上下拖动即层排序；模块拖到另一条带或另一个模块上即移动——先取 previewMove，
 * 弹出「移动会改 ID」确认（草图内改写条数与当前版本里引用旧 ID 的条数），确认后发一个 moveModule。
 * 落点只用画布场景的节点盒子判断；松手后节点回到布局给出的位置（不保存坐标），编辑后由自动布局重排。
 */
import type { Node } from '@vue-flow/core'
import type { CanvasNode, NodeData } from '@/layout/canvas'
import type { DeskState } from '@/state/useDeskState'
import { ask } from '../useEditDialog'

/** 拖动后的中心点：位置取拖到的地方，尺寸取画布场景里的盒子 */
const center = (pos: { x: number; y: number }, box?: CanvasNode) => ({ x: pos.x + (box?.width ?? 0) / 2, y: pos.y + (box?.height ?? 0) / 2 })
const inside = (p: { x: number; y: number }, n: CanvasNode) =>
  p.x >= n.position.x && p.x <= n.position.x + n.width && p.y >= n.position.y && p.y <= n.position.y + n.height

/** 确认框的影响清单 */
export function impactLines(impact: ReturnType<DeskState['edit']['previewMove']>): string[] {
  const lines = impact.renamed.slice(0, 6).map(([a, b]) => `${a} → ${b}`)
  if (impact.renamed.length > 6) lines.push(`…另 ${impact.renamed.length - 6} 个后代`)
  lines.push(`草图里改写 ${impact.references} 处引用（关系两端、接口 owner、封闭、可依赖的层）；关系与接口自身的 ID 不变`)
  const o = impact.outside
  if (o.modules + o.relations + o.interfaces + o.messages)
    lines.push(
      `当前版本里还有 ${o.modules} 个模块、${o.relations} 条关系、${o.interfaces} 个接口、${o.messages} 条场景消息引用旧 ID：保存后交给 AI 按新草图重新生成`,
    )
  return lines
}

/** 移动一个模块：预览、确认、发操作；返回结果说明（空串为没有动作） */
export async function confirmMove(desk: DeskState, id: string, parent: string, newId?: string): Promise<string> {
  const impact = desk.edit.previewMove(id, parent, newId)
  if (impact.rejected) return impact.rejected
  if (!impact.renamed.length) return ''
  if (!(await ask({ title: `移动会改 ID：「${id}」→「${impact.renamed[0][1]}」`, lines: impactLines(impact), ok: '移动' }))) return ''
  const r =
    newId && parent === desk.index.value?.modules.get(id)?.parentId
      ? desk.edit.edit({ op: 'renameModule', id, newId })
      : desk.edit.edit({ op: 'moveModule', id, parent, ...(newId ? { newId } : {}) })
  return r.ok ? '' : r.reason
}

export async function onDragStop(desk: DeskState, node: Node<NodeData>, scene: readonly CanvasNode[]): Promise<string> {
  const data = node.data!
  const p = center(
    node.position,
    scene.find(n => n.id === node.id),
  )
  if (node.type === 'band') {
    const bands = scene.filter(n => n.type === 'band' && n.id !== node.id).sort((a, b) => a.position.y - b.position.y)
    const to = bands.filter(b => b.position.y + b.height / 2 < p.y).length
    const now = scene
      .filter(n => n.type === 'band')
      .sort((a, b) => a.position.y - b.position.y)
      .findIndex(b => b.id === node.id)
    if (to === now) return ''
    const r = desk.edit.edit({ op: 'reorderLayer', id: data.moduleId, to })
    return r.ok ? '' : r.reason
  }
  const idx = desk.index.value
  if (!idx) return ''
  const under = (x: string) => x === data.moduleId || !!idx.pathOf.get(x)?.includes(data.moduleId)
  const hits = scene
    .filter(n => (n.type === 'band' || n.type === 'module' || n.type === 'core') && n.id !== node.id && !under(n.data.moduleId) && inside(p, n))
    .sort((a, b) => a.width * a.height - b.width * b.height)
  const target = hits[0]?.data.moduleId
  if (!target || target === idx.modules.get(data.moduleId)?.parentId) return ''
  return confirmMove(desk, data.moduleId, target)
}
