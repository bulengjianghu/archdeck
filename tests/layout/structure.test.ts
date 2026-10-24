/**
 * 画布场景的结构视角（ADR-0031）：结构边的投影与节点不动（L15、V12）、编码数据（L16）、指标角标（L17）、
 * 共用件折叠（O13）、影响面分档（K15）、允许依赖图（U16）、只引类型收起与计数（L15）、选中依赖边（K10）。
 */
import { describe, expect, it } from 'vitest'
import {
  assignFiles,
  governanceReport,
  impactOf,
  levelFacts,
  loadModel,
  projectLevel,
  structureMetrics,
  structureView,
  type CodeDeps,
  type FileDep,
  type RawFile,
} from '@/model'
import { layoutView } from '../../src/layout/layout'
import { canvasScene, type CanvasInput, type StructureInput } from '../../src/layout/canvas'
import { LAYERS, RULES, SRC, dep } from '../model/governance/helpers'

const typeDep = (from: string, to: string, via = to, line = 1): FileDep => ({ from, to, via, kind: 'type', line })
const readDep = (from: string, to: string, via = to, line = 1): FileDep => ({ from, to, via, kind: 'value', line, uses: true })

/** 内核层内部：impl → util 交互使用、util → api 只引类型、api → util 值使用、impl → api 组装 + 端口实现、util → impl 交互使用 + 子类、ui.store → core.api */
const DEPS: FileDep[] = [
  dep('src/core/impl/i.ts', 'src/core/util/u.ts'),
  typeDep('src/core/util/u.ts', 'src/core/api/client.ts', 'src/core/api/index.ts'),
  readDep('src/core/api/client.ts', 'src/core/util/u.ts'),
  { ...dep('src/core/impl/i.ts', 'src/core/api/client.ts', 'src/core/api/index.ts'), invokeKinds: ['new'] },
  {
    ...typeDep('src/core/impl/i.ts', 'src/core/api/client.ts', 'src/core/api/index.ts', 2),
    names: ['get'],
    inherits: [{ name: 'get', clause: 'implements', decl: 'interface' }],
  },
  dep('src/core/util/u.ts', 'src/core/impl/i.ts'),
  {
    ...dep('src/core/util/u.ts', 'src/core/impl/i.ts', 'src/core/impl/i.ts', 2),
    invokeKinds: ['extends'],
    inherits: [{ name: 'Impl', clause: 'extends', decl: 'class' }],
  },
  dep('src/ui/store/s.ts', 'src/core/api/client.ts', 'src/core/api/index.ts'),
]

function build(layers = LAYERS, deps = DEPS) {
  const raw: RawFile[] = [
    { path: 'system.yaml', text: 'system: { id: sys, name: Sys }' },
    { path: 'modules/layers.yaml', text: layers },
    { path: 'rules.yaml', text: RULES },
  ]
  const { index } = loadModel(raw)
  const own = assignFiles(index, SRC, [])
  const code: CodeDeps = { deps, external: {}, parsed: 6 }
  return { index, report: governanceReport(index, own, { files: SRC, packages: {} }, code, null) }
}

type Built = ReturnType<typeof build>

async function input(b: Built, level: string, s: Partial<StructureInput> = {}, rest: Partial<CanvasInput> = {}): Promise<CanvasInput> {
  const view = projectLevel(b.index, level, { showBoundaries: true })
  const structure: StructureInput = {
    view: structureView(b.index, view, b.report),
    typeOnly: false,
    metrics: structureMetrics(b.index, b.report),
    impact: null,
    impactMode: 'in',
    cycles: levelFacts(b.index, view, b.report).cycles,
    report: b.report,
    ...s,
  }
  return {
    positioned: await layoutView(view),
    index: b.index,
    selection: null,
    hover: null,
    stage: null,
    scenarioView: null,
    emphasis: null,
    participants: new Map(),
    mode: 'hide',
    reveal: [],
    diff: null,
    fileHits: null,
    branchPointId: null,
    structure,
    ...rest,
  }
}

const deps = (s: ReturnType<typeof canvasScene>) => s.edges.filter(e => e.type === 'dep')
const node = (s: ReturnType<typeof canvasScene>, id: string) => s.nodes.find(n => n.id === id)!

