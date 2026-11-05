/**
 * 编辑操作的外部表示（T2.1，DA-9、DL-11）：设计级编辑操作（DesignEditOp）本来就是可序列化的值（X7i 靠它重放）；
 * 这里给 JSON → 操作序列的形状校验——agent 产出的「改」块里的操作逐条校验，任一条不合法整轮拒绝（不应用任何一条）。
 * 只校验形状（键、类型、取值）；能不能做成由 applyDesignEdit 判（X7b），做不成同样整轮拒绝（视图状态层）。
 * agent 不许出的操作：位置类（moveNode、relabel、autoArrange——已有的框 AI 不动，新框由架构台安放，DL-6）与两种恢复（撤回由架构台做，DL-1、DL-2）。纯函数。
 */
import type { EditBlock, Parsed } from '../dialogue/protocol'
import type { DesignEditOp, EditOp } from '../intent/types'
import { RELATION_TYPES } from '../types'

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)
const isStr = (x: unknown): x is string => typeof x === 'string'
const isStrs = (x: unknown): x is string[] => Array.isArray(x) && x.every(isStr)
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)
const isPoint = (x: unknown) => isObj(x) && isNum(x.x) && (x.y === undefined || isNum(x.y))

type Check = (o: Record<string, unknown>) => string | null
const need =
  (spec: Record<string, (v: unknown) => boolean>, optional: Record<string, (v: unknown) => boolean> = {}): Check =>
  o => {
    for (const [k, ok] of Object.entries(spec)) if (!ok(o[k])) return `缺 ${k} 或类型不对`
    for (const [k, ok] of Object.entries(optional)) if (o[k] !== undefined && !ok(o[k])) return `${k} 的类型不对`
    const extra = Object.keys(o).filter(k => k !== 'op' && !(k in spec) && !(k in optional))
    return extra.length ? `多出 ${extra.join('、')}` : null
  }

const relType = (v: unknown) => isStr(v) && (RELATION_TYPES as readonly string[]).includes(v)
const mods = { via: isStr, mode: (v: unknown) => v === 'sync' || v === 'async' || v === '', pull: (v: unknown) => typeof v === 'boolean' }
const PATCH_KEYS = ['name', 'responsibility', 'kind', 'codeRefs', 'abstraction', 'includes', 'excludes', 'role', 'adrs']

/** 单张草图上的操作（EditOp）各自的形状 */
const EDIT: Record<EditOp['op'], Check> = {
  addLayer: need({ name: isStr, at: isNum }, { id: isStr }),
  reorderLayer: need({ id: isStr, to: isNum }),
  setMayDependOn: need({ id: isStr, layers: isStrs }),
  addModule: need({ parent: isStr, name: isStr }, { id: isStr, kind: isStr }),
  updateModule: o => {
    const base = need({ id: isStr, patch: isObj })(o)
    if (base) return base
    const extra = Object.keys(o.patch as object).filter(k => !PATCH_KEYS.includes(k))
    return extra.length ? `updateModule 的 patch 只能改 ${PATCH_KEYS.join(' / ')}，多出 ${extra.join('、')}` : null
  },
  setClosed: need({ id: isStr, closed: v => typeof v === 'boolean' }),
  setStratum: need({ id: isStr, stratum: isStr }),
  moveModule: need({ id: isStr, parent: isStr }, { newId: isStr }),
  renameModule: need({ id: isStr, newId: isStr }),
  removeModule: need({ id: isStr }),
  connect: need({ from: isStr, to: isStr, type: relType }, { description: isStr, interface: isStr, id: isStr, ...mods }),
  updateRelation: o => need({ id: isStr, patch: isObj })(o) ?? need({}, { type: relType, description: isStr, interface: isStr, ...mods })({ ...(o.patch as object) }),
  removeRelation: need({ id: isStr }),
  addInterface: need({ owner: isStr, name: isStr }, { signature: isStr }),
  updateInterface: o => need({ id: isStr, patch: isObj })(o) ?? need({}, { name: isStr, signature: isStr })({ ...(o.patch as object) }),
  removeInterface: need({ id: isStr }),
  implement: need({ interface: isStr, module: isStr }, { remove: v => typeof v === 'boolean' }),
  setMeta: need({ patch: isObj }),
  setAbstraction: need({ text: isStr }),
  moveNode: need({ positions: v => isObj(v) && Object.values(v).every(isPoint) }),
  relabel: need({ id: isStr, label: v => v === null || isPoint(v) }),
  autoArrange: need({}, { area: isObj }),
  addReference: need({ id: isStr }),
  removeReference: need({ id: isStr }),
}

