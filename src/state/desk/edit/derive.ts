/**
 * 编辑会话的派生（X7f、X13、X14、X16、X17、X20，ADR-0025）：都是调用模型层的纯计算。
 * - 设计的索引：载荷里的其他文件（system.yaml、持久草图）连同会话里的各张草图与它们引用的外部模块，经同一条加载流水线成为索引（编辑态下它就是 DeskState 的 index）；
 * - 当前张的画布数据（state.layout.sketch：节点含引用节点、直线边、layout 坐标，无 layout 时网格布局一次、算「需初始布局」不算脏）；
 * - 两级校验（本张与全设计）、超七提示、待重连；两个对比（相对基线 / 相对当前版本）的本张与全设计计数；脏、能否撤销 / 重做；面包屑。
 */
import { computed, type ShallowRef } from 'vue'
import { stringify } from 'yaml'
import {
  compareDesign,
  locateAll,
  loadModel,
  ROOT_MOUNT,
  sketchLifetime,
  sketchText,
  validateSketch,
  type ChangeKind,
  type CompareMode,
  type DesignEditContext,
  type ModelIndex,
  type RawFile,
  type SketchComparison,
  type SketchDef,
  type SketchEntity,
  type SketchSet,
  type SketchValidation,
} from '@/model'
import { sketchScene, type SketchScene } from '@/layout/layout'
import type { Selection } from '../../transition'
import { isDirty, sketchDirty, type EditSession } from './session'

/** 一张草图在载荷里的路径：设计的草图为 sketches/<mount>.yaml，持久草图为 intent/<ID>.yaml */
export const sketchPath = (s: Pick<EditSession, 'target'>, mount: string): string =>
  s.target.kind === 'persistent' ? `intent/${s.target.id}.yaml` : `sketches/${mount}.yaml`

const REFERENCES = 'references.yaml'

/** X19：草图引用、但草图与载荷里都没有定义的模块（与它缺的祖先），取当前版本的名称与位置，让设计的索引自成一份可加载的描述 */
function referenceFile(current: ModelIndex | null, files: readonly RawFile[], sketches: readonly SketchDef[]): RawFile | null {
  if (!current) return null
  const { index } = loadModel(files)
  const need = new Set<string>()
  for (const d of sketches) {
    for (const r of d.relations ?? []) for (const e of [r.from, r.to]) need.add(e)
    for (const x of d.interfaces ?? []) if (x.owner) need.add(x.owner)
    for (const id of Object.keys(d.layout?.modules ?? {})) need.add(id)
    if (d.mount !== ROOT_MOUNT) need.add(d.mount)
  }
  const modules: { id: string; name: string; parent?: string; kind?: string; responsibility?: string }[] = []
  const actors: { id: string; name: string; kind: string }[] = []
  const add = (id: string) => {
    if (index.modules.has(id) || modules.some(m => m.id === id)) return
    const m = current.modules.get(id)
    if (!m) return
    if (m.parentId !== current.rootId) add(m.parentId)
    modules.push({
      id,
      name: m.name,
      ...(m.parentId !== current.rootId ? { parent: m.parentId } : {}),
      ...(m.kind ? { kind: m.kind } : {}),
      ...(m.responsibility ? { responsibility: m.responsibility } : {}),
    })
  }
  for (const id of need) {
    const a = current.actors.get(id)
    if (a && !index.actors.has(id)) actors.push({ id, name: a.name, kind: a.kind })
    else add(id)
  }
  if (!modules.length && !actors.length) return null
  return { path: REFERENCES, text: stringify({ ...(modules.length ? { modules } : {}), ...(actors.length ? { actors } : {}) }, { lineWidth: 0 }) }
}

