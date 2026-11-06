/**
 * 对话会话的值与转移（DA-1、DA-2、DA-11，DL-12；设计 dialogue-layers 的「会话的值与转移」）：一个值 DialogueState——转录（每条带当时的锚点）、
 * 锚点、视角、运行状态、排队的输入、草稿、模式与状态锁；只经纯转移函数 dialogueTransition 改变（换锚点时问「锚点」是否真的变了）。
 * 不发请求、不订阅推送、不派生显示数据。
 */
import { type DiagramCheck, type AgentBlock, type Anchor, type DialogueMode } from '@/model'
import type { ProposalOutcome } from '../edit/changes'
import { sameAnchor } from './anchor'

export interface ImageAttachment {
  name: string
  type: string
  /** data: URL（只在内存；发送时交给开发服务器落到临时目录） */
  dataUrl: string
}

export interface DialogueInput {
  text: string
  mode: DialogueMode
  images: ImageAttachment[]
}

/** 重讲的结果（DL-8）：落了（题解与讲法要求已写、依据已盖）或被拒（原因） */
export type RenarrateOutcome = { applied: true; path: string; notes: string[] } | { applied: false; reasons: string[] }

/** 一轮的结果：重讲（DL-8）或草图里的提议（DA-8） */
export type TurnOutcome = RenarrateOutcome | ProposalOutcome
export type { ProposalOutcome }

export type DialogueEntry =
  | { id: string; role: 'user'; anchor: Anchor; input: DialogueInput }
  | {
      id: string
      role: 'agent'
      anchor: Anchor
      turn: string
      text: string
      blocks: AgentBlock[]
      outcome?: TurnOutcome
      /** DL-41：机制图块到达那一刻的检查结果（按块的下标）；之后草图再改不重判 */
      diagrams?: Record<number, DiagramCheck>
    }
  | { id: string; role: 'error'; anchor: Anchor; turn: string; message: string }
  | { id: string; role: 'stopped'; anchor: Anchor; turn: string; reason: 'stopped' | 'timeout' }

export type DialogueRun = { status: 'idle' } | { status: 'running'; turn: string; live: string; mode: DialogueMode }

export type CanvasPerspective = 'structure' | 'interaction' | 'run' | 'sketch'

export interface DialogueState {
  transcript: DialogueEntry[]
  anchor: Anchor
  perspective: CanvasPerspective
  run: DialogueRun
  queue: DialogueInput[]
  draft: string
  mode: DialogueMode
  /** 编号来源（转录条目与轮次的 ID） */
  seq: number
  /** 对话会话的编号（一个页面一个，协调者创建时给）：轮次 = 会话-序号，多个页面的推送不串 */
  session: string
  /** DL-34：设计已认可 / 已实现 / 已放弃时草图里不能「改」，只能问（原因一句，对话标签显示） */
  lock?: string
}

/** 推送来的 agent 事件（接入层 agentProcess 的 DialogueEvent） */
export type AgentPush =
  | { turn: string; type: 'text'; text: string }
  | { turn: string; type: 'done'; blocks: AgentBlock[]; outcome?: TurnOutcome; diagrams?: Record<number, DiagramCheck> }
  | { turn: string; type: 'error'; message: string }
  | { turn: string; type: 'stopped'; reason: 'stopped' | 'timeout' }

export type DialogueAction =
  | { type: 'send'; input: DialogueInput }
  | { type: 'stop' }
  | { type: 'setAnchor'; anchor: Anchor }
  | { type: 'setPerspective'; perspective: CanvasPerspective; anchor: Anchor }
  | { type: 'setDraft'; text: string }
  | { type: 'setMode'; mode: DialogueMode }
  | { type: 'setLock'; lock: string | null }
  | { type: 'event'; event: AgentPush }

export const EMPTY_DIALOGUE: DialogueState = {
  transcript: [],
  anchor: { kind: 'none' },
  perspective: 'structure',
  run: { status: 'idle' },
  queue: [],
  draft: '',
  mode: 'ask',
  seq: 0,
  session: 's',
}

/** DL-12：重讲只对模块（它改的是这个模块的题解）；锚点不是模块时请求按「问」发 */
export const modeFor = (anchor: Anchor, mode: DialogueMode): DialogueMode => (mode === 'renarrate' && anchor.kind !== 'module' ? 'ask' : mode)

const empty = (i: DialogueInput) => !i.text.trim() && !i.images.length

/** 开一轮：记下用户条目（带此刻的锚点），进入运行 */
function begin(s: DialogueState, input: DialogueInput): DialogueState {
  // DL-34：锁定时「改」按「问」发
  const mode = modeFor(s.anchor, s.lock && input.mode === 'edit' ? 'ask' : input.mode)
  const seq = s.seq + 1
  const turn = `${s.session}-t${seq}`
  return {
    ...s,
    seq,
    transcript: [...s.transcript, { id: `u${seq}`, role: 'user', anchor: s.anchor, input: { ...input, mode } }],
    run: { status: 'running', turn, live: '', mode },
  }
}

