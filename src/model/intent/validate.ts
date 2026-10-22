/**
 * 草图校验（X7f，ADR-0024）：只看草图本身能不能保存——格式、ID 格式与唯一、子模块 ID 以父 ID 为前缀（X5）、引用完整（范围为本草图 ∪ 持久草图）、
 * 不连祖先与后代（M6）、层依赖无环、与持久草图矛盾（与核验共用 sketchContradictions）。error 拒绝保存，warning 只提示。
 * 与核验（sketchCheck，版本对草图）分工：两边都有的只有矛盾检查。编辑态每次操作后、保存前与写入端点调用同一函数。
 */
import { sketchShapeIssues } from '../load'
import type { SketchDef, SketchEntity } from '../types'
import { sketchContradictions } from './check'
import { ID_PATTERN, knownModules, locateAll, subtreeIds } from './edit/locate'
import type { SketchValidation, SketchValidationIssue } from './types'

export function validateSketch(sketch: SketchDef, ctx: { persistent: readonly SketchEntity[]; file: string }): SketchValidation {
  const issues: SketchValidationIssue[] = []
  const err = (code: SketchValidationIssue['code'], message: string, target: SketchValidationIssue['target'], path?: string) =>
    issues.push({ severity: 'error', code, message, target, ...(path ? { path } : {}) })

  // ── 格式（schema）：形状不对时其余检查没有意义 ──
  const shape = sketchShapeIssues(sketch)
  if (shape.length) {
    for (const s of shape) err('sketch.schema', `格式错误：${s.message}`, {}, s.path)
    return { ok: false, issues }
  }
  const persistent = ctx.persistent.filter(p => p.file !== ctx.file && p.def.id !== sketch.id)
  const own = locateAll(sketch)
  const known = knownModules(sketch, persistent)
  const all = [...known].map(([id, m]) => ({ id, parentId: m.parentId }))
  const isAncestor = (a: string, b: string) => subtreeIds(all, a).includes(b)

  // ── ID：格式、本草图内唯一、前缀 ──
  const seen = new Set<string>()
  const ids = [
    ...own.map(m => ({ id: m.id, path: m.path, target: { module: m.id } })),
    ...(sketch.relations ?? []).map((r, i) => ({ id: r.id, path: `sketch.relations.${i}`, target: { relation: r.id } })),
    ...(sketch.interfaces ?? []).map((x, i) => ({ id: x.id, path: `sketch.interfaces.${i}`, target: { interface: x.id } })),
    ...(sketch.dataStructures ?? []).map((x, i) => ({ id: x.id, path: `sketch.dataStructures.${i}`, target: {} })),
  ]
  for (const x of ids) {
    if (!ID_PATTERN.test(x.id)) err('sketch.id', `ID「${x.id}」只能包含字母、数字和 . _ : -，且以字母或数字开头`, x.target, x.path)
    if (seen.has(x.id)) err('sketch.id-dup', `ID「${x.id}」在草图里重复`, x.target, x.path)
    seen.add(x.id)
  }
  for (const m of own)
    if (m.parentId && !m.id.startsWith(`${m.parentId}.`)) err('sketch.id-prefix', `「${m.id}」的 ID 必须以父模块 ID「${m.parentId}.」开头（X5）`, { module: m.id }, m.path)

  // ── 引用完整：parent、关系两端与经由接口、接口 owner、closed、mayDependOn ──
  const ifaces = new Set([...(sketch.interfaces ?? []), ...persistent.flatMap(p => p.def.interfaces ?? [])].map(x => x.id))
  const ref = (id: string, what: string, target: SketchValidationIssue['target'], path: string) =>
    known.has(id) ? true : (err('sketch.ref', `${what}「${id}」不在本草图或持久草图里`, target, path), false)
  for (const m of own) if (m.parentId) ref(m.parentId, `「${m.id}」的父模块`, { module: m.id }, m.path)
  sketch.relations?.forEach((r, i) => {
    const path = `sketch.relations.${i}`
    const ok = [ref(r.from, `关系「${r.id}」的起点`, { relation: r.id }, path), ref(r.to, `关系「${r.id}」的终点`, { relation: r.id }, path)].every(Boolean)
    if (r.interface && !ifaces.has(r.interface)) err('sketch.ref', `关系「${r.id}」经由的接口「${r.interface}」不在本草图或持久草图里`, { relation: r.id }, path)
    if (ok && (r.from === r.to || isAncestor(r.from, r.to) || isAncestor(r.to, r.from)))
      err('sketch.ancestor', `关系「${r.id}」连了自己、祖先或后代（M6）`, { relation: r.id }, path)
  })
  sketch.interfaces?.forEach((x, i) => {
    if (x.owner) ref(x.owner, `接口「${x.id}」的提供方`, { interface: x.id }, `sketch.interfaces.${i}`)
  })
  sketch.closed?.forEach((c, i) => ref(c, '封闭的子树', { module: c }, `sketch.closed.${i}`))
  for (const m of own)
    m.node.mayDependOn?.forEach((d, i) => {
      if (ref(d, `「${m.id}」可依赖的层`, { module: m.id }, `${m.path}.mayDependOn.${i}`) && known.get(d)?.node.kind !== 'layer')
        err('sketch.ref', `「${m.id}」可依赖的「${d}」不是层`, { module: m.id }, `${m.path}.mayDependOn.${i}`)
    })

  // ── 层依赖无环（本草图的写法优先于持久草图）──
  const deps = new Map<string, string[]>()
  for (const [id, m] of known) if (m.node.kind === 'layer') deps.set(id, m.node.mayDependOn ?? [])
  const cycle = findCycle(deps)
  if (cycle) err('sketch.layer-cycle', `层依赖成环：${[...cycle, cycle[0]].join(' → ')}`, { module: cycle.find(id => own.some(m => m.id === id)) ?? cycle[0] })

  // ── 与持久草图矛盾（X4，与核验同一函数）──
  for (const d of sketchContradictions({ def: sketch, file: ctx.file, src: { file: ctx.file, path: 'sketch' } }, persistent))
    err('sketch.contradiction', d.message, { module: d.target.modules?.[0] }, d.at?.path)

  // ── 提醒：模块没写职责 ──
  for (const m of own)
    if (!m.node.responsibility?.trim())
      issues.push({ severity: 'warning', code: 'sketch.empty', message: `「${m.node.name || m.id}」还没写职责`, target: { module: m.id }, path: m.path })

  return { ok: !issues.some(i => i.severity === 'error'), issues }
}

/** 有向图里的一个环（没有时 null） */
function findCycle(edges: ReadonlyMap<string, readonly string[]>): string[] | null {
  const state = new Map<string, 1 | 2>()
  const stack: string[] = []
  const visit = (n: string): string[] | null => {
    state.set(n, 1)
    stack.push(n)
    for (const m of edges.get(n) ?? []) {
      if (!edges.has(m)) continue
      if (state.get(m) === 1) return stack.slice(stack.indexOf(m))
      if (!state.has(m)) {
        const c = visit(m)
        if (c) return c
      }
    }
    stack.pop()
    state.set(n, 2)
    return null
  }
  for (const n of edges.keys()) {
    if (state.has(n)) continue
    const c = visit(n)
    if (c) return c
  }
  return null
}
