/**
 * 回放规则（R1、R5、R6、R10、R12、R13、F6、V1、V7）。纯函数。
 * 回放只由用户驱动：单步、指向、拖动进度、选分支；没有自动播放（R1）。
 * 「下一步是哪一帧」「到达某帧需要哪些分支选择」「改选后保留哪些选择」都问模型层的场景查询。
 * 播放头以帧 ID 记录，与层次无关；层次变化时不动它（R6）。
 */
import { choicesFor, choicesForBranch, landing, pointPrefix, projectScenario, resolvePath, stepAfter, stepBefore, type ScenarioLevelView } from '@/model'
import type { TransitionContext, TransitionResult, ViewState } from './types'

const replace = (state: ViewState): TransitionResult => ({ state, history: 'replace' })
const push = (state: ViewState): TransitionResult => ({ state, history: 'push' })

/** 当前层次上回放路径的投影；没有打开场景或缺少上下文时为 null */
function scenarioView(state: ViewState, ctx: TransitionContext, choices = state.playback?.choices): ScenarioLevelView | null {
  if (!state.playback || !ctx.plan || !ctx.levelView || !choices) return null
  if (choices === state.playback.choices && ctx.scenarioView) return ctx.scenarioView
  return projectScenario(ctx.index, ctx.levelView, ctx.plan, choices)
}

/** LY-6、R5、R12：打开场景（或换场景）即交互视角 + 这个场景，不改层次；停在开头、选中场景（V2）；R10：进历史 */
export function openScenario(state: ViewState, ctx: TransitionContext, id: string): TransitionResult {
  if (!ctx.index.scenarios.has(id)) return replace(state)
  // 交互视角不存字段（同 mode.ts 的 withMode；不引用它，回放规则与视角模式互不依赖）
  const { mode: _mode, ...interaction } = state
  return push({ ...interaction, selection: null, playback: { scenarioId: id, frameId: null, choices: new Map() } })
}

/** LY-6a：退出场景留在交互视角，层次与选中保留（R10：进历史） */
export function closeScenario(state: ViewState): TransitionResult {
  return state.playback ? push({ ...state, playback: null }) : replace(state)
}

/** R7、V7：单步前进 / 后退，按本层可见消息；选中移动后的那一步（清空显式选中） */
function step(state: ViewState, ctx: TransitionContext, find: typeof stepAfter): TransitionResult {
  const v = scenarioView(state, ctx)
  if (!v) return replace(state)
  const from = state.playback!.frameId
  const to = find(v, from)
  // R12：在本层第一步再后退即回到开头
  const target = to ?? (find === stepBefore && from !== null ? null : from)
  if (target === from) return replace(state)
  return replace({ ...state, selection: null, playback: { ...state.playback!, frameId: target } })
}

export const next = (state: ViewState, ctx: TransitionContext) => step(state, ctx, stepAfter)
export const prev = (state: ViewState, ctx: TransitionContext) => step(state, ctx, stepBefore)

/** R13、V7：指向某一步——选中它，进度（播放头）前进或后退到该步；在未选分支上先改选，落在合并的可见消息上取第一帧。null = 回到开头（R12） */
export function seek(state: ViewState, ctx: TransitionContext, frameId: string | null): TransitionResult {
  const pb = state.playback
  if (!pb || !ctx.plan) return replace(state)
  if (frameId === null) return replace({ ...state, selection: null, playback: { ...pb, frameId: null } })
  const choices = choicesFor(ctx.plan, pb.choices, frameId)
  if (!choices) return replace(state)
  const kept = sameChoices(choices, pb.choices) ? pb.choices : choices
  const v = scenarioView(state, ctx, kept)
  const target = v ? landing(v, frameId) : frameId
  return replace({ ...state, selection: null, playback: { ...pb, choices: kept, frameId: target } })
}

/**
 * F6、F6b、F6e：在任意分支点选择或改选（不在路径上时先补齐到达它的选择）；选中不变（选中的是步骤时随进度移动，V7）。
 * 播放头仍在新路径上时不动，否则停在该分支点之前的最后一帧（取其可见消息的第一帧），之前没有帧时回到开头；之后由用户单步继续。
 */
export function chooseBranch(state: ViewState, ctx: TransitionContext, pointId: string, option: number): TransitionResult {
  const pb = state.playback
  if (!pb || !ctx.plan) return replace(state)
  const choices = choicesForBranch(ctx.plan, pb.choices, pointId, option)
  if (!choices) return replace(state)
  const frames = resolvePath(ctx.plan, choices).frames
  if (pb.frameId === null || frames.some(f => f.id === pb.frameId)) return replace({ ...state, playback: { ...pb, choices } })
  const before = pointPrefix(ctx.plan, choices, pointId)
  const last = before[before.length - 1]
  const v = last ? scenarioView(state, ctx, choices) : null
  const frameId = last ? (v ? landing(v, last.id) : last.id) : null
  return replace({ ...state, playback: { ...pb, choices, frameId } })
}

/** 重新加载后：场景已不存在则退出；播放头不在新路径上则回到开头 */
export function reloadedPlayback(state: ViewState, ctx: TransitionContext): ViewState {
  const pb = state.playback
  if (!pb) return state
  if (!ctx.index.scenarios.has(pb.scenarioId) || !ctx.plan) return { ...state, playback: null }
  const valid = new Map([...pb.choices].filter(([id, k]) => (ctx.plan!.points.get(id)?.options.length ?? 0) > k))
  const frames = resolvePath(ctx.plan, valid).frames
  const keep = pb.frameId === null || frames.some(f => f.id === pb.frameId)
  return { ...state, playback: { ...pb, choices: valid, frameId: keep ? pb.frameId : null } }
}

function sameChoices(a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>): boolean {
  if (a.size !== b.size) return false
  for (const [k, v] of a) if (b.get(k) !== v) return false
  return true
}
