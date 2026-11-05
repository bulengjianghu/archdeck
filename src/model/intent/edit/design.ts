/**
 * 设计级编辑（X7b、X7d、X7e、X7j、X7k、X11、X12，ADR-0025）：applyDesignEdit(设计的全部草图, 操作, 上下文) → 新的草图集合 + 影响 | 拒绝原因。
 * 一个操作可以改多张草图：合并（来源降为新模块的子模块，写入新模块的下一层草图）、拆分、降级（写入目标的下一层草图，不存在则推出）、
 * 升级（写入父层草图，下一层的关系不带上来、留作待重连）、移入（根草图里换层）、改 ID、删除（连同挂在它与后代上的草图）。
 * ID 变了一律前缀级联：设计里挂在它或它后代上的草图改挂载点与其中模块 ID，被改写的模块记 from（指向基线）；
 * 关系两端、接口 owner、closed、layout 的键随之改写。from 一律指向基线 ID：沿血缘求闭包写入（X11）。纯函数，输入不动。
 */
import { isRootLayer, pruneStrata, strataKey, stratumOfMember } from './strata'
import { ROOT_MOUNT, type ModuleDef, type SketchDef } from '../../types'
import { lineageSources, mapId, prefixMap, sketchLineage } from '../lineage'
import { mountScope } from '../scope'
import type { DesignEditContext, DesignEditEffects, DesignEditOp, DesignEditResult, EditContext, EditOp, EditRejectCode, SketchSet } from '../types'
import { applyEdit } from './apply'
import { GRID_GAP_X, gridLayout } from './layout'
import { ID_PATTERN, knownModules, locate, locateAll, shortName, type LocatedModule } from './locate'
import { deriveChildSketch, seedFromBaseline, structural } from './seed'
import { placeModule } from './modules'

type Draft = Record<string, SketchDef>
type Reject = { code: EditRejectCode; reason: string }
const no = (code: EditRejectCode, reason: string): Reject => ({ code, reason })

const under = (id: string, prefix: string) => id === prefix || id.startsWith(`${prefix}.`)
const swap = (id: string, from: string, to: string) => (under(id, from) ? `${to}${id.slice(from.length)}` : id)

/** 设计里挂在 id 或它后代上的草图（挂载点） */
export const sketchesUnder = (design: SketchSet, id: string): string[] => Object.keys(design).filter(m => m !== ROOT_MOUNT && under(m, id))

/** 挂载点的父草图：父模块是层（顶层 ID）时为根挂载 */
function parentMount(mount: string): { mount: string; parent: string } | null {
  const dot = mount.lastIndexOf('.')
  if (mount === ROOT_MOUNT || dot < 0) return null
  const parent = mount.slice(0, dot)
  return { mount: parent.includes('.') ? parent : ROOT_MOUNT, parent }
}

class Session {
  readonly fx: DesignEditEffects = { created: [], renamed: [], removed: [], sketches: [], renamedSketches: [], removedSketches: [], createdSketches: [] }
  constructor(
    readonly draft: Draft,
    readonly ctx: DesignEditContext,
  ) {}

  touch(...mounts: string[]) {
    for (const m of mounts) if (!this.fx.sketches.includes(m)) this.fx.sketches.push(m)
  }

  /** 模块是否基线模块（没有基线时：没写 from 的都当作基线模块） */
  isBase(id: string) {
    return this.ctx.baseline ? this.ctx.baseline.modules.has(id) : true
  }

  /** X11：一个模块的基线来源闭包 */
  closureOf(node: ModuleDef): string[] {
    if (node.from?.length) return [...node.from]
    return this.isBase(node.id) ? [node.id] : []
  }

  /** 单张草图编辑的上下文：范围外可引用设计里其他草图与基线的模块 */
  editContext(): EditContext {
    const all = new Set(Object.values(this.draft).flatMap(d => locateAll(d).map(m => m.id)))
    return { persistent: this.ctx.persistent, designSketch: true, known: id => all.has(id) || !!this.ctx.baseline?.modules.has(id) }
  }

  /** 已占用的模块 ID：设计里的，加上基线里没有被血缘带走的 */
  taken(except: readonly string[] = []): Set<string> {
    const out = new Set(Object.values(this.draft).flatMap(d => locateAll(d).map(m => m.id)))
    const gone = lineageSources(sketchLineage(Object.values(this.draft)))
    for (const id of this.ctx.baseline?.modules.keys() ?? []) if (![...gone].some(g => under(id, g))) out.add(id)
    for (const x of except) out.delete(x)
    return out
  }

