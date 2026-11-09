/**
 * 视图状态层的演化事实（J1、J5、J7）：历史同步、desk.evolution 派生、开关与本层投影、耦合线的选中与画布场景。
 */
import { describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createDeskState, decodeSelection, encodeSelection, type SourceFetcher } from '../../src/state/useDeskState'
import { createSourceSync } from '../../src/state/sync/source'
import { layoutView } from '../../src/layout/layout'
import { canvasScene } from '../../src/layout/canvas'
import type { FactsPayload, FileDep, HistoryCommit, SourceHistory, SourcePayload } from '../../src/model'
import { scenarioFiles } from '../fixtures/sample'

const flush = () => new Promise(r => setTimeout(r, 0))

const REFS = `
modules:
  - { id: app.solution.core, parent: app.solution, name: Core, responsibility: x, codeRefs: [src/app/**] }
  - { id: domain.models.core, parent: domain.models, name: Core, responsibility: x, codeRefs: [src/domain/**] }
  - { id: infra.framework.extra, parent: infra.framework, name: Extra, responsibility: x, codeRefs: [src/framework/**] }
`
const S = 'src/app/s.ts'
const M = 'src/domain/m.ts'
const E = 'src/framework/extra.ts'
const LOCAL: SourcePayload = { status: 'local', root: '/repo', files: [S, M, E], packages: {}, lines: { [S]: 100, [M]: 25, [E]: 400 } }
const dep = (from: string, to: string): FileDep => ({ from, to, via: to, kind: 'value', line: 1 })
const facts: FactsPayload = { deps: { deps: [dep(S, E), dep(M, E)], external: {}, parsed: 3 }, baseline: null, ledger: [] }
const c = (n: number, fix: boolean, ...paths: string[]): HistoryCommit => ({
  hash: `h${String(n).padStart(2, '0')}`.padEnd(8, '0'),
  short: `h${n}`,
  date: `2026-10-${String(n).padStart(2, '0')}`,
  subject: fix ? `fix: ${n}` : `feat: ${n}`,
  fix,
  files: paths.map(path => ({ path, added: 1, deleted: 0 })),
})
// app.solution.core 与 infra.framework.extra 一起改 5 次（有依赖 S → E）；domain 只改 2 次（其中 1 次缺陷）
const HISTORY: SourceHistory = {
  status: 'ok',
  head: 'abc',
  days: 180,
  since: '2026-04-25T00:00:00Z',
  commits: [c(7, true, M), c(6, false, M, S), c(5, true, S, E), c(4, false, S, E), c(3, false, S, E), c(2, true, S, E), c(1, false, S, E)],
}
const fetcher = (history: SourceHistory | null = HISTORY, withHistory = true): SourceFetcher => ({
  tree: async () => LOCAL,
  file: async () => null,
  exports: async () => [],
  facts: async () => facts,
  ...(withHistory ? { history: async () => history } : {}),
  commit: async hash => (hash === 'h0500000' ? { hash, message: 'fix: 5\n\n详细说明' } : null),
})

async function setup(url = '/', source: SourceFetcher = fetcher(), version?: { design: string; revision: string }) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { render: () => null } }] })
  await router.push(url)
  const desk = createDeskState(async () => ({ dir: 'model/test', files: [...scenarioFiles(), { path: 'modules/zz-refs.yaml', text: REFS }] }), {
    source,
    version,
  })
  desk.attachRouter(router)
  await desk.init()
  await flush()
  await nextTick()
  return { desk, router }
}

describe('J1 历史同步', () => {
  it('清单取到后随事实一起取历史；读不到时为 error 并带原因；设计版本为 design；未注入为 error', async () => {
    const { desk } = await setup()
    expect(desk.evolution.status.value).toBe('ready')
    expect(desk.evolution.stats.value!.commits).toBe(7)
    expect(desk.evolution.stats.value!.fixes).toBe(3)
    const nogit = await setup('/', fetcher({ status: 'error', reason: '不是 git 仓库' }))
    expect(nogit.desk.evolution.status.value).toBe('error')
    expect(nogit.desk.evolution.error.value).toBe('不是 git 仓库')
    const design = await setup('/', fetcher(), { design: 'd', revision: 'r1' })
    expect(design.desk.evolution.status.value).toBe('design')
    expect(design.desk.evolution.stats.value).toBeNull()
    const none = await setup('/', fetcher(HISTORY, false))
    expect(none.desk.evolution.status.value).toBe('error')
  })

  it('取历史失败为 error，带原因；提交说明按需取并缓存', async () => {
    const sync = createSourceSync({ ...fetcher(), history: async () => Promise.reject(new Error('boom')) })
    await sync.refresh()
    expect(sync.history.value).toEqual({ status: 'error', message: 'boom' })
    expect(sync.facts.value?.status).toBe('ok')
    const ok = createSourceSync(fetcher())
    await ok.refresh()
    const r = ok.commit('h0500000')
    await flush()
    expect(r.value).toEqual({ status: 'ok', value: { hash: 'h0500000', message: 'fix: 5\n\n详细说明' } })
    expect(ok.commit('h0500000')).toBe(r)
    const missing = ok.commit('nope')
    await flush()
    expect(missing.value).toEqual({ status: 'missing' })
  })
})

