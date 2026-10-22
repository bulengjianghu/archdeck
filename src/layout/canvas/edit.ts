/**
 * 编辑落点（X7、C-1、C-4，ADR-0024）：编辑态下画布要多画的伪节点——分层总览中带之间与末尾的插入条（+ 层）、带内与父模块框内的「+ 模块」。
 * 位置由同一份布局结果算出，不保存坐标；画布组件只把它们画成按钮、把点击转成编辑操作。
 */
import type { ModelIndex } from '@/model'
import type { Box } from '../layout'
import type { SceneContext } from './context'
import { placeNode } from './nodes'
import type { CanvasNode, NodeData } from './types'

/** 插入条的高度与「+ 模块」的尺寸（px） */
export const INSERT_H = 14
export const ADD_W = 72
export const ADD_H = 22
/** 编辑落点浮在边之上，单击不被线挡住 */
const OVER = 1005

export function editNodes(ctx: SceneContext, idx: ModelIndex): CanvasNode[] {
  if (!ctx.input.editing || ctx.st) return []
  const { pv } = ctx
  const blank = (id: string): NodeData => ({ moduleId: id, name: '', childCount: 0, selected: false, dim: false })
  const out: CanvasNode[] = []
  const slot = (id: string, box: Box, insert: NonNullable<NodeData['insert']>) => out.push(placeNode(ctx, id, box, 'insert', { ...blank(id), insert }, OVER))
  const bands = pv.view.nodes
    .filter(n => n.role === 'layer')
    .map(n => ({ id: n.id, box: pv.nodes.get(n.id) }))
    .filter((b): b is { id: string; box: Box } => !!b.box)
    .sort((a, b) => a.box.y - b.box.y)
  if (ctx.layered && bands.length) {
    // C-1：带之间与末尾的插入条，at 为插入位置（第几条带之前）
    bands.forEach((b, i) => {
      const above = bands[i - 1]?.box
      const y = above ? (above.y + above.h + b.box.y) / 2 - INSERT_H / 2 : b.box.y - INSERT_H - 4
      slot(`insert:layer:${i}`, { x: b.box.x, y, w: b.box.w, h: INSERT_H }, { kind: 'layer', at: i })
    })
    const last = bands[bands.length - 1].box
    slot(`insert:layer:${bands.length}`, { x: last.x, y: last.y + last.h + 4, w: last.w, h: INSERT_H }, { kind: 'layer', at: bands.length })
    // C-4：带内「+ 模块」，放在带的右下角
    for (const b of bands)
      slot(
        `insert:module:${b.id}`,
        { x: b.box.x + b.box.w - ADD_W - 8, y: b.box.y + b.box.h - ADD_H - 6, w: ADD_W, h: ADD_H },
        { kind: 'module', parent: b.id },
      )
    return out
  }
  const parent = pv.view.parentId
  const frame = pv.parentFrame ?? pv.frame
  if (parent === idx.rootId) {
    // 根层还没有层（空草图）：只能先加层
    const at = frame ?? boundsOf([...pv.nodes.values()])
    slot('insert:layer:0', { x: at.x, y: at.y + at.h + 8, w: Math.max(at.w, 240), h: INSERT_H }, { kind: 'layer', at: 0 })
    return out
  }
  // C-4：父模块框内「+ 模块」，放在框的左下角
  const box = frame ?? boundsOf([...pv.nodes.values()])
  slot(`insert:module:${parent}`, { x: box.x + 8, y: box.y + box.h - ADD_H - 6, w: ADD_W, h: ADD_H }, { kind: 'module', parent })
  return out
}

/** 一组盒子的外框；没有时为原点处的空框 */
function boundsOf(boxes: Box[]): Box {
  if (!boxes.length) return { x: 0, y: 0, w: 240, h: 0 }
  const x = Math.min(...boxes.map(b => b.x))
  const y = Math.min(...boxes.map(b => b.y))
  return { x, y, w: Math.max(...boxes.map(b => b.x + b.w)) - x, h: Math.max(...boxes.map(b => b.y + b.h)) - y + ADD_H + 12 }
}