  checkId(id: string, parent: string, except: readonly string[] = []): Reject | null {
    if (!ID_PATTERN.test(id)) return no('id-format', `ID「${id}」只能包含字母、数字和 . _ : -，且以字母或数字开头`)
    if (!id.startsWith(`${parent}.`) || id.slice(parent.length + 1).includes('.') || id.length === parent.length + 1)
      return no('id-prefix', `ID「${id}」必须是「${parent}.<短名>」（X7c、X9）`)
    if (this.taken(except).has(id)) return no('id-taken', `ID「${id}」已被占用`)
    return null
  }

  sketch(mount: string): SketchDef | Reject {
    return this.draft[mount] ?? no('not-found', `设计里没有挂在「${mount}」上的草图`)
  }

  /** X18：没有时推出一张（基线的子树 + 血缘）；没有基线时为空草图 */
  ensure(mount: string): SketchDef {
    const hit = this.draft[mount]
    if (hit) return hit
    const opts = { id: this.ctx.design }
    const b = this.ctx.baseline
    const def: SketchDef = b
      ? mount === ROOT_MOUNT
        ? seedFromBaseline(ROOT_MOUNT, b, opts)
        : deriveChildSketch(mount, b, this.draft, opts)
      : { id: this.ctx.design, mount, lifetime: 'until-implemented', modules: [] }
    this.draft[mount] = def
    this.fx.createdSketches.push(mount)
    return def
  }

  /**
   * X12：前缀级联——from 及其后代换成 to：模块 ID（被改写的基线模块记 from）、挂载点（草图改挂）、关系两端、接口 owner、closed、layout 的键。
   * skipRelationsIn：不改写这张草图的关系两端（升级时下一层的关系留作待重连）。
   */
  cascade(from: string, to: string, skipRelationsIn?: string) {
    if (from === to) return
    for (const key of Object.keys(this.draft)) {
      const def = this.draft[key]
      let changed = false
      for (const m of locateAll(def)) {
        if (!under(m.id, from)) continue
        if (!m.node.from?.length && this.isBase(m.id)) m.node.from = [m.id]
        const next = swap(m.id, from, to)
        if (m.node.from?.length === 1 && m.node.from[0] === next) delete m.node.from
        this.fx.renamed.push([m.id, next])
        m.node.id = next
        changed = true
      }
      if (key !== skipRelationsIn)
        for (const r of def.relations ?? []) {
          const [f, t] = [swap(r.from, from, to), swap(r.to, from, to)]
          if (f !== r.from || t !== r.to) changed = true
          r.from = f
          r.to = t
        }
      for (const x of def.interfaces ?? [])
        if (x.owner && under(x.owner, from)) {
          x.owner = swap(x.owner, from, to)
          changed = true
        }
      if (def.closed?.some(c => under(c, from))) {
        def.closed = def.closed.map(c => swap(c, from, to))
        changed = true
      }
      if (def.layout?.modules && Object.keys(def.layout.modules).some(id => under(id, from))) {
        def.layout.modules = Object.fromEntries(Object.entries(def.layout.modules).map(([id, p]) => [swap(id, from, to), p]))
        changed = true
      }
      if (key !== ROOT_MOUNT && under(key, from)) {
        const mount = swap(key, from, to)
        delete this.draft[key]
        def.mount = mount
        this.draft[mount] = def
        this.fx.renamedSketches.push([key, mount])
        this.touch(mount)
      } else if (changed) this.touch(key)
    }
  }

  /**
   * 去掉一张草图里同一对模块同类型的重复关系（保留先出现的）与连自己的关系——只看一端是 touching 的（重指向到它的关系）；
   * 草图里原有的、与这一步无关的同对同类型关系不动（第二十一轮波 2 修：合并曾把底稿里本就并存的两条同对关系删掉一条）。
   */
  dedupe(def: SketchDef, touching: string) {
    const seen = new Set<string>()
    def.relations = (def.relations ?? []).filter(r => {
      if (r.from !== touching && r.to !== touching) return true
      const k = `${r.from}\0${r.to}\0${r.type}`
      if (r.from === r.to || seen.has(k)) {
        this.fx.removed.push(r.id)
        if (def.layout?.relations) delete def.layout.relations[r.id]
        return false
      }
      seen.add(k)
      return true
    })
    if (!def.relations.length) delete def.relations
  }

