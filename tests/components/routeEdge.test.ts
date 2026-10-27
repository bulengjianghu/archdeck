// @vitest-environment jsdom
/** 关系边的视觉通道（L10、L12、K9、P15）：四类各一色相（查询淡）、线型只表事实状态、箭头表同步 / 异步、插座表经端口、线宽只按条数三档、选中为窄晕不改线宽 */
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

  it('已证实为实线；未证实为虚线；叠加线为点线（叠加线专用色）', () => {
    expect(render({}).style).not.toContain('dasharray')
    expect(render({ factState: 'unconfirmed' }).style).toContain('stroke-dasharray: 6 4')
    const code = render({ temp: 'code', factState: 'undescribed' }).style
    expect(code).toContain('stroke-dasharray: 0.5 4.5')
    expect(code).toContain('var(--edge-code)')
  })

  it('P15：经由上层的临时线为关系类型色的虚线', () => {
    const s = render({ temp: 'upper', edge: { ...base.edge, type: 'streams' } }).style
    expect(s).toContain('var(--rel-streams)')
    expect(s).toContain('stroke-dasharray: 6 4')
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

  it('L24：经回调的边在起点叠放回程钩（marker-start），与插座、箭头、线型互不替换', () => {
    expect(render({}).w.find('.edge-hook').exists()).toBe(false)
    const h = render({ callback: true })
    expect(h.w.find('marker.callback-marker').exists()).toBe(true)
    expect(h.w.find('.edge-hook').attributes('marker-start')).toContain('hook-')
    expect(h.w.find('path.vue-flow__edge-path').attributes('marker-end')).toContain('arrow-')
    expect(h.style).toBe(render({}).style)
    // 未证实（虚线）又经端口又经回调：三个记号同时在
    const all = render({ callback: true, port: true, factState: 'unconfirmed' })
    expect(all.style).toContain('stroke-dasharray')
    expect(all.w.find('.edge-hook').exists()).toBe(true)
    expect(all.w.find('.edge-socket:not(.edge-hook)').exists()).toBe(true)
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