const DESIGN: Record<Exclude<DesignEditOp['op'], 'edit'>, Check> = {
  merge: need({ sketch: isStr, ids: isStrs, name: isStr, id: isStr }, { kind: isStr }),
  split: need({ sketch: isStr, id: isStr, parts: v => Array.isArray(v) && v.every(p => isObj(p) && isStr(p.name) && isStr(p.id)) }),
  demote: need({ sketch: isStr, id: isStr, target: isStr }),
  promote: need({ sketch: isStr, id: isStr }),
  moveIn: need({ id: isStr, layer: isStr }),
  rename: need({ sketch: isStr, id: isStr, newId: isStr }),
  remove: need({ sketch: isStr, id: isStr }),
  restore: need({ remove: v => Array.isArray(v) && v.every(x => isObj(x) && isStr(x.sketch) && isStr(x.id)), restore: isStrs }),
  restoreEntities: need({ snapshot: isObj, modules: isStrs, relations: isStrs }),
}

/** agent 不许出的操作（DL-6：已有的框 AI 不动；DL-1、DL-2：撤回由架构台做） */
export const AGENT_FORBIDDEN_OPS: readonly string[] = ['moveNode', 'relabel', 'autoArrange', 'restore', 'restoreEntities']

/** 一条设计级编辑操作的形状校验 */
export function parseDesignOp(raw: unknown, opts: { agent?: boolean } = {}): Parsed<DesignEditOp> {
  if (!isObj(raw) || !isStr(raw.op)) return { ok: false, error: '操作要是带 op 的对象' }
  if (raw.op === 'edit') {
    const bad = need({ sketch: isStr, edit: isObj })(raw)
    if (bad) return { ok: false, error: `edit：${bad}` }
    const e = raw.edit as Record<string, unknown>
    if (!isStr(e.op) || !(e.op in EDIT)) return { ok: false, error: `不认识的单张操作：${String(e.op)}` }
    if (opts.agent && AGENT_FORBIDDEN_OPS.includes(e.op)) return { ok: false, error: `AI 不能用 ${e.op}：已有的框只有人能动，新框由架构台安放（DL-6）` }
    const why = EDIT[e.op as EditOp['op']](e)
    return why ? { ok: false, error: `${e.op}：${why}` } : { ok: true, value: raw as unknown as DesignEditOp }
  }
  if (!(raw.op in DESIGN)) return { ok: false, error: `不认识的操作：${raw.op}` }
  if (opts.agent && AGENT_FORBIDDEN_OPS.includes(raw.op)) return { ok: false, error: `AI 不能用 ${raw.op}：撤回由架构台做（写在 withdraw 里）` }
  const why = DESIGN[raw.op as keyof typeof DESIGN](raw)
  return why ? { ok: false, error: `${raw.op}：${why}` } : { ok: true, value: raw as unknown as DesignEditOp }
}

/** 一串操作：任一条不合法整个拒绝（DA-9：非法整轮拒绝） */
export function parseDesignOps(raw: unknown, opts: { agent?: boolean } = {}): Parsed<DesignEditOp[]> {
  if (!Array.isArray(raw)) return { ok: false, error: 'ops 要是数组' }
  const out: DesignEditOp[] = []
  for (const [i, x] of raw.entries()) {
    const r = parseDesignOp(x, opts)
    if (!r.ok) return { ok: false, error: `第 ${i + 1} 条操作：${r.error}` }
    out.push(r.value)
  }
  return { ok: true, value: out }
}

/** 操作序列的 JSON（往返：parseDesignOps(JSON.parse(opsJson(x))) 得到同样的值） */
export const opsJson = (ops: readonly DesignEditOp[]): string => JSON.stringify(ops)

/** DL-21：agent 的改动块——每条操作过形状校验、不许出位置类与恢复类；不合法整轮拒绝（接入层收块时调，页面应用前再按 DesignEditOp 用） */
export function validateEditBlock(block: EditBlock): Parsed<DesignEditOp[]> {
  const r = parseDesignOps(block.ops, { agent: true })
  return r.ok ? r : { ok: false, error: `改动块：${r.error}` }
}