  /** 把一组本草图的模块从原位置摘下（同一列表从后往前） */
  detach(hits: readonly LocatedModule[]) {
    for (const h of [...hits].sort((a, b) => b.index - a.index)) h.list.splice(h.index, 1)
  }
}

const fullId = (parent: string, id: string) => (id.startsWith(`${parent}.`) ? id : `${parent}.${id.trim()}`)
const nodeCopy = (node: ModuleDef, id: string, from: readonly string[]): ModuleDef => {
  // ADR-0052：层是原父模块的分类，换到别的父模块下不带过去
  const { children: _c, parent: _p, from: _f, stratum: _s, ...rest } = node
  return { ...rest, id, ...(from.length && !(from.length === 1 && from[0] === id) ? { from: [...from] } : {}) }
}

/** 本草图的一个模块（层除外时 notLayer） */
function own(def: SketchDef, id: string, notLayer = true): LocatedModule | Reject {
  const hit = locate(def, id)
  if (!hit) return no('not-found', `草图里没有模块「${id}」`)
  if (notLayer && isRootLayer(def, id)) return no('invalid', `「${id}」是层：层只在根草图里增删改排序`)
  return hit
}
const isReject = (x: unknown): x is Reject => !!x && typeof x === 'object' && 'code' in x && 'reason' in x

/** 移走模块时：它的接口跟着走（owner 换新 ID），closed 里的它搬到目标草图 */
function carry(s: Session, src: SketchDef, dst: SketchDef, id: string, to: string) {
  const ifaces = (src.interfaces ?? []).filter(x => x.owner && under(x.owner, id))
  if (ifaces.length) {
    src.interfaces = src.interfaces!.filter(x => !ifaces.includes(x))
    if (!src.interfaces.length) delete src.interfaces
    ;(dst.interfaces ??= []).push(...ifaces.map(x => ({ ...x, owner: swap(x.owner!, id, to) })))
  }
  if (src.closed?.includes(id)) {
    src.closed = src.closed.filter(c => c !== id)
    if (!src.closed.length) delete src.closed
    ;(dst.closed ??= []).push(to)
  }
  if (src.layout?.modules?.[id]) delete src.layout.modules[id]
  void s
}

/** 新模块在目标草图里的位置：目标有布局时取网格里的空位 */
function place(dst: SketchDef, id: string) {
  if (!dst.layout?.modules) return
  dst.layout.modules[id] ??= gridLayout(dst).modules![id]
}

