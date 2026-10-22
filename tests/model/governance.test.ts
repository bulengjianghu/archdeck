/**
 * 架构治理（docs/02-domain.md §2.14–§2.17 K4–K10、U1–U9、Y1–Y5、Q1、Q2、Q4）：模型层的纯函数，按规则逐条验证。
 * 文件依赖直接给出（提取在接入层，见 tests/access/readDeps.test.ts）。
 */
import { describe, expect, it } from 'vitest'
import {
  assignFiles,
  checkDependency,
  confirmRelations,
  cyclicityOf,
  depsBetween,
  describeModule,
  entryResolver,
  gateIssues,
  governanceReport,
  hostOf,
  levelFacts,
  liftDeps,
  loadModel,
  locateFile,
  makeBaseline,
  projectLevel,
  rulesFor,
  stronglyConnected,
  summarizeLedger,
  undescribedDeps,
  unconfirmedWarns,
  valueDeps,
  type Baseline,
  type CodeDeps,
  type FileDep,
  type LedgerEntry,
  type RawFile,
} from '@/model'

const LAYERS = `
modules:
  - id: ui
    name: UI
    kind: layer
    order: 1
    abstraction: 界面
    responsibility: 界面层
    mayDependOn: [core]
    children:
      - { id: ui.view, name: View, responsibility: 视图, codeRefs: [src/ui/view/**] }
      - { id: ui.store, name: Store, responsibility: 状态, codeRefs: [src/ui/store/**] }
  - id: core
    name: Core
    kind: layer
    order: 2
    abstraction: 内核
    responsibility: 内核层
    mayDependOn: []
    children:
      - { id: core.api, name: Api, responsibility: 对外接口, codeRefs: [src/core/api/**], entry: src/core/api/index.ts, provides: [if.get] }
      - { id: core.impl, name: Impl, responsibility: 实现, codeRefs: [src/core/impl/**] }
      - { id: core.util, name: Util, responsibility: 工具, codeRefs: [src/core/util/**] }
      - { id: core.future, name: Future, status: target, responsibility: 规划中 }
interfaces:
  - { id: if.get, name: get, owner: core.api, signature: 'get(id: string): Item' }
relations:
  - { id: rel.1, from: ui.view, to: ui.store, type: depends }
  - { id: rel.2, from: ui.store, to: core.api, type: calls }
  - { id: rel.3, from: core.impl, to: core.util, type: depends }
  - { id: rel.4, from: core.api, to: core.impl, type: calls }
  - { id: rel.5, from: core.util, to: core.future, type: depends }
  - { id: rel.6, from: core.util, to: ui.store, type: dataflow }
`

const RULES = `
rules:
  modules:
    - { module: core.api, exposes: [entry] }
    - { module: ui.view, mayDependOn: [ui.store], reason: 视图只认状态 }
  allow:
    - { from: core.util, to: ui.view, rule: layer, reason: 测试例外 }
`

const files = (rules = RULES): RawFile[] => [
  { path: 'system.yaml', text: 'system: { id: sys, name: Sys }' },
  { path: 'modules/layers.yaml', text: LAYERS },
  { path: 'rules.yaml', text: rules },
]

const SRC = [
  'src/ui/view/a.ts',
  'src/ui/store/s.ts',
  'src/core/api/index.ts',
  'src/core/api/client.ts',
  'src/core/impl/i.ts',
  'src/core/util/u.ts',
  'src/tests/x.ts',
]

const dep = (from: string, to: string, via = to, line = 1): FileDep => ({ from, to, via, kind: 'value', line })

const DEPS: FileDep[] = [
  dep('src/ui/view/a.ts', 'src/ui/store/s.ts'), // ui.view → ui.store：rel.1
  dep('src/ui/store/s.ts', 'src/core/api/client.ts', 'src/core/api/index.ts'), // 经入口访问 core.api
  dep('src/ui/store/s.ts', 'src/core/api/client.ts', 'src/core/api/client.ts', 2), // 绕过入口（U4）
  dep('src/ui/view/a.ts', 'src/core/util/u.ts', 'src/core/util/u.ts', 3), // 白名单之外（U3）
  dep('src/core/impl/i.ts', 'src/ui/view/a.ts'), // core 不可依赖 ui（U2）
  dep('src/core/util/u.ts', 'src/ui/view/a.ts'), // 同上，但有例外（U5）
  dep('src/core/api/index.ts', 'src/core/api/client.ts'), // 同一模块
  dep('src/tests/x.ts', 'src/ui/view/a.ts'), // 一端未归属
  dep('src/ui/store/s.ts', 'src/core/util/u.ts', 'src/core/util/u.ts', 4), // 证实 dataflow 反向
]
const CODE: CodeDeps = { deps: DEPS, external: { vue: 2 }, parsed: 6 }

