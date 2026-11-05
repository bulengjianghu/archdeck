/**
 * 对话会话（DA-1–DA-5，DL-5、DL-12；03「对话会话」）：一个值 DialogueState——转录（每条带当时的锚点）、锚点、运行状态、排队的输入、草稿与模式；
 * 只经纯转移函数 dialogueTransition 改变。协调者（createDialogue）只做三件事：把选中 / 视角翻译成换锚点、把状态变化翻译成请求（发一轮、停止）、
 * 把推送来的 agent 事件翻译成转移。当前版本上的会话不保存（只在内存）；设计里的随设计保存（接入层按请求带的设计落盘，波 2 起有设计里的对话）。
 */
import { shallowRef, watch, type Ref, type ShallowRef } from 'vue'
import { digestView, resolveCitation, type AgentBlock, type Anchor, type Citation, type DialogueMode, type DigestBlock, type ModelIndex } from '@/model'

import type { Selected } from '../transition'

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

export type DialogueEntry =
  | { id: string; role: 'user'; anchor: Anchor; input: DialogueInput }
  | { id: string; role: 'agent'; anchor: Anchor; turn: string; text: string; blocks: AgentBlock[]; outcome?: RenarrateOutcome }
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
}

/** 推送来的 agent 事件（接入层 agentProcess 的 DialogueEvent） */
export type AgentPush =
  | { turn: string; type: 'text'; text: string }
  | { turn: string; type: 'done'; blocks: AgentBlock[]; outcome?: RenarrateOutcome }
  | { turn: string; type: 'error'; message: string }
  | { turn: string; type: 'stopped'; reason: 'stopped' | 'timeout' }

export type DialogueAction =
  | { type: 'send'; input: DialogueInput }
  | { type: 'stop' }
  | { type: 'setAnchor'; anchor: Anchor }
  | { type: 'setPerspective'; perspective: CanvasPerspective; anchor: Anchor }
  | { type: 'setDraft'; text: string }
  | { type: 'setMode'; mode: DialogueMode }
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
  const mode = modeFor(s.anchor, input.mode)
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
    case 'setPerspective':
      // DL-12：换视角只换锚点（运行视角下锚点随选中的步骤），转录、运行中的一轮与队列都不动
      return s.perspective === a.perspective && sameAnchor(s.anchor, a.anchor) ? s : { ...s, perspective: a.perspective, anchor: a.anchor }
    case 'setDraft':
      return s.draft === a.text ? s : { ...s, draft: a.text }
    case 'setMode':
      return s.mode === a.mode ? s : { ...s, mode: a.mode }
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
            }
          : { id: `e${seq}`, role: 'error', anchor: lastAnchor(s), turn: e.turn, message: e.message }
      return next({ ...s, seq, transcript: [...s.transcript, entry] })
    }
  }
}

/** 回答挂在提问那一刻的锚点上（提问之后换了选中，回答仍属原锚点） */
const lastAnchor = (s: DialogueState): Anchor => [...s.transcript].reverse().find(e => e.role === 'user')?.anchor ?? s.anchor

export function sameAnchor(a: Anchor, b: Anchor): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'module') return a.module === (b as typeof a).module
  if (a.kind === 'step') return a.frame === (b as typeof a).frame && a.scenario === (b as typeof a).scenario
  return true
}

/** DA-2：选中 → 锚点。模块 → 模块；步骤 → 步骤（带两端，供锚点条与上下文包）；其余（无选中、关系、文件…）→ 无 */
export function anchorOf(sel: Selected | null, step: { scenario: string; frame: { id: string; from: string; to: string; label?: string } } | null): Anchor {
  if (sel?.kind === 'module') return { kind: 'module', module: sel.id }
  if (sel?.kind === 'step' && step && step.frame.id === sel.id)
    return {
      kind: 'step',
      scenario: step.scenario,
      frame: sel.id,
      from: step.frame.from,
      to: step.frame.to,
      ...(step.frame.label ? { label: step.frame.label } : {}),
    }
  return { kind: 'none' }
}

/** 锚点条的文字 */
export function anchorText(index: ModelIndex | null, a: Anchor): string {
  const name = (id: string) => index?.modules.get(id)?.name ?? index?.actors.get(id)?.name ?? (id === index?.rootId ? index.model.system.name : id)
  if (a.kind === 'module') return name(a.module)
  if (a.kind === 'step') return `${name(a.from)} → ${name(a.to)}${a.label ? ` · ${a.label}` : ''}`
  return '没有选中（问整个系统）'
}