function merge(s: Session, op: Extract<DesignEditOp, { op: 'merge' }>): Reject | null {
  const def = s.sketch(op.sketch)
  if (isReject(def)) return def
  const ids = [...new Set(op.ids)]
  if (ids.length < 2) return no('too-few', '合并至少要选两个模块（X7j）')
  if (!op.name.trim()) return no('invalid', '模块名称不能为空')
  const hits: LocatedModule[] = []
  for (const id of ids) {
    const h = own(def, id)
    if (isReject(h)) return h
    hits.push(h)
  }
  const parent = hits[0].parentId
  if (!parent || hits.some(h => h.parentId !== parent)) return no('invalid', '只能合并同一层的模块（X7j）')
  const newId = fullId(parent, op.id)
  const bad = s.checkId(newId, parent)
  if (bad) return bad
  const closure = [...new Set(hits.flatMap(h => s.closureOf(h.node)))]
  const kinds = new Set(hits.map(h => h.node.kind))
  const kind = op.kind ?? (kinds.size === 1 ? [...kinds][0] : undefined)
  // ADR-0052：来源同属一层时，合并结果留在这层
  const layers = new Set(hits.map(h => stratumOfMember(def, strataKey(def, h.parentId), h.id, h.node)?.id))
  const stratum = layers.size === 1 ? [...layers][0] : undefined
  const node: ModuleDef = {
    id: newId,
    name: op.name.trim(),
    ...(kind ? { kind } : {}),
    ...(stratum !== undefined ? { stratum } : {}),
    ...(closure.length >= 2 ? { from: closure } : {}),
  }
  const first = hits[0]
  first.list.splice(first.index, 0, node)
  const shifted = hits.map(h => (h.list === first.list && h.index >= first.index ? { ...h, index: h.index + 1 } : h))
  s.detach(shifted)
  // 位置：选中节点的重心；来源的相对位置带进下一层
  const pos = ids.map(id => def.layout?.modules?.[id]).filter(p => !!p)
  // 根草图的位置只有 x（X21）：带进下一层（非根草图）的只取 x、y 都有的
  const childLayout: Record<string, { x: number; y: number }> = {}
  for (const id of ids) {
    const p = def.layout?.modules?.[id]
    if (p && p.y !== undefined) childLayout[`${newId}.${shortName(id)}`] = { x: p.x, y: p.y }
  }
  for (const id of ids) if (def.layout?.modules?.[id]) delete def.layout.modules[id]
  if (pos.length) {
    const x = Math.round(pos.reduce((a, p) => a + p.x, 0) / pos.length)
    const ys = pos.map(p => p.y).filter((y): y is number => y !== undefined)
    def.layout!.modules![newId] = op.sketch === ROOT_MOUNT || ys.length < pos.length ? { x } : { x, y: Math.round(ys.reduce((a, y) => a + y, 0) / ys.length) }
  }
  // 下一层草图：来源各成一个子模块（from 指向基线来源），来源之间的关系、来源的接口与 closed 随来源进入
  const child = s.ensure(newId)
  const as = (id: string) => `${newId}.${shortName(id)}`
  child.modules = (child.modules ?? []).filter(m => !ids.some(id => m.id === as(id)))
  for (const h of hits) child.modules.push(nodeCopy(h.node, as(h.id), s.closureOf(h.node)))
  const inside = (def.relations ?? []).filter(r => ids.includes(r.from) && ids.includes(r.to))
  if (inside.length) {
    def.relations = def.relations!.filter(r => !inside.includes(r))
    child.relations = [...(child.relations ?? []).filter(r => !inside.some(x => x.id === r.id)), ...inside.map(r => ({ ...r, from: as(r.from), to: as(r.to) }))]
  }
  for (const id of ids) carry(s, def, child, id, as(id))
  if (Object.keys(childLayout).length) child.layout = { ...(child.layout ?? {}), modules: { ...(child.layout?.modules ?? {}), ...childLayout } }
  // 来源与外界的关系重指向新模块、同对同类型去重
  for (const r of def.relations ?? []) {
    if (ids.includes(r.from)) r.from = newId
    if (ids.includes(r.to)) r.to = newId
  }
  s.dedupe(def, newId)
  s.fx.created.push(newId)
  s.touch(op.sketch, newId)
  // 前缀级联：来源的子树与挂在它们上的草图换成「新模块.来源短名」
  for (const id of ids) s.cascade(id, as(id))
  return null
}

function split(s: Session, op: Extract<DesignEditOp, { op: 'split' }>): Reject | null {
  const def = s.sketch(op.sketch)
  if (isReject(def)) return def
  const hit = own(def, op.id)
  if (isReject(hit)) return hit
  if (op.parts.length < 2) return no('too-few', '拆分至少要拆成两个模块（X7k）')
  const parent = hit.parentId!
  const ids = op.parts.map(p => fullId(parent, p.id))
  if (new Set(ids).size !== ids.length) return no('id-taken', '拆分出的 ID 重复')
  for (const [i, id] of ids.entries()) {
    if (!op.parts[i].name.trim()) return no('invalid', '模块名称不能为空')
    const bad = s.checkId(id, parent, [op.id])
    if (bad) return bad
  }
  const closure = s.closureOf(hit.node)
  // ADR-0052：拆出的模块留在原模块的层
  const layer = stratumOfMember(def, strataKey(def, hit.parentId), op.id, hit.node)?.id
  const nodes = op.parts.map((p, i) => ({
    id: ids[i],
    name: p.name.trim(),
    ...(hit.node.kind ? { kind: hit.node.kind } : {}),
    ...(layer !== undefined ? { stratum: layer } : {}),
    ...(closure.length && !(closure.length === 1 && closure[0] === ids[i]) ? { from: [...closure] } : {}),
  }))
  hit.list.splice(hit.index, 1, ...nodes)
  const at = def.layout?.modules?.[op.id]
  if (at) {
    delete def.layout!.modules![op.id]
    nodes.forEach((n, i) => (def.layout!.modules![n.id] = { x: at.x + (i - (nodes.length - 1) / 2) * 200, ...(at.y !== undefined ? { y: at.y } : {}) }))
  }
  // 原模块的关系不自动分配（待重连，X16）；它的下一层草图随它删除（保留同 ID 的拆分结果时除外）
  if (!ids.includes(op.id))
    for (const m of sketchesUnder(s.draft, op.id)) {
      delete s.draft[m]
      s.fx.removedSketches.push(m)
    }
  s.fx.created.push(...ids.filter(id => id !== op.id))
  if (!ids.includes(op.id)) s.fx.removed.push(op.id)
  s.touch(op.sketch)
  return null
}

