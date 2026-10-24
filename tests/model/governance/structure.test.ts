/** 架构治理 · 结构视图（ADR-0031）：结构边的种类与档 K14、影响面 K15、扇入扇出与不稳定度 K16、交互覆盖 K17、规则叠加 U15、允许依赖图 U16、稳定依赖方向 U17、入度最高的共用件 Q15 */
import { describe, expect, it } from 'vitest'
import {
  ALLOWED_ONLY_NOTE,
  NO_ALLOWED_NOTE,
  NO_FACTS_REASON,
  againstStability,
  againstStabilityOf,
  allowedDeps,
  assignFiles,
  chipDeps,
  fileKinds,
  governanceReport,
  hasStructureEdge,
  impactOf,
  interactionEdgeBetween,
  isolatedInteractions,
  levelDeps,
  levelImpact,
  loadModel,
  moduleMetrics,
  projectLevel,
  sharedHealth,
  stabilityBand,
  structureMetrics,
  structureEdgeFiles,
  structureView,
  tierOf,
  topSharedFanIn,
  type CodeDeps,
  type FileDep,
  type ModuleMetrics,
} from '@/model'
import { sampleFiles } from '../../fixtures/sample'
import { dep, files, LAYERS, RULES, setup, SRC } from './helpers'

/** 内核层内部的各种使用（helpers 的两层四模块）：每条只说明它要验证的种类 */
const typeDep = (from: string, to: string, via = to, line = 1): FileDep => ({ from, to, via, kind: 'type', line })
const readDep = (from: string, to: string, via = to, line = 1): FileDep => ({ from, to, via, kind: 'value', line, uses: true })
const CORE: FileDep[] = [
  dep('src/core/impl/i.ts', 'src/core/util/u.ts'), // impl → util：交互使用，rel.3 覆盖
  typeDep('src/core/util/u.ts', 'src/core/api/client.ts', 'src/core/api/index.ts'), // util → api：只引类型，经入口
  readDep('src/core/api/client.ts', 'src/core/util/u.ts'), // api → util：纯值读取
  { ...dep('src/core/impl/i.ts', 'src/core/api/client.ts'), invokeKinds: ['new'] }, // impl → api：组装（经由不是入口：U4 违规）
  { ...typeDep('src/core/impl/i.ts', 'src/core/api/client.ts', 'src/core/api/index.ts', 2), names: ['get'], inherits: [{ name: 'get', clause: 'implements', decl: 'interface' }] }, // 端口实现
  dep('src/core/util/u.ts', 'src/core/impl/i.ts'), // util → impl：交互使用，没有关系覆盖（K7）
  { ...dep('src/core/util/u.ts', 'src/core/impl/i.ts', 'src/core/impl/i.ts', 2), invokeKinds: ['extends'], inherits: [{ name: 'Impl', clause: 'extends', decl: 'class' }] }, // 子类
]
const coreSetup = (deps = CORE) => {
  const { index } = loadModel(files())
  const own = assignFiles(index, SRC, [])
  const code: CodeDeps = { deps, external: {}, parsed: 6 }
  return { index, own, report: governanceReport(index, own, { files: SRC, packages: {} }, code, null) }
}

