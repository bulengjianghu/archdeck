/**
 * 演化事实（J2–J4、J6–J8）：用架构治理的 fixture（两层四模块、源码清单与文件依赖）加上造的提交，逐条验证次数、去重、热度、分档、耦合阈值与标注。
 */
import { describe, expect, it } from 'vitest'
import {
  assignFiles,
  coupleEnds,
  coupleId,
  couplingBetween,
  couplingsOf,
  evolutionStats,
  heatOf,
  heatTiers,
  hotspots,
  isolatedCouplings,
  levelEvolution,
  loadModel,
  projectLevel,
  reworkList,
  type HistoryCommit,
  type OkHistory,
} from '@/model'
import { CODE, SRC, files, setup } from '../governance/helpers'

const c = (n: number, fix: boolean, ...paths: string[]): HistoryCommit => ({
  hash: `h${String(n).padStart(2, '0')}`.padEnd(8, '0'),
  short: `h${String(n).padStart(2, '0')}`,
  date: `2026-10-${String(n).padStart(2, '0')}`,
  subject: fix ? `fix: ${n}` : `feat: ${n}`,
  fix,
  files: paths.map(path => ({ path, added: 1, deleted: 0 })),
})
const A = 'src/ui/view/a.ts'
const S = 'src/ui/store/s.ts'
const I = 'src/core/impl/i.ts'
const U = 'src/core/util/u.ts'
const API = 'src/core/api/client.ts'
const IDX = 'src/core/api/index.ts'
const X = 'src/tests/x.ts'
/** 新的在前 */
const COMMITS: HistoryCommit[] = [
  c(11, false, API, U),
  c(10, false, API, U),
  c(9, false, API, U),
  c(8, true, API, U),
  c(7, false, API, U, IDX),
  c(6, true, A, I, U),
  c(5, false, A, I, X),
  c(4, false, A, I),
  c(3, true, A, I),
  c(2, false, A, I),
  c(1, true, A, S),
]
const HISTORY: OkHistory = { status: 'ok', head: 'abc', days: 180, since: '2026-04-25T00:00:00Z', commits: COMMITS }
const LINES = { [A]: 100, [S]: 25, [I]: 400, [API]: 50, [IDX]: 10 }

function stats(report = setup().report) {
  const { index, own } = setup()
  return { index, own, stats: evolutionStats(index, own, HISTORY, LINES, report) }
}

describe('J2 文件统计按归属提升到模块', () => {
  it('一次提交对一个模块只计一次；未归属文件不计；上级为子树并集；没有触及的模块次数为 0', () => {
    const { stats: s } = stats()
    expect(s.commits).toBe(11)
    expect(s.fixes).toBe(4)
    const m = (id: string) => s.modules.get(id)!
    expect(m('ui.view')).toMatchObject({ changes: 6, fixes: 3, direct: true })
    expect(m('core.impl')).toMatchObject({ changes: 5, fixes: 2 })
    // c7 同时改了 core.api 的两个文件，只计一次
    expect(m('core.api')).toMatchObject({ changes: 5, fixes: 1 })
    expect(m('core.util')).toMatchObject({ changes: 6, fixes: 2 })
    expect(m('ui.store')).toMatchObject({ changes: 1, fixes: 1 })
    expect(m('core.future')).toMatchObject({ changes: 0, fixes: 0, heat: 0, direct: false })
    // 上级：ui 的提交 = view ∪ store（c1 同时触及两者，去重）；core = impl ∪ api ∪ util
    expect(m('ui')).toMatchObject({ changes: 6, fixes: 3, direct: false })
    expect(m('core')).toMatchObject({ changes: 10, fixes: 3 })
    expect(m('ui.view').commits).toEqual(['h0600000', 'h0500000', 'h0400000', 'h0300000', 'h0200000', 'h0100000'])
  })

  it('已忽略与归属冲突的文件不计（与 K4 同口径）', () => {
    const dup = 'modules: [{ id: dup, name: Dup, responsibility: 重叠, codeRefs: [src/ui/view/**] }]'
    const { index } = loadModel([...files(), { path: 'modules/dup.yaml', text: dup }])
    const own = assignFiles(index, SRC, ['src/tests/**'])
    expect(own.conflicts).toEqual([A])
    expect(own.ignored.has(X)).toBe(true)
    const s = evolutionStats(index, own, HISTORY, LINES)
    expect(s.modules.get('ui.view')!.changes).toBe(0)
    expect(s.modules.get('dup')!.changes).toBe(0)
    // c1 只剩 store；c5 的 tests/x.ts 已忽略，只剩 impl
    expect(s.modules.get('ui')!.changes).toBe(1)
    expect(s.modules.get('core.impl')!.changes).toBe(5)
    expect(s.commits).toBe(11)
  })
})

