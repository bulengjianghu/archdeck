// @vitest-environment jsdom
/**
 * 结构视角的节点角标与表面元素记号（L17、L20、L21③、C9）：「表面 W」与「入 · 出」同一行、跨界折叠的「界外 入 N · 出 M」（悬停列目标），
 * 展开表面的元素记号（位置取元素端口，悬停写名字、种类与扇入，单击请求面板定位），交互束「混合」记号与悬停说明（D8）、承载反向高亮（L22）。
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import StructMarks from '../../src/components/nodes/StructMarks.vue'
import SurfaceMarks from '../../src/components/nodes/SurfaceMarks.vue'
import { resetSurfaceFocus, useSurfaceFocus } from '../../src/components/panel/surfaceFocus'
import ModuleNode from '../../src/components/nodes/ModuleNode.vue'
import RouteEdge from '../../src/components/edges/RouteEdge.vue'
import type { NodeData, NodeSurface, RouteEdgeData } from '../../src/layout/canvas'

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
  })
})

describe('SurfaceMarks', () => {
  const surface: NodeSurface = {
    side: 'top',
    items: [
      { name: 'get', kind: 'port', fanIn: 3, x: 20, y: 0, used: true },
      { name: 'Item', kind: 'type', fanIn: 1, x: 40, y: 0, used: false },
    ],
  }

  it('C6：元素记号按元素端口的位置排在入边一侧；悬停写名字、种类、扇入；收起的元素变淡', () => {
    const w = mount(SurfaceMarks, { props: { surface, moduleId: 'm' } })
    const els = w.findAll('.element')
    expect(els.map(e => e.attributes('data-element'))).toEqual(['get', 'Item'])
    expect(els[0].attributes('style')).toContain('left: 20px')
    expect(els[0].attributes('title')).toBe('get（端口） · 扇入 3')
    expect(els[1].classes()).toContain('unused')
    expect(els[1].classes()).toContain('type')
    const left = mount(SurfaceMarks, { props: { surface: { side: 'left', items: [{ name: 'a', x: 0, y: 30, used: true }] }, moduleId: 'm' } })
    expect(left.find('.element').attributes('style')).toContain('top: 30px')
  })

  it('C9（T2-4）：单击元素直接请求面板定位（focusSurfaceElement：模块与元素），选中模块由节点单击照常完成', async () => {
    resetSurfaceFocus()
    const w = mount(SurfaceMarks, { props: { surface, moduleId: 'm' } })
    await w.findAll('.element')[0].trigger('click')
    expect(useSurfaceFocus().value).toMatchObject({ module: 'm', element: 'get' })
  })

  it('展开的模块节点画元素记号并为它让出入边一侧', () => {
    const stubs = { global: { stubs: { Handles: true } } }
    const w = mount(ModuleNode, { props: { data: { ...base, surface } }, ...stubs })
    expect(w.find('[data-testid="surface-marks"]').exists()).toBe(true)
    expect(w.find('.module-node').classes()).toContain('surface-top')
    expect(
      mount(ModuleNode, { props: { data: base }, ...stubs })
        .find('[data-testid="surface-marks"]')
        .exists(),
    ).toBe(false)
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
