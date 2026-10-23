/**
 * 设计版本的元信息（ADR-0002）。设计版本放在 `model/<项目>/designs/<设计 ID>/`：
 * `design.yaml` 是本文件描述的元信息，`r1/`、`r2/`… 是每轮的完整描述快照。
 * 由接入层在 Node 侧读取，页面只展示。
 */

/** 设计整体状态：起草 → 评审中 → 已定稿 → 已实现；或放弃 */
export type DesignStatus = 'draft' | 'reviewing' | 'accepted' | 'implemented' | 'abandoned'

export const DESIGN_STATUSES: readonly DesignStatus[] = ['draft', 'reviewing', 'accepted', 'implemented', 'abandoned']

/** 已结束迭代的设计归档（DV-6）：项目列表不再列出，仍可从版本切换打开 */
export const isArchived = (status: DesignStatus): boolean => status === 'implemented' || status === 'abandoned'

/** DV-10：草图作为版本打开时的轮次 ID（路由 /p/<项目>/d/<设计>/sketch） */
export const SKETCH_REVISION = 'sketch'
export const isSketchRevision = (v: VersionRef | undefined): v is DesignVersionRef => isDesignVersion(v) && v.revision === SKETCH_REVISION

/** E8：每轮的说明文件（AI 拥有）：designs/<设计>/r<N>/revision.yaml，顶层键 revision */
export const REVISION_FILE = 'revision.yaml'
/** E8：轮次目录名 r<N> */
export const revisionNumber = (id: string): number | null => (/^r(\d+)$/.test(id) ? Number(id.slice(1)) : null)

export interface RevisionInfo {
  /** 轮次 ID，同时是快照目录名，如 r1 */
  id: string
  date?: string
  /** 本轮做了什么（Markdown） */
  summary?: string
  /** 待评审确认的问题 */
  questions?: string[]
  /** 架构师对本轮的评审意见（下一轮据此修改，Markdown） */
  feedback?: string
}

export interface DesignInfo {
  /** 设计 ID，即目录名 */
  id: string
  name: string
  status: DesignStatus
  /** 设计目标与范围（Markdown） */
  goal?: string
  /** 起草时所基于的当前版本 */
  base?: { commit?: string; generatedAt?: string }
  /** DV-9：定稿后记录结论的 ADR，相对源码根目录的路径（可多个） */
  adr?: string[]
  /** 按先后排列，最后一轮为最新 */
  revisions: RevisionInfo[]
  /** DV-5、DV-10：有草图（designs/<设计>/sketches/*.yaml） */
  sketch?: boolean
  /** X9：设计的各张草图（挂载点、相对项目描述目录的路径；needsLayout：没有 layout），设计面板列出 */
  sketches?: { mount: string; file: string; needsLayout?: boolean }[]
  /** X4：认可的偏差（design.yaml 的 accepted） */
  accepted?: { deviation: string; reason: string; at?: string }[]
  /** X4：项目摘要里的偏差计数（未认可的 error 与 warning；草图对最新一轮核验，已定稿的对当前版本） */
  deviations?: { errors: number; warnings: number }
  /** design.yaml 的格式问题、缺失的快照目录等 */
  problems: string[]
}

/** 设计版本的某一轮 */
export interface DesignVersionRef {
  design: string
  revision: string
}

/** 提交版本（E5、E6）：描述在某个 git 提交时的快照；base 为对比基线的提交，`worktree` 为当前版本，缺省为历史中更早的一个提交 */
export interface CommitVersionRef {
  commit: string
  base?: string
}

/** 持久草图版本（ADR-0024）：/p/<项目>/i/<草图 ID>，内容 = system.yaml + intent/**，可编辑 */
export interface IntentVersionRef {
  intent: string
}

/** 打开的是哪个版本：缺省为当前版本 */
export type VersionRef = DesignVersionRef | CommitVersionRef | IntentVersionRef

export const isCommitVersion = (v: VersionRef | undefined): v is CommitVersionRef => !!v && 'commit' in v
export const isDesignVersion = (v: VersionRef | undefined): v is DesignVersionRef => !!v && 'design' in v
export const isIntentVersion = (v: VersionRef | undefined): v is IntentVersionRef => !!v && 'intent' in v
/** X7a：可进入编辑态的版本——设计的草图与持久草图 */
export const isSketchVersion = (v: VersionRef | undefined): boolean => isSketchRevision(v) || isIntentVersion(v)

/** E6：对比基线为当前版本（工作区）时 base 的取值 */
export const WORKTREE = 'worktree'

/** 改动过项目描述的一个 git 提交（E5） */
export interface ModelCommit {
  /** 完整哈希 */
  hash: string
  short: string
  /** 提交日期（YYYY-MM-DD） */
  date: string
  subject: string
}

export const versionLabel = (d: Pick<DesignInfo, 'name'>, rev: string) => `${d.name} · ${rev}`