function setup(rules?: string, baseline: Baseline | null = null) {
  const { index, issues } = loadModel(files(rules))
  const own = assignFiles(index, SRC, [])
  const tree = { files: SRC, packages: {} }
  const report = governanceReport(index, own, tree, CODE, baseline)
  return { index, issues, own, tree, report, entryOf: entryResolver(index, own, tree) }
}

describe('K4 模块依赖', () => {
  it('两端按归属提升，去掉同模块与祖先后代，未归属的单独计数', () => {
    const { index, own } = setup()
    const { moduleDeps, skipped } = liftDeps(index, own, DEPS)
    expect([...moduleDeps.keys()].sort()).toEqual([
      'core.impl->ui.view',
      'core.util->ui.view',
      'ui.store->core.api',
      'ui.store->core.util',
      'ui.view->core.util',
      'ui.view->ui.store',
    ])
    expect(moduleDeps.get('ui.store->core.api')!.files).toHaveLength(2)
    expect(skipped).toBe(1)
  })

  it('一端是归属冲突文件（G6）的依赖不提升到任何模块，单独列出；冲突解决后自然计入', () => {
    const { index } = setup()
    const own = assignFiles(index, SRC, [])
    own.owners.set('src/core/util/u.ts', ['core.util', 'core.impl'])
    own.conflicts.push('src/core/util/u.ts')
    const deps = [dep('src/ui/view/a.ts', 'src/core/util/u.ts'), dep('src/core/util/u.ts', 'src/ui/view/a.ts'), dep('src/ui/view/a.ts', 'src/ui/store/s.ts')]
    const { moduleDeps, skipped, conflicted } = liftDeps(index, own, deps)
    expect([...moduleDeps.keys()]).toEqual(['ui.view->ui.store'])
    expect(conflicted).toEqual(deps.slice(0, 2))
    expect(skipped).toBe(0)
    const fixed = liftDeps(index, assignFiles(index, SRC, []), deps)
    expect([...fixed.moduleDeps.keys()].sort()).toEqual(['core.util->ui.view', 'ui.view->core.util', 'ui.view->ui.store'])
    expect(fixed.conflicted).toEqual([])
  })
})

