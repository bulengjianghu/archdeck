/** 会话规则：视角与焦点（V1–V4、V7）、焦点突出（R15）、回放（R1、R5、R6、R10、R12、R13、F6、F6b、F6e）、URL（F6c、R10、R12） */
import { describe, expect, it } from 'vitest'
import { loadModel, pairReturns, participation, planScenario, projectLevel, projectScenario, RELATION_TYPES, resolvePath, stageEnds } from '../../src/model'
import {
  DEFAULT_TOGGLES,
  emphasisOf,
  encodeView,
  focusOf,
  perspectiveOf,
  transition,
  type TransitionContext,
  type ViewAction,
  type ViewState,
} from '../../src/state/transition'
import { scenarioFiles } from '../fixtures/sample'

const { index } = loadModel(scenarioFiles())
const ALT = 'sc.play#3'
const base: ViewState = { levelId: 'sys', selection: null, hover: null, toggles: DEFAULT_TOGGLES(RELATION_TYPES), playback: null }

function ctxOf(s: ViewState): TransitionContext {
  if (!s.playback) return { index }
  const plan = planScenario(index, s.playback.scenarioId)
  const levelView = projectLevel(index, s.levelId, { showBoundaries: true, mergeTypes: true, scenarioEnds: stageEnds(plan) })
  return { index, plan, levelView, scenarioView: projectScenario(index, levelView, plan, s.playback.choices) }
}

/** 依次执行动作 */
function run(s: ViewState, ...actions: ViewAction[]) {
  let r = { state: s, history: 'replace' as 'push' | 'replace' }
  for (const a of actions) r = transition(r.state, a, ctxOf(r.state))
  return r
}
const open = (level = 'sys', ...actions: ViewAction[]) => run({ ...base, levelId: level }, { type: 'openScenario', id: 'sc.play' }, ...actions)
const frameOf = (s: ViewState) => s.playback?.frameId
const next: ViewAction = { type: 'next' }
const prev: ViewAction = { type: 'prev' }

describe('视角与焦点', () => {
  it('V1：视角由是否打开场景决定；打开不改层次（R5）、进历史（R10），退出后回到结构视角并保留层次与选中、进历史', () => {
    expect(perspectiveOf(base)).toBe('structure')
    const r = open('infra')
    expect(perspectiveOf(r.state)).toBe('run')
    expect(r.state.levelId).toBe('infra')
    expect(r.history).toBe('push')
    const pinned = run(r.state, { type: 'select', selection: { kind: 'module', id: 'infra.mus' } })
    const closed = run(pinned.state, { type: 'closeScenario' })
    expect(perspectiveOf(closed.state)).toBe('structure')
    expect(closed.state).toMatchObject({ levelId: 'infra', selection: { kind: 'module', id: 'infra.mus' } })
    expect(closed.history).toBe('push')
    expect(run(base, { type: 'openScenario', id: 'nope' }).state).toBe(base)
  })

  it('V2：结构视角焦点 = 选中，否则当前父模块；运行视角焦点 = 钉住或跟随二选一', () => {
    expect(focusOf({ ...base, levelId: 'infra' })).toEqual({ kind: 'level', levelId: 'infra' })
    expect(focusOf({ ...base, selection: { kind: 'module', id: 'infra' } })).toEqual({ kind: 'selection', selection: { kind: 'module', id: 'infra' } })
    const r = open('sys', next)
    expect(focusOf(r.state)).toEqual({ kind: 'follow', frameId: 'sc.play#start' })
    const p = run(r.state, { type: 'select', selection: { kind: 'actor', id: 'actor.biz' } })
    expect(focusOf(p.state)).toEqual({ kind: 'pinned', selection: { kind: 'actor', id: 'actor.biz' } })
  })

  it('V3：运行视角下指向任何对象（选中、跳转、定位）即钉住，播放头不动；悬停不算', () => {
    const s = open('sys', next).state
    expect(run(s, { type: 'hover', id: 'infra' }).state.selection).toBeNull()
    const sel = run(s, { type: 'select', selection: { kind: 'edge', id: 'infra->app:calls' } }).state
    expect(focusOf(sel)).toEqual({ kind: 'pinned', selection: { kind: 'edge', id: 'infra->app:calls' } })
    for (const a of [{ type: 'revealModule', id: 'infra.mus' }, { type: 'revealRelation', id: 'r6' }] as ViewAction[]) {
      const r = run(s, a).state
      expect(focusOf(r).kind).toBe('pinned')
      expect(frameOf(r)).toBe(frameOf(s))
    }
  })

  it('V3、R6：回放中双击下钻——钉住被下钻的模块，播放头仍是同一帧', () => {
    const s = open('sys', next, next).state
    const r = run(s, { type: 'drill', id: 'infra' })
    expect(r.state).toMatchObject({ levelId: 'infra', selection: { kind: 'module', id: 'infra' } })
    expect(frameOf(r.state)).toBe(frameOf(s))
    expect(r.history).toBe('push')
    // 结构视角下钻仍按 N2 清空选中
    expect(run(base, { type: 'drill', id: 'infra' }).state.selection).toBeNull()
  })

  it('V4：取消选中回到跟随，播放头不动', () => {
    const pinned = open('sys', next, { type: 'select', selection: { kind: 'module', id: 'infra' } }).state
    const unpinned = run(pinned, { type: 'select', selection: null }).state
    expect(focusOf(unpinned)).toEqual({ kind: 'follow', frameId: 'sc.play#start' })
  })

  it('V7：移动播放头（单步、指向某一步、回到开头）回到跟随；播放头没动时不改钉住', () => {
    const pinned = open('sys', next, { type: 'select', selection: { kind: 'module', id: 'infra' } }).state
    expect(focusOf(run(pinned, next).state)).toEqual({ kind: 'follow', frameId: 'sc.play#1' })
    expect(focusOf(run(pinned, prev).state)).toEqual({ kind: 'follow', frameId: null })
    expect(focusOf(run(pinned, { type: 'seek', frameId: 'sc.play#1' }).state).kind).toBe('follow')
    expect(focusOf(run(pinned, { type: 'seek', frameId: null }).state)).toEqual({ kind: 'follow', frameId: null })
    // 停在未选分支的分支点：下一步无处可去，钉住不变
    const atAlt = run(pinned, next, next, { type: 'select', selection: { kind: 'module', id: 'infra' } }).state
    expect(run(atAlt, next).state).toBe(atAlt)
  })
})

