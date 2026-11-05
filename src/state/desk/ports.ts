/**
 * DeskState 的接线端口（ADR-0052）：写入口与派生按这些形状读写外界，同步适配器（state/sync/）实现它们。
 * 端口归协调者 state.desk 自己：子模块经协调者接线，派生与写入口不依赖同步适配器（DeskState 的分层：同步适配器 → 写入口 → 派生）。只有类型。
 */
import type { ShallowRef } from 'vue'
import type {
  ChangeTable,
  ExportedSymbol,
  FactsPayload,
  ModelIndex,
  ModuleRole,
  ReviewedInput,
  RuleKind,
  SketchDef,
  SketchTarget,
  SketchValidationIssue,
  SourceFile,
  SourceHistory,
  SourcePayload,
} from '@/model'

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
  /** U11、M16：在 intent/roles.yaml 认可一个模块的角色（ADR-0027） */
  role(input: { module: string; role: ModuleRole }): Promise<WriteOutcome>
  /** X3：归档 / 晋升 */
  archive(input: { design: string }): Promise<WriteOutcome>
  /** DL-33：设计状态——认可（带页面读到的各张草图指纹）、回到起草、放弃 */
  designStatus(input: { design: string; action: 'accept' | 'withdraw' | 'abandon'; sketches?: Record<string, string> }): Promise<WriteOutcome>
  /** B6：草图整份写回，带读取时的指纹 */
  saveSketch(input: { target: SketchTarget; sketch: SketchDef; baseHash: string }): Promise<SketchSaveOutcome>
  /** X20：按设计写回若干张草图（新文件、改名、删除），带各自读取时的指纹 */
  saveDesignSketches(input: {
    design: string
    sketches: DesignSketchWrite[]
    removed?: { mount: string; baseHash: string }[]
    changes?: ChangeTable
  }): Promise<DesignSaveOutcome>
  /** DL-10：存为设计说明（designs/<设计>/notes/，AI 拥有、不登记指纹） */
  saveNote(input: { design: string; title: string; text: string; module?: string }): Promise<{ ok: true; file: string } | { ok: false; error: string }>
  /** B6、05 裁决 3：新建设计（design.yaml 与草图）——给挂载点时底稿由服务端从基线（仓库 HEAD）复制；也可直接给草图 */
  createDesign(input: { id: string; name: string; goal?: string; mount?: string; sketch?: SketchDef }): Promise<WriteOutcome>
}

/** 对比基线加载后的结果 */
export interface Baseline {
  label: string
  index: ModelIndex
}

export interface Baselines {
  current?: Baseline
  previous?: Baseline
  base?: Baseline
  own?: Baseline
}

export type Resource<T> = { status: 'loading' } | { status: 'ok'; value: T } | { status: 'missing' } | { status: 'error'; message: string }

/** 源码同步对派生的一面：清单、代码事实、历史（null = 没有），刷新与按需取文件、导出、提交说明 */
export interface SourceSyncPort {
  /** null = 正在取清单 */
  tree: ShallowRef<SourcePayload | null>
  facts: ShallowRef<Resource<FactsPayload> | null>
  history: ShallowRef<Resource<SourceHistory> | null>
  refresh(): Promise<void>
  file(path: string): ShallowRef<Resource<SourceFile>>
  exports(path: string): ShallowRef<Resource<ExportedSymbol[]>>
  commit(hash: string): ShallowRef<Resource<{ hash: string; message: string }>>
}
