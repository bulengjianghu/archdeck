// @vitest-environment jsdom
/** 关系边的视觉通道（L10、K9、P15）：线型只表事实状态、箭头表同步 / 异步 / 实现、线宽按条数三档且编译期更细、选中为窄晕不改线宽 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import RouteEdge from '../../src/components/edges/RouteEdge.vue'
import type { RouteEdgeData } from '../../src/layout/canvas'

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
  compile: false,
  selected: false,
  dim: false,
}

function render(data: Partial<RouteEdgeData>) {
  const w = mount({ components: { RouteEdge }, template: '<svg><RouteEdge id="e1" :data="data" /></svg>', data: () => ({ data: { ...base, ...data } }) })
  const main = w.find('path.vue-flow__edge-path')
  return { w, style: main.attributes('style') ?? '', marker: w.find('marker path') }
}

describe('RouteEdge', () => {
  it('已证实为实线；未证实为虚线；叠加线为点线（叠加线专用色）', () => {
    expect(render({}).style).not.toContain('dasharray')
    expect(render({ factState: 'unconfirmed' }).style).toContain('stroke-dasharray: 6 4')
    const code = render({ temp: 'code', factState: 'undescribed' }).style
    expect(code).toContain('stroke-dasharray: 0.5 4.5')
    expect(code).toContain('var(--edge-code)')
  })

  it('P15：经由上层的临时线为关系类型色的虚线', () => {
    const s = render({ temp: 'upper', edge: { ...base.edge, type: 'dataflow' } }).style
    expect(s).toContain('var(--rel-dataflow)')
    expect(s).toContain('stroke-dasharray: 6 4')
  })

  it('箭头：同步实心、异步空心、implements 空心三角', () => {
    expect(render({}).marker.attributes('fill')).toContain('--rel-calls')
    expect(render({ arrow: 'open' }).marker.attributes('fill')).toBe('none')
    const tri = render({ arrow: 'triangle', edge: { ...base.edge, type: 'implements' } }).marker
    expect(tri.attributes('fill')).toBe('var(--surface)')
    expect(tri.attributes('stroke')).toBe('var(--rel-implements)')
  })

  it('线宽按条数三档、编译期更细；选中与走过不改线宽，选中加窄晕', () => {
    const width = (d: Partial<RouteEdgeData>) => render(d).style.match(/stroke-width: ([\d.]+)/)![1]
    expect([1, 2, 3].map(weight => width({ weight: weight as 1 | 2 | 3 }))).toEqual(['1.5', '2.5', '3.5'])
    expect(width({ weight: 3, compile: true })).toBe('2.5')
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
