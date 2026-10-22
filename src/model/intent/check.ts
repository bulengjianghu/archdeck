/**
 * 草图核验（X2、X4）：对设计的某一轮或当前版本，只比草图写了的——缺模块、封闭子树多出子模块、字段不一致为错误；
 * 关系没有对应、接口不存在或 owner 不同为提醒；职责等文字字段不判。核验前先查草图与持久草图的矛盾。
 * 纯函数：输入草图定义与模型索引，页面、lint:model 与 agent 接口同一份结果。
 */
import { load } from '../load'
import type { ModelIndex, ModuleDef, RawFile, SketchEntity, SketchLifetime, SourceLoc } from '../types'
import type { AcceptedDeviation, SketchCheck, SketchDeviation, SketchDeviationCode } from './types'

/** 草图里的一个模块：父模块（undefined = 根）、写了的字段 */
export interface FlatSketchModule {
  id: string
  parentId?: string
  def: Omit<ModuleDef, 'children' | 'parent'>
  /** 草图写了的字段（没写的不约束，X2） */
  written: ReadonlySet<string>
  src?: SourceLoc
}

/** 草图定义展开为模块清单（嵌套位置、parent，否则根） */
export function flattenSketch(sketch: SketchEntity): FlatSketchModule[] {
  const out: FlatSketchModule[] = []
  const push = (m: ModuleDef, parentId: string | undefined, path: string) => {
    const { children, parent, ...def } = m
    const written = new Set(Object.keys(def).filter(k => k !== 'id' && def[k as keyof typeof def] !== undefined))
    out.push({ id: m.id, parentId: parentId ?? parent, def, written, src: { file: sketch.file, path } })
    children?.forEach((c, i) => push(c, m.id, `${path}.children.${i}`))
  }
  sketch.def.modules?.forEach((m, i) => push(m, undefined, `sketch.modules.${i}`))
  return out
}

