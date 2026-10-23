/**
 * 描述写入的同步适配器（B1–B6，ADR-0019、ADR-0024）：页面只追加人拥有的内容，草图可整份写回；写入方式由项目视图注入（开发服务器的 HTTP 端点）。
 * 写后不改视图状态：开发服务器推送描述变化，模型源同步按 N5 重新加载。
 */
import type { ReviewedInput, RuleKind, SketchDef, SketchTarget, SketchValidationIssue } from '@/model'

export type WriteOutcome = { ok: true; file: string; note?: string } | { ok: false; error: string }

/** B6、X7i：草图整份写回的结果——成功带新指纹；文件已在外部改动为 conflict；服务端校验不过带问题列表 */
export type SketchSaveOutcome = { ok: true; file: string; hash: string } | { ok: false; error: string; conflict?: true; issues?: SketchValidationIssue[] }

/** X20：按设计写回的一张草图——baseHash 为 null 是新文件（会话里推出并改过的）；renamedFrom 为级联改名前的挂载点 */
export interface DesignSketchWrite {
  mount: string
  sketch: SketchDef
  baseHash: string | null
  renamedFrom?: string
}

/** X20、X7i：按设计写回的结果——成功带每个文件的新指纹与丢掉的引用；任一文件已在外部改动为 conflict；服务端校验不过带问题列表 */
export type DesignSaveOutcome =
  | { ok: true; files: { mount: string; file: string; hash: string }[]; removed: string[]; dropped: { mount: string; ids: string[] }[] }
  | { ok: false; error: string; conflict?: true; issues?: SketchValidationIssue[] }

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
  /** X20：按设计写回若干张草图（新文件、改名、删除），带各自读取时的指纹 */
  saveDesignSketches(input: { design: string; sketches: DesignSketchWrite[]; removed?: { mount: string; baseHash: string }[] }): Promise<DesignSaveOutcome>
  /** B6、05 裁决 3：新建设计（design.yaml 与草图）——给挂载点时底稿由服务端从基线（仓库 HEAD）复制；也可直接给草图 */
  createDesign(input: { id: string; name: string; goal?: string; mount?: string; sketch?: SketchDef }): Promise<WriteOutcome>
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
  saveDesignSketches: none,
  createDesign: none,
}
