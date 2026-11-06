/**
 * 对话会话（DA-1–DA-5，DL-5、DL-12；03「对话会话」）：一个值 DialogueState——转录（每条带当时的锚点）、锚点、运行状态、排队的输入、草稿与模式；
 * 只经纯转移函数 dialogueTransition 改变（state.ts）。协调者（createDialogue）只做三件事：把选中 / 视角翻译成换锚点、把状态变化翻译成请求（发一轮、停止）、
 * 把推送来的 agent 事件翻译成转移。当前版本上的会话不保存（只在内存）；设计里的随设计保存（接入层按请求带的设计落盘，波 2 起有设计里的对话）。
 *
 * 这一层的子结构（设计 dialogue-layers）：state（会话的值与转移）· anchor（锚点）· ports（对外端口）· views（卡片派生）；
 * 本文件是协调者 createDialogue，并把子模块的出口一并导出（引用方仍从 state/desk/dialogue 取）。
 */
import { shallowRef, watch, type Ref, type ShallowRef } from 'vue'
import {
  describedModule,
  diagramDescribedRefs,
  diagramAspect,
  diagramFence,
  diagramModules,
  diagramSvgReasons,
  splitNoteDiagrams,
  type ExplainerRef,
  type AgentBlock,
  type Anchor,
  type Citation,
  type ModelIndex,
} from '@/model'
import type { Selected } from '../../transition'
import { anchorOf, anchorText } from './anchor'
import type { AgentTransport, DialogueSketchPort } from './ports'
import {
  dialogueTransition,
  EMPTY_DIALOGUE,
  type CanvasPerspective,
  type DialogueAction,
  type DialogueEntry,
  type DialogueInput,
  type DialogueState,
  transcriptEntries,
  type TranscriptRecord,
} from './state'
import { checkDiagrams, citeViews, digestOf, type DiagramView, type NoteSegmentView } from './views'

export * from './anchor'
export * from './ports'
export * from './state'
export * from './views'

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
  /** DL-51：设计里落盘的各轮（草图版本的载荷带来；随重新加载更新） */
  history?: () => readonly TranscriptRecord[] | undefined
}

export function createDialogue({ project, index, selection, step, perspective, transport, design, openTab, sketch, history }: DialogueInputs) {
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
  // DL-51：设计里落盘的转录在会话为空时整份恢复（打开设计、重新加载页面）；回答里的图按当前张判一次
  watch(
    () => history?.(),
    recs => {
      if (!recs?.length || state.value.transcript.length) return
      const known = (id: string) =>
        sketch?.active() && sketch.sheetHas ? sketch.sheetHas(id) : !!index.value && (id === index.value.rootId || index.value.modules.has(id))
      dispatch({ type: 'restore', entries: transcriptEntries(recs, blocks => checkDiagrams(blocks, known)) })
    },
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