describe('K5、K6 关系的证实', () => {
  it('有对应模块依赖为已证实；dataflow 反向也算；目标态不判定', () => {
    const { report } = setup()
    const st = (id: string) => report.relations.get(id)!.status
    expect(st('rel.1')).toBe('confirmed')
    expect(st('rel.2')).toBe('confirmed')
    expect(st('rel.6')).toBe('confirmed')
    expect(st('rel.3')).toBe('unconfirmed')
    expect(st('rel.4')).toBe('unconfirmed')
    expect(st('rel.5')).toBe('skipped')
  })

  it('依赖落在关系端点的祖先上也算证实（描述比文件粒度细）', () => {
    const { index, own } = setup()
    own.owners.set('src/ui/store/s.ts', ['ui'])
    const { moduleDeps } = liftDeps(index, own, [dep('src/ui/store/s.ts', 'src/core/api/client.ts')])
    expect(confirmRelations(index, moduleDeps).get('rel.2')!.status).toBe('confirmed')
  })

  it('K5a：宿主为自身或最近的有直接归属文件的祖先；两端宿主相同的关系不判定，带宿主', () => {
    const layers = LAYERS.replace(
      '{ id: core.impl, name: Impl, responsibility: 实现, codeRefs: [src/core/impl/**] }',
      '{ id: core.impl, name: Impl, responsibility: 实现, codeRefs: [src/core/impl/**], children: [{ id: core.impl.a, name: A, responsibility: 甲 }, { id: core.impl.b, name: B, responsibility: 乙 }] }',
    ).replace(
      'relations:\n',
      'relations:\n  - { id: rel.c1, from: core.impl.a, to: core.impl.b, type: calls }\n  - { id: rel.c2, from: core.impl.a, to: ui.view, type: calls }\n  - { id: rel.c3, from: core.impl.b, to: core.api, type: calls }\n',
    )
    const { index } = loadModel([files()[0], { path: 'modules/layers.yaml', text: layers }])
    const own = assignFiles(index, SRC, [])
    expect(hostOf(index, own.direct, 'core.impl.a')).toBe('core.impl')
    expect(hostOf(index, own.direct, 'core.api')).toBe('core.api')
    expect(hostOf(index, own.direct, 'core')).toBeUndefined()
    const conf = confirmRelations(index, liftDeps(index, own, DEPS).moduleDeps, own.direct)
    // 同一宿主内的概念拆分：不判定
    expect(conf.get('rel.c1')).toEqual({ status: 'skipped', deps: [], host: 'core.impl' })
    // 宿主不同：照常判定，依赖落在宿主（祖先）上也算证实
    expect(conf.get('rel.c2')!.status).toBe('confirmed')
    expect(conf.get('rel.c3')!.status).toBe('unconfirmed')
    // 不传归属时没有宿主，照常判定
    expect(confirmRelations(index, liftDeps(index, own, DEPS).moduleDeps).get('rel.c1')!.status).toBe('unconfirmed')
  })

  it('K6：编译期关系未证实报 fact.unconfirmed；运行时关系只在两端之间没有任何依赖时报', () => {
    // rel.8：ui.view → core.impl 只有反向依赖（core.impl → ui.view），可由端口解释，只在面板标注
    const { index } = loadModel([...files(), { path: 'modules/z.yaml', text: 'relations: [{ id: rel.8, from: ui.view, to: core.impl, type: calls }]' }])
    const own = assignFiles(index, SRC, [])
    const report = governanceReport(index, own, { files: SRC, packages: {} }, CODE, null)
    const st = (id: string) => report.relations.get(id)!
    expect(st('rel.3')).toMatchObject({ status: 'unconfirmed', isolated: true })
    expect(st('rel.4')).toMatchObject({ status: 'unconfirmed', isolated: true })
    expect(st('rel.8').status).toBe('unconfirmed')
    expect(st('rel.8').isolated).toBeUndefined()
    const warned = report.issues.filter(i => i.code === 'fact.unconfirmed')
    expect(warned.map(i => i.message.match(/「(.+?)」/)![1])).toEqual(['rel.3', 'rel.4'])
    expect(warned[1].message).toContain('两端之间在代码中没有任何依赖')
    expect(unconfirmedWarns(index.relations.get('rel.8')!, st('rel.8'))).toBe(false)
  })

  it('K6：祖先与后代之间的依赖（K4 不提升）也算两端有依赖——祖先的文件组装子模块（注入）', () => {
    const { index } = setup()
    const own = assignFiles(index, [...SRC, 'src/core/wire.ts'], [])
    own.owners.set('src/core/wire.ts', ['core'])
    // core 的组装文件同时依赖 core.api 与 core.impl：rel.4（core.api → core.impl）经注入可解释
    const deps = [dep('src/core/wire.ts', 'src/core/api/client.ts'), dep('src/core/wire.ts', 'src/core/impl/i.ts')]
    const { moduleDeps, nested } = liftDeps(index, own, deps)
    expect(moduleDeps.size).toBe(0)
    expect([...nested].sort()).toEqual(['core->core.api', 'core->core.impl'])
    const c = confirmRelations(index, moduleDeps, own.direct, nested).get('rel.4')!
    expect(c.status).toBe('unconfirmed')
    expect(c.isolated).toBeUndefined()
    expect(confirmRelations(index, moduleDeps, own.direct).get('rel.4')!.isolated).toBe(true)
  })
})

