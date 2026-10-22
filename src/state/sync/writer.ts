/**
 * 描述写入的同步适配器（B1–B6，ADR-0019、ADR-0024）：页面只追加人拥有的内容，草图可整份写回；写入方式由项目视图注入（开发服务器的 HTTP 端点）。
 * 写后不改视图状态：开发服务器推送描述变化，模型源同步按 N5 重新加载。
 */
import type { ReviewedInput, RuleKind, SketchDef, SketchTarget, SketchValidationIssue } from '@/model'

export type WriteOutcome = { ok: true; file: string; note?: string } | { ok: false; error: string }

/** B6、X7i：草图整份写回的结果——成功带新指纹；文件已在外部改动为 conflict；服务端校验不过带问题列表 */
export type SketchSaveOutcome = { ok: true; file: string; hash: string } | { ok: false; error: string; conflict?: true; issues?: SketchValidationIssue[] }

export interface ModelWriter {
  feedback(input: { design: string; revision: string; text: string }): Promise<WriteOutcome>
  allow(input: { from: string; to: string; rule?: RuleKind; reason: string }): Promise<WriteOutcome>
  ignore(input: { pattern: string }): Promise<WriteOutcome>
  /** Z1、Z6：一条或多条确认记录，同一模块更新那一条 */
  reviewed(input: { entries: ReviewedInput[] }): Promise<WriteOutcome>
  /** X4：认可一条偏差 */
  accept(input: { design: string; deviation: string; reason: string }): Promise<WriteOutcome>
  /** X3：归档 / 晋升 */
  archive(input: { design: string }): Promise<WriteOutcome>
  /** B6：草图整份写回，带读取时的指纹 */
  saveSketch(input: { target: SketchTarget; sketch: SketchDef; baseHash: string }): Promise<SketchSaveOutcome>
  /** B6：新建设计（design.yaml 与草图） */
  createDesign(input: { id: string; name: string; goal?: string; sketch: SketchDef }): Promise<WriteOutcome>
}

const none = async (): Promise<{ ok: false; error: string }> => ({ ok: false, error: '没有注入写入来源' })

/** 没有注入写入来源时（只看描述的测试） */
export const NO_WRITER: ModelWriter = {
  feedback: none,
  allow: none,
  ignore: none,
  reviewed: none,
  accept: none,
  archive: none,
  saveSketch: none,
  createDesign: none,
}