describe('J3 热度 = 次数 × √当前行数，三档按分位数', () => {
  it('没有统计行数时按 1；缺陷热度只计缺陷提交', () => {
    expect(heatOf(0, 100)).toBe(0)
    expect(heatOf(4, 100)).toBe(40)
    expect(heatOf(3, 0)).toBe(3)
    const { stats: s } = stats()
    expect(s.modules.get('ui.view')).toMatchObject({ lines: 100, heat: 60, fixHeat: 30 })
    expect(s.modules.get('core.impl')).toMatchObject({ lines: 400, heat: 100, fixHeat: 40 })
    expect(s.modules.get('core.util')).toMatchObject({ lines: 0, heat: 6, fixHeat: 2 })
    expect(s.modules.get('ui')!.heat).toBeCloseTo(6 * Math.sqrt(125))
  })

  it('分位数三等分，0 不分档', () => {
    const tier = heatTiers([6, 38.7, 67, 100, 0])
    expect([0, 6, 38.7, 67, 100].map(tier)).toEqual([null, 1, 2, 3, 3])
    expect(heatTiers([])(5)).toBeNull()
    expect(heatTiers([9])(9)).toBe(3)
  })

  it('本层投影在本层节点间分档：模块、边界节点都标，参与者不标，热度为 0 的不标', () => {
    const { index, stats: s } = stats()
    const view = projectLevel(index, 'core', { showBoundaries: true })
    const lv = levelEvolution(index, view, s, 'changes')
    expect(lv.heat.get('core.impl')).toEqual({ tier: 3, value: 100, count: 5 })
    expect(lv.heat.get('boundary:ui')).toMatchObject({ tier: 3, count: 6 })
    expect(lv.heat.get('core.api')!.tier).toBe(2)
    expect(lv.heat.get('core.util')).toEqual({ tier: 1, value: 6, count: 6 })
    expect(lv.heat.has('core.future')).toBe(false)
    const fixes = levelEvolution(index, view, s, 'fixes')
    expect(fixes.kind).toBe('fixes')
    expect(fixes.heat.get('core.impl')).toEqual({ tier: 3, value: 40, count: 2 })
    // 根层的分层总览：带（层）也标
    const root = levelEvolution(index, projectLevel(index, 'sys', { showBoundaries: true }), s, 'changes')
    expect(root.heat.get('core')!.tier).toBe(3)
    expect(root.heat.get('ui')!.tier).toBe(2)
  })
})