describe('L15 结构边的投影：换边不换节点', () => {
  it('结构视角的节点与位置与交互视角一样（V12），交互边换成结构边，一对节点同方向按种类各一条', async () => {
    const b = build()
    const inS = await input(b, 'core')
    const s = canvasScene(inS)
    const i = canvasScene({ ...inS, structure: null })
    expect(s.nodes.map(n => [n.id, n.position, n.width, n.height])).toEqual(i.nodes.map(n => [n.id, n.position, n.width, n.height]))
    expect(s.edges.every(e => e.type === 'dep')).toBe(true)
    expect(i.edges.every(e => e.type === 'route')).toBe(true)
    // 只引类型（util → api）缺省收起
    expect(
      deps(s)
        .map(e => e.id)
        .sort(),
    ).toEqual([
      'assembly:core.impl->core.api',
      'dependency:core.api->core.util',
      'dependency:core.impl->core.util',
      'dependency:core.util->core.impl',
      'implements:core.impl->core.api',
      'subclass:core.util->core.impl',
    ])
    // 结构边不参与布局：直连（两点直线、不是曲线），两端落在两端节点的边缘上，一律画在节点之下
    const box = (id: string) => inS.positioned!.nodes.get(id)!
    const onRim = (p: { x: number; y: number }, b: { x: number; y: number; w: number; h: number }) =>
      p.x >= b.x - 0.01 &&
      p.x <= b.x + b.w + 0.01 &&
      p.y >= b.y - 0.01 &&
      p.y <= b.y + b.h + 0.01 &&
      [p.x - b.x, b.x + b.w - p.x, p.y - b.y, b.y + b.h - p.y].some(d => Math.abs(d) < 0.01)
    for (const e of deps(s)) {
      expect(e.data.route.curve).toBeFalsy()
      expect(e.data.route.points).toHaveLength(2)
      expect(onRim(e.data.route.points[0], box(e.source))).toBe(true)
      expect(onRim(e.data.route.points[1], box(e.target))).toBe(true)
      expect(e.zIndex).toBe(1)
    }
    // 双向（impl ⇄ util）的两条不重合
    const a = deps(s).find(e => e.id === 'dependency:core.impl->core.util')!.data.route.points
    const r = deps(s).find(e => e.id === 'dependency:core.util->core.impl')!.data.route.points
    expect(JSON.stringify(a)).not.toBe(JSON.stringify([...r].reverse()))
  })

  it('只引类型：缺省收起并计数；打开偏好后画出、计数为 0', async () => {
    const b = build()
    const closed = canvasScene(await input(b, 'core'))
    expect(closed.structure).toEqual({ typeOnlyHidden: 1, note: null })
    const open = canvasScene(await input(b, 'core', { typeOnly: true }))
    expect(open.structure!.typeOnlyHidden).toBe(0)
    const t = deps(open).find(e => e.id === 'dependency:core.util->core.api')!
    expect(t.data.dep).toMatchObject({ kind: 'dependency', tier: 'type' })
  })

  it('边界节点的结构边只在聚焦其一端时画（同 L4）', async () => {
    const b = build()
    const i = await input(b, 'core')
    const quiet = deps(canvasScene(i)).map(e => e.id)
    expect(quiet.some(id => id.includes('boundary:'))).toBe(false)
    const hovered = deps(canvasScene({ ...i, hover: 'core.api' })).map(e => e.id)
    expect(hovered).toContain('dependency:boundary:ui->core.api')
  })

  it('K10：单击的键是两端模块，选中依赖时这对节点的各种类结构边都高亮；交互视角的叠加不画', async () => {
    const b = build()
    const s = canvasScene(await input(b, 'core', {}, { selection: { kind: 'dep', id: 'core.impl->core.api' } }))
    const sel = deps(s)
      .filter(e => e.data.selected)
      .map(e => e.id)
    expect(sel.sort()).toEqual(['assembly:core.impl->core.api', 'implements:core.impl->core.api'])
    expect(deps(s).every(e => `${e.data.dep!.fromModule}->${e.data.dep!.toModule}` === e.id.slice(e.id.indexOf(':') + 1))).toBe(true)
    expect(s.edges.some(e => e.data.temp === 'code' || e.data.temp === 'assembly')).toBe(false)
  })
})

