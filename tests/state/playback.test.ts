/** 会话规则：视角与焦点（V1–V4）、回放（R1、R5、R6、R10、R12–R14、F6、F6a、F6b）、URL（F6c、R10）。每次转移后断言焦点不变式 */
import { describe, expect, it } from 'vitest'
import { loadModel, planScenario, projectLevel, projectScenario, RELATION_TYPES, stageEnds } from '../../src/model'
import {
  DEFAULT_TOGGLES,
  encodeView,
  focusOf,
  perspectiveOf,
  transition,
  type TransitionContext,
  type ViewAction,
  type ViewState,
} from '../../src/state/transition'
import { createClockSync, type Timers } from '../../src/state/sync/clock'
import { nextTick, shallowRef } from 'vue'
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

/** 依次执行动作；每次转移都经 transition 断言焦点不变式 */
function run(s: ViewState, ...actions: ViewAction[]) {
  let r = { state: s, history: 'replace' as 'push' | 'replace' }
  for (const a of actions) r = transition(r.state, a, ctxOf(r.state))
  return r
}
const open = (level = 'sys', ...actions: ViewAction[]) => run({ ...base, levelId: level }, { type: 'openScenario', id: 'sc.play' }, ...actions)
const frameOf = (s: ViewState) => s.playback?.frameId
const tick: ViewAction = { type: 'tick' }