describe('K14 结构边的种类与档', () => {
  it('文件依赖按事实归类：组装、子类、端口实现，其余为依赖；有调用的组装 / 继承另计依赖', () => {
    const ports = new Set(['get'])
    expect(fileKinds(CORE[3], ports)).toEqual(['assembly'])
    expect(fileKinds(CORE[4], ports)).toEqual(['implements'])
    expect(fileKinds(CORE[6], ports)).toEqual(['subclass'])
    expect(fileKinds(CORE[1], ports)).toEqual(['dependency'])
    expect(fileKinds({ ...CORE[3], invokeKinds: ['new', 'call'] }, ports)).toEqual(['assembly', 'dependency'])
    // extends 指向端口（接口名）的是端口实现，不是子类
    expect(fileKinds({ ...CORE[6], inherits: [{ name: 'get', clause: 'extends', decl: 'class' }] }, ports)).toEqual(['implements'])
  })

  it('档取最强：交互使用 > 值使用（纯值读取）> 只引类型', () => {
    expect(tierOf([CORE[1], CORE[2], CORE[0]])).toBe('invokes')
    expect(tierOf([CORE[1], CORE[2]])).toBe('value')
    expect(tierOf([CORE[1]])).toBe('type')
  })

  it('投影到内核层：一对节点同方向按种类各一条边，依赖边带档与文件条数，只引类型的计数', () => {
    const { index, report } = coreSetup()
    const view = projectLevel(index, 'core')
    const { edges, typeOnly } = levelDeps(index, view, report)
    const brief = edges.map(e => `${e.id}${e.tier ? `/${e.tier}` : ''}×${e.files}`).sort()
    expect(brief).toEqual([
      'assembly:core.impl->core.api×1',
      'dependency:core.api->core.util/value×1',
      'dependency:core.impl->core.util/invokes×1',
      'dependency:core.util->core.api/type×1',
      'dependency:core.util->core.impl/invokes×1',
      'implements:core.impl->core.api×1',
      'subclass:core.util->core.impl×1',
    ])
    expect(typeOnly).toBe(1)
    // 选中落到 K10 的同一个键：两端节点的模块 ID；同一对节点的各种类共用一条模块依赖
    const asm = edges.find(e => e.kind === 'assembly')!
    expect([asm.fromModule, asm.toModule, asm.deps]).toEqual(['core.impl', 'core.api', ['core.impl->core.api']])
  })

  it('sample：根层（分层总览）上模块依赖落到带，各带之间一对一条依赖边，聚合的模块依赖条数为线宽', () => {
    const { index, report } = sampleSetup()
    const view = projectLevel(index, index.rootId)
    const { edges } = levelDeps(index, view, report)
    const infraToApp = edges.find(e => e.kind === 'dependency' && e.from === 'infra' && e.to === 'app')!
    expect(infraToApp.deps.sort()).toEqual(['infra.framework.extra->app.solution.core', 'infra.mus.core->app.solution.core'])
    expect(infraToApp.tier).toBe('invokes')
  })
})

describe('K14 结构边的文件依赖（依赖边面板经 desk.facts 取，T5 分层修正）', () => {
  it('structureEdgeFiles：只列归入这条边种类的文件依赖；同一对节点的组装与端口实现各自分开', () => {
    const { index, report } = coreSetup()
    const { edges } = levelDeps(index, projectLevel(index, 'core'), report)
    const byId = new Map(edges.map(e => [e.id, e]))
    const lines = (id: string) => structureEdgeFiles(index, report, byId.get(id)!).map(f => `${f.from}:${f.line}`)
    expect(lines('assembly:core.impl->core.api')).toEqual(['src/core/impl/i.ts:1'])
    expect(lines('implements:core.impl->core.api')).toEqual(['src/core/impl/i.ts:2'])
    expect(lines('dependency:core.util->core.impl')).toEqual(['src/core/util/u.ts:1'])
    expect(structureEdgeFiles(index, report, { kind: 'dependency', deps: ['no->such'] })).toEqual([])
  })
})

describe('K17 交互覆盖数与未解释', () => {
  it('依赖边带覆盖它的关系与事实覆盖；覆盖 0 的交互使用标未解释（即 K7），值使用 / 只引类型不标', () => {
    const { index, report } = coreSetup()
    const { edges } = levelDeps(index, projectLevel(index, 'core'), report)
    const byId = new Map(edges.map(e => [e.id, e]))
    expect(byId.get('dependency:core.impl->core.util')!.coverage).toEqual({ relations: ['rel.3'], implementers: 0, subclass: 0, assembly: 0 })
    expect(byId.get('dependency:core.impl->core.util')!.unexplained).toBeUndefined()
    const lone = byId.get('dependency:core.util->core.impl')!
    expect(lone.coverage!.relations).toEqual([])
    expect(lone.coverage!.subclass).toBe(1)
    expect(lone.unexplained).toBe(true)
    expect(report.undescribed.map(d => d.key)).toContain('core.util->core.impl')
    expect(byId.get('dependency:core.api->core.util')!.unexplained).toBeUndefined()
    expect(byId.get('dependency:core.util->core.api')!.unexplained).toBeUndefined()
  })

  it('UI 层：未解释的交互与 K9 叠加线同一口径；streams 反向的关系也算覆盖', () => {
    const { index, report } = setup()
    const { edges } = levelDeps(index, projectLevel(index, 'ui'), report)
    const dep = (from: string, to: string) => edges.find(e => e.kind === 'dependency' && e.from === from && e.to === to)!
    expect(dep('ui.view', 'boundary:core').unexplained).toBe(true)
    expect(dep('ui.store', 'boundary:core').coverage!.relations).toEqual(['rel.2', 'rel.6'])
    expect(dep('ui.store', 'boundary:core').unexplained).toBeUndefined()
  })
})

