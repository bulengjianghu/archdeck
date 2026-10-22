/**
 * 视角与选中（V1–V4、V7）：由视图状态推出，不另存字段（ADR-0012）。
 *   视角 = playback 为 null ? 结构 : 运行
 *   选中 = selection ≠ null ? selection
 *          运行视角：frameId ≠ null ? 步骤(frameId) : 场景
 *          结构视角：无（面板显示当前父模块）
 * 选中是唯一的主语；步骤与场景不存进 selection，「选中的步骤就是进度所在的一步」（V7）由表示本身保证。
 */
import { coupleEnds, lanesOf, type LevelView, type ModelIndex, type ReturnPairs, type ScenarioLevelView, type SequenceModel } from '@/model'
import type { Selection, TransitionResult, ViewState } from './types'

export type Perspective = 'structure' | 'run'

/** 选中的对象：显式选中，或运行视角下进度所在的步骤 / 场景 */
export type Selected = Selection | { kind: 'step'; id: string } | { kind: 'scenario'; id: string }

export const perspectiveOf = (state: ViewState): Perspective => (state.playback ? 'run' : 'structure')

/** V2、V7：选中的对象；null = 结构视角无选中（面板显示当前父模块，N13） */
export function selectedOf(state: ViewState): Selected | null {
  if (state.selection) return state.selection
  const pb = state.playback
  if (!pb) return null
  return pb.frameId ? { kind: 'step', id: pb.frameId } : { kind: 'scenario', id: pb.scenarioId }
}

/** 选中突出的输入：当前层次的视图、回放路径的本层投影、时序模型、调用返回配对、选中文件的归属模块 */
export interface EmphasisContext {
  index: ModelIndex
  levelView: LevelView | null
  scenarioView: ScenarioLevelView | null
  sequence: SequenceModel | null
  pairs: ReturnPairs | null
  fileOwners: readonly string[]
}

export interface Emphasis {
  /** 选中的步骤所在的可见消息（选中样式）；选中的不是步骤、或它在本层不可见时为 null */
  selected: number | null
  /** 与选中步骤配对的调用 / 返回（F7）所在的可见消息（浅色「配对」标记） */
  paired: ReadonlySet<number>
  /** 突出的泳道（视图节点 ID） */
  lanes: ReadonlySet<string>
}

const NONE: Emphasis = { selected: null, paired: new Set(), lanes: new Set() }

/**
 * R15、R16：选中突出——任何时刻只有被选中的那一个对象用选中样式；结构视角为 null。
 * 选中步骤：它所在的可见消息 + 配对帧所在的可见消息（本层不可见时都没有）；
 * 选中模块 / 文件（归属模块）/ 关系（两端）/ 视图边（两端）/ 参与者：突出泳道（lanesOf），不突出消息；选中场景：不突出。
 */
export function emphasisOf(state: ViewState, ctx: EmphasisContext): Emphasis | null {
  const pb = state.playback
  if (!pb) return null
  const s = selectedOf(state)
  const { index, scenarioView: view, sequence } = ctx
  if (s?.kind === 'step') {
    const current = view?.messageOf.get(s.id)
    if (!view || current === undefined) return NONE
    const paired = new Set<number>()
    for (const f of view.messages[current].frameIds) {
      const pair = ctx.pairs?.get(f)
      const m = pair === undefined ? undefined : view.messageOf.get(pair)
      if (m !== undefined && m !== current) paired.add(m)
    }
    return { selected: current, paired, lanes: new Set() }
  }
  if (!s || s.kind === 'scenario' || !sequence) return NONE
  const lanes = new Set<string>()
  const add = (id: string) => lanesOf(index, sequence, state.levelId, id).forEach(n => lanes.add(n))
  switch (s.kind) {
    case 'module':
    case 'actor':
      add(s.id)
      break
    case 'file':
      ctx.fileOwners.forEach(add)
      break
    case 'relation': {
      const r = index.relations.get(s.id)
      if (r) [r.from, r.to].forEach(add)
      break
    }
    case 'dep':
      s.id.split('->').forEach(add)
      break
    // J7：耦合线按选中关系的方式突出两端泳道
    case 'couple':
      coupleEnds(s.id)?.forEach(add)
      break
    case 'edge': {
      // 视图边的两端是视图节点：模块节点（含边界节点、带）按其模块取泳道，参与者节点即其泳道
      const lv = ctx.levelView
      const e = [...(lv?.edges ?? []), ...(lv?.coreEdges ?? [])].find(x => x.id === s.id)
      if (e) for (const n of [e.from, e.to]) add(lv?.nodes.find(x => x.id === n)?.moduleId ?? n)
      break
    }
  }
  return { selected: null, paired: new Set(), lanes }
}

/**
 * V3：下钻作为「指向」：运行视角下选中被下钻的模块（结构视角按 N2 清空选中）。
 * 其余导航（选中、跳转、定位、返回上级）本身就设定了选中，无需改写。
 */
export function asPointing(before: ViewState, result: TransitionResult, drilled: string): TransitionResult {
  if (!before.playback || result.state === before || result.state.levelId !== drilled) return result
  return { ...result, state: { ...result.state, selection: { kind: 'module', id: drilled } } }
}
