/**
 * 画布模式（LY-6，ADR-0064；V12，ADR-0031）：视角只有结构 / 交互两个；打开场景即交互视角 + 这个场景，退出场景留在交互视角。
 * 切换只换边与角标：层次、视图节点、分级与折叠、临时展开都不在这里改；选中按 V12 映射。纯函数。
 */
import { interactionEdgeBetween, nodeOf, type LevelView, type ModelIndex } from '@/model'
import type { CanvasMode, Selection, TransitionContext, TransitionResult, ViewState } from './types'

const replace = (state: ViewState): TransitionResult => ({ state, history: 'replace' })

/** 缺省为交互视角，只存结构视角（URL 也只写 v=s） */
export function withMode(state: ViewState, mode: CanvasMode): ViewState {
  const { mode: _old, ...rest } = state
  return mode === 'structure' ? { ...rest, mode } : rest
}

/** 视图节点对应的模块 ID（边界节点、带、核心块都带 moduleId；参与者节点即其 ID） */
const moduleOfNode = (view: LevelView, nodeId: string) => view.nodes.find(n => n.id === nodeId)?.moduleId ?? nodeId

/** 模块投影到本层的节点（同 K9、K10 的 nodeOf）；参与者不是依赖的端点 */
function nodeFor(index: ModelIndex, view: LevelView, id: string): string | null {
  if (!index.modules.has(id)) return null
  return nodeOf(index, view, new Set(view.nodes.map(n => n.id)), id)
}

/**
 * V12：选中跟着模式映射——模块、参与者、文件、耦合线照原样；
 * 切到结构视角：关系与视图边换成同一对节点同方向的依赖边（K10 的 `d:`），没有结构边（或没有代码事实）时清空；端口换成其定义模块。
 * 切到交互视角：依赖边换成同一对节点同方向的交互边（关系类型声明顺序中的第一条），没有时仍是 K10 的选中（交互视角的代码依赖叠加线，面板照常）。
 * 返回 [新选中, 被清空的选中]。
 */
export function mapSelection(s: Selection | null, mode: CanvasMode, ctx: TransitionContext): [Selection | null, Selection | undefined] {
  if (!s) return [null, undefined]
  const { index, levelView: view } = ctx
  if (mode === 'structure') {
    if (s.kind === 'port') {
      const owner = index.interfaces.get(s.id)?.owner
      return owner ? [{ kind: 'module', id: owner }, undefined] : [null, s]
    }
    if (s.kind !== 'relation' && s.kind !== 'edge') return [s, undefined]
    let ends: [string, string] | null = null
    if (view && s.kind === 'edge') {
      const e = [...view.edges, ...(view.coreEdges ?? [])].find(x => x.id === s.id)
      if (e) ends = [moduleOfNode(view, e.from), moduleOfNode(view, e.to)]
    }
    if (view && s.kind === 'relation') {
      const r = index.relations.get(s.id)
      const a = r && nodeFor(index, view, r.from)
      const b = r && nodeFor(index, view, r.to)
      if (a && b && a !== b) ends = [moduleOfNode(view, a), moduleOfNode(view, b)]
    }
    if (ends && ctx.structurePair?.(ends[0], ends[1])) return [{ kind: 'dep', id: `${ends[0]}->${ends[1]}` }, undefined]
    return [null, s]
  }
  if (s.kind !== 'dep' || !view) return [s, undefined]
  const [from, to] = s.id.split('->')
  const a = nodeFor(index, view, from)
  const b = nodeFor(index, view, to)
  const edge = a && b && a !== b ? interactionEdgeBetween(view, a, b) : undefined
  return [edge ? { kind: 'edge', id: edge } : s, undefined]
}

/**
 * LY-6、LY-6a：切换视角；同一视角无动作（回放中单击「交互」不退出场景）。回放中切到结构 = 退出场景并切到结构视角。进历史
 * （回放中 mode 总是交互，openScenario 保证）
 */
export function setMode(state: ViewState, ctx: TransitionContext, mode: CanvasMode): TransitionResult {
  const current: CanvasMode = state.mode === 'structure' && !state.playback ? 'structure' : 'interaction'
  if (mode === current) return replace(state)
  const [selection, dropped] = mode === current ? [state.selection, undefined] : mapSelection(state.selection, mode, ctx)
  return { state: { ...withMode(state, mode), playback: null, selection }, history: 'push', ...(dropped ? { dropped } : {}) }
}
