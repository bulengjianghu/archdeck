/**
 * DeskState 的人确认层派生与写入意图（desk.review，Z1、Z3–Z6）：状态、范围、计数由模型层算出；「确认」只发意图，经注入的 ModelWriter 写入。
 */
import { describe, expect, it } from 'vitest'
import { reviewEntries, reviewHash, type ReviewedInput } from '@/model'
import { createDeskState, type ModelWriter } from '../../src/state/useDeskState'
import { sampleFiles } from '../fixtures/sample'

function fakeWriter() {
  const batches: ReviewedInput[][] = []
  const writer: ModelWriter = {
    feedback: async () => ({ ok: false, error: 'x' }),
    allow: async () => ({ ok: false, error: 'x' }),
    ignore: async () => ({ ok: false, error: 'x' }),
    reviewed: async b => (batches.push(b.entries), { ok: true, file: 'model/test/reviewed.yaml' }),
    accept: async () => ({ ok: false, error: 'x' }),
    archive: async () => ({ ok: false, error: 'x' }),
  }
  return { writer, batches }
}

async function open(reviewed?: string, version?: { design: string; revision: string }) {
  const { writer, batches } = fakeWriter()
  const files = sampleFiles(reviewed ? { 'reviewed.yaml': reviewed } : {})
  const desk = createDeskState(async () => ({ dir: 'model/test', files }), { writer, ...(version ? { version } : {}) })
  await desk.init()
  return { desk, batches }
}

describe('desk.review', () => {
  it('没有记录：全部未确认，范围为核心模块与第二级模块，计数为 0 / b · 0', async () => {
    const { desk } = await open()
    expect(desk.review.of('infra').status).toBe('unreviewed')
    expect(desk.review.scope.value.has('infra.framework')).toBe(true)
    expect(desk.review.scope.value.has('infra')).toBe(false)
    expect(desk.review.counts.value).toEqual({ scope: desk.review.scope.value.size, reviewed: 0, stale: 0 })
    expect(desk.review.stale.value.size).toBe(0)
    expect(desk.review.canReview).toBe(true)
  })
  it('有记录：指纹一致为已确认，不一致为需复核并带差异；计数随之', async () => {
    const plain = await open()
    const [ok] = reviewEntries(plain.desk.index.value!, ['infra.framework'], { source: 'manual', at: '2026-10-22' })
    const yaml = `reviewed:\n  - ${JSON.stringify(ok)}\n  - { module: infra.mus, at: '2026-10-22', hash: stale, source: manual, summary: { responsibility: 旧职责 } }\n`
    const { desk } = await open(yaml)
    expect(desk.review.of('infra.framework')).toMatchObject({ status: 'reviewed', entry: { at: '2026-10-22' } })
    const st = desk.review.of('infra.mus')
    expect(st.status).toBe('stale')
    expect(st.diff!.responsibility.some(c => c.kind === 'removed' && c.text === '旧职责')).toBe(true)
    expect(desk.review.stale.value).toEqual(new Set(['infra.mus']))
    expect(desk.review.counts.value).toMatchObject({ reviewed: 1, stale: 1 })
    expect(desk.rework.value!.items.find(i => i.id === 'review:infra.mus')).toBeTruthy()
  })
  it('确认：发出当天、来源 manual、带现在指纹与摘要的记录；可附一句 note；子树各一条', async () => {
    const { desk, batches } = await open()
    const idx = desk.index.value!
    expect(await desk.review.confirm(['infra.framework'], ' 看过 ')).toMatchObject({ ok: true })
    expect(batches).toHaveLength(1)
    expect(batches[0]).toHaveLength(1)
    expect(batches[0][0]).toMatchObject({ module: 'infra.framework', source: 'manual', note: '看过', hash: reviewHash(idx, 'infra.framework') })
    expect(batches[0][0].at).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(batches[0][0].summary.children).toEqual([...(idx.childrenOf.get('infra.framework') ?? [])].sort())
    const sub = ['infra', ...(idx.childrenOf.get('infra') ?? [])]
    expect(await desk.review.confirm(sub)).toMatchObject({ ok: true })
    expect(batches[1].map(e => e.module)).toEqual(sub)
    expect(batches[1].every(e => e.note === undefined)).toBe(true)
    expect(await desk.review.confirm(['nope'])).toMatchObject({ ok: false })
    expect(await desk.review.confirm([])).toMatchObject({ ok: false })
  })
  it('设计版本只显示状态、不提供确认（Z1）', async () => {
    const { desk, batches } = await open(undefined, { design: 'next', revision: 'r2' })
    expect(desk.review.canReview).toBe(false)
    expect(await desk.review.confirm(['infra.framework'])).toMatchObject({ ok: false })
    expect(batches).toHaveLength(0)
  })
})