describe('J4 时间耦合：同提交 ≥ 5 且占两端 ≥ 30%，标注依赖与关系', () => {
  it('达到阈值的对按次数降序；祖先与后代不配对；标注两端子树之间有无模块依赖与描述关系', () => {
    const { stats: s } = stats()
    const ids = s.couplings.map(x => x.id)
    expect(ids).toContain(coupleId('core.impl', 'ui.view'))
    expect(ids).toContain(coupleId('core.api', 'core.util'))
    expect(ids).toContain(coupleId('core', 'ui'))
    expect(ids).toContain(coupleId('core', 'ui.view'))
    expect(ids.some(id => id === coupleId('core', 'core.impl'))).toBe(false)
    expect(ids.some(id => id === coupleId('ui.view', 'core.util'))).toBe(false)
    const vi = couplingBetween(s, 'ui.view', 'core.impl')!
    expect(vi).toMatchObject({ shared: 5, ratioA: 1, dependency: true, relation: false })
    expect(vi.ratioB).toBeCloseTo(5 / 6)
    expect(vi.commits).toEqual(['h0600000', 'h0500000', 'h0400000', 'h0300000', 'h0200000'])
    // core.api 与 core.util 之间既无依赖也无关系：代码事实看不见的耦合
    expect(couplingBetween(s, 'core.util', 'core.api')).toMatchObject({ shared: 5, dependency: false, relation: false })
    // ui 与 core：有依赖（ui.store → core.api）也有关系（rel.2）
    expect(couplingBetween(s, 'ui', 'core')).toMatchObject({ dependency: true, relation: true })
    // 上级是子树并集：core.impl 与 ui（view 的父）同样达到阈值
    expect(couplingsOf(s, 'core.impl').map(x => x.id)).toEqual([coupleId('core.impl', 'ui'), coupleId('core.impl', 'ui.view')])
  })

  it('阈值可改；没有治理报告时依赖按无', () => {
    const { index, own } = setup()
    const strict = evolutionStats(index, own, HISTORY, LINES, null, { min: 6, ratio: 0.3 })
    expect(strict.couplings).toEqual([])
    const ratio = evolutionStats(index, own, HISTORY, LINES, null, { min: 5, ratio: 0.9 })
    expect(ratio.couplings.map(x => x.id)).toEqual([])
    const loose = evolutionStats(index, own, HISTORY, LINES, null, { min: 1, ratio: 0 })
    expect(couplingBetween(loose, 'ui.view', 'core.impl')!.dependency).toBe(false)
    expect(loose.couplings.length).toBeGreaterThan(stats().stats.couplings.length)
  })

  it('本层投影：两端投到本层两个不同节点的成为耦合线，投到当前层次本身的丢弃，同一对节点合并', () => {
    const { index, stats: s } = stats()
    const view = projectLevel(index, 'core', { showBoundaries: true })
    const lv = levelEvolution(index, view, s, 'changes')
    // core.impl~ui 与 core.impl~ui.view 都投到 boundary:ui 与 core.impl，合并后次数为共同提交的并集（5，不是 10）
    expect(lv.couplings.map(x => `${x.from}~${x.to}:${x.shared}:${x.isolated}`)).toEqual([
      'boundary:ui~core.impl:5:false',
      'core.api~core.util:5:true',
    ])
    expect(lv.couplings[0].pairs.sort()).toEqual([coupleId('core.impl', 'ui'), coupleId('core.impl', 'ui.view')].sort())
    expect(lv.couplings[1]).toMatchObject({ id: 'couple:core.api~core.util', fromModule: 'core.api', toModule: 'core.util', pairs: ['core.api~core.util'] })
    // 根层：core~ui、core~ui.view、core.impl~ui、core.impl~ui.view 都投到带 core 与带 ui，合并为一条
    const root = levelEvolution(index, projectLevel(index, 'sys', { showBoundaries: true }), s, 'changes')
    expect(root.couplings).toHaveLength(1)
    expect(root.couplings[0]).toMatchObject({ from: 'core', to: 'ui', shared: 5, isolated: false })
    expect(root.couplings[0].pairs).toHaveLength(4)
  })
})

describe('J6 无依赖无关系的耦合对进返工清单（info）', () => {
  it('类别「时间耦合」，根因键为两端，建议补关系或合并 / 拆分', () => {
    const { index, own, stats: s } = stats()
    expect(isolatedCouplings(s).map(x => x.id)).toEqual([coupleId('core.api', 'core.util')])
    const list = reworkList({ index, issues: [], source: { own, tree: { files: SRC, packages: {} } }, report: setup().report, evolution: s })
    const items = list.items.filter(i => i.category === 'coupling')
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ id: 'coupling:core.api~core.util', severity: 'info', rules: ['J4', 'J6'], code: 'evolution.coupling' })
    expect(items[0].title).toContain('同提交 5 次')
    expect(items[0].actions.map(a => a.kind)).toEqual(['add-relation', 'fix-code'])
    expect(items[0].target.modules).toEqual(['core.api', 'core.util'])
    expect(list.byCategory.coupling).toBe(1)
    expect(list.counts.info).toBeGreaterThanOrEqual(1)
    // 没有演化事实时没有这一类
    expect(reworkList({ index, issues: [], report: setup().report }).byCategory.coupling).toBe(0)
  })
})

describe('J7 耦合对的键', () => {
  it('两端按字典序；可拆回两端', () => {
    expect(coupleId('b', 'a')).toBe('a~b')
    expect(coupleEnds('a~b')).toEqual(['a', 'b'])
    expect(coupleEnds('a~')).toBeNull()
    expect(coupleEnds('nope')).toBeNull()
  })
})

describe('J8 热度前 N', () => {
  it('只列有直接归属文件的模块，按热度降序、同值按次数再按 ID', () => {
    const { stats: s } = stats()
    expect(hotspots(s, 'changes').map(m => m.id)).toEqual(['core.impl', 'ui.view', 'core.api', 'core.util', 'ui.store'])
    expect(hotspots(s, 'changes', 2).map(m => m.id)).toEqual(['core.impl', 'ui.view'])
    expect(hotspots(s, 'fixes').map(m => m.id)).toEqual(['core.impl', 'ui.view', 'core.api', 'ui.store', 'core.util'])
  })
})

// 让 CODE 的引用不被 lint 视为未使用：治理报告来自 setup()，这里只确认 fixture 没变
it('fixture：文件依赖含 core.impl → ui.view', () => {
  expect(CODE.deps.some(d => d.from === I && d.to === A)).toBe(true)
})
