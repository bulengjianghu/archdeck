/**
 * 草图校验（X7f、X14，ADR-0024、ADR-0025）：只看草图本身，两级——
 * 格式错误（error，拦保存）：schema、ID 格式与重复、模块不是挂载点的直接子节点（父、前缀、嵌套不对）、挂载点是层或不存在、
 * 文件名与 mount 不一致、引用不存在、缺名称、关系不在本层（两端都不在本草图，或另一端是本层模块的后代）；
 * 语义提示（warning，拦「保存并交给 AI」与定稿）：根草图的层依赖成环、同挂载点与持久草图矛盾（X4）、待重连（X16）；本层的环由代码事实给出（Y4，ADR-0026）；
 * 只提示（hint，不进两级）：超七（X13）、没写职责。
 * 与核验（sketchCheck，版本对草图）分工：两边都有的只有矛盾检查（同一函数与稳定键）。画布每次操作后、保存前与写入端点调用同一函数。
 */
import { sketchShapeIssues } from '../load'
import { INTERACTION_TYPES, LEGACY_VIAS, ROOT_MOUNT, UNCLASSIFIED, isSharedRole, parseVia, type InteractionType, type ModelIndex, type SketchDef, type SketchEntity } from '../types'
import { sketchContradictions } from './check'
import { ID_PATTERN, knownModules, locateAll } from './edit/locate'
import { prefixMap, sketchLineage, unmapId } from './lineage'
import { looksLocal } from './scope'
import { mountOfSketchFile, type SketchSet, type SketchValidation, type SketchValidationIssue } from './types'

export interface ValidateContext {
  /** 持久草图（引用范围、层、矛盾检查）；正在校验的这张自己会被跳过 */
  persistent: readonly SketchEntity[]
  /** 草图文件（相对项目描述目录，或载荷里的路径）：设计草图的文件名必须与 mount 一致 */
  file: string
  /** 范围外可引用的模块：当前版本或基线（不给时只认持久草图与设计的其他草图） */
  index?: ModelIndex | null
  /** 同一设计的其他草图（引用范围） */
  design?: SketchSet
}

/** X13：一张草图的模块数软限 */
export const SKETCH_SOFT_LIMIT = 7