describe('K7 未描述依赖', () => {
  it('没有关系覆盖（方向一致，dataflow 不论方向）', () => {
    const { index, own } = setup()
    const { moduleDeps } = liftDeps(index, own, DEPS)
    expect(
      undescribedDeps(index, moduleDeps)
        .map(d => d.key)
        .sort(),
    ).toEqual(['core.impl->ui.view', 'core.util->ui.view', 'ui.view->core.util'])
  })

  it('只引用类型的模块依赖不算；有一条值依赖就算', () => {
    const { index, own } = setup()
    const type = (from: string, to: string): FileDep => ({ ...dep(from, to), kind: 'type' })
    const onlyTypes = liftDeps(index, own, [type('src/ui/view/a.ts', 'src/core/impl/i.ts')]).moduleDeps
    expect(undescribedDeps(index, onlyTypes)).toEqual([])
    const mixed = liftDeps(index, own, [type('src/ui/view/a.ts', 'src/core/impl/i.ts'), dep('src/ui/view/a.ts', 'src/core/impl/i.ts', undefined, 2)]).moduleDeps
    expect(undescribedDeps(index, mixed).map(d => d.key)).toEqual(['ui.view->core.impl'])
  })
})

describe('U1 规则的加载与校验', () => {
  it('引用不存在的模块提醒并去掉；allow 缺 reason 报错；重复声明用第一处', () => {
    const { index, issues } = loadModel([
      ...files(`
rules:
  modules:
    - { module: nope, mayDependOn: [core] }
    - { module: ui.view, mayDependOn: [ui.store, ghost] }
  allow:
    - { from: ui, to: core, reason: '' }
  cycles: { tolerated: [ghost] }
`),
      { path: 'zz-more.yaml', text: 'rules: { layers: false }' },
    ])
    expect(issues.filter(i => i.code === 'unknown-rule-module')).toHaveLength(3)
    expect(issues.some(i => i.code === 'allow-without-reason' && i.severity === 'error')).toBe(true)
    expect(issues.some(i => i.code === 'duplicate-rules')).toBe(true)
    expect(index.model.rules!.modules).toEqual([{ module: 'ui.view', mayDependOn: ['ui.store'] }])
    expect(index.model.rules!.allow).toEqual([])
    expect(index.model.rules!.layers).toBeUndefined()
  })
})

describe('U2–U6 规则判定与违规', () => {
  it('层规则、白名单、访问面、例外；按种类、规则所在与两端合并', () => {
    const { report } = setup()
    const v = Object.fromEntries(report.violations.map(x => [x.key, x]))
    expect(Object.keys(v).sort()).toEqual([
      'deps:ui.view:ui.view->core.util',
      'exposes:core.api:ui.store->core.api',
      'layer:core:core.impl->ui.view',
      'layer:core:core.util->ui.view',
    ])
    expect(v['exposes:core.api:ui.store->core.api'].files.map(f => f.line)).toEqual([2])
    expect(v['layer:core:core.util->ui.view'].status).toBe('allowed')
    expect(v['layer:core:core.util->ui.view'].allowReason).toBe('测试例外')
    expect(v['layer:core:core.impl->ui.view'].reason).toContain('「Core」不可依赖「UI」')
  })

  it('U2：没写 mayDependOn 的层不限制；rules.layers: false 关闭层规则', () => {
    const off = setup(`rules: { layers: false }`)
    expect(off.report.violations.filter(v => v.kind === 'layer')).toEqual([])
  })

  it('U4：经由文件在模块子树外（别处的入口再导出）不算访问', () => {
    const { index, own, tree } = setup()
    const r = governanceReport(index, own, tree, { ...CODE, deps: [dep('src/ui/store/s.ts', 'src/core/api/client.ts', 'src/core/util/u.ts')] }, null)
    expect(r.violations.filter(v => v.kind === 'exposes')).toEqual([])
  })
})

