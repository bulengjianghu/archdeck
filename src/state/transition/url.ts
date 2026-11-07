/**
 * URL 编解码（N6、N10、F6c、R10）：视图状态 ↔ 查询参数。解码时丢弃无效值，恢复到最接近的合法状态。
 *
 * | 参数    | 含义                                              |
 * |---------|---------------------------------------------------|
 * | `level` | 当前层次（根层省略）                              |
 * | `sel`   | 选中，`m:` / `r:` / `e:` / `a:` / `f:` / `d:` / `c:` / `p:` / `y:` / `s:`（层，ADR-0052）前缀 |
 * | `sc`    | 打开的场景（有即回放）                        |
 * | `step`  | 播放头帧 ID                                       |
 * | `alt`   | 已选分支：路径上依次经过的分支点的选项，以 `.` 连接 |
 * | `v`     | 视角：`s` 为结构视角，交互视角缺省不写（LY-6）；回放总是交互视角，旧地址带 `sc` 与 `v=s` 时按交互恢复（LY-6b） |
 */
import { choiceList, choicesFromList, planScenario, resolvePath, type ModelIndex, type ScenarioPlan } from '@/model'
import { withMode } from './mode'
import { selectionExists, withLevel } from './navigation'
import type { PlaybackState, Query, Selection, TransitionContext, TransitionResult, ViewState } from './types'

const SELECTION_PREFIX = { module: 'm', relation: 'r', edge: 'e', actor: 'a', file: 'f', dep: 'd', couple: 'c', port: 'p', cycle: 'y', stratum: 's' } as const
const SELECTION_KIND = { m: 'module', r: 'relation', e: 'edge', a: 'actor', f: 'file', d: 'dep', c: 'couple', p: 'port', y: 'cycle', s: 'stratum' } as const

export function encodeSelection(s: Selection | null): string | undefined {
  if (!s) return undefined
  return `${SELECTION_PREFIX[s.kind]}:${s.id}`
}

export function decodeSelection(raw: unknown): Selection | null {
  if (typeof raw !== 'string') return null
  const m = /^([mreafdcpys]):(.+)$/.exec(raw)
  if (!m) return null
  return { kind: SELECTION_KIND[m[1] as keyof typeof SELECTION_KIND], id: m[2] }
}

export function encodeView(state: ViewState, index: ModelIndex, plan?: ScenarioPlan | null): Record<string, string> {
  const query: Record<string, string> = {}
  if (state.levelId && state.levelId !== index.rootId) query.level = state.levelId
  const sel = encodeSelection(state.selection)
  if (sel) query.sel = sel
  if (state.mode === 'structure') query.v = 's'
  const pb = state.playback
  if (pb) {
    query.sc = pb.scenarioId
    if (pb.frameId) query.step = pb.frameId
    const list = plan?.scenarioId === pb.scenarioId ? choiceList(plan, pb.choices) : []
    if (list.length) query.alt = list.join('.')
  }
  return query
}

/**
 * 按查询参数恢复：不存在的层次回到根，不存在的选中被丢弃；
 * 场景（R12）：带有效步骤时停在该步；同一场景已打开且没带步骤时保留原播放头；否则停在开头。
 */
export function restore(state: ViewState, ctx: TransitionContext, query: Query): TransitionResult {
  const { index } = ctx
  const level = query.level ?? index.rootId
  const sel = decodeSelection(query.sel)
  const playback = restorePlayback(state, ctx, query)
  // LY-6b：旧地址同时带场景与 v=s（回放中照写进入前的模式）→ 交互 + 场景；之后写回的地址即规范形
  const next = withMode(
    withLevel(state, index, level, { select: selectionExists(index, sel) ? sel : null }),
    query.v === 's' && !playback ? 'structure' : 'interaction',
  )
  return { state: { ...next, playback }, history: 'replace' }
}

function restorePlayback(state: ViewState, ctx: TransitionContext, query: Query): PlaybackState | null {
  const sc = query.sc
  if (!sc || !ctx.index.scenarios.has(sc)) return null
  const same = state.playback?.scenarioId === sc
  const plan = same && ctx.plan?.scenarioId === sc ? ctx.plan : planScenario(ctx.index, sc)
  const list = (query.alt ?? '').split('.').filter(Boolean).map(Number)
  const choices = choicesFromList(plan, list)
  const onPath = new Set(resolvePath(plan, choices).frames.map(f => f.id))
  if (query.step && onPath.has(query.step)) return { scenarioId: sc, frameId: query.step, choices }
  const kept = same && state.playback!.frameId && onPath.has(state.playback!.frameId) ? state.playback!.frameId : null
  return { scenarioId: sc, frameId: kept, choices }
}

/** 两组查询参数是否相同（忽略值为 undefined 的键） */
export function sameQuery(a: Query, b: Query): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const k of keys) if (a[k] !== b[k]) return false
  return true
}