function demote(s: Session, op: Extract<DesignEditOp, { op: 'demote' }>): Reject | null {
  const def = s.sketch(op.sketch)
  if (isReject(def)) return def
  if (op.id === op.target) return no('ancestor', '不能降级到自己之下')
  const a = own(def, op.id)
  if (isReject(a)) return a
  const c = own(def, op.target)
  if (isReject(c)) return isReject(c) && c.code === 'invalid' ? no('invalid', '拖到层上是移入（根草图里换层），不是降级') : c
  if (a.parentId !== c.parentId) return no('invalid', '只能降级到同一层的另一个模块之下（X7d）')
  const newId = `${op.target}.${shortName(op.id)}`
  const bad = s.checkId(newId, op.target)
  if (bad) return bad
  const child = s.ensure(op.target)
  ;(child.modules ??= []).push(nodeCopy(a.node, newId, s.closureOf(a.node)))
  place(child, newId)
  carry(s, def, child, op.id, newId)
  s.detach([a])
  // 关系重指向目标、去重；与目标之间的关系成了连祖先，去掉
  for (const r of def.relations ?? []) {
    if (r.from === op.id) r.from = op.target
    if (r.to === op.id) r.to = op.target
  }
  s.dedupe(def, op.target)
  s.touch(op.sketch, op.target)
  s.cascade(op.id, newId)
  return null
}

function promote(s: Session, op: Extract<DesignEditOp, { op: 'promote' }>): Reject | null {
  const def = s.sketch(op.sketch)
  if (isReject(def)) return def
  const up = parentMount(op.sketch)
  if (!up) return no('invalid', '根草图里的模块没有上一层')
  const x = own(def, op.id)
  if (isReject(x)) return x
  const target = s.ensure(up.mount)
  const newId = `${up.parent}.${shortName(op.id)}`
  const bad = s.checkId(newId, up.parent)
  if (bad) return bad
  const node = nodeCopy(x.node, newId, s.closureOf(x.node))
  // ADR-0052：升级上来的模块落在它原来所在模块的层（父层声明了分层时）
  const from = stratumOfMember(target, up.parent, op.sketch)?.id
  if (from !== undefined) node.stratum = from
  else delete node.stratum
  if (up.mount === ROOT_MOUNT) {
    const layer = locate(target, up.parent)
    if (!layer) return no('not-found', `根草图里没有层「${up.parent}」`)
    ;(layer.node.children ??= []).push(node)
  } else (target.modules ??= []).push(node)
  place(target, newId)
  carry(s, def, target, op.id, newId)
  s.detach([x])
  s.touch(op.sketch, up.mount)
  // 下一层的关系不带上来：留在原草图里成为待重连（X16）
  s.cascade(op.id, newId, op.sketch)
  return null
}

function moveIn(s: Session, op: Extract<DesignEditOp, { op: 'moveIn' }>): Reject | null {
  const root = s.ensure(ROOT_MOUNT)
  const a = own(root, op.id)
  if (isReject(a)) return a
  const layer = locate(root, op.layer)
  if (!layer || !isRootLayer(root, op.layer)) return no('not-found', `根草图里没有层「${op.layer}」`)
  if (a.parentId === op.layer) return null
  if (!a.parentId || a.nested === false) return no('root-only', '移入只用于根草图里层的直接子模块（X7d）')
  const newId = `${op.layer}.${shortName(op.id)}`
  const bad = s.checkId(newId, op.layer)
  if (bad) return bad
  s.detach([a])
  ;(layer.node.children ??= []).push(nodeCopy(a.node, newId, s.closureOf(a.node)))
  if (root.layout?.modules?.[op.id]) {
    root.layout.modules[newId] = root.layout.modules[op.id]
    delete root.layout.modules[op.id]
  }
  s.touch(ROOT_MOUNT)
  s.cascade(op.id, newId)
  return null
}

