/**
 * 模型源同步：取描述文件并交给模型层加载；本项目的描述变化（开发态 `arch-model:changed`）时重新取。
 * 只负责外界，加载结果由协调者 dispatch。
 */
import { loadModel, type DesignInfo, type LoadedModel, type ModelCommit, type ModelIndex, type RawFile, type VersionRef } from '@/model'

export interface CompareSource {
  label: string
  dir: string
  files: RawFile[]
}

export interface ModelPayload {
  /** 项目 ID；多项目时用于校验路由与变更通知 */
  project?: string
  dir: string
  files: RawFile[]
  /** 本项目的全部设计版本 */
  designs?: DesignInfo[]
  /** 改动过本项目描述的最近提交（E5） */
  commits?: ModelCommit[]
  /** 打开的是设计版本（ADR-0002，轮次或草图 DV-10）或提交版本（E5）时给出 */
  version?: VersionRef
  compare?: { current: CompareSource; previous?: CompareSource }
  /** X4：对本版本有约束力的设计草图 */
  sketches?: { design: string; file: RawFile }[]
  /** DV-10：草图版本的「交给 AI」指令 */
  sketchPrompt?: string
  /** X7i：草图版本的草图文件、它在载荷里的路径与读取时的指纹（设计有多张时为主草图） */
  sketch?: { file: string; hash: string; path?: string }
  /** X9、X20：设计的全部草图（第三波的设计级会话用） */
  sketchFiles?: { mount?: string; file: string; path?: string; hash: string; needsLayout?: boolean }[]
}

export type FetchModel = () => Promise<ModelPayload>

/** 对比基线加载后的结果 */
export interface Baseline {
  label: string
  index: ModelIndex
}

export interface LoadedSource {
  payload: ModelPayload
  model: LoadedModel
  baselines: { current?: Baseline; previous?: Baseline }
}

/** 取一次描述并加载（设计版本同时加载对比基线） */
export async function fetchAndLoad(fetchModel: FetchModel): Promise<LoadedSource> {
  const payload = await fetchModel()
  const toBaseline = (src?: CompareSource): Baseline | undefined => (src ? { label: src.label, index: loadModel(src.files).index } : undefined)
  return {
    payload,
    model: loadModel(payload.files),
    baselines: { current: toBaseline(payload.compare?.current), previous: toBaseline(payload.compare?.previous) },
  }
}

/** 变更通知的来源：开发态为 import.meta.hot */
export interface ChangeEvents {
  on(event: 'arch-model:changed', cb: (data: { project?: string }) => void): void
  off(event: 'arch-model:changed', cb: (data: { project?: string }) => void): void
}

/** 订阅本项目的描述变化，返回取消订阅函数 */
export function watchModelChanges(events: ChangeEvents | undefined, project: string | undefined, onChange: () => void): () => void {
  if (!events) return () => {}
  const cb = (data: { project?: string }) => {
    if (data?.project === project) onChange()
  }
  events.on('arch-model:changed', cb)
  return () => events.off('arch-model:changed', cb)
}