describe('K17 交互图互查（模块面板经 desk.facts 取，T5 分层修正）', () => {
  it('isolatedInteractions：涉及模块子树、两端之间没有任何依赖的交互关系（K6 报警的未证实）', () => {
    const { index, report } = setup()
    const isolated = [...report.relations].filter(([, c]) => c.status === 'unconfirmed' && c.isolated).map(([id]) => id)
    expect(isolated).toEqual(expect.arrayContaining(['rel.3', 'rel.4']))
    expect(isolatedInteractions(index, report, 'core.impl')).toEqual(expect.arrayContaining(['rel.3', 'rel.4']))
    expect(isolatedInteractions(index, report, 'core.api')).toContain('rel.4')
    expect(isolatedInteractions(index, report, 'core.api')).not.toContain('rel.3')
    // 系统根：全部 isolated 的交互
    expect(isolatedInteractions(index, report, index.rootId).sort()).toEqual(isolated.sort())
  })
})

describe('U15 规则叠加', () => {
  it('违规（取最严的状态）、允许（列出允许它的规则）、无约束', () => {
    const { index, report } = setup()
    const { edges } = levelDeps(index, projectLevel(index, 'ui'), report)
    const dep = (from: string, to: string) => edges.find(e => e.kind === 'dependency' && e.from === from && e.to === to)!
    const allowed = dep('ui.view', 'ui.store').ruling
    expect(allowed.verdict).toBe('allowed')
    expect(allowed.allowedBy.map(b => `${b.kind}:${b.at}`)).toEqual(['deps:ui.view'])
    const bad = dep('ui.view', 'boundary:core').ruling
    expect([bad.verdict, bad.status]).toEqual(['violation', 'open'])
    // 层规则允许 UI 依赖内核（U2），白名单不许 View 依赖 Store 以外（U3）
    expect(bad.violations.map(v => v.kind)).toEqual(['deps'])
    // 内核层依赖 UI：一条违规、一条已豁免（U5）——最严的是无基线的违规
    const back = dep('boundary:core', 'ui.view').ruling
    expect([back.verdict, back.status]).toEqual(['violation', 'open'])
    expect(back.violations.map(v => v.status).sort()).toEqual(['allowed', 'open'])
  })

  it('基线内的为已知、全部豁免的为已豁免；层内没有规则约束的为无约束', () => {
    const { report: open } = setup()
    const all = open.violations.filter(v => v.status !== 'allowed').map(v => v.key)
    const { index, report } = setup(undefined, { createdAt: 't', violations: all, cyclicity: { modules: 99, files: 99 } })
    const { edges } = levelDeps(index, projectLevel(index, 'ui'), report)
    expect(edges.find(e => e.from === 'ui.view' && e.to === 'boundary:core')!.ruling.status).toBe('known')
    const c = coreSetup()
    const core = levelDeps(c.index, projectLevel(c.index, 'core'), c.report).edges
    expect(core.find(e => e.id === 'dependency:core.impl->core.util')!.ruling.verdict).toBe('unconstrained')
    // 访问面：经入口的只引类型依赖是允许，绕过入口的组装是违规
    expect(core.find(e => e.id === 'dependency:core.util->core.api')!.ruling.allowedBy.map(b => b.kind)).toEqual(['exposes'])
    expect(core.find(e => e.id === 'assembly:core.impl->core.api')!.ruling.verdict).toBe('violation')
  })
})

