// @vitest-environment jsdom
/**
 * 画布场景的结构视角（ADR-0031、ADR-0032）：结构边即束（L21：一对节点一条、最强形态与档、线宽按元素级边条数、「×N 元素」角标），
 * 节点不动（L15、V12）、过滤（B1 只引类型 / 只看交互使用、B4 只看未解释）与画布角计数、跨界折叠与悬停画出（B2）、选中束聚焦（B3）与反向高亮承载的交互（L22），
 * 表面展开（C6、L20：元素端口、散开为元素级边、越过入口记号、「表面 W」角标），指标角标（L17）、共用件折叠（O13）、影响面（K15）、允许依赖图（U16）、分层总览（O13③）。
 * 束与显示派生走真实的 DeskState（desk.facts.structureDisplay），画布输入的组装同 GraphCanvas（bundleDesk.ts）。
 */
import { describe, expect, it } from 'vitest'
import { loadModel, projectLevel, structureView, type FileDep } from '@/model'
import { cacheKey, layoutView, type PositionedView } from '../../src/layout/layout'
import { canvasScene, type CanvasInput } from '../../src/layout/canvas'
import { DEPS, MODEL, openDesk, sceneOf, settle } from './bundleDesk'

type Scene = ReturnType<typeof canvasScene>
const deps = (s: Scene) => s.edges.filter(e => e.type === 'dep')
const ids = (s: Scene) =>
  deps(s)
    .map(e => e.id)
    .sort()
const node = (s: Scene, id: string) => s.nodes.find(n => n.id === id)!
const dep = (s: Scene, id: string) => deps(s).find(e => e.id === id)!

describe('L15、L21 束：一对节点一条，换边不换节点', () => {
  it('结构视角的节点与位置与交互视角一样（V12），交互边换成束——一对节点同方向只有一条，走线取并集布局', async () => {
    const desk = await openDesk()
    const { scene: s, positioned: pv } = await sceneOf(desk)
    desk.setMode('interaction')
    const { scene: i } = await sceneOf(desk)
    expect(s.nodes.map(n => [n.id, n.position, n.width, n.height])).toEqual(i.nodes.map(n => [n.id, n.position, n.width, n.height]))
    expect(s.edges.every(e => e.type === 'dep')).toBe(true)
    expect(i.edges.every(e => e.type === 'route')).toBe(true)
    // 只引类型（util → log）收起，跨界（ui → api）折叠
    expect(ids(s)).toEqual([
      'bundle:core.api->core.log',
      'bundle:core.impl->core.api',
      'bundle:core.impl->core.log',
      'bundle:core.impl->core.util',
      'bundle:core.util->core.api',
    ])
    const pairs = deps(s).map(e => `${e.source}|${e.target}`)
    expect(new Set(pairs).size).toBe(pairs.length)
    for (const e of deps(s)) {
      expect(e.data.route.points).toEqual(pv!.edges.get(e.id)!.points)
      expect(e.zIndex).toBe(1)
    }
  })

  it('布局交给 elk 的是束（缓存键按束 ID，布局版本已升）；收起的束仍参与布局，开关切换节点不动', async () => {
    const desk = await openDesk()
    const links = desk.facts.layoutLinks.value!
    expect(links.edges.map(e => e.id).every(id => id.startsWith('bundle:'))).toBe(true)
    expect(links.edges.map(e => e.id)).toContain('bundle:core.util->core.log')
    const key = cacheKey(desk.view.value!, {}, links)
    expect(key).toContain('L21-bundle-1')
    expect(key).toContain('bundle:core.util->core.log')
    const closed = (await sceneOf(desk)).scene
    const open = (await sceneOf(desk, { typeOnly: true })).scene
    expect(ids(closed)).not.toContain('bundle:core.util->core.log')
    expect(ids(open)).toContain('bundle:core.util->core.log')
    expect(closed.nodes.map(n => [n.id, n.position])).toEqual(open.nodes.map(n => [n.id, n.position]))
  })
})

