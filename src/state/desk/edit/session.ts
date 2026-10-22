/**
 * 编辑会话（X7、X7g、X7i，ADR-0024）：编辑中的草图连同撤销 / 重做栈与读取时的指纹，一个值，只经这里的纯函数改变。
 * 撤销栈存「编辑前的草图快照 + 操作 + 影响」：快照让撤销与重做是值替换；操作让保存冲突后能把本次改动重放到新文件上；影响让撤销后选中照样跟随（X7h）。
 * 「脏」由编辑中的草图与读取时的草图是否相同推出，不另存（原则 6）。
 */
import { applyEdit, type EditContext, type EditEffects, type EditOp, type EditResult, type SketchDef, type SketchTarget } from '@/model'

/** X7g：撤销栈深度上限 */
export const UNDO_LIMIT = 200

interface Step {
  op: EditOp
  before: SketchDef
  after: SketchDef
  effects: EditEffects
}

export interface EditSession {
  target: SketchTarget
  /** 草图在载荷里的路径（设计的草图为 sketch.yaml，持久草图为 intent/<ID>.yaml） */
  file: string
  /** 读取时（或上次保存后）的草图与文件指纹 */
  base: { sketch: SketchDef; hash: string }
  draft: SketchDef
  past: Step[]
  future: Step[]
  /** X7i：文件已在外部改动（重新加载时指纹不同，或保存被拒绝） */
  stale: boolean
}

const same = (a: SketchDef, b: SketchDef) => JSON.stringify(a) === JSON.stringify(b)
const NONE: EditEffects = { created: [], renamed: [], removed: [] }

export function begin(target: SketchTarget, file: string, sketch: SketchDef, hash: string): EditSession {
  return { target, file, base: { sketch, hash }, draft: sketch, past: [], future: [], stale: false }
}

export const isDirty = (s: EditSession): boolean => !same(s.draft, s.base.sketch)

/** 应用一个编辑操作：成功压撤销栈、清空重做栈；拒绝时会话不变 */
export function apply(s: EditSession, op: EditOp, ctx: EditContext): { session: EditSession; result: EditResult } {
  const result = applyEdit(s.draft, op, ctx)
  if (!result.ok) return { session: s, result }
  const step: Step = { op, before: s.draft, after: result.sketch, effects: result.effects }
  return { session: { ...s, draft: result.sketch, past: [...s.past, step].slice(-UNDO_LIMIT), future: [] }, result }
}

/** 撤销：回到上一步之前的草图；影响为原影响的反向（新建的被删、改名的换回） */
export function undo(s: EditSession): { session: EditSession; effects: EditEffects } | null {
  const step = s.past[s.past.length - 1]
  if (!step) return null
  const effects: EditEffects = { created: [], renamed: step.effects.renamed.map(([a, b]) => [b, a]), removed: step.effects.created }
  return { session: { ...s, draft: step.before, past: s.past.slice(0, -1), future: [step, ...s.future] }, effects }
}

export function redo(s: EditSession): { session: EditSession; effects: EditEffects } | null {
  const step = s.future[0]
  if (!step) return null
  return { session: { ...s, draft: step.after, past: [...s.past, step], future: s.future.slice(1) }, effects: step.effects }
}

/** 保存成功：读取时的草图与指纹更新为刚保存的，清空两个栈（X7g：撤销只在本次未保存的编辑内） */
export function saved(s: EditSession, hash: string): EditSession {
  return { ...s, base: { sketch: s.draft, hash }, past: [], future: [], stale: false }
}

/** 描述重新加载：指纹相同则不变；内容与编辑中的一致（刚保存的）则接上新指纹；否则文件已在外部改动 */
export function reloaded(s: EditSession, sketch: SketchDef, hash: string): EditSession {
  if (hash === s.base.hash) return s
  if (same(sketch, s.draft)) return { ...s, base: { sketch, hash }, past: [], future: [], stale: false }
  return { ...s, stale: true }
}

/** X7i：把本次的操作按序重放到新读到的草图上；失败的操作列出，有失败时仍为已过时（可放弃本次改动） */
export function replay(s: EditSession, sketch: SketchDef, hash: string, ctx: EditContext): { session: EditSession; failed: EditOp[] } {
  let next = begin(s.target, s.file, sketch, hash)
  const failed: EditOp[] = []
  for (const step of s.past) {
    const r = apply(next, step.op, ctx)
    if (r.result.ok) next = r.session
    else failed.push(step.op)
  }
  return { session: { ...next, stale: failed.length > 0 }, failed }
}

/** 放弃本次改动：以给出的（或读取时的）草图重新开始 */
export function discard(s: EditSession, sketch = s.base.sketch, hash = s.base.hash): EditSession {
  return begin(s.target, s.file, sketch, hash)
}

export { NONE as NO_EFFECTS }