function rename(s: Session, op: Extract<DesignEditOp, { op: 'rename' }>): Reject | null {
  const def = s.sketch(op.sketch)
  if (isReject(def)) return def
  const x = own(def, op.id, false)
  if (isReject(x)) return x
  const newId = x.parentId ? fullId(x.parentId, op.newId) : op.newId.trim()
  if (newId === op.id) return null
  const bad = x.parentId
    ? s.checkId(newId, x.parentId)
    : !ID_PATTERN.test(newId) || newId.includes('.')
      ? no('id-format', `层 ID「${newId}」不合法`)
      : s.taken().has(newId)
        ? no('id-taken', `ID「${newId}」已被占用`)
        : null
  if (bad) return bad
  s.touch(op.sketch)
  s.cascade(op.id, newId)
  return null
}

function remove(s: Session, op: Extract<DesignEditOp, { op: 'remove' }>): Reject | null {
  const def = s.sketch(op.sketch)
  if (isReject(def)) return def
  const r = applyEdit(def, { op: 'removeModule', id: op.id }, s.editContext())
  if (!r.ok) return no(r.code, r.reason)
  s.draft[op.sketch] = r.sketch
  s.fx.removed.push(...r.effects.removed)
  s.touch(op.sketch)
  // X7e：挂在它或它后代上的草图一并删；其他草图里以它（或后代）为端点的关系、它提供的接口一并删
  for (const m of sketchesUnder(s.draft, op.id)) {
    delete s.draft[m]
    s.fx.removedSketches.push(m)
  }
  for (const [key, d] of Object.entries(s.draft)) {
    const rels = (d.relations ?? []).filter(x => under(x.from, op.id) || under(x.to, op.id))
    const ifs = (d.interfaces ?? []).filter(x => x.owner && under(x.owner, op.id))
    if (!rels.length && !ifs.length) continue
    if (rels.length) d.relations = d.relations!.filter(x => !rels.includes(x))
    if (ifs.length) d.interfaces = d.interfaces!.filter(x => !ifs.includes(x))
    s.fx.removed.push(...rels.map(x => x.id), ...ifs.map(x => x.id))
    s.touch(key)
  }
  return null
}

/** 基线模块所在的那一层草图：父是根下的层（或根）时为根挂载，否则为父模块 */
function baselineMount(b: NonNullable<DesignEditContext['baseline']>, parent: string): string {
  if (parent === b.rootId) return ROOT_MOUNT
  return b.modules.get(parent)?.parentId === b.rootId ? ROOT_MOUNT : parent
}

/**
 * DL-2：恢复到基线——删掉设计里的这些模块（级联同 remove），把基线模块按底稿（X18 的结构字段）放回它在基线里的那一层；
 * 那一层的父在设计里改了 ID 时按前缀映射放到新父下（记 from）。底稿里一端是它、另一端在编辑中可见的关系一并放回（沿用基线 ID）。
 */
