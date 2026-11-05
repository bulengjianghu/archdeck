/**
 * 对话会话（DA-1–DA-5，DL-5、DL-12；03「对话会话」）：一个值 DialogueState——转录（每条带当时的锚点）、锚点、运行状态、排队的输入、草稿与模式；
 * 只经纯转移函数 dialogueTransition 改变。协调者（createDialogue）只做三件事：把选中 / 视角翻译成换锚点、把状态变化翻译成请求（发一轮、停止）、
 * 把推送来的 agent 事件翻译成转移。当前版本上的会话不保存（只在内存）；设计里的随设计保存（接入层按请求带的设计落盘，波 2 起有设计里的对话）。
 */
import { shallowRef, watch, type Ref, type ShallowRef } from 'vue'
import {
  checkDiagram,
  describedModule,
  diagramDescribedRefs,
  diagramAspect,
  diagramFence,
  diagramModules,
  diagramSvgReasons,
  digestView,
  resolveCitation,
  splitNoteDiagrams,
  type DiagramCheck,
  type ExplainerRef,
  type AgentBlock,
  type Anchor,
  type Citation,
  type DialogueMode,
  type DigestBlock,
  type ModelIndex,
  type SketchContext,
} from '@/model'
import type { ProposalOutcome } from './edit/changes'

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

export function sameAnchor(a: Anchor, b: Anchor): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'module') return a.module === (b as typeof a).module && a.sheet === (b as typeof a).sheet
  if (a.kind === 'step') return a.frame === (b as typeof a).frame && a.scenario === (b as typeof a).scenario
  return true
}

/**
 * DA-2：选中 → 锚点。模块 → 模块；步骤 → 步骤（带两端，供锚点条与上下文包）；其余（无选中、关系、文件…）→ 无。
 * 草图里（sheet 给出当前张）总有锚点：选中的框，没有选中时是当前张的挂载点（DL-19：「没有选中对象不能发起修改」在草图里由当前张兜底）。
 */
