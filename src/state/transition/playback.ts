/**
 * 回放规则（R1、R5、R6、R10、R12–R14、F6、F6a、V1、V4）。纯函数。
 * 「下一步是哪一帧」「到达某帧需要哪些分支选择」「改选后保留哪些选择」都问模型层的场景查询。
 * 播放头以帧 ID 记录，与层次无关；层次变化时不动它（R6）。
 */
import { chooseBranch as choose, choicesFor, landing, projectScenario, resolvePath, stepAfter, stepBefore, type ScenarioLevelView } from '@/model'
import type { PlaybackState, Speed, TransitionContext, TransitionResult, ViewState } from './types'

const replace = (state: ViewState): TransitionResult => ({ state, history: 'replace' })
const push = (state: ViewState): TransitionResult => ({ state, history: 'push' })

function withPlayback(state: ViewState, patch: Partial<PlaybackState>): ViewState {
  return state.playback ? { ...state, playback: { ...state.playback, ...patch } } : state
}

/** 当前层次上回放路径的投影；没有打开场景或缺少上下文时为 null */
function scenarioView(state: ViewState, ctx: TransitionContext, choices = state.playback?.choices): ScenarioLevelView | null {
  if (!state.playback || !ctx.plan || !ctx.levelView || !choices) return null
  if (choices === state.playback.choices && ctx.scenarioView) return ctx.scenarioView
  return projectScenario(ctx.index, ctx.levelView, ctx.plan, choices)
}

/** V1、R5、R12：打开场景（或换场景）进入运行视角，不改层次；从头自动播放，焦点跟随 */
export function openScenario(state: ViewState, ctx: TransitionContext, id: string): TransitionResult {
  if (!ctx.index.scenarios.has(id)) return replace(state)
  const speed = state.playback?.speed ?? 1
  return push({ ...state, selection: null, playback: { scenarioId: id, frameId: null, choices: new Map(), playing: true, speed } })
}

/** V1：退出场景回到结构视角，层次与选中保留（R14：进历史） */
export function closeScenario(state: ViewState): TransitionResult {
  return state.playback ? push({ ...state, playback: null }) : replace(state)
}

/** R1、R7、R14：单步前进，按本层可见消息；单步时暂停 */
export function next(state: ViewState, ctx: TransitionContext): TransitionResult {
  const v = scenarioView(state, ctx)
  if (!v) return replace(state)
  const to = stepAfter(v, state.playback!.frameId)
  return replace(withPlayback(state, { frameId: to ?? state.playback!.frameId, playing: false }))
}

/** R1、R7、R14：单步后退；单步时暂停 */
export function prev(state: ViewState, ctx: TransitionContext): TransitionResult {
  const v = scenarioView(state, ctx)
  if (!v) return replace(state)
  const to = stepBefore(v, state.playback!.frameId)
  return replace(withPlayback(state, { frameId: to ?? state.playback!.frameId, playing: false }))
}

/** 时钟到点：前进一条可见消息；到 alt 未选分支处或场景末尾时暂停（F6a） */
export function tick(state: ViewState, ctx: TransitionContext): TransitionResult {
  const pb = state.playback
  const v = scenarioView(state, ctx)
  if (!pb?.playing || !v) return replace(state)
  const to = stepAfter(v, pb.frameId)
  if (to === null) return replace(withPlayback(state, { playing: false }))
  const after = stepAfter(v, to)
  return replace(withPlayback(state, { frameId: to, playing: after !== null }))
}

/** R13：指向某一步——播放头前进或后退到该步并暂停，焦点跟随它；在未选分支上先改选，落在合并的可见消息上取第一帧 */
export function seek(state: ViewState, ctx: TransitionContext, frameId: string): TransitionResult {
  const pb = state.playback
  if (!pb || !ctx.plan) return replace(state)
  const choices = choicesFor(ctx.plan, pb.choices, frameId)
  if (!choices) return replace(state)
  const v = scenarioView(state, ctx, sameChoices(choices, pb.choices) ? pb.choices : choices)
  const target = v ? landing(v, frameId) : frameId
  return replace({ ...state, selection: null, playback: { ...pb, choices: sameChoices(choices, pb.choices) ? pb.choices : choices, frameId: target, playing: false } })
}

/** V4、R14：只有播放能恢复播放，恢复时回到跟随；在末尾时从头开始；停在未选分支的分支点时无效 */
export function play(state: ViewState, ctx: TransitionContext): TransitionResult {
  const pb = state.playback
  const v = scenarioView(state, ctx)
  if (!pb || !v || !ctx.plan) return replace(state)
  if (stepAfter(v, pb.frameId) === null) {
    if (resolvePath(ctx.plan, pb.choices).pending) return replace(state)
    return replace({ ...state, selection: null, playback: { ...pb, frameId: null, playing: true } })
  }
  return replace({ ...state, selection: null, playback: { ...pb, playing: true } })
}

export function pause(state: ViewState): TransitionResult {
  return replace(withPlayback(state, { playing: false }))
}

export function speed(state: ViewState, value: Speed): TransitionResult {
  return replace(withPlayback(state, { speed: value }))
}

/** F6、F6b：在分支点选择或改选；播放头不在新路径上时退到该分支点的第一帧之前；保持暂停，由用户点播放继续 */
export function chooseBranch(state: ViewState, ctx: TransitionContext, pointId: string, option: number): TransitionResult {
  const pb = state.playback
  if (!pb || !ctx.plan || !ctx.plan.points.has(pointId)) return replace(state)
  const choices = choose(ctx.plan, pb.choices, pointId, option)
  const frames = resolvePath(ctx.plan, choices).frames
  const frameId = pb.frameId === null || frames.some(f => f.id === pb.frameId) ? pb.frameId : null
  return replace({ ...state, playback: { ...pb, choices, frameId, playing: false } })
}

/** 重新加载后：场景已不存在则退出；播放头不在新路径上则回到开头并暂停 */
export function reloadedPlayback(state: ViewState, ctx: TransitionContext): ViewState {
  const pb = state.playback
  if (!pb) return state
  if (!ctx.index.scenarios.has(pb.scenarioId) || !ctx.plan) return { ...state, playback: null }
  const valid = new Map([...pb.choices].filter(([id, k]) => (ctx.plan!.points.get(id)?.options.length ?? 0) > k))
  const frames = resolvePath(ctx.plan, valid).frames
  const keep = pb.frameId === null || frames.some(f => f.id === pb.frameId)
  return { ...state, playback: { ...pb, choices: valid, frameId: keep ? pb.frameId : null, playing: keep && pb.playing } }
}

function sameChoices(a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>): boolean {
  if (a.size !== b.size) return false
  for (const [k, v] of a) if (b.get(k) !== v) return false
  return true
}
