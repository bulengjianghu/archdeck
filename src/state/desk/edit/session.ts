/**
 * 编辑会话（X7、X7g、X7i、X20，ADR-0024、ADR-0025）：按**设计**一份——设计的全部草图（文件里读到的与会话里推出的）、当前张（挂载点）、
 * 一条设计级撤销 / 重做栈与各张读取时的指纹。一个值，只经这里的纯函数改变。
 * 撤销栈存「编辑前后的会话文档 + 操作 + 影响 + 前后的当前张」：快照让撤销与重做是值替换（一步可改几张草图）；操作让保存冲突后能重放；
 * 当前张让撤销到别的草图上的一步时画布切过去（X7g）。脏由文档与读取时的草图推出，不另存（原则 6）。
 */
import {
  applyDesignEdit,
  deriveChildSketch,
  ROOT_MOUNT,
  seedFromBaseline,
  type DesignEditContext,
  type DesignEditEffects,
  type DesignEditOp,
  type EditRejectCode,
  type SketchDef,
  type SketchSet,
  type SketchTarget,
} from '@/model'

/** X7g：撤销栈深度上限 */
export const UNDO_LIMIT = 200

/** 一张读自文件的草图：载荷里的路径、读取时的指纹与内容 */
export interface ReadSketch {
  file: string
  hash: string
  def: SketchDef
}

/** 会话文档：撤销的一步替换的就是它 */
export interface SessionDoc {
  /** 设计的全部草图（按挂载点） */
  sketches: SketchSet
  /** 当前挂载点 → 读取时的挂载点（读自文件的草图；级联改名后跟着换键） */
  origin: Readonly<Record<string, string>>
  /** 会话里出现的草图（推出的或操作新建的）出现时的样子：未改动的不算脏、不写文件（X20） */
  born: Readonly<Record<string, SketchDef>>
}

export interface Step {
  /** 这一步的操作（双击空白新建模块 = 新建 + 落位，是一步） */
  ops: DesignEditOp[]
  before: SessionDoc
  after: SessionDoc
  effects: DesignEditEffects
  /** 做这一步时所在的草图与做完后所在的草图 */
  mountBefore: string
  mountAfter: string
}