describe('K16 扇入、扇出与不稳定度', () => {
  it('按子树外的不同模块数计，与层次无关；I = Ce ÷ (Ca + Ce)，无依赖为 null', () => {
    const { index, report } = setup()
    const m = structureMetrics(index, report)
    expect(m.get('core.util')).toEqual({ module: 'core.util', ca: 2, ce: 1, instability: 1 / 3, band: 'balanced' })
    expect(m.get('core')).toMatchObject({ ca: 2, ce: 1 })
    expect(m.get('ui')).toMatchObject({ ca: 2, ce: 2, instability: 0.5 })
    expect(m.get('core.future')).toEqual({ module: 'core.future', ca: 0, ce: 0, instability: null, band: null })
    expect(m.has(index.rootId)).toBe(false)
  })

  it('三档与「只看值依赖」：去掉只引类型重算', () => {
    expect([stabilityBand(0), stabilityBand(0.5), stabilityBand(0.9), stabilityBand(null)]).toEqual(['stable', 'balanced', 'unstable', null])
    const { index, report } = coreSetup()
    expect(structureMetrics(index, report).get('core.api')).toMatchObject({ ca: 2, ce: 1 })
    expect(structureMetrics(index, report, { valuesOnly: true }).get('core.api')).toMatchObject({ ca: 1, ce: 1 })
  })

  it('明细：贡献最多的依赖方 / 被依赖方与本层节点数（sample）', () => {
    const { index, report } = sampleSetup()
    const d = moduleMetrics(index, report, 'app.solution.core', { view: projectLevel(index, 'app') })!
    expect(d.topDependents.map(x => x.module).sort()).toEqual(['infra.framework.extra', 'infra.mus.core'])
    expect(d.topDependencies).toEqual([{ module: 'domain.models.core', files: 1 }])
    // 在 app 层：依赖方都在边界节点 infra 上，被依赖方在 domain 上
    expect(d.level).toEqual({ in: 1, out: 1 })
  })
})

describe('U17 稳定依赖方向', () => {
  const metrics = new Map<string, ModuleMetrics>([
    ['a', { module: 'a', ca: 9, ce: 1, instability: 0.1, band: 'stable' }],
    ['b', { module: 'b', ca: 1, ce: 4, instability: 0.8, band: 'unstable' }],
    ['c', { module: 'c', ca: 2, ce: 2, instability: 0.35, band: 'balanced' }],
  ])
  const { index } = loadModel([
    { path: 'system.yaml', text: 'system: { id: sys, name: Sys }' },
    { path: 'modules/m.yaml', text: 'modules:\n  - { id: a, name: A, responsibility: x }\n  - { id: b, name: B, responsibility: x }\n  - { id: c, name: C, role: shared, responsibility: x }' },
  ])

  it('依赖方的 I 比被依赖方小 0.3 以上时提示；反方向、差不到阈值的不提示', () => {
    expect(againstStability(index, metrics, 'a', 'b')).toEqual({ from: 0.1, to: 0.8 })
    expect(againstStability(index, metrics, 'b', 'a')).toBeNull()
    expect(againstStability(index, metrics, 'a', 'b', 0.8)).toBeNull()
  })

  it('被依赖方是共用件、或 I 无定义时不提示', () => {
    expect(againstStability(index, metrics, 'a', 'c', 0.1)).toBeNull()
    expect(againstStability(index, metrics, 'a', 'zz')).toBeNull()
  })

  it('againstStabilityOf：一组直接依赖中违背方向的，带两端的 I（面板「逆稳定」提示行）', () => {
    expect(againstStabilityOf(index, metrics, 'a', ['b', 'c', 'zz'])).toEqual([{ module: 'b', hit: { from: 0.1, to: 0.8 } }])
    expect(againstStabilityOf(index, metrics, 'b', ['a', 'c'])).toEqual([])
  })

  it('标在依赖边上（sample：领域层反过来依赖应用层后，较稳定的应用层依赖较易变的领域层）', () => {
    const { index: idx, report } = sampleSetup([dep('src/domain/m.ts', 'src/app/s.ts')])
    const m = structureMetrics(idx, report)
    expect([m.get('app')!.instability, m.get('domain')!.instability]).toEqual([0.25, 0.5])
    const edges = levelDeps(idx, projectLevel(idx, idx.rootId), report, { metrics: m, threshold: 0.2 }).edges
    expect(edges.find(e => e.from === 'app' && e.to === 'domain')!.againstStability).toEqual({ from: 0.25, to: 0.5 })
    expect(edges.find(e => e.from === 'domain' && e.to === 'app')!.againstStability).toBeUndefined()
    // 缺省阈值 0.3：差 0.25 不提示
    expect(levelDeps(idx, projectLevel(idx, idx.rootId), report).edges.some(e => e.againstStability)).toBe(false)
  })
})