export function validateSketch(sketch: SketchDef, ctx: ValidateContext): SketchValidation {
  const issues: SketchValidationIssue[] = []
  const push = (severity: SketchValidationIssue['severity'], code: SketchValidationIssue['code'], message: string, target: SketchValidationIssue['target'] = {}, path?: string) =>
    issues.push({ severity, code, message, target, ...(path ? { path } : {}) })
  const err = (...a: Parameters<typeof push> extends [unknown, ...infer R] ? R : never) => push('error', ...a)
  const finish = (pending: string[] = []): SketchValidation => {
    const by = (s: string) => issues.filter(i => i.severity === s)
    const errors = by('error')
    const warnings = by('warning')
    const hints = by('hint')
    return { ok: !errors.length, ready: !errors.length && !warnings.length, errors, warnings, hints, issues: [...errors, ...warnings, ...hints], pending }
  }

  // ── 格式（schema）：形状不对时其余检查没有意义 ──
  const shape = sketchShapeIssues(sketch)
  if (shape.length) {
    for (const s of shape) err('sketch.schema', `格式错误：${s.message}`, {}, s.path)
    return finish()
  }
  const root = sketch.mount === ROOT_MOUNT
  const persistent = ctx.persistent.filter(p => p.file !== ctx.file && p.def.id !== sketch.id)
  const others = Object.values(ctx.design ?? {}).filter(d => d !== sketch && d.mount !== sketch.mount)
  const own = locateAll(sketch)
  const local = new Set(own.map(m => m.id))
  const fromPersistent = knownModules({ id: '', mount: ROOT_MOUNT }, persistent)
  const fromDesign = new Set(others.flatMap(d => locateAll(d).map(m => m.id)))
  const plain = (id: string) => local.has(id) || fromPersistent.has(id) || fromDesign.has(id) || !!ctx.index?.modules.has(id) || !!ctx.index?.actors.has(id)
  // X12：前缀级联换了 ID、没有草图覆盖的后代（由前缀映射推出）也算存在——按映射回到基线里的 ID 查
  const prefixes = prefixMap(sketchLineage([sketch, ...others]))
  const known = (id: string) => {
    if (plain(id)) return true
    const was = prefixes.size ? unmapId(prefixes, id) : id
    return was !== id && plain(was)
  }
  const isLayer = (id: string) =>
    (fromPersistent.get(id)?.node.kind ?? own.find(m => m.id === id)?.node.kind ?? ctx.index?.modules.get(id)?.kind) === 'layer'
  const layers = new Set([...fromPersistent].filter(([, m]) => m.node.kind === 'layer').map(([id]) => id))
  if (root) for (const m of own) if (m.parentId === undefined && m.node.kind === 'layer') layers.add(m.id)

  // ── 挂载点与文件（X9）──
  const fileMount = mountOfSketchFile(ctx.file)
  if (fileMount !== undefined && fileMount !== sketch.mount) err('sketch.file', `文件名「${fileMount}」与 mount「${sketch.mount}」不一致：设计的草图文件名必须是挂载点 ID（X9）`, {}, 'sketch.mount')
  if (!root) {
    if (isLayer(sketch.mount)) err('sketch.mount', `挂载点「${sketch.mount}」是层：层的直接子模块由根草图画（X9）`, {}, 'sketch.mount')
    else if ((ctx.index || persistent.length || others.length) && !known(sketch.mount)) err('sketch.ref', `挂载点「${sketch.mount}」不存在`, {}, 'sketch.mount')
  } else if (sketch.abstraction !== undefined) err('sketch.mount', '根挂载没有父模块原则：各层的原则写在层的 abstraction 等字段（X10）', {}, 'sketch.abstraction')

  // ── ID：格式、本草图内唯一 ──
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

  // ── 模块是挂载点的直接子节点（X9）、有名称 ──
  for (const m of own) {
    const t = { module: m.id }
    if (!m.node.name?.trim()) err('sketch.name', `「${m.id}」缺名称`, t, m.path)
    if (root) {
      if (m.parentId === undefined) {
        if (m.node.kind !== 'layer') err('sketch.scope', `根草图的顶层只放层，「${m.id}」不是层（X9）`, t, m.path)
        if (m.node.parent !== undefined) err('sketch.parent', `「${m.id}」不写 parent：根草图的层挂在系统根下`, t, m.path)
      } else if (!m.nested || own.find(x => x.id === m.parentId)?.parentId !== undefined)
        err('sketch.nested', `根草图只到层的直接子模块，「${m.id}」更深（X9）：往下一层请在它的父模块上再挂一张草图`, t, m.path)
      else if (!m.id.startsWith(`${m.parentId}.`) || m.id.slice(m.parentId.length + 1).includes('.'))
        err('sketch.id-prefix', `「${m.id}」的 ID 必须是「${m.parentId}.<短名>」（X5、X9）`, t, m.path)
    } else {
      if (m.nested) err('sketch.nested', `「${m.id}」嵌套在 children 里：草图只画一个层次，往下一层请在它的父模块上再挂一张草图（X9）`, t, m.path)
      else if (m.node.parent !== undefined && m.node.parent !== sketch.mount)
        err('sketch.parent', `「${m.id}」写了 parent「${m.node.parent}」：父模块由 mount 推出，不写 parent（X9）`, t, m.path)
      if (!m.nested && (!m.id.startsWith(`${sketch.mount}.`) || m.id.slice(sketch.mount.length + 1).includes('.')))
        err('sketch.id-prefix', `「${m.id}」不是挂载点「${sketch.mount}」的直接子节点：ID 必须是「${sketch.mount}.<短名>」（X9）`, t, m.path)
    }
  }

  // ── 关系只写本层（X9、X19）；端点原在本层、现已不在的为待重连（X16）──
  const within = (id: string) => root || id === sketch.mount || id.startsWith(`${sketch.mount}.`)
  const ifaces = new Set([...(sketch.interfaces ?? []), ...persistent.flatMap(p => p.def.interfaces ?? []), ...others.flatMap(d => d.interfaces ?? [])].map(x => x.id))
  for (const x of ctx.index?.interfaces.keys() ?? []) ifaces.add(x)
  const pending: string[] = []
  /**
   * X23：连线的类型与修饰的格式——类型取四类（迁移期的 calls 只提示「待分类」，不进两级）；via 合四形态（旧的平铺取值只提示），
   * port:<P> 的 P 是已知接口、bus:<M> 的 M 是已知模块；mode 只用于查询 / 委托，pull 只用于流。
   */
  const relationFormat = (r: NonNullable<SketchDef['relations']>[number], path: string) => {
    const t = { relation: r.id }
    const type = r.type as string
    if (type === UNCLASSIFIED) push('hint', 'sketch.unclassified', `关系「${r.id}」待分类：按三问定为查询（queries）或委托（commands），写进草图即确认（X23）`, t, path)
    else if (!INTERACTION_TYPES.includes(type as InteractionType))
      err('sketch.relation-type', `关系「${r.id}」的类型「${type}」不是四类交互之一：查询 queries / 委托 commands / 通知 notifies / 流 streams（X23）`, t, path)
    if (r.via !== undefined) {
      const v = parseVia(r.via)
      if (!v) {
        if (LEGACY_VIAS.includes(r.via)) push('hint', 'sketch.via', `关系「${r.id}」的 via: ${r.via} 是旧写法：改写为 port:<接口> / bus:<总线模块> / channel:<通道名>（M20）`, t, path)
        else err('sketch.via', `关系「${r.id}」的 via「${r.via}」不合四形态：不写（直接）/ port:<接口 ID> / bus:<模块 ID> / channel:<通道名>（X23）`, t, path)
      } else if (v.kind === 'port' && v.target && !ifaces.has(v.target)) err('sketch.ref', `关系「${r.id}」经由的端口「${v.target}」不存在（X23）`, t, path)
      else if (v.kind === 'bus' && v.target && !known(v.target)) err('sketch.ref', `关系「${r.id}」经由的总线「${v.target}」不存在（X23）`, t, path)
      else if (v.kind !== 'channel' && !v.target) push('hint', 'sketch.via', `关系「${r.id}」的 via: ${r.via} 没指明${v.kind === 'port' ? '端口' : '总线'}（M20）`, t, path)
    }
    if (r.mode !== undefined && (type === 'notifies' || type === 'streams'))
      err('sketch.relation-type', `关系「${r.id}」是${type === 'notifies' ? '通知（一律异步）' : '流'}，不写 mode：mode 只用于查询与委托（M13、X23）`, t, path)
    if (r.pull !== undefined && type !== 'streams') err('sketch.relation-type', `关系「${r.id}」不是流，不写 pull（M13、X23）`, t, path)
  }
  sketch.relations?.forEach((r, i) => {
    const path = `sketch.relations.${i}`
    const t = { relation: r.id }
    const ends = [r.from, r.to]
    const gone = ends.filter(e => !local.has(e) && looksLocal(sketch.mount, e, layers) && !(root && known(e)))
    if (gone.length) {
      pending.push(r.id)
      push('warning', 'sketch.pending', `关系「${r.id}」的端点「${gone.join('、')}」已不在本层：重连到本层模块或删除（X16）`, t, path)
      return
    }
    const missing = ends.filter(e => !known(e))
    for (const e of missing) err('sketch.ref', `关系「${r.id}」的${e === r.from ? '起点' : '终点'}「${e}」不存在`, t, path)
    if (missing.length) return
    if (!ends.some(e => local.has(e)) && !(root && ends.every(e => looksLocal(ROOT_MOUNT, e, layers))))
      err('sketch.scope', `关系「${r.id}」两端都不在本草图：关系只写本层（X9、X19）`, t, path)
    else if (ends.some(e => !local.has(e) && within(e) && !(root && looksLocal(ROOT_MOUNT, e, layers))))
      err('sketch.scope', `关系「${r.id}」的另一端在本层模块的后代里：只写本层模块之间、或一端在挂载点之外的关系（X9、X18）`, t, path)
    else if (r.from === r.to || ends.some((e, k) => !local.has(e) && (ends[1 - k].startsWith(`${e}.`) || e.startsWith(`${ends[1 - k]}.`))))
      err('sketch.ancestor', `关系「${r.id}」连了自己、祖先或后代（M6）`, t, path)
    if (r.interface && !ifaces.has(r.interface)) err('sketch.ref', `关系「${r.id}」经由的接口「${r.interface}」不存在`, t, path)
    relationFormat(r, path)
  })

  // ── X24：草图声明的端口实现者是已知模块 ──
  sketch.interfaces?.forEach((x, i) =>
    x.implementedBy?.forEach(m => {
      if (!known(m)) err('sketch.ref', `接口「${x.id}」的实现者「${m}」不存在（X24）`, { interface: x.id }, `sketch.interfaces.${i}.implementedBy`)
    }),
  )

  // ── 接口的 owner 是本草图的模块（X10）；closed 是挂载点或本草图的模块（X2）；可依赖的是层 ──
  sketch.interfaces?.forEach((x, i) => {
    const path = `sketch.interfaces.${i}`
    if (!x.owner || local.has(x.owner)) return
    if (looksLocal(sketch.mount, x.owner, layers) && !(root && known(x.owner))) {
      push('warning', 'sketch.pending', `接口「${x.id}」的提供方「${x.owner}」已不在本层：改给本层模块或删除（X16）`, { interface: x.id }, path)
      return
    }
    err('sketch.ref', `接口「${x.id}」的提供方「${x.owner}」不是本草图的模块：对外接口写在提供方所在的草图（X10）`, { interface: x.id }, path)
  })
  sketch.closed?.forEach((c, i) => {
    if (c !== sketch.mount && !local.has(c)) err('sketch.ref', `封闭的「${c}」不是挂载点或本草图的模块（X2）`, { module: c }, `sketch.closed.${i}`)
  })
  for (const m of own)
    m.node.mayDependOn?.forEach((d, i) => {
      if (!known(d)) err('sketch.ref', `「${m.id}」可依赖的层「${d}」不存在`, { module: m.id }, `${m.path}.mayDependOn.${i}`)
      else if (!isLayer(d)) err('sketch.ref', `「${m.id}」可依赖的「${d}」不是层`, { module: m.id }, `${m.path}.mayDependOn.${i}`)
    })

  // ── 语义：根草图的层依赖成环（mayDependOn 图，X14）；非根草图本层的环由代码事实给出（Y4，ADR-0026）──
  if (root) {
    const deps = new Map<string, string[]>()
    for (const [id, m] of fromPersistent) if (m.node.kind === 'layer' && m.parentId === undefined) deps.set(id, m.node.mayDependOn ?? [])
    for (const m of own) if (m.parentId === undefined && m.node.kind === 'layer') deps.set(m.id, m.node.mayDependOn ?? [])
    const cycle = findCycle(deps)
    if (cycle) push('warning', 'sketch.layer-cycle', `层依赖成环：${[...cycle, cycle[0]].join(' → ')}（X14）`, { module: cycle.find(id => local.has(id)) ?? cycle[0] })
  }

  // ── 语义：同挂载点与持久草图矛盾（X4，与核验同一函数）──
  for (const d of sketchContradictions({ def: sketch, file: ctx.file, src: { file: ctx.file, path: 'sketch' }, mount: sketch.mount }, persistent))
    push('warning', 'sketch.contradiction', d.message, { module: d.target.modules?.[0] }, d.at?.path)

  // ── 只提示：超七（X13）、没写职责 ──
  // X13、X21：根草图按每条层带算（骨架整体天然超七），其余草图按本层；七的软限只数非共用件（ADR-0027）
  if (root)
    for (const layer of own.filter(m => m.parentId === undefined)) {
      const n = (layer.node.children ?? []).filter(k => !isSharedRole(k.role)).length
      if (n > SKETCH_SOFT_LIMIT) push('hint', 'sketch.over-seven', `「${layer.node.name || layer.id}」${n} 个模块，考虑归并（X13）`, { module: layer.id }, layer.path)
    }
  else if (own.filter(m => !isSharedRole(m.node.role)).length > SKETCH_SOFT_LIMIT)
    push('hint', 'sketch.over-seven', `${own.filter(m => !isSharedRole(m.node.role)).length} 个模块，考虑归并（X13）`)
  for (const m of own)
    if (m.node.kind !== 'layer' && !m.node.responsibility?.trim()) push('hint', 'sketch.empty', `「${m.node.name || m.id}」还没写职责`, { module: m.id }, m.path)

  return finish(pending)
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