describe('视角与焦点', () => {
  it('V1：视角由是否打开场景决定；打开不改层次（R5）、进历史（R10），退出后回到结构视角并保留层次与选中', () => {
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

  it('V2：结构视角焦点 = 选中，否则当前父模块；运行视角焦点 = 钉住或跟随', () => {
    expect(focusOf({ ...base, levelId: 'infra' })).toEqual({ kind: 'level', levelId: 'infra' })
    expect(focusOf({ ...base, selection: { kind: 'module', id: 'infra' } })).toEqual({ kind: 'selection', selection: { kind: 'module', id: 'infra' } })
    const r = open('sys', tick)
    expect(focusOf(r.state)).toEqual({ kind: 'follow', frameId: 'sc.play#start' })
    const p = run(r.state, { type: 'select', selection: { kind: 'actor', id: 'actor.biz' } })
    expect(focusOf(p.state)).toEqual({ kind: 'pinned', selection: { kind: 'actor', id: 'actor.biz' } })
  })

  it('V2：不变式「播放中 ⇒ 无选中」——打开场景清空选中；违反时转移抛错', () => {
    const r = run({ ...base, selection: { kind: 'module', id: 'infra' } }, { type: 'openScenario', id: 'sc.play' })
    expect(r.state.selection).toBeNull()
    expect(r.state.playback!.playing).toBe(true)
    const broken = { ...r.state, selection: { kind: 'module' as const, id: 'infra' } }
    expect(() => transition(broken, { type: 'hover', id: null }, ctxOf(broken))).toThrow(/焦点不变式/)
  })

  it('V3：运行视角下指向任何对象（选中、下钻、跳转、定位）即暂停并钉住；悬停不算', () => {
    const playing = open('sys', tick).state
    expect(run(playing, { type: 'hover', id: 'infra' }).state.playback!.playing).toBe(true)
    const sel = run(playing, { type: 'select', selection: { kind: 'edge', id: 'infra->app:calls' } }).state
    expect(sel.playback!.playing).toBe(false)
    expect(sel.selection).toEqual({ kind: 'edge', id: 'infra->app:calls' })
    for (const a of [{ type: 'goTo', id: 'app' }, { type: 'revealModule', id: 'infra.mus' }, { type: 'revealRelation', id: 'r6' }] as ViewAction[]) {
      expect(run(playing, a).state.playback!.playing).toBe(false)
    }
  })

  it('V3、R6：播放中双击下钻——暂停并钉住被下钻的模块，播放头仍是同一帧', () => {
    const playing = open('sys', tick, tick).state
    const r = run(playing, { type: 'drill', id: 'infra' })
    expect(r.state).toMatchObject({ levelId: 'infra', selection: { kind: 'module', id: 'infra' } })
    expect(r.state.playback).toMatchObject({ playing: false, frameId: frameOf(playing) })
    expect(r.history).toBe('push')
    // 结构视角下钻仍按 N2 清空选中
    expect(run(base, { type: 'drill', id: 'infra' }).state.selection).toBeNull()
  })

  it('V4：取消选中回到跟随但保持暂停；只有播放能恢复播放，恢复时回到跟随', () => {
    const pinned = open('sys', tick, { type: 'select', selection: { kind: 'module', id: 'infra' } }).state
    const unpinned = run(pinned, { type: 'select', selection: null }).state
    expect(unpinned.selection).toBeNull()
    expect(unpinned.playback!.playing).toBe(false)
    const resumed = run(pinned, { type: 'play' }).state
    expect(resumed.selection).toBeNull()
    expect(resumed.playback!.playing).toBe(true)
  })
})

describe('回放', () => {
  it('R12：从头打开自动播放，第一拍走到第一条可见消息；速度可设 0.5 / 1 / 2', () => {
    const r = open('sys')
    expect(r.state.playback).toMatchObject({ frameId: null, playing: true, speed: 1 })
    expect(frameOf(run(r.state, tick).state)).toBe('sc.play#start')
    expect(run(r.state, { type: 'speed', value: 2 }).state.playback!.speed).toBe(2)
  })

  it('R1、R7、R14：单步按本层可见消息前进 / 后退，单步时暂停；到头 / 到尾不动', () => {
    const s = open('sys', tick).state
    const fwd = run(s, { type: 'next' })
    expect(frameOf(fwd.state)).toBe('sc.play#1')
    expect(fwd.state.playback!.playing).toBe(false)
    expect(fwd.history).toBe('replace')
    expect(frameOf(run(fwd.state, { type: 'prev' }).state)).toBe('sc.play#start')
    expect(frameOf(run(s, { type: 'prev' }).state)).toBe('sc.play#start')
  })

  it('F6、F6a：自动播放到 alt 未选分支处暂停；选择后保持暂停，点播放继续', () => {
    let s = open('sys', tick, tick, tick).state
    expect(frameOf(s)).toBe('sc.play#2')
    expect(s.playback!.playing).toBe(false)
    s = run(s, tick).state
    expect(frameOf(s)).toBe('sc.play#2')
    s = run(s, { type: 'chooseBranch', pointId: ALT, option: 0 }).state
    expect(s.playback).toMatchObject({ playing: false, frameId: 'sc.play#2' })
    expect(s.playback!.choices.get(ALT)).toBe(0)
    s = run(s, { type: 'play' }, tick).state
    expect(frameOf(s)).toBe('sc.play#update')
  })

  it('F6a：自动播放到场景末尾时暂停', () => {
    let s = open('sys', tick, tick, tick, { type: 'chooseBranch', pointId: ALT, option: 1 }, { type: 'play' }).state
    for (let i = 0; i < 10; i++) s = run(s, tick).state
    expect(frameOf(s)).toBe('sc.play#done')
    expect(s.playback!.playing).toBe(false)
  })

  it('R14：停在未选分支的分支点时播放无效；在末尾时从头开始', () => {
    const atAlt = open('sys', tick, tick, tick).state
    expect(run(atAlt, { type: 'play' }).state).toBe(atAlt)
    const end = run(atAlt, { type: 'chooseBranch', pointId: ALT, option: 1 }, { type: 'seek', frameId: 'sc.play#done' }).state
    expect(run(end, { type: 'play' }).state.playback).toMatchObject({ frameId: null, playing: true })
  })

  it('F6b：退回分支点之前再前进时沿用已选分支；在分支点改选会丢弃其后的选择', () => {
    let s = open('sys', tick, tick, tick, { type: 'chooseBranch', pointId: ALT, option: 0 }, { type: 'next' }).state
    expect(frameOf(s)).toBe('sc.play#update')
    s = run(s, { type: 'prev' }, { type: 'prev' }, { type: 'next' }, { type: 'next' }).state
    expect(frameOf(s)).toBe('sc.play#update')
    // 改选后播放头不在新路径上：退回开头
    const changed = run(s, { type: 'chooseBranch', pointId: ALT, option: 1 }).state
    expect(changed.playback!.choices.get(ALT)).toBe(1)
    expect(frameOf(changed)).toBeNull()
  })

  it('R13：指向某一步——前进或后退到该步并暂停、焦点跟随；在未选分支上先改选；落在合并消息的第一帧', () => {
    const s = open('sys', tick, tick, tick, { type: 'chooseBranch', pointId: ALT, option: 1 }, { type: 'seek', frameId: 'sc.play#done' }).state
    const pinned = run(s, { type: 'select', selection: { kind: 'module', id: 'infra' } }).state
    const back = run(pinned, { type: 'seek', frameId: 'sc.play#1' })
    expect(back.state).toMatchObject({ selection: null, playback: { frameId: 'sc.play#1', playing: false } })
    expect(back.history).toBe('replace')
    const other = run(s, { type: 'seek', frameId: 'sc.play#update' }).state
    expect(other.playback!.choices.get(ALT)).toBe(0)
    expect(frameOf(other)).toBe('sc.play#update')
    // 根层 infra 内部连续的帧（sc.play#start 之后的 #1）各自是可见消息；下钻到 infra.framework 再指向
    const merged = loadModel(
      scenarioFiles({ 'scenarios/x.yaml': 'scenario: { id: sc.m, name: M, steps: [{ call: { id: a, from: infra.player, to: infra.framework.sm } }, { call: { id: b, from: infra.framework.sm, to: infra.framework.pipeline } }] }' }),
    ).index
    const plan = planScenario(merged, 'sc.m')
    const st: ViewState = { ...base, playback: { scenarioId: 'sc.m', frameId: null, choices: new Map(), playing: false, speed: 1 } }
    const lv = projectLevel(merged, 'sys', { showBoundaries: true, mergeTypes: true, scenarioEnds: stageEnds(plan) })
    const r = transition(st, { type: 'seek', frameId: 'sc.m#b' }, { index: merged, plan, levelView: lv, scenarioView: projectScenario(merged, lv, plan, new Map()) })
    expect(frameOf(r.state)).toBe('sc.m#a')
  })

  it('R6：层次变化后播放头仍是同一帧，单步粒度随层次变化', () => {
    const s = open('sys', tick, tick).state
    const up = run({ ...s, levelId: 'infra' }, { type: 'next' }).state
    expect(frameOf(up)).toBe('sc.play#2')
    expect(frameOf(run({ ...s, levelId: 'infra.framework' }, { type: 'next' }).state)).toBe('sc.play#2')
  })

  it('重新加载：场景已不存在则退出运行视角；播放头不在新路径上则回到开头', () => {
    const s = open('infra', tick, tick).state
    const { index: gone } = loadModel(scenarioFiles({ 'scenarios/play.yaml': '' }))
    expect(transition(s, { type: 'reloaded', previousPath: ['sys', 'infra'] }, { index: gone }).state.playback).toBeNull()
    const kept = run(s, { type: 'reloaded', previousPath: ['sys', 'infra'] }).state
    expect(frameOf(kept)).toBe(frameOf(s))
  })
})

describe('URL', () => {
  it('F6c、R10：场景、步骤、已选分支写进 URL', () => {
    const s = open('infra', tick, tick, tick, tick, { type: 'chooseBranch', pointId: ALT, option: 0 }, { type: 'next' }).state
    const plan = planScenario(index, 'sc.play')
    expect(encodeView(s, index, plan)).toEqual({ level: 'infra', sc: 'sc.play', step: 'sc.play#update', alt: '0' })
    expect(encodeView(base, index)).toEqual({})
  })

  it('R12：带步骤的链接打开时停在该步、不播放；只有场景时从头自动播放；无效值被丢弃', () => {
    const at = run(base, { type: 'restore', query: { level: 'infra', sc: 'sc.play', step: 'sc.play#update', alt: '0' } }).state
    expect(at).toMatchObject({ levelId: 'infra', playback: { scenarioId: 'sc.play', frameId: 'sc.play#update', playing: false } })
    expect(at.playback!.choices.get(ALT)).toBe(0)
    expect(run(base, { type: 'restore', query: { sc: 'sc.play' } }).state.playback).toMatchObject({ frameId: null, playing: true })
    expect(run(base, { type: 'restore', query: { sc: 'sc.play', step: 'sc.play#update' } }).state.playback).toMatchObject({ frameId: null, playing: true })
    expect(run(base, { type: 'restore', query: { sc: 'nope' } }).state.playback).toBeNull()
    // 带选中的链接：钉住，不播放（V2）
    expect(run(base, { type: 'restore', query: { sc: 'sc.play', sel: 'm:infra' } }).state.playback!.playing).toBe(false)
  })

  it('后退到同一场景的另一步：停在该步；后退到结构视角：退出场景', () => {
    const s = open('sys', tick, tick).state
    expect(run(s, { type: 'restore', query: { sc: 'sc.play', step: 'sc.play#start' } }).state.playback).toMatchObject({ frameId: 'sc.play#start', playing: false })
    expect(run(s, { type: 'restore', query: { sc: 'sc.play' } }).state.playback).toMatchObject({ frameId: 'sc.play#1', playing: false })
    expect(run(s, { type: 'restore', query: {} }).state.playback).toBeNull()
  })
})

describe('时钟同步', () => {
  it('播放中按速度到点触发；暂停或播放头变化时重新计时', async () => {
    const pending: { cb: () => void; ms: number; cleared: boolean }[] = []
    const timers: Timers = {
      set: (cb, ms) => {
        const t = { cb, ms, cleared: false }
        pending.push(t)
        return t
      },
      clear: h => ((h as { cleared: boolean }).cleared = true),
    }
    const pb = shallowRef<ViewState['playback']>(null)
    let ticks = 0
    createClockSync(() => pb.value, () => ticks++, timers)
    pb.value = { scenarioId: 's', frameId: null, choices: new Map(), playing: true, speed: 1 }
    await nextTick()
    expect(pending.at(-1)!.ms).toBe(200)
    pending.at(-1)!.cb()
    expect(ticks).toBe(1)
    pb.value = { ...pb.value, frameId: 'f1', speed: 2 }
    await nextTick()
    expect(pending.at(-1)!.ms).toBe(500)
    pb.value = { ...pb.value, speed: 0.5 }
    await nextTick()
    expect(pending.at(-2)!.cleared).toBe(true)
    expect(pending.at(-1)!.ms).toBe(2000)
    pb.value = { ...pb.value, playing: false }
    await nextTick()
    expect(pending.at(-1)!.cleared).toBe(true)
  })
})
