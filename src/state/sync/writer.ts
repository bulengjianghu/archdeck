/**
 * 描述写入的同步适配器（B1–B6，ADR-0019、ADR-0024）：页面只追加人拥有的内容，草图可整份写回；写入方式由项目视图注入（开发服务器的 HTTP 端点）。
 * 写后不改视图状态：开发服务器推送描述变化，模型源同步按 N5 重新加载。
 */
import type { ModelWriter } from '../desk/ports'

// ADR-0052：写入口与派生按这些形状调用写入（DeskState 的接线端口，归协调者 state.desk），这里实现
export type { WriteOutcome, SketchSaveOutcome, DesignSketchWrite, DesignSaveOutcome, ModelWriter, ArchivePreview } from '../desk/ports'

const none = async (): Promise<{ ok: false; error: string }> => ({ ok: false, error: '没有注入写入来源' })

/** 没有注入写入来源时（只看描述的测试） */
export const NO_WRITER: ModelWriter = {
  feedback: none,
  allow: none,
  ignore: none,
  reviewed: none,
  accept: none,
  role: none,
  archive: none,
  archivePreview: none,
  designStatus: none,
  saveSketch: none,
  saveDesignSketches: none,
  saveNote: none,
  createDesign: none,
}