describe('回放', () => {
  it('R1、R12：打开场景停在开头（播放头为空、跟随），状态里没有播放与速度', () => {
    const r = open('sys')
    expect(r.state.playback).toEqual({ scenarioId: 'sc.play', frameId: null, choices: new Map() })
    expect(focusOf(r.state)).toEqual({ kind: 'follow', frameId: null })
    expect(frameOf(run(r.state, next).state)).toBe('sc.play#start')
  })

  it('R7、R12：单步按本层可见消息前进 / 后退，只替换地址；在第一步后退回到开头，在开头后退不动', () => {
    const s = open('sys', next).state
    const fwd = run(s, next)
    expect(frameOf(fwd.state)).toBe('sc.play#1')
    expect(fwd.history).toBe('replace')
    expect(frameOf(run(fwd.state, prev).state)).toBe('sc.play#start')
    const start = run(s, prev).state
    expect(frameOf(start)).toBeNull()
    expect(run(start, prev).state).toBe(start)
  })

  it('F6：单步到 alt 未选分支处停住，下一步无效；选择后继续单步', () => {
    let s = open('sys', next, next, next).state
    expect(frameOf(s)).toBe('sc.play#2')
    expect(run(s, next).state).toBe(s)
    s = run(s, { type: 'chooseBranch', pointId: ALT, option: 0 }).state
    expect(frameOf(s)).toBe('sc.play#2')
    expect(s.playback!.choices.get(ALT)).toBe(0)
    expect(frameOf(run(s, next).state)).toBe('sc.play#update')
  })

  it('到场景末尾时下一步无效', () => {
    let s = open('sys', next, next, next, { type: 'chooseBranch', pointId: ALT, option: 1 }).state
    for (let i = 0; i < 10; i++) s = run(s, next).state
    expect(frameOf(s)).toBe('sc.play#done')
    expect(run(s, next).state).toBe(s)
  })

  it('F6b：退回分支点之前再前进时沿用已选分支；在分支点改选会丢弃其后的选择', () => {
    let s = open('sys', next, next, next, { type: 'chooseBranch', pointId: ALT, option: 0 }, next).state
    expect(frameOf(s)).toBe('sc.play#update')
    s = run(s, prev, prev, next, next).state
    expect(frameOf(s)).toBe('sc.play#update')
    // F6e：改选后播放头不在新路径上——停在分支点之前的最后一帧，下一步进入新分支
    const changed = run(s, { type: 'chooseBranch', pointId: ALT, option: 1 }).state
    expect(changed.playback!.choices.get(ALT)).toBe(1)
    expect(frameOf(changed)).toBe('sc.play#2')
    expect(changed.selection).toBeNull()
  })

  it('F6e：播放头仍在新路径上时不动；分支点之前没有帧时回到开头；不在路径上的分支点也能直选', () => {
    // 播放头在分支点之前：改选不动它
    const before = open('sys', next, next).state
    expect(frameOf(run(before, { type: 'chooseBranch', pointId: ALT, option: 1 }).state)).toBe(frameOf(before))
    // 尚未到达分支点也能直选（补齐到达它的选择）
    const early = run(open('sys').state, { type: 'chooseBranch', pointId: ALT, option: 0 }).state
    expect(early.playback!.choices.get(ALT)).toBe(0)
    expect(frameOf(early)).toBeNull()
    // 不存在的分支点：不变
    const same = open('sys', next).state
    expect(run(same, { type: 'chooseBranch', pointId: 'nope', option: 0 }).state).toBe(same)
  })

  it('R15：跟随时突出当前消息与配对返回；钉住时突出参与的消息；停在开头或结构视角不突出', () => {
    const plan = planScenario(index, 'sc.play')
    const pairs = pairReturns(plan)
    const at = (s: ViewState) => ctxOf(s).scenarioView!
    // 结构视角、停在开头
    expect(emphasisOf(base, null, pairs, null)).toBeNull()
    const start = open('sys', { type: 'chooseBranch', pointId: ALT, option: 1 }).state
    expect(emphasisOf(start, at(start), pairs, null)).toBeNull()
    // 走到 sc.decide 的调用：它与配对返回一起突出
    let s = start
    const v0 = at(s)
    const callIdx = v0.messages.findIndex(m => m.frameIds.some(f => plan.frames.get(f)!.kind === 'call' && pairs.has(f)))
    expect(callIdx).toBeGreaterThanOrEqual(0)
    s = run(s, { type: 'seek', frameId: v0.messages[callIdx].frameIds[0] }).state
    const v = at(s)
    const em = emphasisOf(s, v, pairs, null)!
    const call = v.messages[v.messageOf.get(frameOf(s)!)!]
    const paired = call.frameIds.map(f => pairs.get(f)).find(Boolean)!
    expect([...em].sort()).toEqual([v.messageOf.get(frameOf(s)!)!, v.messageOf.get(paired)!].sort())
    // 钉住：参与的消息；钉住文件：空集
    const pinned = run(s, { type: 'select', selection: { kind: 'module', id: 'app.solution' } }).state
    const part = participation(index, resolvePath(plan, pinned.playback!.choices).frames, v, { kind: 'module', id: 'app.solution' })
    expect([...emphasisOf(pinned, v, pairs, part)!]).toEqual(part.messages)
    const file = run(s, { type: 'select', selection: { kind: 'file', id: 'x.ts' } }).state
    expect(emphasisOf(file, v, pairs, null)!.size).toBe(0)
    // ADR-0011：钉住当前层次本身或其祖先时按跟随
    const follow = emphasisOf(s, v, pairs, null)
    const self = { ...s, selection: { kind: 'module' as const, id: s.levelId } }
    expect(emphasisOf(self, v, pairs, part, index)).toEqual(follow)
    const drilled = { ...s, levelId: 'app', selection: { kind: 'module' as const, id: 'app' } }
    expect(emphasisOf(drilled, v, pairs, part, index)).toEqual(follow)
    // 当前层次之外的模块仍按参与突出
    expect([...emphasisOf(pinned, v, pairs, part, index)!]).toEqual(part.messages)
  })

  it('R13：指向某一步——前进或后退到该步、焦点跟随；在未选分支上先改选；落在合并消息的第一帧', () => {
    const s = open('sys', next, next, next, { type: 'chooseBranch', pointId: ALT, option: 1 }, { type: 'seek', frameId: 'sc.play#done' }).state
    const pinned = run(s, { type: 'select', selection: { kind: 'module', id: 'infra' } }).state
    const back = run(pinned, { type: 'seek', frameId: 'sc.play#1' })
    expect(back.state).toMatchObject({ selection: null, playback: { frameId: 'sc.play#1' } })
    expect(back.history).toBe('replace')
    const other = run(s, { type: 'seek', frameId: 'sc.play#update' }).state
    expect(other.playback!.choices.get(ALT)).toBe(0)
    expect(frameOf(other)).toBe('sc.play#update')
    const merged = loadModel(
      scenarioFiles({ 'scenarios/x.yaml': 'scenario: { id: sc.m, name: M, steps: [{ call: { id: a, from: infra.framework.sm, to: infra.framework.pipeline } }, { call: { id: b, from: infra.framework.pipeline, to: infra.framework.sm } }] }' }),
    ).index
    const plan = planScenario(merged, 'sc.m')
    const st: ViewState = { ...base, playback: { scenarioId: 'sc.m', frameId: null, choices: new Map() } }
    const lv = projectLevel(merged, 'sys', { showBoundaries: true, mergeTypes: true, scenarioEnds: stageEnds(plan) })
    const r = transition(st, { type: 'seek', frameId: 'sc.m#b' }, { index: merged, plan, levelView: lv, scenarioView: projectScenario(merged, lv, plan, new Map()) })
    expect(frameOf(r.state)).toBe('sc.m#a')
  })

  it('R6：层次变化后播放头仍是同一帧，单步粒度随层次变化', () => {
    const s = open('sys', next, next).state
    expect(frameOf(run({ ...s, levelId: 'infra' }, next).state)).toBe('sc.play#2')
    expect(frameOf(run({ ...s, levelId: 'infra.framework' }, next).state)).toBe('sc.play#2')
  })

  it('重新加载：场景已不存在则退出运行视角；播放头仍在路径上则保留', () => {
    const s = open('infra', next, next).state
    const { index: gone } = loadModel(scenarioFiles({ 'scenarios/play.yaml': '' }))
    expect(transition(s, { type: 'reloaded', previousPath: ['sys', 'infra'] }, { index: gone }).state.playback).toBeNull()
    const kept = run(s, { type: 'reloaded', previousPath: ['sys', 'infra'] }).state
    expect(frameOf(kept)).toBe(frameOf(s))
  })
})