describe('L16 结构边的编码数据', () => {
  it('依赖带档，事实种类不带；线宽按聚合的模块依赖条数三档；未解释与违规照标', async () => {
    const b = build()
    const s = canvasScene(await input(b, 'core', { typeOnly: true }))
    const by = (id: string) => deps(s).find(e => e.id === id)!.data
    expect(by('dependency:core.impl->core.util').dep!.tier).toBe('invokes')
    expect(by('dependency:core.api->core.util').dep!.tier).toBe('value')
    expect(by('subclass:core.util->core.impl').dep!.tier).toBeUndefined()
    expect(by('dependency:core.impl->core.util').weight).toBe(1)
    // util → impl：有调用、没有关系覆盖（K7）→ 未解释，标签只有异常标记
    expect(by('dependency:core.util->core.impl')).toMatchObject({ label: '未解释', warn: true, dep: { unexplained: true } })
    expect(by('dependency:core.impl->core.util').label).toBe('')
    expect(by('dependency:core.impl->core.util').dep!.title).toContain('交互覆盖 1 条')
  })

  it('U15：违规按状态给出三档（新增 / 已知 / 已豁免），只标违规', async () => {
    const b = build(LAYERS, [...DEPS, dep('src/core/impl/i.ts', 'src/ui/view/a.ts')])
    const s = canvasScene(await input(b, b.index.rootId))
    const v = deps(s).find(e => e.id === 'dependency:core->ui')!
    expect(v.data.dep!.violation).toBe('new')
    expect(deps(s).find(e => e.id === 'dependency:ui->core')!.data.dep!.violation).toBeUndefined()
  })
})

describe('L17 指标角标、Y4 环常显', () => {
  it('结构视角每个模块节点标 Ca / Ce 与不稳定度档，交互视角不标；环编号不受代码事实开关影响', async () => {
    const b = build()
    const i = await input(b, 'core')
    const s = canvasScene(i)
    const m = structureMetrics(b.index, b.report).get('core.impl')!
    expect(node(s, 'core.impl').data.metrics).toEqual({ ca: m.ca, ce: m.ce, instability: m.instability, band: m.band })
    expect(node(canvasScene({ ...i, structure: null }), 'core.impl').data.metrics).toBeUndefined()
    // impl ↔ util 互相依赖：同一个环（交互视角未开代码事实时不标）
    expect(node(s, 'core.impl').data.cycle).toBeDefined()
    expect(node(s, 'core.impl').data.cycle).toBe(node(s, 'core.util').data.cycle)
    expect(node(canvasScene({ ...i, structure: null }), 'core.impl').data.cycle).toBeUndefined()
  })
})

describe('O13 共用件折叠（方案丙）', () => {
  const shared = (b: string) =>
    b.replace('{ id: core.util, name: Util, responsibility: 工具,', '{ id: core.util, name: Util, role: shared, responsibility: 工具,')

  it('与架上共用件之间的边缺省不画、聚焦时画；共用件反向依赖使用者的、在环中的照画；「共用 ×N」按依赖计（含只引类型）', async () => {
    const b = build(shared(LAYERS), [
      dep('src/core/impl/i.ts', 'src/core/util/u.ts'), // impl → util
      readDep('src/core/api/client.ts', 'src/core/util/u.ts'), // api → util：纯值读取
      typeDep('src/core/api/client.ts', 'src/core/util/u.ts', 'src/core/util/u.ts', 2),
      dep('src/core/util/u.ts', 'src/core/impl/i.ts'), // util → impl：共用件依赖使用者，与 impl → util 成环
    ])
    const i = await input(b, 'core')
    expect(i.positioned!.view.shelf).toEqual(['core.util'])
    const quiet = deps(canvasScene(i)).map(e => e.id)
    expect(quiet).not.toContain('dependency:core.api->core.util')
    // util → impl：共用件依赖使用者（U12 反向依赖）照画；impl → util 与它成环（Y4）照画
    expect(quiet).toContain('dependency:core.util->core.impl')
    expect(quiet).toContain('dependency:core.impl->core.util')
    const hovered = deps(canvasScene({ ...i, hover: 'core.api' })).map(e => e.id)
    expect(hovered).toContain('dependency:core.api->core.util')
    const s = canvasScene(i)
    expect(node(s, 'core.impl').data.sharedCount).toBe(1)
    expect(node(s, 'core.api').data.sharedCount).toBe(1)
    // 架上的块只标入
    expect(node(s, 'core.util').data.metrics?.inOnly).toBe(true)
  })
})