describe('L16、L21① 束的编码', () => {
  it('线型与端点取最强形态、档取最强；线宽按束内元素级边条数三档；形态不止一种时「×N 元素」角标，悬停列各形态与元素', async () => {
    const desk = await openDesk()
    const { scene: s } = await sceneOf(desk, { typeOnly: true })
    const asm = dep(s, 'bundle:core.impl->core.api').data
    expect(asm.dep).toMatchObject({ kind: 'assembly', tier: 'invokes', forms: ['assembly', 'implements'], elements: 2, deps: 2 })
    expect(asm.weight).toBe(2)
    expect(asm.label).toBe('×2 元素')
    expect(asm.dep!.title).toContain('组装：Client（操作）')
    expect(asm.dep!.title).toContain('端口实现：get（端口）')
    // 子类强于使用
    expect(dep(s, 'bundle:core.impl->core.util').data.dep).toMatchObject({ kind: 'subclass', forms: ['subclass', 'use'] })
    expect(dep(s, 'bundle:core.impl->core.log').data.dep).toMatchObject({ kind: 'use', tier: 'value' })
    expect(dep(s, 'bundle:core.util->core.log').data.dep).toMatchObject({ kind: 'use', tier: 'type' })
    // 单一形态不带角标、线宽 1
    const one = dep(s, 'bundle:core.util->core.api').data
    expect(one.label).toBe('')
    expect(one.weight).toBe(1)
    expect(one.dep!.elements).toBeUndefined()
    // api → log：有调用、没有交互覆盖（K7）→ 未解释
    expect(dep(s, 'bundle:core.api->core.log').data).toMatchObject({ label: '未解释', warn: true, dep: { unexplained: true } })
    expect(one.dep!.title).toContain('交互覆盖 2 条')
  })

  it('U15：违规按状态给出三档红晕，违规的束不论档位照画', async () => {
    const rules = MODEL.replace('mayDependOn: []', 'mayDependOn: []\n    # 内核不得依赖界面')
    const desk = await openDesk(
      '/?level=core&v=s',
      [...DEPS, { from: 'src/core/log/l.ts', to: 'src/ui/view/a.ts', via: 'src/ui/view/a.ts', kind: 'type', line: 9 }],
      rules,
    )
    const { scene: s } = await sceneOf(desk)
    const v = dep(s, 'bundle:core.log->boundary:ui')
    expect(v.data.dep).toMatchObject({ tier: 'type', violation: 'new' })
  })
})

describe('B1–B4 过滤与画布角计数', () => {
  it('缺省只引类型收起；只看交互使用时值使用也收起；只看未解释只留未解释的束；各自计数', async () => {
    const desk = await openDesk()
    expect((await sceneOf(desk)).scene.structure).toEqual({ typeOnlyHidden: 1, valueHidden: 0, coveredHidden: 0, note: null })
    const inv = (await sceneOf(desk, { invokesOnly: true })).scene
    expect(ids(inv)).not.toContain('bundle:core.impl->core.log')
    expect(inv.structure!.valueHidden).toBe(1)
    const unc = (await sceneOf(desk, { uncoveredOnly: true })).scene
    expect(ids(unc)).toEqual(['bundle:core.api->core.log'])
    expect(unc.structure!.coveredHidden).toBe(6)
  })
})

describe('B2 跨界折叠', () => {
  it('一端是边界节点的束缺省不画，本层那一端节点朝外一侧标「界外 入 N · 出 M」、悬停列目标；悬停或选中一端时画出', async () => {
    const desk = await openDesk()
    const { scene: s } = await sceneOf(desk)
    expect(ids(s)).not.toContain('bundle:boundary:ui->core.api')
    const mark = node(s, 'core.api').data.crossFold!
    expect(mark).toMatchObject({ in: 1, out: 0 })
    expect(mark.title).toContain('入 UI')
    expect(['top', 'bottom', 'left', 'right']).toContain(mark.side)
    expect(node(s, 'core.impl').data.crossFold).toBeUndefined()
    desk.setHover('boundary:ui')
    expect(ids((await sceneOf(desk)).scene)).toContain('bundle:boundary:ui->core.api')
    desk.setHover(null)
    desk.select({ kind: 'module', id: 'core.api' })
    await settle(desk)
    // 选中一端时画出（这时被依赖方表面展开，跨界的束散开到元素）
    expect(ids((await sceneOf(desk)).scene)).toContain('el:boundary:ui->core.api:use:get')
  })
})

