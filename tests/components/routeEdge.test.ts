// @vitest-environment jsdom
/** 关系边的视觉通道（L10、L12、K9、P11、P15、F6、L18）：四类各一色相（查询淡）、线型只答行为还是依赖（ADR-0035）、箭头表同步 / 异步、插座表经端口、线宽只按条数三档、选中为窄晕不改线宽 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import RouteEdge from '../../src/components/edges/RouteEdge.vue'
import type { RouteEdgeData } from '../../src/layout/canvas'
import { arrowDepth, arrowSize } from '../../src/components/edges/edgeStyle'

const base: RouteEdgeData = {
  route: {
    points: [
      { x: 0, y: 0 },
      { x: 0, y: 100 },
    ],
    label: { x: 0, y: 50 },
  },
  edge: { id: 'a->b:calls', kind: 'direct', from: 'a', to: 'b', type: 'calls', relationIds: ['r1'], mode: 'sync' },
  label: '',
  factState: 'confirmed',
  arrow: 'closed',
  weight: 1,
  selected: false,
  dim: false,
}

function render(data: Partial<RouteEdgeData>) {
  const w = mount({ components: { RouteEdge }, template: '<svg><RouteEdge id="e1" :data="data" /></svg>', data: () => ({ data: { ...base, ...data } }) })
  const main = w.find('path.vue-flow__edge-path')
  return { w, style: main.attributes('style') ?? '', marker: w.find('marker path') }
}

describe('RouteEdge', () => {
  it('箭头随线宽档放大，空心「V」描边 = 线宽 + 1；线在箭头处回缩一个箭头深度', () => {
    const one = render({ arrow: 'open', weight: 1 })
    const three = render({ arrow: 'open', weight: 3 })
    expect(Number(one.w.find('marker').attributes('markerWidth'))).toBe(arrowSize(1))
    expect(Number(three.w.find('marker').attributes('markerWidth'))).toBe(arrowSize(3))
    expect(Number(one.marker.attributes('stroke-width')) * (arrowSize(1) / 10)).toBeCloseTo(1.5 + 1)
    // 竖直的边终点 (0,100)：线停在 100 − 箭头深度，尖端落在原终点
    const d = one.w.find('path.vue-flow__edge-path').attributes('d')!
    expect(d.endsWith(`L0,${100 - arrowDepth(arrowSize(1))}`)).toBe(true)
  })

  it('L10、L18：交互边一律实线——已证实、未证实都是实线（事实状态写在标签位）；代码依赖叠加线是依赖，虚线（叠加线专用色）', () => {
    expect(render({}).style).not.toContain('dasharray')
    expect(render({ factState: 'unconfirmed', label: '未证实', warn: true }).style).not.toContain('dasharray')
    const code = render({ temp: 'code', factState: 'undescribed' }).style
    expect(code).toContain('stroke-dasharray: 6 4')
    expect(code).toContain('var(--edge-code)')
  })

  it('L18：依赖类的线用依赖的端点记号——叠加线与缺段开口箭头，组装叠加依赖方一端实心菱形', () => {
    const code = render({ temp: 'code' }).w
    expect(code.findAll('marker.uml-marker')).toHaveLength(1)
    expect(code.find('marker.uml-marker path').attributes('fill')).toBe('none')
    const gap = render({ temp: 'carrier-gap' })
    expect(gap.style).toContain('stroke-dasharray: 6 4')
    expect(gap.style).toContain('var(--warning)')
    const asm = render({ temp: 'assembly' })
    expect(asm.style).toContain('stroke-dasharray: 6 4')
    expect(asm.style).toContain('var(--assembly)')
    expect(asm.w.findAll('marker.uml-marker')).toHaveLength(2)
    expect(asm.w.find('path.vue-flow__edge-path').attributes('marker-start')).toMatch(/^url\(#arrow-e1-start\)$/)
    // 交互边仍是同步 / 异步箭头
    expect(render({}).w.find('marker.uml-marker').exists()).toBe(false)
  })

  it('P15、P11、F6：经由上层（类型色）、未建模（红）与分支预览（降低不透明度）的临时线都是交互，实线', () => {
    const s = render({ temp: 'upper', edge: { ...base.edge, type: 'streams' } }).style
    expect(s).toContain('var(--rel-streams)')
    expect(s).not.toContain('dasharray')
    const u = render({ temp: 'unmodeled' }).style
    expect(u).toContain('var(--danger)')
    expect(u).not.toContain('dasharray')
    const p = render({ play: 'preview' }).style
    expect(p).not.toContain('dasharray')
    expect(p).toContain('opacity: 0.6')
  })

  it('J5：时间耦合是线型的唯一例外——波浪线，不是虚线', () => {
    const c = render({ temp: 'couple', label: '×3', pill: true })
    expect(c.style).not.toContain('dasharray')
    expect(c.w.find('path.vue-flow__edge-path').attributes('d')!.split(' L').length).toBeGreaterThan(4)
  })

  it('L26：标签位画成 pill，含异常时为警示色', () => {
    const w = render({ label: '×2 · 未证实', pill: true, warn: true }).w
    expect(w.find('g.edge-label-pill.edge-label-warn').exists()).toBe(true)
  })

  it('箭头：同步实心、异步空心（没有空心三角）', () => {
    expect(render({}).marker.attributes('fill')).toContain('--rel-calls')
    expect(render({ arrow: 'open' }).marker.attributes('fill')).toBe('none')
    expect(render({}).w.findAll('marker path').length).toBe(1)
  })

  it('L10：四类各一色相——查询低饱和 + 半透明、委托实色；未分类中性灰；查询不改线宽（只「淡」不「细」）', () => {
    const of = (type: RouteEdgeData['edge']['type']) => render({ edge: { ...base.edge, type } }).style
    expect(of('queries')).toContain('var(--rel-queries)')
    expect(of('queries')).toContain('opacity: 0.6')
    expect(of('queries')).toContain('stroke-width: 1.5')
    expect(of('commands')).toContain('var(--rel-commands)')
    expect(of('commands')).toContain('opacity: 1')
    expect(of('notifies')).toContain('var(--rel-notifies)')
    expect(of('streams')).toContain('var(--rel-streams)')
    expect(of('calls')).toContain('var(--rel-calls)')
    // 聚焦变淡照乘
    expect(render({ dim: true, edge: { ...base.edge, type: 'queries' } }).style).toMatch(/opacity: 0\.07/)
  })

  it('L12：经端口的边在目标端加插座记号（与箭头叠放、不替换箭头），不改色相与线型', () => {
    const plain = render({}).w
    expect(plain.find('.edge-socket').exists()).toBe(false)
    const p = render({ port: true })
    expect(p.w.find('.edge-socket').exists()).toBe(true)
    expect(p.w.find('marker.socket-marker').exists()).toBe(true)
    // 箭头仍在主线上；插座沿完整走线的终点（箭头尖端）
    expect(p.w.find('path.vue-flow__edge-path').attributes('marker-end')).toContain('arrow-')
    expect(p.w.find('.edge-socket').attributes('d')!.endsWith('L0,100')).toBe(true)
    expect(p.style).toBe(render({}).style)
  })

  it('L24（第十一轮）：经回调不画图形记号——不改线型、箭头，标签由画布场景写「回调」', () => {
    const h = render({ callback: true, label: '回调' })
    expect(h.w.find('marker.callback-marker').exists()).toBe(false)
    expect(h.w.find('path.vue-flow__edge-path').attributes('marker-start')).toBeUndefined()
    expect(h.style).toBe(render({}).style)
  })

  it('L25（第十一轮）：悬停的边下垫背景色衬边（沿回缩后的走线、比线宽 4px）、线加粗一档且不透明；配对边只垫衬边、不加粗', () => {
    expect(render({}).w.find('.edge-hover-casing').exists()).toBe(false)
    const width = (d: Partial<RouteEdgeData>) => Number(render(d).style.match(/stroke-width: ([\d.]+)/)![1])
    const h = render({ hovered: true, selected: true, type: 'queries' } as Partial<RouteEdgeData>)
    const casing = h.w.find('.edge-hover-casing')
    expect(casing.exists()).toBe(true)
    expect(casing.classes()).not.toContain('pair')
    expect(h.w.find('.edge-selected-glow').exists()).toBe(true)
    expect(width({ hovered: true })).toBe(width({}) + 1)
    expect(Number(casing.attributes('stroke-width'))).toBe(width({ hovered: true }) + 4)
    // 衬边走回缩后的线，不伸进节点（与主线同一条 path）
    expect(casing.attributes('d')).toBe(h.w.find('path.vue-flow__edge-path').attributes('d'))
    expect(h.style).toContain('opacity: 1')
    const pair = render({ hoverPair: true })
    expect(pair.w.find('.edge-hover-casing.pair').exists()).toBe(true)
    expect(width({ hoverPair: true })).toBe(width({}))
  })

  it('线宽只按条数三档；选中与走过不改线宽，选中加窄晕', () => {
    const width = (d: Partial<RouteEdgeData>) => render(d).style.match(/stroke-width: ([\d.]+)/)![1]
    expect([1, 2, 3].map(weight => width({ weight: weight as 1 | 2 | 3 }))).toEqual(['1.5', '2.5', '3.5'])
    expect(width({ selected: true })).toBe('1.5')
    expect(width({ play: 'walked' })).toBe('1.5')
    expect(render({ selected: true }).w.find('.edge-selected-glow').exists()).toBe(true)
  })

  it('违规红晕优先于设计变更底色；×N 标签画成 pill', () => {
    const v = render({ violated: true, change: 'added' }).w
    expect(v.find('.edge-violated').exists()).toBe(true)
    expect(v.find('.edge-diff').exists()).toBe(false)
    expect(render({ label: '×3', pill: true }).w.find('.edge-label-pill').exists()).toBe(true)
  })
})