function restore(s: Session, op: Extract<DesignEditOp, { op: 'restore' }>): Reject | null {
  const b = s.ctx.baseline
  if (!b) return no('invalid', '没有基线：不能恢复到基线（X18）')
  for (const id of op.restore) if (!b.modules.has(id)) return no('not-found', `基线里没有模块「${id}」`)
  const pts = op.remove.map(r => s.draft[r.sketch]?.layout?.modules?.[r.id]).filter(p => !!p)
  for (const r of op.remove) {
    const out = remove(s, { op: 'remove', sketch: r.sketch, id: r.id })
    if (out) return out
  }
  const map = prefixMap(sketchLineage(Object.values(s.draft)))
  const cx = pts.length ? Math.round(pts.reduce((a, p) => a + p.x, 0) / pts.length) : undefined
  const ys = pts.map(p => p.y).filter((y): y is number => y !== undefined)
  const cy = ys.length ? Math.round(ys.reduce((a, y) => a + y, 0) / ys.length) : undefined
  op.restore.forEach((id, i) => {
    const parent = b.modules.get(id)!.parentId
    const at = parent === b.rootId ? parent : mapId(map, parent)
    const as = at === parent ? id : `${at}.${shortName(id)}`
    const mount = at === parent ? baselineMount(b, parent) : at.includes('.') ? at : ROOT_MOUNT
    const def = s.ensure(mount)
    s.touch(mount)
    if (locate(def, as)) return
    const node: ModuleDef = { ...structural(b, id, as), ...(as !== id ? { from: [id] } : {}) }
    placeModule(def, node, parent === b.rootId ? undefined : at)
    s.fx.created.push(as)
    if (def.layout?.modules) {
      if (cx !== undefined) def.layout.modules[as] = { x: cx + (i - (op.restore.length - 1) / 2) * GRID_GAP_X, ...(cy !== undefined && mount !== ROOT_MOUNT ? { y: cy } : {}) }
      else place(def, as)
    }
    // 底稿里与它相连的关系（两端在编辑中可见、同一对同类型没有的）沿用基线 ID 放回
    const ctx = s.editContext()
    const known = (x: string) => !!locate(def, x) || !!ctx.known?.(x) || x === def.mount
    const scope = mountScope(b, mount === ROOT_MOUNT ? ROOT_MOUNT : parent)
    for (const rid of scope.relations) {
      const r = b.relations.get(rid)!
      if (r.from !== id && r.to !== id) continue
      const [from, to] = [r.from === id ? as : mapId(map, r.from), r.to === id ? as : mapId(map, r.to)]
      if (!known(from) || !known(to) || from === to) continue
      const rels = (def.relations ??= [])
      if (rels.some(x => x.id === rid || (x.from === from && x.to === to && x.type === r.type))) continue
      rels.push({ id: rid, from, to, type: r.type })
      s.fx.created.push(rid)
    }
  })
  return null
}

/** 设计里一个模块所在的草图与位置 */
function findModule(draft: Draft, id: string): { mount: string; hit: LocatedModule } | null {
  for (const [mount, def] of Object.entries(draft)) {
    const hit = locate(def, id)
    if (hit) return { mount, hit }
  }
  return null
}

/**
 * DL-1：按轮快照恢复——模块与关系恢复成快照里的样子：同一草图同一父下的原地换字段（子模块不动），否则摘下再按快照放回；
 * 快照里没有的删掉。位置一并恢复。之后：因此消失的模块所挂的草图删掉，快照里挂在恢复回来的模块上、会话里没有的草图放回，
 * 一端是因此消失的模块的关系删掉。
 */