describe('K15 影响面分档', () => {
  async function withImpact(b: Built, module: string, mode: 'in' | 'out' | 'both') {
    const impact = impactOf(b.index, b.report, module)
    return canvasScene(await input(b, 'core', { impact, impactMode: mode }, { selection: { kind: 'module', id: module } }))
  }

  it('选中模块时闭包按方向与距离标在节点上，闭包外变淡；方向随偏好', async () => {
    const b = build(LAYERS, [
      dep('src/core/impl/i.ts', 'src/core/util/u.ts'), // impl → util
      dep('src/ui/store/s.ts', 'src/core/impl/i.ts'), // ui.store → impl：ui 离 util 两步
    ])
    const inS = await withImpact(b, 'core.util', 'in')
    expect(node(inS, 'core.impl').data.impact).toMatchObject({ direction: 'in', distance: 1 })
    expect(node(inS, 'boundary:ui').data.impact).toMatchObject({ direction: 'in', distance: 2 })
    expect(node(inS, 'core.util').data.impactSelf).toBe(true)
    expect(node(inS, 'core.util').data.dim).toBe(false)
    expect(node(inS, 'core.api').data.dim).toBe(true)
    expect(node(inS, 'core.api').data.impact).toBeUndefined()
    const outS = await withImpact(b, 'core.util', 'out')
    expect(node(outS, 'core.impl').data.impact).toBeUndefined()
    const outImpl = await withImpact(b, 'core.impl', 'out')
    expect(node(outImpl, 'core.util').data.impact).toMatchObject({ direction: 'out', distance: 1 })
  })
})

describe('U16 没有代码事实时的允许依赖图', () => {
  it('只画允许边（点线，不带档与指标），画布角注明', async () => {
    const b = build()
    const view = projectLevel(b.index, b.index.rootId)
    const s = canvasScene(await input(b, b.index.rootId, { view: structureView(b.index, view, null), metrics: null, cycles: null, report: null }))
    expect(deps(s).map(e => [e.id, e.data.dep!.kind])).toEqual([['allowed:ui->core', 'allowed']])
    expect(s.structure!.note).toBe('没有代码事实，只画允许依赖')
    expect(s.nodes.every(n => !n.data.metrics)).toBe(true)
  })

  it('正在读取代码事实时不画边，只给说明', async () => {
    const b = build()
    const s = canvasScene(await input(b, 'core', { view: null, note: '正在读取代码事实…' }))
    expect(deps(s)).toHaveLength(0)
    expect(s.structure!.note).toBe('正在读取代码事实…')
  })
})

describe('O13③ 分层总览', () => {
  const core = (b: string) => b.replace('{ id: core.api, name: Api,', '{ id: core.api, name: Api, role: core,')

  it('带间画层间依赖、直连（带与带之间的竖直直线）；核心模块的跨层依赖只在聚焦它时画', async () => {
    const b = build(core(LAYERS))
    const i = await input(b, b.index.rootId)
    expect(i.positioned!.view.mode).toBe('layered')
    const quiet = canvasScene(i)
    const band = deps(quiet).find(e => e.id === 'dependency:ui->core')!
    expect(band.data.route.points).toHaveLength(2)
    expect(band.data.route.points[0].x).toBe(band.data.route.points[1].x)
    expect(deps(quiet).some(e => e.id.startsWith('chip:'))).toBe(false)
    const hovered = canvasScene({ ...i, hover: 'core.api' })
    expect(deps(hovered).map(e => e.id)).toContain('chip:dependency:ui->core.api')
  })
})