describe('K15 影响面', () => {
  it('传入 / 传出闭包按最短距离排序，环成员标出，子树内的不列', () => {
    const { index, report } = setup()
    const imp = impactOf(index, report, 'core.util')!
    expect(imp.incoming.map(e => `${e.module}@${e.distance}${e.inCycle ? '⟳' : ''}`)).toEqual(['ui.store@1⟳', 'ui.view@1⟳', 'core.impl@2'])
    expect(imp.outgoing.map(e => `${e.module}@${e.distance}`)).toEqual(['ui.view@1', 'ui.store@2', 'core.api@3'])
    expect(imp.inCycle).toBe(true)
    // 父模块按子树算：内核层的传入是 UI 层的两个模块
    expect(impactOf(index, report, 'core')!.incoming.map(e => e.module)).toEqual(['ui.store', 'ui.view'])
    expect(impactOf(index, report, 'nope')).toBeNull()
  })

  it('只看值依赖时去掉只引类型；给了归属时计文件数', () => {
    const { index, own, report } = coreSetup()
    expect(impactOf(index, report, 'core.api')!.incoming.map(e => e.module)).toEqual(['core.impl', 'core.util'])
    const values = impactOf(index, report, 'core.api', { valuesOnly: true, own })!
    expect(values.incoming.map(e => e.module)).toEqual(['core.impl', 'core.util'])
    expect(values.incoming.map(e => e.distance)).toEqual([1, 2])
    expect(values.files).toEqual({ incoming: 2, outgoing: 2 })
  })

  it('投影到本层：节点 → 方向与最短距离，两个方向都在的为 both，自身所在的节点不列（sample）', () => {
    const { index, report } = sampleSetup()
    const imp = impactOf(index, report, 'app.solution.core')!
    const lv = levelImpact(index, projectLevel(index, index.rootId), imp)
    expect(Object.fromEntries(lv)).toEqual({
      infra: { direction: 'in', distance: 1, inCycle: false },
      domain: { direction: 'out', distance: 1, inCycle: false },
    })
  })
})

describe('U16 没有代码事实时的允许依赖图', () => {
  it('层的 mayDependOn 与白名单投影为本层的允许边，同一对节点合并；注明只画允许依赖', () => {
    const { index } = loadModel(sampleFiles())
    const root = allowedDeps(index, projectLevel(index, index.rootId))
    expect(root.note).toBe(ALLOWED_ONLY_NOTE)
    expect(root.edges.map(e => e.id).sort()).toEqual(['allowed:app->domain', 'allowed:infra->app', 'allowed:infra->domain'])
    // 层规则的依赖方是本层的父模块自己（mapEndpoint 落不到本层节点）时不画；白名单照画
    const h = loadModel(files())
    const ui = allowedDeps(h.index, projectLevel(h.index, 'ui'))
    expect(ui.edges.map(e => `${e.id}:${e.rules.map(r => r.kind).join('+')}`)).toEqual(['allowed:ui.view->ui.store:deps'])
    const top = allowedDeps(h.index, projectLevel(h.index, h.index.rootId))
    expect(top.edges.map(e => e.id)).toEqual(['allowed:ui->core'])
  })

  it('活动草图的层 mayDependOn 一并投影；一条都没有时说明原因', () => {
    const { index } = loadModel(sampleFiles())
    const sk = allowedDeps(index, projectLevel(index, index.rootId), [{ layer: 'domain', mayDependOn: ['infra'] }])
    expect(sk.edges.find(e => e.id === 'allowed:domain->infra')!.rules).toEqual([{ kind: 'sketch', at: 'domain', to: 'infra' }])
    const bare = loadModel(files('rules:\n  layers: false\n'))
    expect(allowedDeps(bare.index, projectLevel(bare.index, 'ui'))).toEqual({ edges: [], note: NO_ALLOWED_NOTE })
  })

  it('structureView：没有报告时为允许依赖图并给出不适用的原因；有报告时为结构边', () => {
    const { index, report } = setup()
    const view = projectLevel(index, 'ui')
    const none = structureView(index, view, null)
    expect(none.facts).toBe(false)
    if (!none.facts) expect(none.reason).toBe(NO_FACTS_REASON)
    const real = structureView(index, view, report)
    expect(real.facts && real.edges.length).toBeGreaterThan(0)
  })
})

describe('V12 的模型层查询', () => {
  it('这对节点之间有没有结构边；同一对节点的交互边取关系类型声明顺序中的第一条', () => {
    const { index, report } = setup()
    const view = projectLevel(index, 'ui')
    expect(hasStructureEdge(index, view, report, 'ui.view', 'ui.store')).toBe(true)
    expect(hasStructureEdge(index, view, report, 'ui.store', 'ui.view')).toBe(false)
    expect(hasStructureEdge(index, view, report, 'ui.view', 'core.util')).toBe(true)
    expect(interactionEdgeBetween(view, 'ui.view', 'ui.store')).toBe('ui.view->ui.store:calls')
    expect(interactionEdgeBetween(view, 'ui.store', 'ui.view')).toBeUndefined()
  })
})