describe('U7–U9 基线与门禁', () => {
  it('没有基线：违规全部为 rule.violation 提醒，已豁免的不报', () => {
    const { report } = setup()
    const codes = report.issues.filter(i => i.code.startsWith('rule.')).map(i => `${i.code}:${i.severity}`)
    expect(codes).toEqual(Array(3).fill('rule.violation:warning'))
    expect(gateIssues(report)).toEqual([])
  })

  it('有基线：基线外为 rule.new 错误，基线内为 rule.known；已消除的计数', () => {
    const baseline: Baseline = { createdAt: 't', violations: ['deps:ui.view:ui.view->core.util', 'deps:x:gone->gone'], cyclicity: { modules: 9, files: 9 } }
    const { report } = setup(RULES, baseline)
    expect(report.gate).toEqual({ newViolations: 2, knownViolations: 1, resolved: 1, cycleGrew: false })
    expect(gateIssues(report).map(i => i.code)).toEqual(['rule.new', 'rule.new'])
    expect(report.issues.find(i => i.code === 'rule.known')!.severity).toBe('warning')
  })

  it('环度高于基线为 cycle.grew 错误', () => {
    const { report } = setup(RULES, { createdAt: 't', violations: [], cyclicity: { modules: 4, files: 9 } })
    expect(report.gate.cycleGrew).toBe(true)
    expect(gateIssues(report).some(i => i.code === 'cycle.grew' && i.severity === 'error')).toBe(true)
  })

  it('makeBaseline 记录未豁免的违规键与环度', () => {
    const { report } = setup()
    const b = makeBaseline(report, '2026-10-21', 'abc')
    expect(b.violations).toEqual(['deps:ui.view:ui.view->core.util', 'exposes:core.api:ui.store->core.api', 'layer:core:core.impl->ui.view'])
    expect(b.cyclicity).toEqual(report.cyclicity)
    expect(b.commit).toBe('abc')
  })
})

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

describe('K9、K10、Y4、Y5 本层投影', () => {
  it('视图边的证实与违规，未描述依赖成为叠加线，本层的环', () => {
    const { index, report } = setup()
    const view = projectLevel(index, 'ui')
    const f = levelFacts(index, view, report)
    expect(f.edgeFacts.get(view.edges.find(e => e.from === 'ui.view' && e.to === 'ui.store')!.id)).toBe('confirmed')
    const toCore = view.edges.find(e => e.from === 'ui.store' && e.to === 'boundary:core')!
    expect(f.violatedEdges.has(toCore.id)).toBe(true)
    expect(f.overlays.map(o => `${o.id}:${o.undescribed}/${o.violations}`).sort()).toEqual(['dep:boundary:core->ui.view:2/1', 'dep:ui.view->boundary:core:1/1'])
    const o = f.overlays.find(x => x.from === 'ui.view')!
    expect([o.fromModule, o.toModule]).toEqual(['ui.view', 'core'])
    expect(new Set(f.cycles.values()).size).toBe(1)
    expect([...f.cycles.keys()].sort()).toEqual(['boundary:core', 'ui.store', 'ui.view'])
  })

  it('K9：画布只画基线外的违规——已知（基线内）与已豁免的不进叠加线与红晕，面板照常列出', () => {
    const { index, report: open } = setup()
    const all = open.violations.filter(v => v.status !== 'allowed').map(v => v.key)
    const { report } = setup(undefined, { createdAt: 't', violations: all, cyclicity: { modules: 99, files: 99 } })
    expect(report.violations.filter(v => v.status === 'known')).toHaveLength(all.length)
    const view = projectLevel(index, 'ui')
    const f = levelFacts(index, view, report)
    expect(f.violatedEdges.size).toBe(0)
    expect(f.overlays.every(o => o.violations === 0)).toBe(true)
    // 未描述依赖照常是叠加线
    expect(f.overlays.some(o => o.undescribed > 0)).toBe(true)
  })

  it('K9、Y5：同方向有多条视图边（L5 按类型分边）时，违规红晕与本层环的视图边只取类型声明顺序中的第一条', () => {
    const { index } = loadModel([...files(), { path: 'modules/z.yaml', text: 'relations: [{ id: rel.7, from: ui.store, to: core.util, type: depends }]' }])
    const own = assignFiles(index, SRC, [])
    const report = governanceReport(index, own, { files: SRC, packages: {} }, CODE, null)
    const view = projectLevel(index, 'ui')
    expect(view.edges.filter(e => e.from === 'ui.store' && e.to === 'boundary:core').map(e => e.type).sort()).toEqual(['calls', 'depends'])
    const f = levelFacts(index, view, report)
    expect([...f.violatedEdges].filter(id => id.startsWith('ui.store->boundary:core'))).toEqual(['ui.store->boundary:core:depends'])
    const e = f.levelCycles[0].edges.find(x => x.from === 'ui.store' && x.to === 'boundary:core')!
    expect(e.edgeId).toBe('ui.store->boundary:core:depends')
  })

  it('Y5：本层环的节点按视图顺序，环内的本层依赖带同方向视图边与投影来的模块依赖', () => {
    const { index, report } = setup()
    const view = projectLevel(index, 'ui')
    const [c] = levelFacts(index, view, report).levelCycles
    expect(c.id).toBe(1)
    const order = view.nodes.map(n => n.id)
    expect(c.nodes.map(n => n.id)).toEqual(order.filter(id => ['ui.view', 'ui.store', 'boundary:core'].includes(id)))
    expect(c.nodes.find(n => n.id === 'boundary:core')!.module).toBe('core')
    const pairs = c.edges.map(e => `${e.from}->${e.to}`)
    expect([...pairs].sort()).toEqual(['boundary:core->ui.view', 'ui.store->boundary:core', 'ui.view->boundary:core', 'ui.view->ui.store'])
    expect(pairs).toEqual([...pairs].sort((a, b) => order.indexOf(a.split('->')[0]) - order.indexOf(b.split('->')[0]) || order.indexOf(a.split('->')[1]) - order.indexOf(b.split('->')[1])))
    const edge = (p: string) => c.edges.find(e => `${e.from}->${e.to}` === p)!
    expect(edge('ui.view->ui.store').edgeId).toBe(view.edges.find(e => e.from === 'ui.view' && e.to === 'ui.store')!.id)
    expect(edge('ui.view->boundary:core').edgeId).toBeUndefined()
    const back = edge('boundary:core->ui.view')
    expect([back.fromModule, back.toModule]).toEqual(['core', 'ui.view'])
    expect(back.deps.map(d => d.key).sort()).toEqual(['core.impl->ui.view', 'core.util->ui.view'])
    expect(back.deps.every(d => d.files.length > 0)).toBe(true)
  })

  it('视图边的关系全部未证实为 unconfirmed', () => {
    const { index, report } = setup()
    const view = projectLevel(index, 'core')
    const f = levelFacts(index, view, report)
    expect(f.edgeFacts.get(view.edges.find(e => e.from === 'core.impl' && e.to === 'core.util')!.id)).toBe('unconfirmed')
  })

  it('选中叠加线：列出投影到这对节点的模块依赖与违规', () => {
    const { index, report } = setup()
    const view = projectLevel(index, 'ui')
    const sel = depsBetween(index, view, report, 'core', 'ui.view')!
    expect(sel.deps.map(d => `${d.key}:${d.described}`).sort()).toEqual(['core.impl->ui.view:false', 'core.util->ui.view:false'])
    expect(sel.violations.map(v => v.status).sort()).toEqual(['allowed', 'open'])
    expect(depsBetween(index, view, report, 'ui.view', 'ui.view')).toBeNull()
  })
})

