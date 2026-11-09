/**
 * 设计状态迁移（DL-32）、锁定判定（DL-34）、认可指纹比对（DL-35）：07 §3.1 迁移表每一行一测。
 */
import { describe, expect, it } from 'vitest'
import {
  DESIGN_ACTIONS,
  DRIFT_REASON,
  LOCKED_ACCEPTED,
  approvalDrift,
  designTransition,
  driftText,
  editLock,
  type DesignStatus,
} from '../../src/model'

const intact = approvalDrift({ at: '2026-11-05', sketches: { 'sketches/a.yaml': 'h1' } }, { 'sketches/a.yaml': 'h1' })

describe('DL-32 迁移表：起草中', () => {
  it('认可 → 已认可（已保存、无格式错误、无未解决的提示）', () => {
    expect(designTransition('draft', 'accept', { saved: true, errors: 0, hints: 0 })).toEqual({ ok: true, to: 'accepted' })
  })
  it('认可的条件依次判：未保存 → 格式错误 → 未解决的提示，原因写第一条', () => {
    expect(designTransition('draft', 'accept', { saved: false, errors: 2, hints: 1 })).toMatchObject({ ok: false, reason: expect.stringContaining('未保存') })
    expect(designTransition('draft', 'accept', { saved: true, errors: 2, firstError: 'ID 重复' })).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/2 个格式错误.*ID 重复/),
    })
    expect(designTransition('draft', 'accept', { saved: true, hints: 1, firstHint: '成环' })).toMatchObject({ ok: false, reason: expect.stringMatching(/1 个未解决的提示.*成环/) })
  })
  it('放弃 → 已放弃', () => expect(designTransition('draft', 'abandon')).toEqual({ ok: true, to: 'abandoned' }))
  it('回到起草、归档拒绝并说明', () => {
    expect(designTransition('draft', 'withdraw')).toMatchObject({ ok: false, reason: expect.stringContaining('还没认可') })
    expect(designTransition('draft', 'archive', { consistent: true, ratchet: true, drift: intact })).toMatchObject({ ok: false, reason: expect.stringContaining('先「认可」') })
  })
  it('「评审中」不再产生：没有动作去向是它；旧设计按起草中迁移', () => {
    for (const from of ['draft', 'accepted', 'reviewing'] as DesignStatus[])
      for (const a of DESIGN_ACTIONS) {
        const r = designTransition(from, a, { consistent: true, ratchet: true, drift: intact })
        if (r.ok) expect(r.to).not.toBe('reviewing')
      }
    expect(designTransition('reviewing', 'accept')).toEqual({ ok: true, to: 'accepted' })
    expect(designTransition('reviewing', 'abandon')).toEqual({ ok: true, to: 'abandoned' })
  })
})

describe('DL-32 迁移表：已认可', () => {
  it('回到起草 → 起草中', () => expect(designTransition('accepted', 'withdraw')).toEqual({ ok: true, to: 'draft' }))
  it('放弃 → 已放弃', () => expect(designTransition('accepted', 'abandon')).toEqual({ ok: true, to: 'abandoned' }))
  it('再认可拒绝', () => expect(designTransition('accepted', 'accept')).toMatchObject({ ok: false, reason: expect.stringContaining('已经认可') }))
  it('归档 → 已实现（三关全绿）', () => expect(designTransition('accepted', 'archive', { consistent: true, ratchet: true, drift: intact })).toEqual({ ok: true, to: 'implemented' }))
  it('归档三关各缺一关被拒', () => {
    expect(designTransition('accepted', 'archive', { consistent: false, ratchet: true, drift: intact })).toMatchObject({ ok: false, reason: expect.stringContaining('核验不一致') })
    expect(designTransition('accepted', 'archive', { consistent: true, ratchet: false, drift: intact })).toMatchObject({ ok: false, reason: expect.stringContaining('棘轮') })
    const drifted = approvalDrift({ sketches: { 'sketches/a.yaml': 'h1' } }, { 'sketches/a.yaml': 'h2' })
    expect(designTransition('accepted', 'archive', { consistent: true, ratchet: true, drift: drifted })).toEqual({ ok: false, reason: DRIFT_REASON })
  })
})

describe('DL-32 迁移表：已实现、已放弃只看', () => {
  it.each(['implemented', 'abandoned'] as DesignStatus[])('%s：一切动作拒绝', from => {
    for (const a of DESIGN_ACTIONS) expect(designTransition(from, a, { consistent: true, ratchet: true, drift: intact })).toMatchObject({ ok: false, reason: expect.stringContaining('只看') })
  })
})

describe('DL-34 锁定判定', () => {
  it('已认可锁定并提示「回到起草」；已实现 / 已放弃只看；起草中与评审中不锁', () => {
    expect(editLock('accepted')).toBe(LOCKED_ACCEPTED)
    expect(LOCKED_ACCEPTED).toContain('回到起草')
    expect(editLock('implemented')).toContain('只看')
    expect(editLock('abandoned')).toContain('只看')
    expect(editLock('draft')).toBeNull()
    expect(editLock('reviewing')).toBeNull()
    expect(editLock(undefined)).toBeNull()
  })
})

describe('DL-35 认可指纹比对', () => {
  it('逐张一致即一致', () => expect(intact).toMatchObject({ intact: true, missing: false }))
  it('认可后手改草图文件：指纹不符，列出改了的', () => {
    const d = approvalDrift({ at: '2026-11-05', sketches: { 'sketches/a.yaml': 'h1', 'sketches/b.yaml': 'h2' } }, { 'sketches/a.yaml': 'hX', 'sketches/b.yaml': 'h2' })
    expect(d).toMatchObject({ intact: false, changed: ['sketches/a.yaml'], added: [], removed: [] })
    expect(driftText(d)).toContain('草图自认可后已改动')
  })
  it('新加的、删掉的草图分列', () => {
    const d = approvalDrift({ sketches: { 'sketches/a.yaml': 'h1' } }, { 'sketches/b.yaml': 'h2' })
    expect(d).toMatchObject({ intact: false, added: ['sketches/b.yaml'], removed: ['sketches/a.yaml'] })
  })
  it('没有认可记录或已撤回：不一致，原因「没有认可记录」', () => {
    expect(approvalDrift(undefined, {})).toMatchObject({ intact: false, missing: true })
    const w = approvalDrift({ at: '2026-11-05', withdrawnAt: '2026-11-06' }, {})
    expect(w.missing).toBe(true)
    expect(driftText(w)).toBe('没有认可记录')
  })
})