/** 一轮结束（说完、出错）后：排队的下一条接着发 */
const next = (s: DialogueState): DialogueState => {
  const idle: DialogueState = { ...s, run: { status: 'idle' } }
  if (!s.queue.length) return idle
  const [head, ...rest] = s.queue
  return begin({ ...idle, queue: rest }, head)
}

/** 停止 / 超时：这一轮什么都不落（DA-11）；排队的输入退回草稿，不自动接着发（停下来的人要先看一眼） */
function halt(s: DialogueState, turn: string, reason: 'stopped' | 'timeout'): DialogueState {
  const back = s.queue.map(q => q.text.trim()).filter(Boolean)
  return {
    ...s,
    seq: s.seq + 1,
    run: { status: 'idle' },
    queue: [],
    draft: [s.draft.trim(), ...back].filter(Boolean).join('\n'),
    transcript: [...s.transcript, { id: `x${s.seq + 1}`, role: 'stopped', anchor: s.anchor, turn, reason }],
  }
}

export function dialogueTransition(s: DialogueState, a: DialogueAction): DialogueState {
  switch (a.type) {
    case 'send': {
      if (empty(a.input)) return s
      // DL-12 排队：AI 回合中再发的进队列，这一轮说完按序接着发
      const sent = { ...s, draft: '' }
      return s.run.status === 'running' ? { ...sent, queue: [...s.queue, a.input] } : begin(sent, a.input)
    }
    case 'stop':
      return s.run.status === 'running' ? halt(s, s.run.turn, 'stopped') : s
    case 'setAnchor':
      // DA-2：换锚点不动转录（历史消息各自记着当时的锚点）
      return sameAnchor(s.anchor, a.anchor) ? s : { ...s, anchor: a.anchor }
    case 'setPerspective': {
      // DL-12：换视角只换锚点（运行视角下锚点随选中的步骤），转录、运行中的一轮与队列都不动
      if (s.perspective === a.perspective && sameAnchor(s.anchor, a.anchor)) return s
      // DL-19：进入草图画布缺省「改」，离开时「改」回到「问」（改只在草图里，重讲只在当前版本上）
      const mode = a.perspective === 'sketch' ? (s.perspective !== 'sketch' ? (s.lock ? 'ask' : 'edit') : s.mode) : s.mode === 'edit' ? 'ask' : s.mode
      return { ...s, perspective: a.perspective, anchor: a.anchor, mode }
    }
    case 'setDraft':
      return s.draft === a.text ? s : { ...s, draft: a.text }
    case 'setMode': {
      // DL-19：草图里只有「改 / 问」，当前版本上只有「问 / 重讲」
      const allowed = s.perspective === 'sketch' ? a.mode !== 'renarrate' && !(s.lock && a.mode === 'edit') : a.mode !== 'edit'
      return s.mode === a.mode || !allowed ? s : { ...s, mode: a.mode }
    }
    case 'setLock': {
      // DL-34：锁上时「改」退回「问」；解锁（回到起草）后在草图里回到缺省的「改」（DL-19）
      const lock = a.lock ?? undefined
      if (lock === s.lock) return s
      const mode = lock ? (s.mode === 'edit' ? 'ask' : s.mode) : s.perspective === 'sketch' ? 'edit' : s.mode
      const { lock: _old, ...rest } = s
      return lock ? { ...rest, lock, mode } : { ...rest, mode }
    }
    case 'event': {
      const e = a.event
      // 停止之后迟到的事件、别的轮次的事件一律不认
      if (s.run.status !== 'running' || s.run.turn !== e.turn) return s
      const run = s.run
      if (e.type === 'text') return { ...s, run: { ...run, live: run.live + e.text } }
      if (e.type === 'stopped') return halt(s, e.turn, e.reason)
      const seq = s.seq + 1
      const entry: DialogueEntry =
        e.type === 'done'
          ? {
              id: `a${seq}`,
              role: 'agent',
              anchor: lastAnchor(s),
              turn: e.turn,
              text: run.live,
              blocks: e.blocks,
              ...(e.outcome ? { outcome: e.outcome } : {}),
              ...(e.diagrams && Object.keys(e.diagrams).length ? { diagrams: e.diagrams } : {}),
            }
          : { id: `e${seq}`, role: 'error', anchor: lastAnchor(s), turn: e.turn, message: e.message }
      return next({ ...s, seq, transcript: [...s.transcript, entry] })
    }
  }
}

/** 回答挂在提问那一刻的锚点上（提问之后换了选中，回答仍属原锚点） */
const lastAnchor = (s: DialogueState): Anchor => [...s.transcript].reverse().find(e => e.role === 'user')?.anchor ?? s.anchor