describe('Q1 定位与模块说明', () => {
  it('生效的规则：所在层、祖先链上的白名单与访问面', () => {
    const { index, entryOf } = setup()
    expect(rulesFor(index, 'ui.view', entryOf)).toEqual({
      layers: [{ layer: 'ui', mayDependOn: ['core'] }],
      deps: [{ module: 'ui.view', mayDependOn: ['ui.store'], reason: '视图只认状态' }],
      exposes: [],
    })
    expect(rulesFor(index, 'core.api', entryOf).exposes).toEqual([{ module: 'core.api', exposes: ['entry'], entry: 'src/core/api/index.ts' }])
  })

  it('文件定位给出归属、各级职责、接口、出入的违规', () => {
    const { index, own, report, entryOf } = setup()
    const at = locateFile(index, own, new Set(SRC), report, entryOf, 'src/core/api/client.ts')
    expect(at.status).toBe('owned')
    expect(at.module!.path.map(p => p.id)).toEqual(['core', 'core.api'])
    expect(at.module!.interfaces).toEqual([{ id: 'if.get', name: 'get', signature: 'get(id: string): Item' }])
    expect(at.module!.violations.in.map(v => v.kind)).toEqual(['exposes'])
    expect(locateFile(index, own, new Set(SRC), report, entryOf, 'src/tests/x.ts').status).toBe('unowned')
    expect(locateFile(index, own, new Set(SRC), report, entryOf, 'nope.ts').status).toBe('missing')
    const d = describeModule(index, own, report, entryOf, 'ui')!
    expect(d.cycles).toEqual([['core.util', 'ui.store', 'ui.view']])
  })
})

