/**
 * 归档三关与估与实际（第二十一轮波 4 T4.1，DL-46–DL-49，TK-5、TK-6）：三关各缺一关归档被拒、三关全绿通过；估与实际的差集；任务单次序。
 */
import { describe, expect, it } from 'vitest'
import {
  approvalDrift,
  archiveGates,
  changedModules,
  designTransition,
  estimateGap,
  gapLine,
  gateContext,
  needsRatchet,
  TASK_ORDER,
  type SketchCheck,
} from '../../src/model'

const check = (over: Partial<SketchCheck> = {}): SketchCheck => ({
  sketch: 'd',
  mount: 'app',
  design: 'd',
  lifetime: 'until-implemented',
  deviations: [],
  counts: { error: 0, warning: 0, info: 0 },
  consistent: true,
  ...over,
})
const bad = check({
  consistent: false,
  counts: { error: 1, warning: 0, info: 0 },
  deviations: [{ key: 'k', code: 'sketch.missing-module', severity: 'error', rules: ['X4'], message: '缺模块 app.x', target: {} }],
})
const approval = { at: '2026-11-06', sketches: { 'sketches/app.yaml': 'h1' } }
const intact = approvalDrift(approval, { 'sketches/app.yaml': 'h1' })
const drifted = approvalDrift(approval, { 'sketches/app.yaml': 'h2' })
const archive = (g: ReturnType<typeof archiveGates>, drift = intact) => designTransition('accepted', 'archive', gateContext(g, drift))

describe('DL-47 归档三关', () => {
  it('三关全绿：ok、三行都过，迁移表放行到「已实现」', () => {
    const g = archiveGates({ checks: [check()], gateErrors: [], drift: intact })
    expect(g.ok).toBe(true)
    expect(g.first).toBeNull()
    expect(g.gates.map(x => [x.key, x.ok])).toEqual([
      ['consistent', true],
      ['ratchet', true],
      ['drift', true],
    ])
    expect(archive(g)).toEqual({ ok: true, to: 'implemented' })
  })
  it('缺第一关（核验不一致）：拒绝，说明带偏差', () => {
    const g = archiveGates({ checks: [bad], gateErrors: [], drift: intact })
    expect(g.first?.key).toBe('consistent')
    expect(g.first?.detail).toContain('缺模块 app.x')
    expect(archive(g)).toMatchObject({ ok: false, reason: expect.stringContaining('核验不一致') })
    // 没有草图也算没过
    expect(archiveGates({ checks: [], gateErrors: [], drift: intact }).first?.key).toBe('consistent')
  })
  it('缺第二关（棘轮有新增，或代码事实不可得）：拒绝', () => {
    const g = archiveGates({ checks: [check()], gateErrors: [{ message: '新增违规 a → b' }], drift: intact })
    expect(g.first).toMatchObject({ key: 'ratchet', detail: '规则有 1 条新违反：新增违规 a → b' })
    expect(archive(g)).toMatchObject({ ok: false, reason: expect.stringContaining('棘轮') })
    const unknown = archiveGates({ checks: [check()], gateErrors: null, ratchetUnknown: '找不到源码', drift: intact })
    expect(unknown.first).toMatchObject({ key: 'ratchet', ok: false, detail: '找不到源码' })
  })
  it('缺第三关（草图自认可后已改动）：拒绝，提示「草图自认可后已改动」', () => {
    const g = archiveGates({ checks: [check()], gateErrors: [], drift: drifted })
    expect(g.first?.key).toBe('drift')
    expect(g.first?.detail).toContain('草图自认可后已改动')
    expect(archive(g, drifted)).toMatchObject({ ok: false, reason: expect.stringContaining('草图自认可后已改动') })
    // 没有认可记录（旧流程认可的设计）也不过
    const none = approvalDrift(undefined, { 'sketches/app.yaml': 'h1' })
    expect(archiveGates({ checks: [check()], gateErrors: [], drift: none }).first?.detail).toBe('没有认可记录')
  })
})

describe('DL-47 棘轮按需算', () => {
  it('另两关没过时不算棘轮（暂不判），第一道没过的关取判过的那一关', () => {
    expect(needsRatchet([check()], intact)).toBe(true)
    expect(needsRatchet([bad], intact)).toBe(false)
    expect(needsRatchet([check()], drifted)).toBe(false)
    const g = archiveGates({ checks: [check()], drift: drifted })
    expect(g.gates[1]).toMatchObject({ key: 'ratchet', ok: false, skipped: true })
    expect(g.first?.key).toBe('drift')
    expect(designTransition('accepted', 'archive', gateContext(g, drifted))).toMatchObject({ ok: false, reason: expect.stringContaining('棘轮') })
  })
})

describe('DL-49 估与实际', () => {
  const before = { a: '1', b: '1', c: '1', d: '1' }
  const after = { a: '1', b: '2', d: '1', e: '1' }
  it('改了、删了、新加按描述指纹算', () => {
    expect(changedModules(before, after)).toEqual({ changed: ['b'], removed: ['c'], added: ['e'] })
  })
  it('差集：估了没改、改了没估，新加的单列；估 N · 实际 N′', () => {
    const g = estimateGap({ at: '2026-11-06', modules: ['a', 'b'], fresh: false, current: before }, after)
    expect(g).toMatchObject({ recorded: true, estimated: 2, actual: 3, touched: ['b', 'c'], added: ['e'], spared: ['a'], missed: ['c'] })
    expect(gapLine(g)).toBe('认可时估牵动 2 · 实际改了 3（其中新加 1）')
  })
  it('全是新框：估写「新」不给数；没有估算记录时注明无从比对', () => {
    const g = estimateGap({ modules: [], fresh: true, current: before }, after)
    expect(g.estimated).toBeNull()
    expect(gapLine(g)).toBe('认可时估牵动 新 · 实际改了 3（其中新加 1）')
    const none = estimateGap(undefined, after)
    expect(none.recorded).toBe(false)
    expect(gapLine(none)).toBe('认可时没有记下估算，无从比对')
  })
})

describe('DL-46 任务单次序', () => {
  it('待做 → 不核验 → ✓', () => {
    const states = ['done', 'todo', 'unchecked', 'todo'] as const
    expect([...states].sort((a, b) => TASK_ORDER[a] - TASK_ORDER[b])).toEqual(['todo', 'todo', 'unchecked', 'done'])
  })
})