export interface EditSession {
  target: SketchTarget
  /** 草图 ID：设计的草图为设计 ID，持久草图为它的 ID */
  id: string
  /** 读自文件的草图（按读取时的挂载点） */
  read: Readonly<Record<string, ReadSketch>>
  doc: SessionDoc
  /** 当前张（挂载点） */
  mount: string
  past: Step[]
  future: Step[]
  /** X7i：文件已在外部改动（重新加载时指纹不同，或保存被拒绝） */
  stale: boolean
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const withoutLayout = (d: SketchDef): SketchDef => {
  const { layout: _layout, ...rest } = d
  return rest
}

export const NO_DESIGN_EFFECTS: DesignEditEffects = {
  created: [],
  renamed: [],
  removed: [],
  sketches: [],
  renamedSketches: [],
  removedSketches: [],
  createdSketches: [],
}

/** 主草图：根挂载在前，否则第一张 */
export const primaryMount = (read: Readonly<Record<string, ReadSketch>>): string =>
  read[ROOT_MOUNT] ? ROOT_MOUNT : (Object.keys(read).sort()[0] ?? ROOT_MOUNT)

export function begin(target: SketchTarget, id: string, read: Record<string, ReadSketch>, mount = primaryMount(read)): EditSession {
  const sketches = Object.fromEntries(Object.entries(read).map(([m, r]) => [m, r.def]))
  const origin = Object.fromEntries(Object.keys(read).map(m => [m, m]))
  return { target, id, read, doc: { sketches, origin, born: {} }, mount: sketches[mount] ? mount : primaryMount(read), past: [], future: [], stale: false }
}

/** 当前张的草图 */
export const current = (s: EditSession): SketchDef | undefined => s.doc.sketches[s.mount]

/** X18：一张会话里推出的草图此刻应有的样子（基线子树 + 血缘），判定「未改动」用 */
function derivedNow(s: EditSession, mount: string, baseline: DesignEditContext['baseline']): SketchDef | null {
  if (!baseline) return null
  const opts = { id: s.id }
  return mount === ROOT_MOUNT ? seedFromBaseline(ROOT_MOUNT, baseline, opts) : deriveChildSketch(mount, baseline, s.doc.sketches, opts)
}

/**
 * X20：一张草图是否要写回——读自文件的：挂载点或内容与读取时不同；会话里出现的：结构与此刻推出的结果不同（合并时写入的下一层与推出相同不算，
 * T1 裁决 5），或位置与出现时不同。
 */
export function sketchDirty(s: EditSession, mount: string, baseline?: DesignEditContext['baseline']): boolean {
  const def = s.doc.sketches[mount]
  if (!def) return false
  const o = s.doc.origin[mount]
  if (o !== undefined) return o !== mount || !same(def, s.read[o]?.def)
  const born = s.doc.born[mount]
  if (!born) return true
  const now = derivedNow(s, mount, baseline)
  const structure = !same(withoutLayout(def), withoutLayout(now ?? born))
  return structure || !same(def.layout, born.layout)
}

/** 读自文件、已不在会话里的草图（删掉的） */
export const removedMounts = (s: EditSession): string[] => {
  const kept = new Set(Object.values(s.doc.origin))
  return Object.keys(s.read).filter(m => !kept.has(m))
}

/** X20：脏按设计算——任一张要写回，或读自文件的草图被删 */
export const isDirty = (s: EditSession, baseline?: DesignEditContext['baseline']): boolean =>
  removedMounts(s).length > 0 || Object.keys(s.doc.sketches).some(m => sketchDirty(s, m, baseline))

/** 一步之后的会话文档：草图换成新的，读取时的挂载点与出现时的样子随改名、删除、新建跟着走 */
function nextDoc(doc: SessionDoc, sketches: SketchSet, fx: DesignEditEffects): SessionDoc {
  const origin: Record<string, string> = { ...doc.origin }
  const born: Record<string, SketchDef> = { ...doc.born }
  for (const [from, to] of fx.renamedSketches) {
    if (from in origin) {
      origin[to] = origin[from]
      delete origin[from]
    }
    if (from in born) {
      born[to] = born[from]
      delete born[from]
    }
  }
  for (const m of fx.removedSketches) {
    delete origin[m]
    delete born[m]
  }
  for (const m of fx.createdSketches) if (!(m in origin) && sketches[m]) born[m] = sketches[m]
  for (const m of Object.keys(born)) if (!sketches[m]) delete born[m]
  for (const m of Object.keys(origin)) if (!sketches[m]) delete origin[m]
  return { sketches, origin, born }
}

/** 当前张随一步的影响：改了挂载点跟着换，被删掉回到最近仍在的祖先草图（X7h） */
export function followMount(mount: string, sketches: SketchSet, fx: DesignEditEffects): string {
  let m = mount
  for (const [from, to] of fx.renamedSketches) if (from === m) m = to
  if (sketches[m]) return m
  while (m !== ROOT_MOUNT) {
    const dot = m.lastIndexOf('.')
    m = dot < 0 ? ROOT_MOUNT : m.slice(0, dot)
    if (sketches[m]) return m
  }
  return sketches[ROOT_MOUNT] ? ROOT_MOUNT : (Object.keys(sketches)[0] ?? mount)
}

export type ApplyOutcome = { ok: true; session: EditSession; effects: DesignEditEffects } | { ok: false; code: EditRejectCode; reason: string }

/** 合并几步的影响 */
function mergeEffects(a: DesignEditEffects, b: DesignEditEffects): DesignEditEffects {
  const out = { ...a }
  for (const k of Object.keys(b) as (keyof DesignEditEffects)[]) (out[k] as unknown[]) = [...(a[k] as unknown[]), ...(b[k] as unknown[])]
  return out
}

/** 持久草图只有这一张：会新出现或删掉草图的操作不成立 */
function persistentGuard(s: EditSession, fx: DesignEditEffects): string | null {
  if (s.target.kind !== 'persistent') return null
  if (fx.createdSketches.length || fx.removedSketches.length || fx.renamedSketches.length) return '持久草图只编辑这一张：这个操作会改动下一层草图，请在设计里做'
  return null
}

/**
 * 应用一步（一个或几个操作，原子）：成功压撤销栈、清空重做栈；任一操作被拒绝时会话不变。
 */
export function apply(s: EditSession, ops: DesignEditOp | DesignEditOp[], ctx: DesignEditContext): ApplyOutcome {
  const list = Array.isArray(ops) ? ops : [ops]
  let sketches: SketchSet = s.doc.sketches
  let fx: DesignEditEffects = NO_DESIGN_EFFECTS
  for (const op of list) {
    const r = applyDesignEdit(sketches, op, ctx)
    if (!r.ok) return r
    sketches = r.design
    fx = mergeEffects(fx, r.effects)
  }
  const guard = persistentGuard(s, fx)
  if (guard) return { ok: false, code: 'invalid', reason: guard }
  const doc = nextDoc(s.doc, sketches, fx)
  const mount = followMount(s.mount, sketches, fx)
  const step: Step = { ops: list, before: s.doc, after: doc, effects: fx, mountBefore: s.mount, mountAfter: mount }
  return { ok: true, session: { ...s, doc, mount, past: [...s.past, step].slice(-UNDO_LIMIT), future: [] }, effects: fx }
}

/** X7k：拆分时随原模块删掉的一张下一层草图——挂载点、模块数；derived 为会话里推出且未改动的（或还没打开、按 X18 从基线推出的） */
export interface SplitLoss {
  mount: string
  modules: number
  derived: boolean
}

/**
 * X7k：拆分前的二次确认（不改会话）——原模块的下一层草图（含更深的）随拆分删除，列出来由呈现层确认后再拆。
 * 设计里有（读自文件或改过）的为 derived = false；推出且未改动的空草图不计；原模块的下一层还没在会话里出现、基线里有子树时按 X18 推出并计入（derived = true）。
 * 拆分结果保留原 ID 时不删，返回空；拆分本身不成立时为原因。
 */
export function splitImpact(
  s: EditSession,
  op: Extract<DesignEditOp, { op: 'split' }>,
  ctx: DesignEditContext,
): { ok: true; sketches: SplitLoss[] } | { ok: false; reason: string } {
  const r = apply(s, op, ctx)
  if (!r.ok) return { ok: false, reason: r.reason }
  const sketches: SplitLoss[] = [...r.effects.removedSketches]
    .sort()
    .map(m => ({ mount: m, modules: s.doc.sketches[m]?.modules?.length ?? 0, derived: s.doc.origin[m] === undefined && !sketchDirty(s, m, ctx.baseline) }))
    .filter(x => !x.derived || x.modules > 0)
  if (s.target.kind === 'design' && r.effects.removed.includes(op.id) && !s.doc.sketches[op.id] && ctx.baseline) {
    const modules = deriveChildSketch(op.id, ctx.baseline, s.doc.sketches, { id: s.id }).modules?.length ?? 0
    if (modules) sketches.unshift({ mount: op.id, modules, derived: true })
  }
  return { ok: true, sketches }
}

/** 影响的反向（撤销时的跟随）：新建的被删、改名的换回、草图的改名换回 */
const reverse = (fx: DesignEditEffects): DesignEditEffects => ({
  created: [],
  renamed: fx.renamed.map(([a, b]) => [b, a]),
  removed: fx.created,
  sketches: fx.sketches,
  renamedSketches: fx.renamedSketches.map(([a, b]) => [b, a]),
  removedSketches: fx.createdSketches,
  createdSketches: [],
})

/** 撤销：回到上一步之前的文档与那一步所在的草图（X7g：撤销的一步在别的草图上时切过去） */
export function undo(s: EditSession): { session: EditSession; effects: DesignEditEffects } | null {
  const step = s.past[s.past.length - 1]
  if (!step) return null
  const mount = step.before.sketches[step.mountBefore] ? step.mountBefore : followMount(s.mount, step.before.sketches, reverse(step.effects))
  return { session: { ...s, doc: step.before, mount, past: s.past.slice(0, -1), future: [step, ...s.future] }, effects: reverse(step.effects) }
}

export function redo(s: EditSession): { session: EditSession; effects: DesignEditEffects } | null {
  const step = s.future[0]
  if (!step) return null
  return { session: { ...s, doc: step.after, mount: step.mountAfter, past: [...s.past, step], future: s.future.slice(1) }, effects: step.effects }
}

/**
 * 打开一张草图（下钻 / 面包屑）：会话里已有就切过去；没有时按 X18 推出一张放进会话（不进撤销栈、未改动不算脏）。
 * 持久草图只有这一张。
 */
export function open(s: EditSession, mount: string, ctx: DesignEditContext): { ok: true; session: EditSession } | { ok: false; reason: string } {
  if (s.doc.sketches[mount]) return { ok: true, session: mount === s.mount ? s : { ...s, mount } }
  if (s.target.kind === 'persistent') return { ok: false, reason: '持久草图只编辑这一张：下一层请在设计里画' }
  const b = ctx.baseline
  const def: SketchDef = b
    ? mount === ROOT_MOUNT
      ? seedFromBaseline(ROOT_MOUNT, b, { id: s.id })
      : deriveChildSketch(mount, b, s.doc.sketches, { id: s.id })
    : { id: s.id, mount, lifetime: 'until-implemented', modules: [] }
  const doc: SessionDoc = { ...s.doc, sketches: { ...s.doc.sketches, [mount]: def }, born: { ...s.doc.born, [mount]: def } }
  return { ok: true, session: { ...s, doc, mount } }
}

/**
 * 保存成功：写过的草图成为读取时的草图（新指纹），删掉的从读取里去掉，清空两个栈（X7g：撤销只在本次未保存的编辑内）；
 * 没写的会话草图（推出且未改动）留在会话里。sent 为实际写出的草图（已丢掉无关系的引用）。
 */
export function saved(
  s: EditSession,
  sent: Readonly<Record<string, SketchDef>>,
  hashes: Readonly<Record<string, { file: string; hash: string }>>,
): EditSession {
  const read: Record<string, ReadSketch> = {}
  const origin: Record<string, string> = {}
  const born: Record<string, SketchDef> = {}
  const sketches: Record<string, SketchDef> = { ...s.doc.sketches }
  for (const m of Object.keys(s.doc.sketches)) {
    const o = s.doc.origin[m]
    if (sent[m] && hashes[m]) {
      sketches[m] = sent[m]
      read[m] = { def: sent[m], ...hashes[m] }
      origin[m] = m
    } else if (o !== undefined) {
      read[m] = s.read[o]
      origin[m] = m
    } else if (s.doc.born[m]) born[m] = s.doc.born[m]
  }
  return { ...s, read, doc: { sketches, origin, born }, past: [], future: [], stale: false }
}

/**
 * 描述重新加载（按设计）：指纹都相同则不变；读到的内容与会话里的一致（刚保存的）则接上新指纹；否则文件已在外部改动。
 */
export function reloaded(s: EditSession, read: Record<string, ReadSketch>): EditSession {
  const was = Object.entries(s.read)
    .map(([m, r]) => `${m}:${r.hash}`)
    .sort()
  const now = Object.entries(read)
    .map(([m, r]) => `${m}:${r.hash}`)
    .sort()
  if (same(was, now)) return s
  const fresh = Object.entries(read).every(([m, r]) => same(r.def, s.doc.sketches[m])) && Object.keys(s.read).every(m => read[m] || !s.doc.sketches[m])
  if (fresh) {
    const origin = Object.fromEntries(Object.keys(read).map(m => [m, m]))
    const born = Object.fromEntries(Object.entries(s.doc.born).filter(([m]) => !read[m]))
    return { ...s, read, doc: { ...s.doc, origin, born }, past: [], future: [], stale: false }
  }
  return { ...s, stale: true }
}

/** X7i：把本次的每一步按序重放到新读到的草图上；失败的步骤列出，有失败时仍为已过时（可放弃本次改动） */
export function replay(s: EditSession, read: Record<string, ReadSketch>, ctx: DesignEditContext): { session: EditSession; failed: DesignEditOp[] } {
  let next = begin(s.target, s.id, read, s.mount)
  const failed: DesignEditOp[] = []
  for (const step of s.past) {
    if (!next.doc.sketches[step.mountBefore]) {
      const o = open(next, step.mountBefore, ctx)
      if (o.ok) next = o.session
    }
    const r = apply(next, step.ops, ctx)
    if (r.ok) next = r.session
    else failed.push(...step.ops)
  }
  const mount = next.doc.sketches[s.mount] ? s.mount : next.mount
  return { session: { ...next, mount, stale: failed.length > 0 }, failed }
}

/** 放弃本次改动：以给出的（或读取时的）草图重新开始，停在原来的草图（还在的话） */
export function discard(s: EditSession, read: Record<string, ReadSketch> = { ...s.read }): EditSession {
  return begin(s.target, s.id, read, read[s.mount] ? s.mount : undefined)
}