describe('B3 选中束：聚焦与反向高亮承载的交互（L22）', () => {
  it('选中束时它与散开的元素级边高亮，不与两端相连的束变淡；它承载的交互临时画出；取消选中恢复', async () => {
    const desk = await openDesk()
    desk.select({ kind: 'dep', id: 'core.util->core.api' })
    await settle(desk)
    const { scene: s } = await sceneOf(desk)
    // 被依赖方展开这条束接到的元素：散开为元素级边
    const own = deps(s).filter(e => e.data.selected)
    expect(own.map(e => e.id)).toEqual(['el:core.util->core.api:use:get'])
    expect(dep(s, 'bundle:core.impl->core.log').data.dim).toBe(true)
    expect(dep(s, 'bundle:core.impl->core.util').data.dim).toBe(false)
    const carried = s.edges.filter(e => e.data.temp === 'carried')
    expect(carried).toHaveLength(1)
    expect(carried[0].data.edge.relationIds.sort()).toEqual(['rel.q', 'rel.q2'])
    expect(carried[0].data.label).toBe('承载 ×2')
    desk.select(null)
    const back = (await sceneOf(desk)).scene
    expect(deps(back).some(e => e.data.dim)).toBe(false)
    expect(back.edges.some(e => e.data.temp === 'carried')).toBe(false)
  })
})

describe('C6、L20 表面展开', () => {
  it('节点角标「表面 W」与「入 · 出」同一行，没有入口不给', async () => {
    const desk = await openDesk()
    const { scene: s } = await sceneOf(desk)
    expect(node(s, 'core.api').data.metrics!.w).toBe(2)
    expect(node(s, 'core.impl').data.metrics!.w).toBeUndefined()
  })

  it('选中模块：元素作为 elk 端口排在入边一侧、节点加长，束散开为元素级边接到各自元素；越过入口接到节点本体并带记号', async () => {
    const bypass: FileDep = {
      from: 'src/core/log/l.ts',
      to: 'src/core/api/client.ts',
      via: 'src/core/api/client.ts',
      kind: 'value',
      line: 7,
      names: ['get'],
      uses: true,
      invokes: true,
    }
    const desk = await openDesk('/?level=core&v=s', [...DEPS, bypass])
    const before = (await sceneOf(desk)).scene
    desk.select({ kind: 'module', id: 'core.api' })
    await settle(desk)
    const { scene: s, positioned: pv, expansion } = await sceneOf(desk)
    expect(expansion!.expand).toEqual([{ node: 'core.api', elements: ['get', 'Client'], from: null }])
    const api = node(s, 'core.api')
    const was = node(before, 'core.api')
    expect(api.width * api.height).toBeGreaterThan(was.width * was.height)
    expect(api.data.surface!.items.map(i => [i.name, i.kind, i.fanIn, i.used])).toEqual([
      ['get', 'port', 3, true],
      ['Client', 'operation', 1, true],
    ])
    // 元素级边的终点落在各自的元素端口上
    const at = (name: string) => pv!.elements!.get('core.api')!.find(p => p.name === name)!
    const end = (id: string) => dep(s, id).data.route.points.at(-1)!
    expect(end('el:core.impl->core.api:assembly:Client')).toMatchObject({ x: expect.closeTo(at('Client').x, -1), y: expect.closeTo(at('Client').y, -1) })
    expect(end('el:core.util->core.api:use:get')).toMatchObject({ x: expect.closeTo(at('get').x, -1), y: expect.closeTo(at('get').y, -1) })
    expect(dep(s, 'el:core.util->core.api:use:get').data.dep).toMatchObject({ kind: 'use', tier: 'invokes', element: { name: 'get', kind: 'port' } })
    // 束不再画；越过入口的元素级边接到节点本体、标「越过入口」
    expect(ids(s)).not.toContain('bundle:core.util->core.api')
    const by = deps(s).find(e => e.data.dep!.bypass)!
    expect(by.data.label).toContain('越过入口')
    // 端口实现 get 是只引类型档：随只引类型开关收起（T0 裁决 11）
    expect(ids(s)).not.toContain('el:core.impl->core.api:implements:get')
    expect(ids((await sceneOf(desk, { typeOnly: true })).scene)).toContain('el:core.impl->core.api:implements:get')
  })

  it('总是展开表面：本层全部有元素的模块展开；取消后收起', async () => {
    const desk = await openDesk()
    const { expansion, scene } = await sceneOf(desk, { surfaceAlways: true })
    expect(expansion!.expand.map(x => x.node)).toEqual(['core.api'])
    expect(node(scene, 'core.api').data.surface).toBeDefined()
    expect((await sceneOf(desk)).expansion).toBeNull()
  })

  it('交互视角展开接收方：交互束按接口散开到元素，没写接口的留在原边；只画被交互接到的元素；束内修饰不一致标「混合」（D7、D8、L23）', async () => {
    const desk = await openDesk('/?level=core')
    const quiet = (await sceneOf(desk)).scene
    const edge = quiet.edges.find(e => e.id === 'core.util->core.api:queries')!
    expect(edge.data).toMatchObject({ mixed: true })
    expect(edge.data.label).toContain('混合')
    expect(edge.data.title).toContain('同步 / 异步')
    desk.select({ kind: 'module', id: 'core.api' })
    await settle(desk)
    const { scene: s } = await sceneOf(desk)
    const part = s.edges.find(e => e.id === 'core.util->core.api:queries#to:get')!
    expect(part.data.edge.relationIds).toEqual(['rel.q'])
    const rest = s.edges.find(e => e.id === 'core.util->core.api:queries')!
    expect(rest.data.edge.relationIds).toEqual(['rel.q2'])
    // 只画被交互接到的元素（get），不画元素清单（Client）
    expect(node(s, 'core.api').data.surface!.items.map(i => i.name)).toEqual(['get'])
    // 两个视角同一份展开布局（V12）
    desk.setMode('structure')
    const st = (await sceneOf(desk)).scene
    expect(st.nodes.map(n => [n.id, n.position, n.width, n.height])).toEqual(s.nodes.map(n => [n.id, n.position, n.width, n.height]))
  })
})