describe('Q2 写前判定', () => {
  it('denied：给出违反的规则与理由', () => {
    const { index, own, report, entryOf } = setup()
    const r = checkDependency(index, own, report, entryOf, 'src/core/impl/i.ts', [{ to: 'src/ui/store/s.ts', via: 'src/ui/store/s.ts' }])
    expect(r.verdict).toBe('denied')
    expect(r.checks[0].hits.map(h => h.kind)).toEqual(['layer'])
    expect(r.targets.map(t => t.id)).toEqual(['ui.store'])
  })

  it('allowed：有规则约束且通过，并给出覆盖它的关系', () => {
    const { index, own, report, entryOf } = setup()
    const r = checkDependency(index, own, report, entryOf, 'ui.view', [{ to: 'ui.store' }])
    expect(r.verdict).toBe('allowed')
    expect(r.checks[0].describedBy).toEqual(['rel.1'])
  })

  it('unconstrained：没有规则约束；同一模块内不受约束', () => {
    const { index, own, report, entryOf } = setup()
    expect(checkDependency(index, own, report, entryOf, 'ui.store', [{ to: 'ui.view' }]).verdict).toBe('unconstrained')
    const inner = checkDependency(index, own, report, entryOf, 'src/core/api/index.ts', [{ to: 'src/core/api/client.ts' }])
    expect(inner.verdict).toBe('unconstrained')
    expect(inner.notes[0]).toContain('同一模块内')
  })

  it('访问面：绕过入口 denied，经入口 allowed', () => {
    const { index, own, report, entryOf } = setup()
    const deep = checkDependency(index, own, report, entryOf, 'src/ui/store/s.ts', [{ to: 'src/core/api/client.ts', via: 'src/core/api/client.ts' }])
    expect(deep.checks[0].hits.map(h => h.kind)).toEqual(['exposes'])
    const viaEntry = checkDependency(index, own, report, entryOf, 'src/ui/store/s.ts', [{ to: 'src/core/api/client.ts', via: 'src/core/api/index.ts' }])
    expect(viaEntry.verdict).toBe('allowed')
  })

  it('环影响：加入后形成或扩大模块环', () => {
    const { index, own, report, entryOf } = setup(`rules: { layers: false }`)
    const r = checkDependency(index, own, report, entryOf, 'core.api', [{ to: 'ui.view' }])
    expect(r.checks[0].cycle).toEqual({ before: 0, after: 4, createsOrGrows: true })
    const same = checkDependency(index, own, report, entryOf, 'core.util', [{ to: 'ui.store' }])
    expect(same.checks[0].cycle.createsOrGrows).toBe(false)
  })

  it('依赖方未归属时说明无法判定', () => {
    const { index, own, report, entryOf } = setup()
    const r = checkDependency(index, own, report, entryOf, 'src/tests/x.ts', [{ to: 'ui.view' }])
    expect(r.checks).toEqual([])
    expect(r.notes[0]).toContain('无法判定')
  })
})

describe('Q4 拦截记录的统计', () => {
  it('按判定统计，扫描给出首末值', () => {
    const c = { modules: 9, files: 9 }
    const entries: LedgerEntry[] = [
      { at: '1', tool: 'check_dependency', client: 'mcp', from: 'a', to: 'b', verdict: 'denied', rules: ['layer', 'deps'], cycle: true },
      { at: '2', tool: 'check_dependency', client: 'cli', from: 'a', to: 'c', verdict: 'allowed', rules: [], cycle: false },
      { at: '3', tool: 'rescan', client: 'mcp', violations: 5, newViolations: 1, cyclicity: c },
      { at: '4', tool: 'rescan', client: 'mcp', violations: 3, newViolations: 0, cyclicity: { modules: 4, files: 9 } },
    ]
    const s = summarizeLedger(entries)
    expect(s.checks).toBe(2)
    expect(s.byVerdict).toEqual({ allowed: 1, denied: 1, unconstrained: 0 })
    expect(s.deniedByRule).toEqual({ layer: 1, deps: 1, exposes: 0 })
    expect(s.cycleFlags).toBe(1)
    expect(s.rescans).toBe(2)
    expect(s.first!.violations).toBe(5)
    expect(s.last!.cyclicity.modules).toBe(4)
  })
})
