/** 架构治理 · 环（Y1–Y3）：强连通分量、只按值依赖、环度与容忍 */
import { describe, expect, it } from 'vitest'
import {
  assignFiles,
  checkDependency,
  cyclicityOf,
  entryResolver,
  governanceReport,
  levelFacts,
  loadModel,
  projectLevel,
  stronglyConnected,
  valueDeps,
  type FileDep,
} from '@/model'
import { files, SRC, dep, DEPS, CODE, setup } from './helpers'

describe('Y1–Y3 环与环度', () => {
  it('强连通分量只取规模 ≥ 2，自环忽略', () => {
    expect(
      stronglyConnected([
        ['a', 'b'],
        ['b', 'a'],
        ['c', 'c'],
        ['b', 'd'],
      ]),
    ).toEqual([['a', 'b']])
  })

  it('模块环与文件环，环度为规模平方和', () => {
    const { report } = setup()
    expect(report.moduleCycles.map(c => c.members)).toEqual([['core.util', 'ui.store', 'ui.view']])
    expect(report.fileCycles.map(c => c.members)).toEqual([['src/core/util/u.ts', 'src/ui/store/s.ts', 'src/ui/view/a.ts']])
    expect(report.cyclicity).toEqual({ modules: 9, files: 9 })
    expect(cyclicityOf([{ members: ['a', 'b'], tolerated: false }, { members: ['c', 'd', 'e'], tolerated: false }])).toBe(13)
  })

  it('环只按值依赖：只引类型的依赖不是环的边，模块环、文件环、本层环与写前判定的环影响同一口径', () => {
    const { index } = loadModel(files())
    const own = assignFiles(index, SRC, [])
    // core.api → ui.store 只引类型：若计入，会与 ui.store → core.api 成环
    const typeBack: FileDep = { ...dep('src/core/api/client.ts', 'src/ui/store/s.ts'), kind: 'type' }
    const report = governanceReport(index, own, { files: SRC, packages: {} }, { ...CODE, deps: [...DEPS, typeBack] }, null)
    expect(report.moduleDeps.has('core.api->ui.store')).toBe(true)
    expect(report.moduleCycles.map(c => c.members)).toEqual([['core.util', 'ui.store', 'ui.view']])
    expect(report.fileCycles.map(c => c.members)).toEqual([['src/core/util/u.ts', 'src/ui/store/s.ts', 'src/ui/view/a.ts']])
    expect(report.cyclicity).toEqual({ modules: 9, files: 9 })
    expect(valueDeps([{ key: 'a->b', from: 'a', to: 'b', files: [typeBack] }])).toEqual([])
    // 本层环（Y4、Y5）：core 层的 api 与 impl 不因类型依赖成环；环的构成只列值依赖
    const core = levelFacts(index, projectLevel(index, 'core'), report)
    expect(core.cycles.has('core.api')).toBe(false)
    const ui = levelFacts(index, projectLevel(index, 'ui'), report)
    expect(ui.levelCycles[0].edges.flatMap(e => e.deps.flatMap(d => d.files)).every(f => f.kind === 'value')).toBe(true)
    // Q2：环影响也只看值依赖——core.api → ui.view 加入前，core.api 不在环里
    const r = checkDependency(index, own, report, entryResolver(index, own, { files: SRC, packages: {} }), 'core.api', [{ to: 'ui.view' }])
    expect(r.checks[0].cycle.before).toBe(0)
  })

  it('容忍的环不计入环度，仍列出', () => {
    const { report } = setup(`rules: { cycles: { tolerated: [ui, core] } }`)
    expect(report.moduleCycles[0].tolerated).toBe(true)
    expect(report.cyclicity).toEqual({ modules: 0, files: 0 })
  })
})