/** X3：生命周期——intent/ 下缺省 persistent，设计的草图缺省 until-implemented */
export const sketchLifetime = (s: SketchEntity): SketchLifetime => s.def.lifetime ?? (/(^|\/)intent\//.test(s.file) ? 'persistent' : 'until-implemented')

export interface SketchCheckOptions {
  /** 持久草图（矛盾检查用，X4）；草图自己与它 supersedes 的不算 */
  persistent?: readonly SketchEntity[]
  /** 认可的偏差（design.yaml 的 accepted，X4） */
  accepted?: readonly AcceptedDeviation[]
}

const sameSet = (a: readonly string[] | undefined, b: readonly string[] | undefined) => {
  const x = [...(a ?? [])].sort().join('\0')
  const y = [...(b ?? [])].sort().join('\0')
  return x === y
}

export function sketchCheck(sketch: SketchEntity, index: ModelIndex, opts: SketchCheckOptions = {}): SketchCheck {
  const deviations: SketchDeviation[] = []
  const push = (code: SketchDeviationCode, severity: 'error' | 'warning', entity: string, message: string, extra: Partial<SketchDeviation> = {}) =>
    deviations.push({ key: `${code.slice('sketch.'.length)}:${entity}`, code, severity, rules: ['X4'], message, target: {}, ...extra })
  const rootId = index.rootId
  const parentOf = (m: FlatSketchModule) => m.parentId ?? rootId
  const name = (id: string) => index.modules.get(id)?.name ?? id
  const modules = flattenSketch(sketch)
  const byId = new Map(modules.map(m => [m.id, m]))
  const closed = new Set(sketch.def.closed ?? [])

  // ── 与持久草图的矛盾（X4）：两边都写的字段不一致，或往封闭子树下加直接子模块；声明 supersedes 的跳过 ──
  for (const p of opts.persistent ?? []) {
    if (p.def.id === sketch.def.id || p.file === sketch.file || sketch.def.supersedes === p.def.id) continue
    const pm = flattenSketch(p)
    const pById = new Map(pm.map(m => [m.id, m]))
    for (const m of modules) {
      const q = pById.get(m.id)
      if (!q) continue
      const diff: string[] = []
      if (parentOf(m) !== parentOf(q)) diff.push('父模块')
      for (const f of ['kind', 'core'] as const) if (m.written.has(f) && q.written.has(f) && m.def[f] !== q.def[f]) diff.push(f)
      if (m.written.has('mayDependOn') && q.written.has('mayDependOn') && !sameSet(m.def.mayDependOn, q.def.mayDependOn)) diff.push('mayDependOn')
      if (diff.length)
        push('sketch.contradiction', 'error', m.id, `「${m.id}」与持久草图「${p.def.id}」矛盾：${diff.join('、')}不一致；要改它请在草图里声明 supersedes: ${p.def.id}`, {
          rules: ['X3', 'X4'],
          target: { modules: [m.id] },
          at: m.src,
        })
    }
    const pClosed = new Set(p.def.closed ?? [])
    const pChildren = new Set(pm.filter(x => x.parentId !== undefined).map(x => `${x.parentId}/${x.id}`))
    for (const m of modules) {
      if (m.parentId === undefined || !pClosed.has(m.parentId) || pChildren.has(`${m.parentId}/${m.id}`)) continue
      push('sketch.contradiction', 'error', m.id, `「${m.id}」挂在持久草图「${p.def.id}」封闭的「${m.parentId}」之下，但不在它的直接子模块里；要加它请声明 supersedes: ${p.def.id}`, {
        rules: ['X2', 'X3', 'X4'],
        target: { modules: [m.id, m.parentId] },
        at: m.src,
      })
    }
  }

  // ── 模块：存在、父模块 / kind / core / mayDependOn（写了才比）──
  for (const m of modules) {
    const actual = index.modules.get(m.id)
    if (!actual) {
      push('sketch.missing-module', 'error', m.id, `草图的模块「${m.id}」（${m.def.name}）在版本里不存在：AI 必须沿用草图的 ID，重命名或移动只能经草图`, {
        rules: ['X4', 'X5'],
        target: { modules: [parentOf(m)] },
        at: m.src,
      })
      continue
    }
    const diff: string[] = []
    if (actual.parentId !== parentOf(m)) diff.push(`父模块（草图 ${parentOf(m)}，版本 ${actual.parentId}）`)
    for (const f of ['kind', 'core'] as const) if (m.written.has(f) && m.def[f] !== actual[f]) diff.push(`${f}（草图 ${String(m.def[f])}，版本 ${String(actual[f])}）`)
    if (m.written.has('mayDependOn') && !sameSet(m.def.mayDependOn, actual.mayDependOn))
      diff.push(`mayDependOn（草图 [${(m.def.mayDependOn ?? []).join(', ')}]，版本 [${(actual.mayDependOn ?? []).join(', ')}]）`)
    if (diff.length)
      push('sketch.field', 'error', m.id, `「${name(m.id)}」与草图不一致：${diff.join('；')}`, { target: { modules: [m.id] }, at: m.src, detail: '写了才比：草图没写的字段不约束（X2）' })
  }

  // ── 封闭子树（X2）：直接子模块集合必须相等 ──
  for (const c of closed) {
    if (!index.modules.has(c) && c !== rootId) continue
    const declared = new Set(modules.filter(m => parentOf(m) === c).map(m => m.id))
    for (const kid of index.childrenOf.get(c) ?? [])
      if (!declared.has(kid))
        push('sketch.extra-child', 'error', kid, `「${name(c)}」在草图里是封闭的子树，版本多出了直接子模块「${kid}」（${name(kid)}）`, {
          rules: ['X2', 'X4'],
          target: { modules: [kid, c] },
          at: byId.get(c)?.src,
        })
  }

  // ── 关系：按两端 + 类型，版本里两端落在草图两端子树内的同类型关系也算对应 ──
  const within = (id: string, anc: string) => id === anc || !!index.pathOf.get(id)?.includes(anc)
  sketch.def.relations?.forEach((r, i) => {
    const hit = [...index.relations.values()].some(x => x.type === r.type && within(x.from, r.from) && within(x.to, r.to))
    if (!hit)
      push('sketch.missing-relation', 'warning', r.id, `草图的关系「${r.id}」（${r.type}，${name(r.from)} → ${name(r.to)}）在版本里没有对应（含两端更深层之间的）`, {
        target: { relation: r.id, modules: [r.from, r.to].filter(id => index.modules.has(id)) },
        at: { file: sketch.file, path: `sketch.relations.${i}` },
      })
  })

  // ── 接口：存在、owner（写了才比）──
  sketch.def.interfaces?.forEach((x, i) => {
    const actual = index.interfaces.get(x.id)
    const at = { file: sketch.file, path: `sketch.interfaces.${i}` }
    if (!actual) push('sketch.missing-interface', 'warning', x.id, `草图的接口「${x.id}」（${x.name}）在版本里不存在`, { target: { interface: x.id, ...(x.owner ? { modules: [x.owner] } : {}) }, at })
    else if (x.owner !== undefined && actual.owner !== x.owner)
      push('sketch.interface-owner', 'warning', x.id, `接口「${x.id}」的提供方与草图不同：草图 ${x.owner}，版本 ${actual.owner ?? '（未写）'}`, { target: { interface: x.id, modules: [x.owner] }, at })
  })

  // ── 认可的偏差（X4）：只有提醒能认可，降为 info ──
  const accepted = new Map((opts.accepted ?? []).map(a => [a.deviation, a]))
  for (const d of deviations) {
    const a = accepted.get(d.key)
    if (a && d.severity === 'warning') {
      d.severity = 'info'
      d.accepted = { reason: a.reason, ...(a.at ? { at: a.at } : {}) }
    }
  }
  const counts = { error: 0, warning: 0, info: 0 }
  for (const d of deviations) counts[d.severity]++
  return {
    sketch: sketch.def.id,
    ...(sketch.design ? { design: sketch.design } : {}),
    lifetime: sketchLifetime(sketch),
    ...(sketch.def.supersedes ? { supersedes: sketch.def.supersedes } : {}),
    deviations,
    counts,
    consistent: counts.error === 0 && counts.warning === 0,
  }
}

/** 载荷附带的设计草图（X4）：解析成草图实体，记所属设计 */
export function parseDesignSketches(files: readonly { design: string; file: RawFile }[]): SketchEntity[] {
  return files.flatMap(({ design, file }) => load([file]).model.sketches.map(s => ({ ...s, design })))
}

/**
 * 对一个版本有约束力的草图（X3、X4）：版本自带的持久草图 + 载荷附带的设计草图；版本自带的非持久草图（草图版本里打开的那张）不算——它自己就是尺子。
 * 返回每张的核验结果；accepted 按设计给出。
 */
export function checkSketches(
  index: ModelIndex,
  designSketches: readonly SketchEntity[],
  accepted: ReadonlyMap<string, readonly AcceptedDeviation[]> = new Map(),
): SketchCheck[] {
  const persistent = index.model.sketches.filter(s => sketchLifetime(s) === 'persistent')
  const out = persistent.map(s => sketchCheck(s, index, { persistent }))
  for (const s of designSketches) out.push(sketchCheck(s, index, { persistent, accepted: s.design ? accepted.get(s.design) : undefined }))
  return out
}