describe('Q15 入度最高的共用件', () => {
  it('共用件中扇入最大的、它的 Ca 与占系统模块数的比例；没有被依赖的共用件时不给', () => {
    const h = setup()
    // core.util 与 core.api 当共用件：core.util 的 Ca 2 最大
    const top = topSharedFanIn(h.index, h.report, ['core.api', 'core.util'])
    const modules = h.index.modules.size - (h.index.modules.has(h.index.rootId) ? 1 : 0)
    expect(top).toEqual({ module: 'core.util', ca: 2, ratio: 2 / modules })
    expect(topSharedFanIn(h.index, h.report, ['core.future'])).toBeUndefined()
  })

  it('健康度的共用件一行带上它（sample：Models 认作共用件）', () => {
    const { index, own, report } = sampleSetup(undefined, undefined, 'shared')
    const s = sharedHealth(index, own, report)!
    expect(s.topFanIn).toEqual({ module: 'domain.models', ca: 1, ratio: 1 / (index.modules.size - (index.modules.has(index.rootId) ? 1 : 0)) })
    expect(sharedHealth(index, own, { sharedReverse: [] })!.topFanIn).toBeUndefined()
  })
})

// ── sample 数据源：tests/fixtures/sample 的描述，补上归属与几条文件依赖 ──

const SAMPLE_REFS = `
modules:
  - { id: app.solution.core, parent: app.solution, name: Core, responsibility: x, codeRefs: [src/app/**] }
  - { id: infra.framework.extra, parent: infra.framework, name: Extra, responsibility: x, codeRefs: [src/framework/**] }
  - { id: infra.mus.core, parent: infra.mus, name: Core, responsibility: x, codeRefs: [src/mus/**] }
`
const SAMPLE_SRC = ['src/app/s.ts', 'src/domain/m.ts', 'src/framework/extra.ts', 'src/mus/m.ts']
const SAMPLE_DEPS: FileDep[] = [
  dep('src/framework/extra.ts', 'src/app/s.ts'),
  dep('src/mus/m.ts', 'src/app/s.ts'),
  readDep('src/app/s.ts', 'src/domain/m.ts'),
]

function sampleSetup(extra: FileDep[] = [], domainRefs = '  - { id: domain.models.core, parent: domain.models, name: Core, responsibility: x, codeRefs: [src/domain/**] }\n', role?: string) {
  const roles: Record<string, string> = role ? { 'intent/roles.yaml': `roles:\n  domain.models: ${role}\n` } : {}
  const { index } = loadModel(sampleFiles({ 'modules/zz-refs.yaml': SAMPLE_REFS + domainRefs, ...roles }))
  const own = assignFiles(index, SAMPLE_SRC, [])
  const code: CodeDeps = { deps: [...SAMPLE_DEPS, ...extra], external: {}, parsed: 4 }
  return { index, own, report: governanceReport(index, own, { files: SAMPLE_SRC, packages: {} }, code, null) }
}

describe('O13③ 分层总览中核心模块的跨层依赖（chipDeps）', () => {
  it('一端落在给出的核心块子树内时投到块、另一端投到所在的带；按种类各一条，带档；没给块时为空', () => {
    const raw = [
      { path: 'system.yaml', text: 'system: { id: sys, name: Sys }' },
      { path: 'modules/layers.yaml', text: LAYERS.replace('{ id: core.api, name: Api,', '{ id: core.api, name: Api, role: core,') },
      { path: 'rules.yaml', text: RULES },
    ]
    const { index } = loadModel(raw)
    const own = assignFiles(index, SRC, [])
    const deps = [...CORE, dep('src/ui/store/s.ts', 'src/core/api/client.ts', 'src/core/api/index.ts')]
    const report = governanceReport(index, own, { files: SRC, packages: {} }, { deps, external: {}, parsed: 6 }, null)
    const view = projectLevel(index, index.rootId, { showBoundaries: true })
    expect(view.mode).toBe('layered')
    expect(chipDeps(index, view, report, new Set())).toEqual([])
    const out = chipDeps(index, view, report, new Set(['core.api']))
    expect(out.map(e => e.id)).toEqual(['chip:dependency:ui->core.api'])
    expect(out[0]).toMatchObject({ kind: 'dependency', from: 'ui', to: 'core.api', fromModule: 'ui', toModule: 'core.api', tier: 'invokes', files: 1 })
  })
})
