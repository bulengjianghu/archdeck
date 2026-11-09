// @vitest-environment jsdom
/**
 * 结构视角的节点角标与表面元素记号（L17、L20、L21③、C9）：「表面 W」与「入 · 出」同一行、跨界折叠的「界外 入 N · 出 M」（悬停列目标），
 * 展开表面的元素记号（位置取元素端口，悬停写名字、种类与扇入，单击请求面板定位），交互束「混合」记号与悬停说明（D8）、承载反向高亮（L22）。
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import StructMarks from '../../src/components/nodes/StructMarks.vue'
import SurfaceMarks from '../../src/components/nodes/SurfaceMarks.vue'
import { hoverSurfaceElement, leaveSurfaceElement, resetSurfaceFocus, useSurfaceFocus, useSurfaceHover } from '../../src/components/panel/surfaceFocus'
import ModuleNode from '../../src/components/nodes/ModuleNode.vue'
import RouteEdge from '../../src/components/edges/RouteEdge.vue'
import { DOT_ARROW } from '../../src/components/edges/edgeStyle'
import { EDGE_HOVER_Z, landsOn, withElementHover, type CanvasEdge, type NodeData, type NodeSurface, type RouteEdgeData } from '../../src/layout/canvas'

const base: NodeData = { moduleId: 'm', name: 'M', childCount: 0, selected: false, dim: false }

describe('StructMarks', () => {
  it('L20①：有入口时角标同一行加「表面 W」；没有 W 不显示', () => {
    const w = mount(StructMarks, { props: { data: { ...base, metrics: { ca: 2, ce: 1, instability: 0.33, band: 'balanced', w: 5 } } } })
    expect(w.get('[data-testid="node-metrics"]').text()).toBe('入 2 · 出 1 · 表面 5')
    expect(w.get('[data-testid="node-metrics"]').attributes('title')).toContain('表面宽度 W 5')
    const n = mount(StructMarks, { props: { data: { ...base, metrics: { ca: 2, ce: 1, instability: 0.33, band: 'balanced' } } } })
    expect(n.get('[data-testid="node-metrics"]').text()).toBe('入 2 · 出 1')
    expect(n.find('[data-testid="node-surface-w"]').exists()).toBe(false)
  })

  it('B2：跨界折叠记号在朝外一侧，写「界外 入 N · 出 M」，悬停列目标', () => {
    const w = mount(StructMarks, { props: { data: { ...base, crossFold: { in: 2, out: 1, side: 'top', title: '跨界折叠\n入 UI' } } } })
    const m = w.get('[data-testid="cross-fold"]')
    expect(m.text()).toBe('界外 入 2 · 出 1')
    expect(m.classes()).toContain('top')
    expect(m.attributes('title')).toContain('入 UI')
    const only = mount(StructMarks, { props: { data: { ...base, crossFold: { in: 0, out: 3, side: 'left', title: '' } } } })
    expect(only.get('[data-testid="cross-fold"]').text()).toBe('界外 出 3')
    // L20②（ADR-0036）：展开表面的节点入边一侧是端口点，朝同一侧的记号挪到相邻一侧（顶 → 右、左 → 下）
    const top = mount(StructMarks, { props: { data: { ...base, surface: { side: 'top', items: [] }, crossFold: { in: 1, out: 0, side: 'top', title: '' } } } })
    expect(top.get('[data-testid="cross-fold"]').classes()).toContain('right')
    const left = mount(StructMarks, {
      props: { data: { ...base, surface: { side: 'left', items: [] }, crossFold: { in: 1, out: 0, side: 'left', title: '' } } },
    })
    expect(left.get('[data-testid="cross-fold"]').classes()).toContain('bottom')
  })
})

describe('SurfaceMarks（ADR-0036 定尺寸点阵）', () => {
  const surface: NodeSurface = {
    side: 'top',
    items: [
      { name: 'get', kind: 'port', fanIn: 2, users: ['甲', '乙'], owner: '运行（run）', x: 20, y: 0, used: true },
      { name: 'Item', kind: 'type', fanIn: 1, owner: '本体', x: 50, y: 0, used: false },
    ],
    more: 3,
  }

  it('L20②：每个元素一个按种类区分形状的点、不写名字，位置取布局排出的点；收起的变淡；行尾「+N」', () => {
    const w = mount(SurfaceMarks, { props: { surface, moduleId: 'm' } })
    const dots = w.findAll('.dot')
    expect(dots.map(e => e.attributes('data-element'))).toEqual(['get', 'Item'])
    expect(w.text()).not.toContain('get')
    expect(dots[0].attributes('style')).toContain('left: 20px')
    expect(dots[0].classes()).toContain('port')
    // 不靠浏览器 title（返工：选中时会被扇出线吃掉），说明进 aria-label 与画布自己的提示框
    expect(dots[0].attributes('title')).toBeUndefined()
    expect(dots[0].attributes('aria-label')).toBe('get · 端口 · 属于 运行（run） · 扇入 2：甲、乙')
    expect(dots[1].classes()).toEqual(expect.arrayContaining(['type', 'unused']))
    expect(w.find('[data-testid="surface-more"]').text()).toBe('+3')
    const left = mount(SurfaceMarks, { props: { surface: { side: 'left', items: [{ name: 'a', x: 0, y: 30, used: true }] }, moduleId: 'm' } })
    expect(left.find('.dot').attributes('style')).toContain('top: 30px')
  })

  it('L20④、L20b（ADR-0036 返工）：悬停点一定出现画布自己的提示框（名字 · 种类、属于 <子模块>、扇入与使用者），移开收起；画布上不写组名', async () => {
    const w = mount(SurfaceMarks, { props: { surface, moduleId: 'm' }, attachTo: document.body })
    expect(w.findAll('[data-testid="surface-group"]')).toHaveLength(0)
    await w.findAll('.dot')[0].trigger('mouseenter')
    const tip = document.body.querySelector('[data-testid="surface-tip"]')!
    expect([...tip.children].map(c => c.textContent)).toEqual(['get · 端口', '属于 运行（run）', '扇入 2：甲、乙'])
    await w.findAll('.dot')[0].trigger('mouseleave')
    expect(document.body.querySelector('[data-testid="surface-tip"]')).toBeNull()
    await w.findAll('.dot')[1].trigger('mouseenter')
    expect(document.body.querySelector('[data-testid="surface-tip"]')!.textContent).toContain('本层画出来的边没有接到它')
    w.unmount()
  })

  it('C9（T2-4）：单击点直接请求面板定位（focusSurfaceElement：模块与元素），选中模块由节点单击照常完成', async () => {
    resetSurfaceFocus()
    const w = mount(SurfaceMarks, { props: { surface, moduleId: 'm' } })
    await w.findAll('.dot')[0].trigger('click')
    expect(useSurfaceFocus().value).toMatchObject({ module: 'm', element: 'get' })
  })

  it('L20④：悬停点设共享的悬停值（面板同一行同亮），移开只清自己；面板悬停的行在画布上同亮', async () => {
    const w = mount(SurfaceMarks, { props: { surface, moduleId: 'm' } })
    await w.findAll('.dot')[0].trigger('mouseenter')
    expect(useSurfaceHover().value).toEqual({ module: 'm', element: 'get' })
    leaveSurfaceElement('m', 'Item')
    expect(useSurfaceHover().value).not.toBeNull()
    await w.findAll('.dot')[0].trigger('mouseleave')
    expect(useSurfaceHover().value).toBeNull()
    hoverSurfaceElement({ module: 'm', element: 'Item' })
    await w.vm.$nextTick()
    expect(w.findAll('.dot')[1].classes()).toContain('hot')
    hoverSurfaceElement({ module: 'x', element: 'Item' })
    await w.vm.$nextTick()
    expect(w.findAll('.dot')[1].classes()).not.toContain('hot')
    hoverSurfaceElement(null)
  })

  it('展开的模块节点画点阵；节点尺寸与内容位置不变（返工：不再为组名让位）', () => {
    const stubs = { global: { stubs: { Handles: true } } }
    const w = mount(ModuleNode, { props: { data: { ...base, surface } }, ...stubs })
    expect(w.find('[data-testid="surface-marks"]').exists()).toBe(true)
    expect(w.find('.module-node').classes()).toContain('surface-top')
    expect(w.find('.module-node').classes()).not.toContain('surface-grouped')
    expect(
      mount(ModuleNode, { props: { data: base }, ...stubs })
        .find('[data-testid="surface-marks"]')
        .exists(),
    ).toBe(false)
  })
})

describe('withElementHover（L20④）', () => {
  const edge = (id: string, source: string, target: string, dep?: Partial<NonNullable<RouteEdgeData['dep']>>) =>
    ({ id, source, target, type: 'dep', zIndex: 0, data: { dim: true, ...(dep ? { dep } : {}) } }) as unknown as CanvasEdge
  const nodes: { id: string; class?: string }[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  const edges = [
    edge('el:a->b:get', 'a', 'b', { element: { name: 'get', kind: 'port' } }),
    edge('q#to:get', 'c', 'b'),
    edge('el:c->b:run', 'c', 'b', { element: { name: 'run', kind: 'operation' } }),
    edge('bundle:a->b#rest', 'a', 'b', { rest: true }),
  ]

  it('落在点上的边（结构的元素级边、交互的散开段）按悬停边高亮、发起方加描边环；其余原样', () => {
    const h = withElementHover(nodes, edges, { node: 'b', element: 'get' })
    expect(h.edges.filter(e => e.data.hovered).map(e => e.id)).toEqual(['el:a->b:get', 'q#to:get'])
    expect(h.edges.find(e => e.id === 'el:a->b:get')!.data.dim).toBe(false)
    expect(h.edges.find(e => e.id === 'el:a->b:get')!.zIndex).toBe(EDGE_HOVER_Z)
    expect(h.edges[2]).toBe(edges[2])
    expect(h.nodes.filter(n => n.class?.includes('edge-end')).map(n => n.id)).toEqual(['a', 'c'])
    expect(landsOn(edges[3], 'b', 'get')).toBe(false)
    expect(withElementHover(nodes, edges, null).edges).toEqual(edges)
    expect(withElementHover(nodes, edges, { node: 'a', element: 'get' }).nodes.some(n => n.class)).toBe(false)
  })
})

describe('RouteEdge 第八轮', () => {
  const data = (extra: Partial<RouteEdgeData>): RouteEdgeData => ({
    route: {
      points: [
        { x: 0, y: 0 },
        { x: 0, y: 100 },
      ],
    },
    edge: { id: 'e', kind: 'direct', from: 'a', to: 'b', type: 'queries', relationIds: ['r1', 'r2'], mode: 'sync' },
    label: '',
    factState: 'confirmed',
    arrow: 'closed',
    weight: 2,
    selected: false,
    dim: false,
    ...extra,
  })
  const render = (d: RouteEdgeData) => mount({ components: { RouteEdge }, template: '<svg><RouteEdge id="e" :data="d" /></svg>', data: () => ({ d }) })

  it('L23a②（ADR-0036 返工）：散开到端口点的一段带箭头、小一档（DOT_ARROW）；原视图边照常', () => {
    const at = (id: string) =>
      mount({ components: { RouteEdge }, template: `<svg><RouteEdge id="${id}" :data="d" /></svg>`, data: () => ({ d: data({}) }) }).find(
        'path.vue-flow__edge-path',
      )
    expect(at('e#to:get').attributes('marker-end')).toContain('arrow-')
    expect(at('e').attributes('marker-end')).toContain('arrow-')
    const marker = (id: string) =>
      mount({ components: { RouteEdge }, template: `<svg><RouteEdge id="${id}" :data="d" /></svg>`, data: () => ({ d: data({}) }) })
        .find('marker')
        .attributes('markerWidth') ??
      mount({ components: { RouteEdge }, template: `<svg><RouteEdge id="${id}" :data="d" /></svg>`, data: () => ({ d: data({}) }) })
        .find('marker')
        .attributes('markerwidth')
    expect(Number(marker('e#to:get'))).toBe(DOT_ARROW)
    expect(Number(marker('e'))).toBeGreaterThan(DOT_ARROW)
  })

  it('D8：束内修饰不一致标「混合」，悬停列出各条', () => {
    const w = render(data({ mixed: true, label: '×2 混合', title: '束内同步 / 异步不一致（D8）：\na → b' }))
    expect(w.find('g[data-mixed]').exists()).toBe(true)
    expect(w.find('title').text()).toContain('同步 / 异步')
  })

  it('L22：结构视角反向高亮的承载交互带强调色晕、是交互（实线）；缺段是依赖——警示色虚线', () => {
    const carried = render(data({ temp: 'carried' }))
    expect(carried.find('path.edge-carried-glow').exists()).toBe(true)
    expect(carried.find('path.vue-flow__edge-path').attributes('style')).not.toContain('dasharray')
    const gap = render(data({ temp: 'carrier-gap', label: '缺段', pill: true, warn: true }))
    expect(gap.find('path.vue-flow__edge-path').attributes('style')).toContain('stroke-dasharray: 6 4')
    expect(gap.find('path.vue-flow__edge-path').attributes('style')).toContain('var(--warning)')
  })
})