function restoreEntities(s: Session, op: Extract<DesignEditOp, { op: 'restoreEntities' }>): Reject | null {
  const snap = op.snapshot
  const present = (id: string) => !!findModule(s.draft, id)
  const before = new Set(op.modules.filter(present))
  const ensureSnapSketch = (mount: string): SketchDef | null => {
    if (s.draft[mount]) return s.draft[mount]
    if (!snap[mount]) return null
    s.draft[mount] = structuredClone(snap[mount]) as SketchDef
    s.fx.createdSketches.push(mount)
    return s.draft[mount]
  }
  for (const id of op.modules) {
    const cur = findModule(s.draft, id)
    const was = findModule(snap as Draft, id)
    const pos = was ? snap[was.mount].layout?.modules?.[id] : undefined
    if (cur && was && cur.mount === was.mount && cur.hit.parentId === was.hit.parentId) {
      const node = cur.hit.node as unknown as Record<string, unknown>
      const { children: _c, ...fields } = structuredClone(was.hit.node)
      for (const k of Object.keys(node)) if (k !== 'children') delete node[k]
      Object.assign(node, fields)
      const lay = s.draft[cur.mount].layout
      if (lay?.modules && pos) lay.modules[id] = { ...pos }
      s.touch(cur.mount)
      continue
    }
    if (cur) {
      cur.hit.list.splice(cur.hit.index, 1)
      if (s.draft[cur.mount].layout?.modules) delete s.draft[cur.mount].layout!.modules![id]
      s.touch(cur.mount)
      if (!was) s.fx.removed.push(id)
    }
    if (was) {
      const def = ensureSnapSketch(was.mount)
      if (!def || locate(def, id)) continue
      const { children, ...fields } = structuredClone(was.hit.node)
      const keep = (children ?? []).filter(c => !present(c.id))
      const node: ModuleDef = { ...fields, ...(keep.length ? { children: keep } : {}) }
      placeModule(def, node, was.hit.parentId)
      if (pos) (def.layout ??= {}).modules = { ...(def.layout.modules ?? {}), [id]: { ...pos } }
      if (!cur) s.fx.created.push(id)
      s.touch(was.mount)
    }
  }
  for (const rid of op.relations) {
    for (const [mount, def] of Object.entries(s.draft))
      if (def.relations?.some(r => r.id === rid)) {
        def.relations = def.relations.filter(r => r.id !== rid)
        if (!def.relations.length) delete def.relations
        if (def.layout?.relations) delete def.layout.relations[rid]
        s.touch(mount)
      }
    for (const [mount, def] of Object.entries(snap)) {
      const r = def.relations?.find(x => x.id === rid)
      if (!r) continue
      const dst = ensureSnapSketch(mount)
      if (!dst) continue
      ;(dst.relations ??= []).push(structuredClone(r))
      const label = def.layout?.relations?.[rid]
      if (label) ((dst.layout ??= {}).relations ??= {})[rid] = structuredClone(label)
      s.touch(mount)
    }
  }
  const gone = new Set([...before].filter(id => !present(id)))
  for (const m of Object.keys(s.draft))
    if (m !== ROOT_MOUNT && [...gone].some(g => under(m, g))) {
      delete s.draft[m]
      s.fx.removedSketches.push(m)
    }
  for (const id of op.modules) if (present(id) && snap[id] && !s.draft[id]) ensureSnapSketch(id)
  for (const [mount, def] of Object.entries(s.draft)) {
    const dead = (def.relations ?? []).filter(r => [r.from, r.to].some(e => [...gone].some(g => under(e, g))))
    if (!dead.length) continue
    def.relations = def.relations!.filter(r => !dead.includes(r))
    if (!def.relations.length) delete def.relations
    s.fx.removed.push(...dead.map(r => r.id))
    s.touch(mount)
  }
  return null
}

function single(s: Session, mount: string, edit: EditOp): Reject | null {
  if (edit.op === 'renameModule') return rename(s, { op: 'rename', sketch: mount, id: edit.id, newId: edit.newId })
  if (edit.op === 'removeModule') return remove(s, { op: 'remove', sketch: mount, id: edit.id })
  const def = s.sketch(mount)
  if (isReject(def)) return def
  if (mount !== ROOT_MOUNT && (edit.op === 'addLayer' || edit.op === 'reorderLayer' || edit.op === 'setMayDependOn'))
    return no('root-only', '层的增删改排序只在根草图里做（X7）')
  const r = applyEdit(def, edit, s.editContext())
  if (!r.ok) return no(r.code, r.reason)
  s.draft[mount] = r.sketch
  s.fx.created.push(...r.effects.created)
  s.fx.renamed.push(...r.effects.renamed)
  s.fx.removed.push(...r.effects.removed)
  s.touch(mount)
  return null
}

export function applyDesignEdit(design: SketchSet, op: DesignEditOp, ctx: DesignEditContext): DesignEditResult {
  const s = new Session(structuredClone({ ...design }) as Draft, ctx)
  const out =
    op.op === 'edit'
      ? single(s, op.sketch, op.edit)
      : op.op === 'merge'
        ? merge(s, op)
        : op.op === 'split'
          ? split(s, op)
          : op.op === 'demote'
            ? demote(s, op)
            : op.op === 'promote'
              ? promote(s, op)
              : op.op === 'moveIn'
                ? moveIn(s, op)
                : op.op === 'rename'
                  ? rename(s, op)
                  : op.op === 'restore'
                    ? restore(s, op)
                    : op.op === 'restoreEntities'
                      ? restoreEntities(s, op)
                      : remove(s, op)
  if (out) return { ok: false, ...out }
  // ADR-0052：挪走的模块不再列在原层的成员里（成员只在持久草图里的照留）
  const inDesign = new Set(Object.values(s.draft).flatMap(d => locateAll(d).map(m => m.id)))
  for (const def of Object.values(s.draft)) pruneStrata(def, id => inDesign.has(id) || knownModules(def, ctx.persistent).has(id))
  return { ok: true, design: s.draft, effects: s.fx }
}