describe('URL', () => {
  it('F6c、R10：场景、步骤、已选分支写进 URL', () => {
    const s = open('infra', next, next, next, next, { type: 'chooseBranch', pointId: ALT, option: 0 }, next).state
    const plan = planScenario(index, 'sc.play')
    expect(encodeView(s, index, plan)).toEqual({ level: 'infra', sc: 'sc.play', step: 'sc.play#update', alt: '0' })
    expect(encodeView(base, index)).toEqual({})
  })

  it('R12：带有效步骤的链接停在该步；只有场景（或步骤无效）时停在开头；无效场景被丢弃；带选中即钉住', () => {
    const at = run(base, { type: 'restore', query: { level: 'infra', sc: 'sc.play', step: 'sc.play#update', alt: '0' } }).state
    expect(at).toMatchObject({ levelId: 'infra', playback: { scenarioId: 'sc.play', frameId: 'sc.play#update' } })
    expect(at.playback!.choices.get(ALT)).toBe(0)
    expect(run(base, { type: 'restore', query: { sc: 'sc.play' } }).state.playback).toMatchObject({ frameId: null })
    expect(run(base, { type: 'restore', query: { sc: 'sc.play', step: 'sc.play#update' } }).state.playback).toMatchObject({ frameId: null })
    expect(run(base, { type: 'restore', query: { sc: 'nope' } }).state.playback).toBeNull()
    expect(focusOf(run(base, { type: 'restore', query: { sc: 'sc.play', sel: 'm:infra' } }).state).kind).toBe('pinned')
  })

  it('后退到同一场景的另一步：停在该步；没带步骤时保留原播放头；后退到结构视角：退出场景', () => {
    const s = open('sys', next, next).state
    expect(run(s, { type: 'restore', query: { sc: 'sc.play', step: 'sc.play#start' } }).state.playback).toMatchObject({ frameId: 'sc.play#start' })
    expect(run(s, { type: 'restore', query: { sc: 'sc.play' } }).state.playback).toMatchObject({ frameId: 'sc.play#1' })
    expect(run(s, { type: 'restore', query: {} }).state.playback).toBeNull()
  })
})
