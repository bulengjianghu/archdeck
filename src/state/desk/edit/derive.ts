/**
 * 编辑态派生（X7f、L-1、L-2、L-4，ADR-0024）：编辑中的草图连同 system.yaml 与持久草图经同一条加载流水线成为索引（编辑态下它就是 DeskState 的 index）；
 * 即时校验、对当前版本的实时核验、未保存改动的摘要、晋升预览。都是调用模型层的纯计算。
 */
import { computed, type ShallowRef } from 'vue'
import {
  diffModels,
  loadModel,
  sketchCheck,
  sketchLifetime,
  sketchText,
  validateSketch,
  type AcceptedDeviation,
  type EditContext,
  type ModelDiff,
  type ModelIndex,
  type RawFile,
  type SketchCheck,
  type SketchDef,
  type SketchEntity,
  type SketchValidation,
} from '@/model'
import { isDirty, type EditSession } from './session'

/** 草图连同载荷里的其他文件（system.yaml、持久草图）加载成索引；草图文件换成 draft 的文本 */
export function draftIndex(files: readonly RawFile[], file: string, draft: SketchDef): ModelIndex {
  return loadModel([...files.filter(f => f.path !== file), { path: file, text: sketchText(draft) }]).index
}

/** 编辑的上下文：载荷里的持久草图（不含正在编辑的那张） */
export function editContext(loaded: ModelIndex, file: string, designSketch: boolean): EditContext {
  return { persistent: loaded.model.sketches.filter(s => s.file !== file && sketchLifetime(s) === 'persistent'), designSketch }
}

export interface DeriveInputs {
  session: ShallowRef<EditSession | null>
  loaded: ShallowRef<ModelIndex | null>
  files: ShallowRef<RawFile[]>
  /** 当前版本（载荷附带的对比基线），实时核验的对象 */
  current: () => ModelIndex | null
  accepted: () => readonly AcceptedDeviation[]
  design?: string
}

export function createDerive({ session, loaded, files, current, accepted, design }: DeriveInputs) {
  const ctx = computed<EditContext | null>(() => (session.value && loaded.value ? editContext(loaded.value, session.value.file, !!design) : null))
  const entity = (def: SketchDef, file: string): SketchEntity => ({ def, file, src: { file, path: 'sketch' }, ...(design ? { design } : {}) })
  /** X7f：即时校验 */
  const validation = computed<SketchValidation | null>(() => {
    const s = session.value
    return s && ctx.value ? validateSketch(s.draft, { persistent: ctx.value.persistent, file: s.file }) : null
  })
  /** L-1：编辑中对当前版本实时核验——「实现后将有 N 处偏差」 */
  const check = computed<SketchCheck | null>(() => {
    const s = session.value
    const cur = current()
    return s && cur && ctx.value ? sketchCheck(entity(s.draft, s.file), cur, { persistent: ctx.value.persistent, accepted: accepted() }) : null
  })
  const dirty = computed(() => (session.value ? isDirty(session.value) : false))
  /** L-2：未保存的改动（相对读取时 / 上次保存后的草图） */
  const changes = computed<ModelDiff | null>(() => {
    const s = session.value
    if (!s || !dirty.value) return null
    return diffModels(draftIndex(files.value, s.file, s.base.sketch), draftIndex(files.value, s.file, s.draft))
  })
  /** L-4：声明 supersedes 时与被替换持久草图的差异——持久草图单独加载 vs 草图替换它之后 */
  const promotion = computed<ModelDiff | null>(() => {
    const s = session.value
    const target = s?.draft.supersedes && ctx.value?.persistent.find(p => p.def.id === s.draft.supersedes)
    if (!s || !target) return null
    const system = files.value.filter(f => f.path === 'system.yaml')
    const before = loadModel([...system, { path: target.file, text: sketchText(target.def) }]).index
    const after = loadModel([...system, { path: s.file, text: sketchText({ ...s.draft, supersedes: undefined }) }]).index
    return diffModels(before, after)
  })
  return { ctx, validation, check, dirty, changes, promotion }
}

export type EditDerivations = ReturnType<typeof createDerive>