describe('J5 本层投影只在结构视角、热度或耦合开启时', () => {
  it('缺省全关为 null；开热度得到角标、开耦合得到耦合线；运行视角下为 null', async () => {
    const { desk } = await setup('/?level=infra.framework')
    expect(desk.toggles.heat).toBe('off')
    expect(desk.toggles.coupling).toBe(false)
    expect(desk.evolution.level.value).toBeNull()
    desk.setToggles({ heat: 'fixes' })
    const lv = desk.evolution.level.value!
    expect(lv.kind).toBe('fixes')
    expect(lv.heat.get('infra.framework.extra')).toEqual({ tier: 3, value: 2 * Math.sqrt(400), count: 2 })
    expect(lv.couplings).toEqual([])
    desk.setToggles({ heat: 'off', coupling: true })
    const lc = desk.evolution.level.value!
    expect(lc.heat.size).toBe(0)
    expect(lc.couplings.map(l => `${l.from}~${l.to}:${l.shared}:${l.isolated}`)).toEqual(['boundary:app~infra.framework.extra:5:false'])
    expect(lc.couplings[0].primary).toBe('app~infra.framework.extra')
    desk.openScenario('sc.play')
    expect(desk.evolution.level.value).toBeNull()
  })

  it('模块统计、耦合对端、热度前 N、无依赖的耦合对', async () => {
    const { desk } = await setup()
    const e = desk.evolution
    expect(e.moduleOf('app.solution.core')).toMatchObject({ changes: 6, fixes: 2, lines: 100 })
    expect(e.moduleOf('app')).toMatchObject({ changes: 6 })
    // 只列最具体的对（祖先对是同一现象的并集）
    expect(e.couplingsFor('app.solution.core').map(x => x.id)).toEqual(['app.solution.core~infra.framework.extra'])
    expect(e.stats.value!.couplings.map(x => x.id)).toContain('app.solution.core~infra')
    expect(e.between('infra.framework.extra', 'app.solution.core')).toMatchObject({ shared: 5, dependency: true })
    expect(e.hotspotsOf('changes').map(m => m.id)).toEqual(['infra.framework.extra', 'app.solution.core', 'domain.models.core'])
    expect(e.hotspotsOf('fixes', 1).map(m => m.id)).toEqual(['infra.framework.extra'])
    // 全部耦合对两端都有依赖（S → E、M → E 提升到祖先），没有无依赖的
    expect(e.isolated.value).toEqual([])
    expect(e.commitOf('h0500000')?.subject).toBe('fix: 5')
    expect(desk.rework.value!.byCategory.coupling).toBe(0)
  })
})

describe('J7 耦合线的选中', () => {
  it('sel=c:<A>~<B> 往返编码；从 URL 恢复并给出耦合与本层的耦合线；两端不存在的丢弃', async () => {
    expect(encodeSelection({ kind: 'couple', id: 'a~b' })).toBe('c:a~b')
    expect(decodeSelection('c:a~b')).toEqual({ kind: 'couple', id: 'a~b' })
    const { desk } = await setup('/?level=infra.framework&sel=c:app.solution.core~infra.framework.extra')
    desk.setToggles({ coupling: true })
    const sel = desk.evolution.selectedCouple.value!
    expect(sel.a).toBe('app.solution.core')
    expect(sel.coupling).toMatchObject({ shared: 5 })
    expect(sel.line?.id).toBe('couple:boundary:app~infra.framework.extra')
    desk.goTo('domain')
    expect(desk.evolution.selectedCouple.value).toBeNull()
    const ghost = await setup('/?sel=c:app~ghost')
    expect(ghost.desk.selection.value).toBeNull()
  })

  it('画布场景：角标、耦合线（×N、可选中）；开关关闭时没有', async () => {
    const { desk } = await setup('/?level=infra.framework&sel=c:app.solution.core~infra.framework.extra')
    desk.setToggles({ heat: 'changes', coupling: true })
    const positioned = await layoutView(desk.view.value!)
    const base = {
      positioned,
      index: desk.index.value,
      selection: desk.selection.value,
      hover: null,
      stage: null,
      scenarioView: null,
      emphasis: null,
      participants: new Map(),
      mode: 'hide' as const,
      reveal: [],
      diff: null,
      fileHits: null,
      branchPointId: null,
    }
    const s = canvasScene({ ...base, evolution: desk.evolution.level.value })
    expect(s.nodes.find(n => n.id === 'infra.framework.extra')!.data.heat).toEqual({ tier: 3, kind: 'changes', value: 5 * Math.sqrt(400), count: 5 })
    const line = s.edges.find(e => e.data.temp === 'couple')!
    expect(line.source).toBe('boundary:app')
    expect(line.target).toBe('infra.framework.extra')
    expect(line.data.label).toBe('×5')
    expect(line.data.selected).toBe(true)
    expect(line.data.couple?.isolated).toBe(false)
    expect(line.data.jumps).toBeUndefined()
    expect(canvasScene({ ...base, evolution: null }).edges.some(e => e.data.temp === 'couple')).toBe(false)
    // F7（L44）：按需显示——不选中、不聚焦时不画，画布角计数；悬停一端时画出
    const rest = canvasScene({ ...base, selection: null, evolution: desk.evolution.level.value })
    expect(rest.edges.some(e => e.data.temp === 'couple')).toBe(false)
    expect(rest.pending?.couples).toBeGreaterThan(0)
    const hovered = canvasScene({ ...base, selection: null, hover: 'infra.framework.extra', evolution: desk.evolution.level.value })
    expect(hovered.edges.some(e => e.data.temp === 'couple')).toBe(true)
  })
})