describe('L22 承载叠加（交互视角）', () => {
  it('选中一条交互时承载段以结构边的形态记号临时画出并高亮，接到元素；缺段画提示虚线；无关的边与节点变淡', async () => {
    const desk = await openDesk('/?level=core')
    desk.select({ kind: 'relation', id: 'rel.q' })
    await settle(desk)
    const { scene: s } = await sceneOf(desk)
    const seg = s.edges.find(e => e.id.startsWith('carrier:rel.q:'))!
    expect(seg.type).toBe('dep')
    expect(seg.data.dep).toMatchObject({ carrier: true, kind: 'use', element: { name: 'get' } })
    expect(seg.data.selected).toBe(true)
    expect(seg.source).toBe('core.util')
    expect(seg.target).toBe('core.api')
    expect(s.edges.filter(e => e.type === 'route' && !e.data.selected && !e.data.temp).every(e => e.data.dim)).toBe(true)
    expect(node(s, 'core.log').data.dim).toBe(true)
    expect(node(s, 'core.util').data.dim).toBe(false)
    desk.select({ kind: 'relation', id: 'rel.gap' })
    await settle(desk)
    const gap = (await sceneOf(desk)).scene.edges.find(e => e.data.temp === 'carrier-gap')!
    expect(gap.data.label).toMatch(/^缺：/)
    expect(gap.data.factState).toBe('unconfirmed')
  })
})

