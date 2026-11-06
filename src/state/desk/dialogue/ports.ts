/**
 * 对外端口（DA-6、DA-11；设计 dialogue-layers 的「对外端口」）：对话与外界的边界——agent 传输端口与一轮请求、草图那一面，以及没注入时的空实现。
 * 不含任何实现（传输由 agent 通道同步 state/sync/agent.ts 实现，草图那一面由编辑分组给）。
 */
import { type AgentBlock, type Anchor, type DialogueMode, type SketchContext } from '@/model'
import type { ProposalOutcome } from '../edit/changes'
import type { AgentPush, ImageAttachment } from './state'

/** 对话的传输端口（同步适配器 state/sync/agent.ts 实现；测试注入假的） */
export interface AgentTransport {
  turn(project: string, request: AgentTurnRequest): Promise<{ ok: true } | { ok: false; error: string }>
  stop(project: string, turn: string): Promise<void>
  /** DL-51（收尾 S3）：设计里「改」一轮的提议卡结果随转录落盘（页面应用改动块之后才有）；没有实现时不落 */
  outcome?(project: string, record: { design: string; turn: string; outcome: ProposalOutcome }): Promise<void>
  /** 订阅本项目的推送；返回取消订阅 */
  subscribe(project: string, cb: (e: AgentPush) => void): () => void
}

export interface AgentTurnRequest {
  session: string
  turn: string
  mode: DialogueMode
  anchor: Anchor
  text: string
  images: ImageAttachment[]
  /** 设计里的对话随设计落盘；当前版本上不带（不落盘，DA-1） */
  design?: string
  /** 草图里：草图上下文（DL-14，波 2） */
  sketch?: SketchContext
}

/**
 * DA-6：对话在草图里的一面（编辑分组给）——在不在草图里、设计、当前张、草图上下文、把一轮的改动块应用到编辑会话（提议卡的结果）、名称。
 */
export interface DialogueSketchPort {
  active: () => boolean
  design: () => string | undefined
  mount: () => string | null
  context: () => SketchContext | null
  apply: (blocks: readonly AgentBlock[], turn: string) => ProposalOutcome | undefined
  nameOf: (id: string) => string | undefined
  /** DL-34：设计的状态锁（已认可 / 已实现 / 已放弃时的原因），没有时可改 */
  lock?: () => string | null
  /** DL-41：当前张上有没有这个模块（挂载点与它画着的框）——草图里机制图的 data-arch 按它查 */
  sheetHas?: (id: string) => boolean
}

export const NO_AGENT: AgentTransport = {
  turn: async () => ({ ok: false, error: '没有注入 agent 通道（只看描述的测试）' }),
  stop: async () => {},
  subscribe: () => () => {},
}
