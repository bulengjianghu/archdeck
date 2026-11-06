/**
 * 模型源同步：取描述文件并交给模型层加载；本项目的描述变化（开发态 `arch-model:changed`）时重新取。
 * 只负责外界，加载结果由协调者 dispatch。
 */
import type { Baseline, Baselines } from '../desk/ports'
import { loadModel, type DesignInfo, type LoadedModel, type ModelCommit, type RawFile, type TranscriptRecord, type VersionRef } from '@/model'

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
  compare?: { current: CompareSource; previous?: CompareSource; baseline?: CompareSource }
  /** X4：对本版本有约束力的设计草图 */
  sketches?: { design: string; file: RawFile }[]
  /** DV-10：草图版本的「交给 AI」指令 */
  sketchPrompt?: string
  /** X7i：草图版本的草图文件、它在载荷里的路径与读取时的指纹（设计有多张时为主草图） */
  sketch?: { file: string; hash: string; path?: string }
  /** X9、X20：设计的全部草图（第三波的设计级会话用） */
  sketchFiles?: { mount?: string; file: string; path?: string; hash: string; needsLayout?: boolean }[]
  /** DL-3：草图版本里设计的改动项编号表（changes.json 原文） */
  changes?: unknown
  /** DL-10：设计说明 */
  notes?: DesignNote[]
  /** DL-51：设计里落盘的对话（各轮，贴图为 data URL） */
  transcript?: TranscriptRecord[]
}

/** DL-10：一份设计说明（designs/<设计>/notes/<名>.md，AI 拥有） */
export interface DesignNote {
  file: string
  title: string
  module?: string
  text: string
}

export type FetchModel = () => Promise<ModelPayload>

export interface LoadedSource {
  payload: ModelPayload
  model: LoadedModel
  /**
   * current：当前版本；previous：上一轮；base：设计的基线（X17，载荷给出时）；
   * own：持久草图版本里「去掉这张草图贡献后的当前版本」——持久草图本身也进当前版本（X1），交给 AI 时的改动摘要与它比（口径同服务端 intentChanges）；偏差仍相对 current
   */
  baselines: Baselines
}

// ADR-0052：对比基线的形状是 DeskState 的接线端口（state.desk），派生按它读
export type { Baseline, Baselines } from '../desk/ports'

/** 取一次描述并加载（设计版本同时加载对比基线） */
export async function fetchAndLoad(fetchModel: FetchModel): Promise<LoadedSource> {
  const payload = await fetchModel()
  const toBaseline = (src?: CompareSource): Baseline | undefined => (src ? { label: src.label, index: loadModel(src.files).index } : undefined)
  const current = payload.compare?.current
  // 持久草图版本：主草图在 intent/ 下（设计的草图在 sketches/ 下）
  const own = payload.sketch?.path?.startsWith('intent/') ? payload.sketch.path : undefined
  return {
    payload,
    model: loadModel(payload.files),
    baselines: {
      current: toBaseline(current),
      previous: toBaseline(payload.compare?.previous),
      base: toBaseline(payload.compare?.baseline),
      ...(own && current ? { own: toBaseline({ ...current, files: current.files.filter(f => f.path !== own) }) } : {}),
    },
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
