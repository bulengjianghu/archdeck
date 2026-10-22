/** 会话规则：视角与选中（V1–V4、V7）、选中突出（R15、R16）、回放（R1、R5、R6、R10、R12、R13、F6、F6b、F6e）、URL（F6c、R10、R12） */
import { describe, expect, it } from 'vitest'
import { buildSequence, loadModel, pairReturns, planScenario, projectLevel, projectScenario, RELATION_TYPES, stageEnds } from '../../src/model'
import {
  DEFAULT_TOGGLES,
  emphasisOf,
  encodeView,
  keyIntent,
  selectedOf,
  perspectiveOf,
  transition,
  type Selection,
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
  const levelView = projectLevel(index, s.levelId, { showBoundaries: true, scenarioEnds: stageEnds(plan) })
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

describe('视角与选中', () => {
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

  it('V2：选中是唯一主语——结构视角无选中为 null；运行视角为显式选中，否则进度所在的步骤或场景', () => {
    expect(selectedOf({ ...base, levelId: 'infra' })).toBeNull()
    expect(selectedOf({ ...base, selection: { kind: 'module', id: 'infra' } })).toEqual({ kind: 'module', id: 'infra' })
    const r = open('sys', next)
    expect(selectedOf(r.state)).toEqual({ kind: 'step', id: 'sc.play#start' })
    const p = run(r.state, { type: 'select', selection: { kind: 'actor', id: 'actor.biz' } })
    expect(selectedOf(p.state)).toEqual({ kind: 'actor', id: 'actor.biz' })
  })

  it('V3：运行视角下指向任何对象（选中、跳转、定位）即选中它，进度不动；悬停不算', () => {
    const s = open('sys', next).state
    expect(run(s, { type: 'hover', id: 'infra' }).state.selection).toBeNull()
    const sel = run(s, { type: 'select', selection: { kind: 'edge', id: 'infra->app:calls' } }).state
    expect(selectedOf(sel)).toEqual({ kind: 'edge', id: 'infra->app:calls' })
    for (const a of [
      { type: 'revealModule', id: 'infra.mus' },
      { type: 'revealRelation', id: 'r6' },
    ] as ViewAction[]) {
      const r = run(s, a).state
      expect(selectedOf(r)!.kind).toBe(a.type === 'revealModule' ? 'module' : 'relation')
      expect(frameOf(r)).toBe(frameOf(s))
    }
  })

  it('V3、R6：回放中双击下钻——选中被下钻的模块，进度仍是同一帧', () => {
    const s = open('sys', next, next).state
    const r = run(s, { type: 'drill', id: 'infra' })
    expect(r.state).toMatchObject({ levelId: 'infra', selection: { kind: 'module', id: 'infra' } })
    expect(frameOf(r.state)).toBe(frameOf(s))
    expect(r.history).toBe('push')
    // 结构视角下钻仍按 N2 清空选中
    expect(run(base, { type: 'drill', id: 'infra' }).state.selection).toBeNull()
  })

  it('V4：取消选中即选中进度所在的步骤（在开头时为场景），进度不动；已是它时 Esc 无动作（N9）', () => {
    const pinned = open('infra', next, { type: 'select', selection: { kind: 'module', id: 'infra.mus' } }).state
    expect(keyIntent(pinned, index, 'Escape')).toEqual({ type: 'select', selection: null })
    const unpinned = run(pinned, { type: 'select', selection: null }).state
    expect(selectedOf(unpinned)).toEqual({ kind: 'step', id: 'sc.play#start' })
    expect(keyIntent(unpinned, index, 'Escape')).toBeNull()
    const atStart = run(open('infra').state, { type: 'select', selection: { kind: 'file', id: 'x.ts' } }, { type: 'select', selection: null }).state
    expect(selectedOf(atStart)).toEqual({ kind: 'scenario', id: 'sc.play' })
  })

  it('N8：运行视角下返回上级同样在父层选中退出来的模块，原来选中的步骤或文件被取消，进度不动', () => {
    const s = open('infra', next, next).state
    const up = run(s, { type: 'goUp' }).state
    expect(up).toMatchObject({ levelId: 'sys', selection: { kind: 'module', id: 'infra' } })
    expect(frameOf(up)).toBe(frameOf(s))
    const file = run(s, { type: 'select', selection: { kind: 'file', id: 'x.ts' } }, { type: 'goUp' }).state
    expect(selectedOf(file)).toEqual({ kind: 'module', id: 'infra' })
  })

  it('V7：单步、指向某一步、回到开头 = 选中那一步并移动进度；进度没动时选中不变', () => {
    const pinned = open('sys', next, { type: 'select', selection: { kind: 'module', id: 'infra' } }).state
    expect(selectedOf(run(pinned, next).state)).toEqual({ kind: 'step', id: 'sc.play#1' })
    expect(selectedOf(run(pinned, prev).state)).toEqual({ kind: 'scenario', id: 'sc.play' })
    expect(selectedOf(run(pinned, { type: 'seek', frameId: 'sc.play#1' }).state)!.kind).toBe('step')
    expect(selectedOf(run(pinned, { type: 'seek', frameId: null }).state)).toEqual({ kind: 'scenario', id: 'sc.play' })
    // 停在未选分支的分支点：下一步无处可去，选中不变
    const atAlt = run(pinned, next, next, { type: 'select', selection: { kind: 'module', id: 'infra' } }).state
    expect(run(atAlt, next).state).toBe(atAlt)
  })
})

describe('回放', () => {
  it('R1、R12：打开场景停在开头（进度为空）、选中场景，状态里没有播放与速度', () => {
    const r = open('sys')
    expect(r.state.playback).toEqual({ scenarioId: 'sc.play', frameId: null, choices: new Map() })
    expect(selectedOf(r.state)).toEqual({ kind: 'scenario', id: 'sc.play' })
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

  /** 选中突出的上下文：当前层次的舞台视图、回放路径的本层投影、时序模型、配对 */
  function emCtx(s: ViewState, fileOwners: string[] = []) {
    const c = ctxOf(s)
    if (!c.plan) return { index, levelView: null, scenarioView: null, sequence: null, pairs: null, fileOwners }
    const sequence = buildSequence(index, c.levelView!, c.plan, s.playback!.choices, c.scenarioView!)
    return { index, levelView: c.levelView!, scenarioView: c.scenarioView!, sequence, pairs: pairReturns(c.plan), fileOwners }
  }
  const lanes = (s: ViewState, sel: Selection, owners: string[] = []) => [...emphasisOf({ ...s, selection: sel }, emCtx(s, owners))!.lanes].sort()

  it('R15：选中步骤——只有它所在的消息为选中，配对的调用 / 返回只作配对；不突出泳道', () => {
    const plan = planScenario(index, 'sc.play')
    const pairs = pairReturns(plan)
    const start = open('sys', { type: 'chooseBranch', pointId: ALT, option: 1 }).state
    const v0 = ctxOf(start).scenarioView!
    const callIdx = v0.messages.findIndex(m => m.frameIds.some(f => plan.frames.get(f)!.kind === 'call' && pairs.has(f)))
    expect(callIdx).toBeGreaterThanOrEqual(0)
    const s = run(start, { type: 'seek', frameId: v0.messages[callIdx].frameIds[0] }).state
    expect(selectedOf(s)).toEqual({ kind: 'step', id: frameOf(s) })
    const v = ctxOf(s).scenarioView!
    const em = emphasisOf(s, emCtx(s))!
    const call = v.messageOf.get(frameOf(s)!)!
    const paired = v.messages[call].frameIds.map(f => pairs.get(f)).find(Boolean)!
    expect(em.selected).toBe(call)
    expect([...em.paired]).toEqual([v.messageOf.get(paired)!])
    expect(em.lanes.size).toBe(0)
  })

  it('R15：选中场景或结构视角不突出；选中其他对象时不突出消息，只突出泳道', () => {
    expect(emphasisOf(base, emCtx(base))).toBeNull()
    const start = open('sys').state
    expect(selectedOf(start)).toEqual({ kind: 'scenario', id: 'sc.play' })
    expect(emphasisOf(start, emCtx(start))).toEqual({ selected: null, paired: new Set(), lanes: new Set() })
    const s = open('infra', next, next).state
    const em = emphasisOf({ ...s, selection: { kind: 'module', id: 'infra.mus' } }, emCtx(s))!
    expect(em.selected).toBeNull()
    expect(em.paired.size).toBe(0)
    // 模块：自身的泳道；本层不是独立泳道时取包含它的泳道；是当前层次本身或其祖先时不突出
    expect(lanes(s, { kind: 'module', id: 'infra.mus' })).toEqual(['infra.mus'])
    expect(lanes(s, { kind: 'module', id: 'infra.framework.sm' })).toEqual(['infra.framework'])
    expect(lanes(s, { kind: 'module', id: 'app.solution' })).toEqual(['boundary:app'])
    expect(lanes(s, { kind: 'module', id: 'infra' })).toEqual([])
    expect(lanes(s, { kind: 'module', id: 'sys' })).toEqual([])
    // 参与者、关系（两端）、视图边（两端）、文件（归属模块）
    expect(lanes(s, { kind: 'actor', id: 'actor.biz' })).toEqual(['actor.biz'])
    expect(lanes(s, { kind: 'relation', id: 'r1' })).toEqual(['boundary:app', 'infra.framework'])
    expect(lanes(s, { kind: 'edge', id: 'infra.player->infra.framework:calls' })).toEqual(['infra.framework', 'infra.player'])
    expect(lanes(s, { kind: 'file', id: 'x.ts' }, ['infra.mus'])).toEqual(['infra.mus'])
  })

  it('R16：选中的模块在本层包含多条泳道时全部突出；文件归属多个模块取并集；选中步骤本层不可见时不突出', () => {
    const s = open('sys', next).state
    // 分层总览：层 infra 含核心模块泳道与「infra · 其他」
    expect(lanes(s, { kind: 'module', id: 'infra' })).toEqual(['infra', 'infra.framework', 'infra.player'])
    expect(lanes(s, { kind: 'module', id: 'infra.mus' })).toEqual(['infra'])
    expect(lanes(s, { kind: 'file', id: 'x.ts' }, ['infra.mus', 'domain.services'])).toEqual(['domain.services', 'infra'])
    // 选中的步骤在本层不可见：不突出
    const hidden = { ...s, playback: { ...s.playback!, frameId: 'nope' } }
    expect(emphasisOf(hidden, emCtx(hidden))).toEqual({ selected: null, paired: new Set(), lanes: new Set() })
  })

  it('R13：指向某一步——选中它，进度前进或后退到该步；在未选分支上先改选；落在合并消息的第一帧', () => {
    const s = open('sys', next, next, next, { type: 'chooseBranch', pointId: ALT, option: 1 }, { type: 'seek', frameId: 'sc.play#done' }).state
    const pinned = run(s, { type: 'select', selection: { kind: 'module', id: 'infra' } }).state
    const back = run(pinned, { type: 'seek', frameId: 'sc.play#1' })
    expect(back.state).toMatchObject({ selection: null, playback: { frameId: 'sc.play#1' } })
    expect(back.history).toBe('replace')
    const other = run(s, { type: 'seek', frameId: 'sc.play#update' }).state
    expect(other.playback!.choices.get(ALT)).toBe(0)
    expect(frameOf(other)).toBe('sc.play#update')
    const merged = loadModel(
      scenarioFiles({
        'scenarios/x.yaml':
          'scenario: { id: sc.m, name: M, steps: [{ call: { id: a, from: infra.framework.sm, to: infra.framework.pipeline } }, { call: { id: b, from: infra.framework.pipeline, to: infra.framework.sm } }] }',
      }),
    ).index
    const plan = planScenario(merged, 'sc.m')
    const st: ViewState = { ...base, playback: { scenarioId: 'sc.m', frameId: null, choices: new Map() } }
    const lv = projectLevel(merged, 'sys', { showBoundaries: true, scenarioEnds: stageEnds(plan) })
    const r = transition(
      st,
      { type: 'seek', frameId: 'sc.m#b' },
      { index: merged, plan, levelView: lv, scenarioView: projectScenario(merged, lv, plan, new Map()) },
    )
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

  it('R12：带有效步骤的链接停在该步；只有场景（或步骤无效）时停在开头；无效场景被丢弃；带选中时选中该对象、step 为进度', () => {
    const at = run(base, { type: 'restore', query: { level: 'infra', sc: 'sc.play', step: 'sc.play#update', alt: '0' } }).state
    expect(at).toMatchObject({ levelId: 'infra', playback: { scenarioId: 'sc.play', frameId: 'sc.play#update' } })
    expect(at.playback!.choices.get(ALT)).toBe(0)
    expect(run(base, { type: 'restore', query: { sc: 'sc.play' } }).state.playback).toMatchObject({ frameId: null })
    expect(run(base, { type: 'restore', query: { sc: 'sc.play', step: 'sc.play#update' } }).state.playback).toMatchObject({ frameId: null })
    expect(run(base, { type: 'restore', query: { sc: 'nope' } }).state.playback).toBeNull()
    expect(selectedOf(run(base, { type: 'restore', query: { sc: 'sc.play', sel: 'm:infra' } }).state)).toEqual({ kind: 'module', id: 'infra' })
    // 旧链接（sel + step）按新语义：选中 sel 的对象，step 是进度
    const old = run(base, { type: 'restore', query: { level: 'infra', sc: 'sc.play', step: 'sc.play#update', alt: '0', sel: 'm:infra.mus' } }).state
    expect(selectedOf(old)).toEqual({ kind: 'module', id: 'infra.mus' })
    expect(frameOf(old)).toBe('sc.play#update')
  })

  it('V2、V7：URL——选中步骤时只有 step；选中场景时既无 sel 也无 step；选中其他对象时 sel 与表示进度的 step 并存', () => {
    const scene = open('infra').state
    expect(encodeView(scene, index)).toEqual({ level: 'infra', sc: 'sc.play' })
    const step = run(scene, next).state
    expect(encodeView(step, index)).toEqual({ level: 'infra', sc: 'sc.play', step: 'sc.play#start' })
    const mod = run(step, { type: 'select', selection: { kind: 'module', id: 'infra.mus' } }).state
    expect(encodeView(mod, index)).toEqual({ level: 'infra', sc: 'sc.play', step: 'sc.play#start', sel: 'm:infra.mus' })
  })

  it('后退到同一场景的另一步：停在该步；没带步骤时保留原播放头；后退到结构视角：退出场景', () => {
    const s = open('sys', next, next).state
    expect(run(s, { type: 'restore', query: { sc: 'sc.play', step: 'sc.play#start' } }).state.playback).toMatchObject({ frameId: 'sc.play#start' })
    expect(run(s, { type: 'restore', query: { sc: 'sc.play' } }).state.playback).toMatchObject({ frameId: 'sc.play#1' })
    expect(run(s, { type: 'restore', query: {} }).state.playback).toBeNull()
  })
})