// ── 协调：选中 / 视角 → 换锚点；状态变化 → 请求；推送 → 转移 ──

/** 对话的传输端口（同步适配器 state/sync/agent.ts 实现；测试注入假的） */
export interface AgentTransport {
  turn(project: string, request: AgentTurnRequest): Promise<{ ok: true } | { ok: false; error: string }>
  stop(project: string, turn: string): Promise<void>
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
}

export const NO_AGENT: AgentTransport = {
  turn: async () => ({ ok: false, error: '没有注入 agent 通道（只看描述的测试）' }),
  stop: async () => {},
  subscribe: () => () => {},
}

/** DL-13：问答卡的引用——原文由架构台从描述填，解析不了的标「引用无效」 */
export type CiteView = { ok: true; cite: Citation; module: string; name: string; text: string } | { ok: false; cite: Citation; reason: string }
export function citeViews(index: ModelIndex | null, list: readonly Citation[] | undefined): CiteView[] {
  return (list ?? []).map(c => {
    const r = index ? resolveCitation(index, c) : ({ ok: false, reason: '描述未加载' } as const)
    return r.ok ? { ok: true, cite: c, module: r.module, name: r.name, text: r.text } : { ok: false, cite: c, reason: r.reason }
  })
}

/** DL-15：梳理卡的渲染数据 */
export const digestOf = (index: ModelIndex | null, block: AgentBlock) => (block.kind === 'digest' && index ? digestView(index, block as DigestBlock) : null)

export interface DialogueInputs {
  project: string | undefined
  index: Readonly<Ref<ModelIndex | null>>
  selection: Readonly<Ref<Selected | null>>
  /** 运行视角下选中的步骤所在的场景与帧（锚点要两端） */
  step: Readonly<Ref<{ scenario: string; frame: { id: string; from: string; to: string; label?: string } } | null>>
  perspective: Readonly<Ref<CanvasPerspective>>
  transport: AgentTransport
  design?: string
  /** 打开（固定）对话标签（DL-4、DL-5） */
  openTab: () => void
}

export function createDialogue({ project, index, selection, step, perspective, transport, design, openTab }: DialogueInputs) {
  const session = Math.random().toString(36).slice(2, 10)
  const state: ShallowRef<DialogueState> = shallowRef({
    ...EMPTY_DIALOGUE,
    session,
    perspective: perspective.value,
    anchor: anchorOf(selection.value, step.value),
  })
  const dispatch = (a: DialogueAction) => {
    const before = state.value
    const after = dialogueTransition(before, a)
    state.value = after
    // 状态变化 → 请求：进入一个新的运行轮次就发；停止就通知子进程
    if (after.run.status === 'running' && (before.run.status !== 'running' || before.run.turn !== after.run.turn)) {
      const turn = after.run.turn
      const user = [...after.transcript].reverse().find(e => e.role === 'user')
      if (user?.role === 'user' && project)
        void transport
          .turn(project, {
            session,
            turn,
            mode: user.input.mode,
            anchor: user.anchor,
            text: user.input.text,
            images: user.input.images,
            ...(design ? { design } : {}),
          })
          .then(r => {
            if (!r.ok) dispatch({ type: 'event', event: { turn, type: 'error', message: r.error } })
          })
    }
    if (a.type === 'stop' && before.run.status === 'running' && project) void transport.stop(project, before.run.turn)
  }
  watch([selection, step], () => dispatch({ type: 'setAnchor', anchor: anchorOf(selection.value, step.value) }))
  watch(perspective, p => dispatch({ type: 'setPerspective', perspective: p, anchor: anchorOf(selection.value, step.value) }))
  const unsubscribe = project ? transport.subscribe(project, event => dispatch({ type: 'event', event })) : () => {}
  return {
    state,
    dispatch,
    /** 「讨论 ›」：打开并固定对话标签；给了模块且与选中不同时锚点改到它 */
    open(module?: string) {
      if (module) dispatch({ type: 'setAnchor', anchor: { kind: 'module', module } })
      openTab()
    },
    send: (input: DialogueInput) => dispatch({ type: 'send', input }),
    /** 派生给呈现层：引用原文、梳理卡、锚点文字（呈现层不直接调模型层的计算） */
    citeViews: (list: readonly Citation[] | undefined) => citeViews(index.value, list),
    digest: (block: AgentBlock) => digestOf(index.value, block),
    anchorText: (a: Anchor) => anchorText(index.value, a),
    stop: () => dispatch({ type: 'stop' }),
    dispose: unsubscribe,
  }
}

export type Dialogue = ReturnType<typeof createDialogue>