describe('L17 指标角标、O13 共用件折叠、K15 影响面', () => {
  it('结构视角每个模块节点标 Ca / Ce 与不稳定度档，交互视角不标', async () => {
    const desk = await openDesk()
    const { scene: s } = await sceneOf(desk)
    const m = desk.facts.metrics.value!.get('core.impl')!
    expect(node(s, 'core.impl').data.metrics).toEqual({ ca: m.ca, ce: m.ce, instability: m.instability, band: m.band })
    desk.setMode('interaction')
    expect(node((await sceneOf(desk)).scene, 'core.impl').data.metrics).toBeUndefined()
  })

  it('与架上共用件之间的束缺省不画、聚焦时画；「共用 ×N」按依赖计（含只引类型）', async () => {
    const shared = MODEL.replace('{ id: core.log, name: Log,', '{ id: core.log, name: Log, role: shared,')
    const desk = await openDesk('/?level=core&v=s', DEPS, shared)
    const { scene: s, positioned } = await sceneOf(desk)
    expect(positioned!.view.shelf).toEqual(['core.log'])
    expect(ids(s).some(id => id.endsWith('->core.log'))).toBe(false)
    expect(node(s, 'core.impl').data).toMatchObject({ sharedCount: 1, sharedByDeps: true })
    expect(node(s, 'core.util').data.sharedCount).toBe(1)
    expect(node(s, 'core.log').data.metrics?.inOnly).toBe(true)
    desk.setHover('core.impl')
    expect(ids((await sceneOf(desk)).scene)).toContain('bundle:core.impl->core.log')
  })

  it('选中模块时影响面按方向与距离标在节点上，闭包外变淡', async () => {
    const desk = await openDesk()
    desk.select({ kind: 'module', id: 'core.log' })
    await settle(desk)
    const { scene: s } = await sceneOf(desk)
    expect(node(s, 'core.api').data.impact).toMatchObject({ direction: 'in', distance: 1 })
    expect(node(s, 'core.log').data.impactSelf).toBe(true)
  })
})

describe('U16 没有代码事实时的允许依赖图', () => {
  const plain = (s: Partial<CanvasInput['structure']> & object, pv: PositionedView, index: ReturnType<typeof loadModel>['index']): CanvasInput => ({
    positioned: pv,
    index,
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
    structure: { view: null, typeOnly: false, metrics: null, impact: null, impactMode: 'in', cycles: null, ...s },
  })

  it('只画允许边（点线，不带档与指标），画布角注明；正在读取时不画边', async () => {
    const { index } = loadModel([
      { path: 'system.yaml', text: 'system: { id: sys, name: Sys }' },
      { path: 'modules.yaml', text: MODEL },
    ])
    const view = projectLevel(index, index.rootId)
    const sv = structureView(index, view, null)
    const pv = await layoutView(view, {}, { edges: sv.edges })
    const s = canvasScene(plain({ view: sv }, pv, index))
    expect(deps(s).map(e => [e.id, e.data.dep!.kind])).toEqual([['allowed:ui->core', 'allowed']])
    expect(s.structure!.note).toBe('没有代码事实，只画允许依赖')
    expect(s.nodes.every(n => !n.data.metrics)).toBe(true)
    const loading = canvasScene(plain({ view: null, note: '正在读取代码事实…' }, pv, index))
    expect(deps(loading)).toHaveLength(0)
    expect(loading.structure!.note).toBe('正在读取代码事实…')
  })
})

describe('O13③ 分层总览', () => {
  it('带间画层间的束；核心模块的跨层依赖按对合成一条，只在聚焦它时画', async () => {
    const core = MODEL.replace('{ id: core.api, name: Api,', '{ id: core.api, name: Api, role: core,')
    const desk = await openDesk('/?v=s', DEPS, core)
    const { scene: quiet, positioned: pv } = await sceneOf(desk)
    expect(pv!.view.mode).toBe('layered')
    const band = dep(quiet, 'bundle:ui->core')
    expect(band.data.route).toEqual(pv!.edges.get('bundle:ui->core'))
    expect(ids(quiet).some(id => id.startsWith('chip:'))).toBe(false)
    expect(desk.facts.layoutLinks.value!.core!.map(e => e.id)).toContain('chip:bundle:ui->core.api')
    desk.setHover('core.api')
    const hovered = (await sceneOf(desk)).scene
    const chip = dep(hovered, 'chip:bundle:ui->core.api')
    expect(chip.data.route).toEqual(pv!.coreEdges.get(chip.id))
    expect(chip.data.route.curve).toBe(true)
  })
})
