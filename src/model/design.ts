/**
 * 设计版本的元信息（ADR-0002）。设计版本放在 `model/<项目>/designs/<设计 ID>/`：
 * `design.yaml` 是本文件描述的元信息，`r1/`、`r2/`… 是每轮的完整描述快照。
 * 由接入层在 Node 侧读取，页面只展示。
 */

/** 设计整体状态：起草 → 评审中 → 已定稿 → 已实现；或放弃 */
export type DesignStatus = 'draft' | 'reviewing' | 'accepted' | 'implemented' | 'abandoned'

export const DESIGN_STATUS_LABELS: Record<DesignStatus, string> = {
  draft: '起草中',
  reviewing: '评审中',
  accepted: '已定稿',
  implemented: '已实现',
  abandoned: '已放弃',
}

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
  /** 按先后排列，最后一轮为最新 */
  revisions: RevisionInfo[]
  /** design.yaml 的格式问题、缺失的快照目录等 */
  problems: string[]
}

/** 打开的是哪个版本：缺省为当前版本 */
export interface VersionRef {
  design: string
  revision: string
}

export const versionLabel = (d: Pick<DesignInfo, 'name'>, rev: string) => `${d.name} · ${rev}`