export function anchorOf(
  sel: Selected | null,
  step: { scenario: string; frame: { id: string; from: string; to: string; label?: string } } | null,
  sheet?: string | null,
): Anchor {
  if (sheet) return { kind: 'module', module: sel?.kind === 'module' ? sel.id : sheet, sheet }
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

/** 锚点条的文字（草图里：「当前张 <挂载点名>」，选中了框再加「 · <框名>」） */
export function anchorText(index: ModelIndex | null, a: Anchor, nameOf?: (id: string) => string | undefined): string {
  const name = (id: string) =>
    nameOf?.(id) ??
    index?.modules.get(id)?.name ??
    index?.actors.get(id)?.name ??
    (id === index?.rootId || id === 'root' ? (index?.model.system.name ?? id) : id)
  if (a.kind === 'module' && a.sheet) return `当前张 ${name(a.sheet)}${a.module !== a.sheet ? ` · ${name(a.module)}` : ''}`
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

/** DL-13：问答卡的引用——原文由架构台从描述填，解析不了的标「引用无效」 */
export type CiteView = { ok: true; cite: Citation; module: string; name: string; text: string } | { ok: false; cite: Citation; reason: string }
export function citeViews(index: ModelIndex | null, list: readonly Citation[] | undefined): CiteView[] {
  return (list ?? []).map(c => {
    const r = index ? resolveCitation(index, c) : ({ ok: false, reason: '描述未加载' } as const)
    return r.ok ? { ok: true, cite: c, module: r.module, name: r.name, text: r.text } : { ok: false, cite: c, reason: r.reason }
  })
}

/**
 * DL-41：一轮说完时检查其中的机制图块（只拒那一块，文字照常）；known 当前版本上是描述（含系统根），草图里是当前张。
 * 没有图块时为空对象。
 */
export function checkDiagrams(blocks: readonly AgentBlock[], known: (id: string) => boolean): Record<number, DiagramCheck> {
  const out: Record<number, DiagramCheck> = {}
  blocks.forEach((b, k) => {
    if (b.kind === 'diagram') out[k] = checkDiagram(b, known)
  })
  return out
}

/** DL-42：一张图的显示数据（aspect = 高 / 宽）——通过检查的给 SVG、说明与要填入的引用；被拒的给原因 */
export type DiagramView =
  { ok: true; svg: string; caption: string; refs: Record<string, ExplainerRef>; aspect: number } | { ok: false; caption: string; reasons: string[] }

/** DL-43：设计说明正文的一段——文字，或一张图（只过形状、安全与尺寸检查） */
export type NoteSegmentView = { kind: 'text'; text: string } | ({ kind: 'diagram' } & DiagramView)

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
  /** 草图里的一面（没有时只在当前版本上对话） */
  sketch?: DialogueSketchPort
}

export function createDialogue({ project, index, selection, step, perspective, transport, design, openTab, sketch }: DialogueInputs) {
  const session = Math.random().toString(36).slice(2, 10)
  /**
   * DL-42：图里引用的模块要填入的原文——描述里有的按图解同一口径（EX-2）；草图里才有的框只给名称；
   * 不附「图解 ›」（SVG 里插不进链接）；哪里都没有的不列（显示时删除线）
   */
  const diagramRefs = (svg: string): Record<string, ExplainerRef> => {
    const idx = index.value
    const out: Record<string, ExplainerRef> = {}
    const fromIndex = idx ? diagramDescribedRefs(idx, svg) : {}
    const inSketch = !!sketch?.active()
    for (const id of diagramModules(svg)) {
      const known = inSketch ? !!sketch?.sheetHas?.(id) : id in fromIndex
      if (!known) continue
      const hit = fromIndex[id]
      if (hit) out[id] = hit
      else out[id] = { name: sketch?.nameOf(id) ?? id, summary: null, invariants: [], explainer: false }
    }
    return out
  }
  const sheet = () => (sketch?.active() ? (sketch.mount() ?? null) : null)
  const anchorNow = () => anchorOf(selection.value, step.value, sheet())
  const state: ShallowRef<DialogueState> = shallowRef({
    ...EMPTY_DIALOGUE,
    session,
    perspective: perspective.value,
    mode: perspective.value === 'sketch' ? ('edit' as const) : ('ask' as const),
    anchor: anchorNow(),
  })
  const dispatch = (a0: DialogueAction) => {
    const before = state.value
    // DA-6、DL-1：草图里「改」的一轮说完时，先把改动块应用到编辑会话（一轮一步），结果写进提议卡
    let a = a0
    // DL-41：回答到达那一刻检查机制图块（当前版本上查描述，草图里查当前张），结果随条目留下
    if (a.type === 'event' && a.event.type === 'done' && before.run.status === 'running' && before.run.turn === a.event.turn) {
      const idx = index.value
      const known = sketch?.active() ? (sketch.sheetHas ?? (() => false)) : idx ? describedModule(idx) : () => false
      const diagrams = checkDiagrams(a.event.blocks, known)
      if (Object.keys(diagrams).length) a = { ...a, event: { ...a.event, diagrams } }
    }
    if (
      a.type === 'event' &&
      a.event.type === 'done' &&
      before.run.status === 'running' &&
      before.run.turn === a.event.turn &&
      before.run.mode === 'edit' &&
      sketch
    ) {
      const outcome = sketch.apply(a.event.blocks, a.event.turn)
      if (outcome) a = { ...a, event: { ...a.event, outcome } }
    }
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
            ...((sketch?.active() ? sketch.design() : design) ? { design: sketch?.active() ? sketch.design() : design } : {}),
            ...(sketch?.active() && sketch.context() ? { sketch: sketch.context()! } : {}),
          })
          .then(r => {
            if (!r.ok) dispatch({ type: 'event', event: { turn, type: 'error', message: r.error } })
          })
    }
    if (a.type === 'stop' && before.run.status === 'running' && project) void transport.stop(project, before.run.turn)
  }
  watch([selection, step, () => sheet()], () => dispatch({ type: 'setAnchor', anchor: anchorNow() }))
  watch(perspective, p => dispatch({ type: 'setPerspective', perspective: p, anchor: anchorNow() }))
  watch(
    () => (sketch?.active() ? (sketch.lock?.() ?? null) : null),
    lock => dispatch({ type: 'setLock', lock }),
    { immediate: true },
  )
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
    /** DL-42：回答里第 k 块机制图的显示数据（检查结果取到达那一刻的） */
    diagram(entry: DialogueEntry, k: number): DiagramView | null {
      if (entry.role !== 'agent') return null
      const b = entry.blocks[k]
      if (b?.kind !== 'diagram') return null
      const c = entry.diagrams?.[k] ?? { ok: false, reasons: ['没有检查结果'] }
      return c.ok
        ? { ok: true, svg: b.svg, caption: b.caption, refs: diagramRefs(b.svg), aspect: diagramAspect(b.svg) ?? 0.5 }
        : { ok: false, caption: b.caption, reasons: c.reasons }
    },
    /** DL-43：存为设计说明时接在正文后的图——这条回答里通过检查的图块，按次序写成围栏块 */
    diagramFences: (entry: DialogueEntry): string[] =>
      entry.role === 'agent' ? entry.blocks.flatMap((b, k) => (b.kind === 'diagram' && entry.diagrams?.[k]?.ok ? [diagramFence(b)] : [])) : [],
    /** DL-43：设计说明正文切成文字段与图段；图段过形状、安全与尺寸检查（不查模块是否存在） */
    noteSegments: (text: string): NoteSegmentView[] =>
      splitNoteDiagrams(text).map(seg => {
        if (seg.kind === 'text') return seg
        const reasons = diagramSvgReasons(seg.svg)
        return reasons.length
          ? { kind: 'diagram', ok: false, caption: seg.caption, reasons }
          : { kind: 'diagram', ok: true, svg: seg.svg, caption: seg.caption, refs: diagramRefs(seg.svg), aspect: diagramAspect(seg.svg) ?? 0.5 }
      }),
    anchorText: (a: Anchor) => anchorText(index.value, a, sketch?.active() ? sketch.nameOf : undefined),
    /** DA-6：AI 正在修改草图（画布只读） */
    editing: () => state.value.run.status === 'running' && state.value.run.mode === 'edit',
    /**
     * DA-7：「按这张图起草」——把梳理卡（与它那一问贴的照片）作为「改」的一轮发出去；只在草图里。
     */
    draftFromDigest(entryId: string) {
      const s = state.value
      const at = s.transcript.findIndex(e => e.id === entryId)
      const ask = [...s.transcript.slice(0, at)].reverse().find(e => e.role === 'user')
      const entry = s.transcript[at]
      if (!sketch?.active() || entry?.role !== 'agent' || state.value.lock) return
      const digest = entry.blocks.find(b => b.kind === 'digest')
      if (!digest) return
      dispatch({
        type: 'send',
        input: {
          text: `按这张图起草：把梳理卡里对上的框与关系画进当前张（梳理卡：${JSON.stringify(digest)}）`,
          mode: 'edit',
          images: ask?.role === 'user' ? ask.input.images : [],
        },
      })
    },
    stop: () => dispatch({ type: 'stop' }),
    dispose: unsubscribe,
  }
}

export type Dialogue = ReturnType<typeof createDialogue>