/** 设计的索引：载荷里的草图文件与引用文件换成会话里的各张草图（与它们引用的外部模块） */
export function designIndex(files: readonly RawFile[], s: EditSession, current: ModelIndex | null): ModelIndex {
  const readPaths = new Set(Object.values(s.read).map(r => r.file))
  const rest = files.filter(f => !readPaths.has(f.path) && f.path !== REFERENCES && !/^sketches\//.test(f.path))
  const drafts = Object.entries(s.doc.sketches).map(([m, d]) => ({ path: sketchPath(s, m), text: sketchText(d) }))
  const refs = referenceFile(current, [...rest, ...drafts], Object.values(s.doc.sketches))
  return loadModel([...rest, ...drafts, ...(refs ? [refs] : [])]).index
}

/** 草图实体（核验与对比的输入） */
const entity = (s: EditSession, mount: string, def: SketchDef): SketchEntity => {
  const file = sketchPath(s, mount)
  return { def, file, src: { file, path: 'sketch' }, mount, ...(s.target.kind === 'design' ? { design: s.target.design } : {}) }
}

/** 编辑的上下文：载荷里的持久草图（不含正在编辑的那张）与设计的基线 */
export function editContext(s: EditSession, loaded: ModelIndex, baseline: ModelIndex | null): DesignEditContext {
  const own = new Set(Object.values(s.read).map(r => r.file))
  return { design: s.id, persistent: loaded.model.sketches.filter(p => !own.has(p.file) && sketchLifetime(p) === 'persistent'), baseline }
}

/** 一种对比的结果：全设计计数与本张 */
export interface CompareView {
  mode: CompareMode
  counts: Record<ChangeKind, number>
  pending: number
  sheet: SketchComparison | null
  sheets: SketchComparison[]
}

/** 图上标出变更：本张的变更按实体 ID 归类（拆分标在拆出的每个模块上） */
export function changeMarks(c: SketchComparison | null): Map<string, ChangeKind> {
  const out = new Map<string, ChangeKind>()
  for (const x of c?.changes ?? []) {
    if (x.kind === 'removed') continue
    if (x.kind === 'split') for (const id of x.to ?? []) out.set(id, 'split')
    else out.set(x.id, x.kind)
  }
  return out
}

export interface DeriveInputs {
  session: ShallowRef<EditSession | null>
  loaded: ShallowRef<ModelIndex | null>
  files: ShallowRef<RawFile[]>
  /** 当前版本（相对当前版本的对象——偏差，与 sketchCheck 同一口径；引用外部模块、名称与位置的来源） */
  current: () => ModelIndex | null
  /** 持久草图「交给 AI 时的改动摘要」的对象：去掉这张草图贡献后的当前版本（同服务端 intentChanges）；不进计数 */
  handoffCurrent: () => ModelIndex | null
  /** 有相对基线（设计的草图）；持久草图没有，vsBaseline 为 null */
  twoBases: boolean
  /** 设计的基线（相对基线的对象、底稿与推出的来源） */
  baseline: () => ModelIndex | null
  /** 对比口径与是否在图上标出（对比弹层设定） */
  compareMode: () => CompareMode
  showDiff: () => boolean
  selection: () => Selection | null
  /** 画布上额外选中的（框选 / ⇧ 多选） */
  multi: () => readonly string[]
  /** X22：隐藏外部引用（工具条的切换，只在会话里） */
  hideReferences: () => boolean
  /** X22：草图画布的可用区域（画布容器的实际尺寸；没量到为 null） */
  area?: () => { w: number; h: number } | null
}

export function createDerive(i: DeriveInputs) {
  const { session, loaded, files } = i
  const ctx = computed<DesignEditContext | null>(() => (session.value && loaded.value ? editContext(session.value, loaded.value, i.baseline()) : null))
  /** 设计的索引（编辑态下 DeskState 的 index） */
  const index = computed<ModelIndex | null>(() => (session.value ? designIndex(files.value, session.value, i.current()) : null))
  const sketch = computed<SketchDef | null>(() => session.value?.doc.sketches[session.value.mount] ?? null)
  const mount = computed(() => session.value?.mount ?? null)

  /** X14：各张的两级校验 */
  const validations = computed<Record<string, SketchValidation>>(() => {
    const s = session.value
    if (!s || !ctx.value) return {}
    const out: Record<string, SketchValidation> = {}
    for (const [m, d] of Object.entries(s.doc.sketches))
      out[m] = validateSketch(d, { persistent: ctx.value.persistent, file: sketchPath(s, m), index: i.current() ?? i.baseline(), design: s.doc.sketches })
    return out
  })
  /** 当前张的校验 */
  const validation = computed<SketchValidation | null>(() => (mount.value ? (validations.value[mount.value] ?? null) : null))
  /** 全设计：能保存（没有格式错误）、能交给 AI（也没有语义提示） */
  const designErrors = computed(() => Object.entries(validations.value).flatMap(([m, v]) => v.errors.map(e => ({ mount: m, ...e }))))
  const designWarnings = computed(() => Object.entries(validations.value).flatMap(([m, v]) => v.warnings.map(e => ({ mount: m, ...e }))))
  /** X13：超七 */
  const overSeven = computed(() => validation.value?.hints.find(h => h.code === 'sketch.over-seven') ?? null)
  /** X13、X21：本张的全部超七提示（根草图按每条层带各一条） */
  const overSevens = computed(() => validation.value?.hints.filter(h => h.code === 'sketch.over-seven') ?? [])
  /** X16：待重连 */
  const pending = computed(() => validation.value?.pending ?? [])

  const compare = (mode: CompareMode, target: ModelIndex | null): CompareView | null => {
    const s = session.value
    if (!s || !target) return null
    const entities = Object.entries(s.doc.sketches).map(([m, d]) => entity(s, m, d))
    const r = compareDesign(entities, target, mode)
    return { mode, counts: r.counts, pending: r.pending, sheet: r.sketches.find(c => c.mount === s.mount) ?? null, sheets: r.sketches }
  }
  /** X17：两个对比——相对基线（我改了什么）与相对当前版本（实现还差什么） */
  const vsBaseline = computed(() => (i.twoBases ? compare('baseline', i.baseline()) : null))
  const vsCurrent = computed(() => compare('current', i.current()))
  /**
   * X17：持久草图交给 AI 时的改动摘要——与去掉这张草图贡献后的当前版本比（它本身也进当前版本，X1），只用于「说明」里单独一节，
   * 不是偏差、不进计数；设计的草图为 null（交给 AI 的摘要是相对基线）
   */
  const handoff = computed(() => (i.twoBases ? null : compare('current', i.handoffCurrent())))
  const comparison = computed(() => (i.compareMode() === 'baseline' ? vsBaseline.value : vsCurrent.value))

  const dirty = computed(() => (session.value ? isDirty(session.value, i.baseline()) : false))
  /** 各张是否改过（面板与设计面板标记用） */
  const dirtySketches = computed(() => {
    const s = session.value
    return s ? Object.keys(s.doc.sketches).filter(m => sketchDirty(s, m, i.baseline())) : []
  })
  const canUndo = computed(() => !!session.value?.past.length)
  const canRedo = computed(() => !!session.value?.future.length)

  /** 名称：设计里的草图、当前版本、基线 */
  const nameOf = (id: string): string | undefined => {
    const s = session.value
    for (const d of Object.values(s?.doc.sketches ?? {})) {
      const hit = locateAll(d).find(m => m.id === id)
      if (hit) return hit.node.name
    }
    return i.current()?.modules.get(id)?.name ?? i.baseline()?.modules.get(id)?.name ?? i.current()?.actors.get(id)?.name
  }
  /** 模块有下一层：设计里有挂在它身上的草图，或基线 / 当前版本里有子模块 */
  const deeper = (id: string): boolean => {
    const s = session.value
    if (s?.doc.sketches[id]) return true
    const has = (idx: ModelIndex | null) => (idx?.childrenOf.get(id)?.length ?? 0) > 0
    return has(i.baseline()) || has(i.current())
  }

  /** X22：引用按层成列的依据——设计的索引（没有时为当前版本）里的层（按 order）、模块所属的层与系统名 */
  const boundary = computed(() => {
    const idx = index.value ?? i.current()
    if (!idx) return {}
    const layers = (idx.childrenOf.get(idx.rootId) ?? []).map(id => idx.modules.get(id)!).filter(m => m?.kind === 'layer')
    const ids = new Set(layers.map(l => l.id))
    const layerOf = (id: string) => {
      const top = idx.pathOf.get(id)?.[1] ?? id.split('.')[0]
      return ids.has(top) ? top : undefined
    }
    return { layers: layers.map(l => ({ id: l.id, name: l.name })), layerOf, system: idx.model.system.name }
  })
  /** 当前张的画布数据 */
  const scene = computed<SketchScene | null>(() => {
    const def = sketch.value
    if (!def) return null
    const sel = i.selection()
    const selected = new Set([...(sel && (sel.kind === 'module' || sel.kind === 'relation') ? [sel.id] : []), ...i.multi()])
    return sketchScene({
      def,
      nameOf,
      deeper,
      changes: i.showDiff() ? changeMarks(comparison.value?.sheet ?? null) : null,
      selected,
      pending: pending.value,
      ...boundary.value,
      mountName: def.mount === ROOT_MOUNT ? undefined : (nameOf(def.mount) ?? def.mount),
      hideReferences: i.hideReferences(),
      ...(i.area?.() ? { area: i.area()! } : {}),
    })
  })
  /** X15：当前张没有 layout（显示的是一次网格布局，不写回） */
  const needsLayout = computed(() => !!scene.value?.needsLayout)

  /** 面包屑：从根到当前张的挂载点（层不是层次，跳过：层的子模块画在根草图里） */
  const breadcrumb = computed<{ mount: string; name: string; open: boolean }[]>(() => {
    const s = session.value
    const m = s?.mount
    if (!s || !m) return []
    const chain: string[] = [ROOT_MOUNT]
    if (m !== ROOT_MOUNT) {
      const parts = m.split('.')
      for (let k = 2; k <= parts.length; k++) chain.push(parts.slice(0, k).join('.'))
    }
    const label = (x: string) => (x === ROOT_MOUNT ? (i.current()?.model.system.name ?? '系统') : (nameOf(x) ?? x))
    // 层的名称作为第二级的前缀显示，便于认出「视图状态层 › DeskState」
    return chain.map(x => {
      const layer = x !== ROOT_MOUNT && x.split('.').length === 2 ? nameOf(x.split('.')[0]) : undefined
      return { mount: x, name: layer ? `${layer} › ${label(x)}` : label(x), open: !!s.doc.sketches[x] }
    })
  })

  return {
    ctx,
    index,
    sketch,
    mount,
    validations,
    validation,
    designErrors,
    designWarnings,
    overSeven,
    overSevens,
    pending,
    vsBaseline,
    vsCurrent,
    handoff,
    comparison,
    dirty,
    dirtySketches,
    canUndo,
    canRedo,
    scene,
    needsLayout,
    breadcrumb,
    nameOf,
    deeper,
  }
}

export type EditDerivations = ReturnType<typeof createDerive>
export type { SketchSet }
