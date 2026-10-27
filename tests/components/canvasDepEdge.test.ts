// @vitest-environment jsdom
/**
 * 结构边的编码表（L16，ADR-0031 裁决 D）：UML 类图惯例——使用虚线 + 开口箭头、子类实线 + 空心三角、端口实现虚线 + 空心三角、
 * 组装实线 + 组装者一端实心菱形 + 开口箭头；依赖三档用明度（不用透明度）；色相中性；线宽 = 聚合条数（共享通道 L18）；违规三档红晕（U15）；
 * 允许边（U16）点线、意图色。另含「只引类型」等结构视角显示偏好的本地记忆（useStructurePrefs）。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import DepEdge from '../../src/components/edges/DepEdge.vue'
import { ALLOWED_COLOR, FACT_COLOR, TIER_COLOR, depColor, depDash, depEnds, depStroke, umlDepth } from '../../src/components/edges/depStyle'
import { DASHED, DOTTED, WIDTH, arrowSize } from '../../src/components/edges/edgeStyle'
import { DEFAULT_STRUCTURE_PREFS, resetStructurePrefs, useStructurePrefs } from '../../src/components/display/useDisplayPrefs'
import { depWeight, violationLook, type DepEdgeLook, type RouteEdgeData } from '../../src/layout/canvas'

const look = (l: Partial<DepEdgeLook>): DepEdgeLook => ({ kind: 'use', tier: 'invokes', fromModule: 'a', toModule: 'b', deps: 1, title: 'a → b', ...l })

function render(l: Partial<DepEdgeLook>, extra: Partial<RouteEdgeData> = {}) {
  const data: RouteEdgeData = {
    route: {
      points: [
        { x: 0, y: 0 },
        { x: 0, y: 100 },
      ],
      label: { x: 0, y: 50 },
    },
    edge: { id: 'e', kind: 'direct', from: 'a', to: 'b', type: 'calls', relationIds: [], mode: 'sync' },
    label: '',
    factState: 'confirmed',
    arrow: 'open',
    weight: 1,
    selected: false,
    dim: false,
    dep: look(l),
    ...extra,
  }
  const w = mount({ components: { DepEdge }, template: '<svg><DepEdge id="dependency:a->b" :data="data" /></svg>', data: () => ({ data }) })
  return { w, main: w.find('path.vue-flow__edge-path') }
}

describe('L16 编码表', () => {
  it('线型：依赖与端口实现虚线，子类与组装实线，允许边点线', () => {
    expect(depDash('use')).toBe(DASHED)
    expect(depDash('implements')).toBe(DASHED)
    expect(depDash('subclass')).toBeUndefined()
    expect(depDash('assembly')).toBeUndefined()
    expect(depDash('allowed')).toBe(DOTTED)
  })

  it('端点：依赖开口箭头；子类、端口实现空心三角；组装起点实心菱形、终点开口箭头', () => {
    expect(depEnds('use')).toEqual({ end: 'open' })
    expect(depEnds('subclass')).toEqual({ end: 'triangle' })
    expect(depEnds('implements')).toEqual({ end: 'triangle' })
    expect(depEnds('assembly')).toEqual({ start: 'diamond', end: 'open' })
  })

  it('依赖三档用明度（深 / 中 / 浅），不改透明度；其余种类中性色；允许边意图色', () => {
    expect(depColor({ kind: 'use', tier: 'invokes' })).toBe(TIER_COLOR.invokes)
    expect(depColor({ kind: 'use', tier: 'value' })).toBe(TIER_COLOR.value)
    expect(depColor({ kind: 'use', tier: 'type' })).toBe(TIER_COLOR.type)
    expect(new Set(Object.values(TIER_COLOR)).size).toBe(3)
    expect(depColor({ kind: 'subclass' })).toBe(FACT_COLOR)
    expect(depColor({ kind: 'allowed' })).toBe(ALLOWED_COLOR)
    for (const tier of ['invokes', 'value', 'type'] as const) expect(depStroke({ kind: 'use', tier }).opacity).toBe(1)
    expect(depStroke({ kind: 'use', tier: 'type', dim: true }).opacity).toBeLessThan(1)
  })

  it('线宽 = 聚合的模块依赖条数三档（与交互边同一套宽度）', () => {
    expect([1, 2, 4, 5, 9].map(depWeight)).toEqual([1, 2, 2, 3, 3])
    expect(depStroke({ kind: 'use', weight: 3 }).strokeWidth).toBe(WIDTH[2])
  })

  it('违规状态投到三档红晕：新增与无基线、已知、已豁免', () => {
    expect([violationLook('new'), violationLook('open'), violationLook('known'), violationLook('allowed'), violationLook(undefined)]).toEqual([
      'new',
      'new',
      'known',
      'allowed',
      undefined,
    ])
  })
})

describe('L16、L21 第八轮：按形态与档', () => {
  it('形态：使用（第七轮的 dependency 同义）虚线 + 开口箭头；四种形态都按档定浓淡；不带档的事实形态为中性色', () => {
    expect(depDash('use')).toBe(DASHED)
    expect(depEnds('use')).toEqual({ end: 'open' })
    expect(depColor({ kind: 'use', tier: 'value' })).toBe(TIER_COLOR.value)
    expect(depColor({ kind: 'assembly', tier: 'type' })).toBe(TIER_COLOR.type)
    expect(depColor({ kind: 'subclass', tier: 'invokes' })).toBe(TIER_COLOR.invokes)
    expect(depColor({ kind: 'implements' })).toBe(FACT_COLOR)
    expect(depColor({ kind: 'use' })).toBe(TIER_COLOR.invokes)
  })

  it('线宽档按束内元素级边条数：1 / 2–4 / ≥5', () => {
    expect([1, 2, 3, 4, 5, 12].map(depWeight)).toEqual([1, 2, 2, 2, 3, 3])
  })

  it('束：「×N 元素」角标进 data-elements；元素级边带元素名；越过入口在终点画小叉', () => {
    const b = render({ kind: 'assembly', forms: ['assembly', 'implements'], elements: 3 }, { label: '×3 元素' })
    expect(b.w.find('g.dep-edge').attributes('data-elements')).toBe('3')
    expect(b.w.find('g.dep-edge').attributes('data-kind')).toBe('assembly')
    const el = render({ kind: 'use', element: { name: 'get', kind: 'port' } })
    expect(el.w.find('g.dep-edge').attributes('data-element')).toBe('get')
    expect(el.w.find('path.dep-bypass').exists()).toBe(false)
    const by = render({ kind: 'use', bypass: true })
    expect(by.w.find('g.dep-edge').attributes('data-bypass')).toBe('')
    expect(by.w.find('path.dep-bypass').exists()).toBe(true)
  })

  it('承载段（L22）带强调色晕', () => {
    const c = render({ kind: 'use', carrier: true }, { selected: true })
    expect(c.w.find('g.dep-edge').classes()).toContain('dep-carrier')
    expect(c.w.find('path.edge-selected-glow').exists()).toBe(true)
  })
})

describe('DepEdge', () => {
  it('使用：虚线、终点开口箭头，线在箭头处回缩；没有起点记号', () => {
    const { w, main } = render({})
    expect(main.attributes('style')).toContain('stroke-dasharray: 6 4')
    expect(main.attributes('marker-end')).toContain('dep-end-')
    expect(main.attributes('marker-start')).toBeUndefined()
    expect(main.attributes('d')!.endsWith(`L0,${100 - umlDepth('open', arrowSize(1))}`)).toBe(true)
    expect(w.findAll('marker')).toHaveLength(1)
  })

  it('组装：实线、起点实心菱形（auto-start-reverse）、终点开口箭头，两端都回缩', () => {
    const { w, main } = render({ kind: 'assembly', tier: undefined })
    expect(main.attributes('style')).not.toContain('dasharray')
    const markers = w.findAll('marker')
    expect(markers).toHaveLength(2)
    expect(markers[1].attributes('orient')).toBe('auto-start-reverse')
    expect(markers[1].find('path').attributes('fill')).not.toBe('none')
    expect(main.attributes('d')!.startsWith(`M0,${umlDepth('diamond', arrowSize(1))}`)).toBe(true)
  })

  it('子类：实线、空心三角（填底色）；端口实现：虚线、空心三角', () => {
    const sub = render({ kind: 'subclass', tier: undefined })
    expect(sub.main.attributes('style')).not.toContain('dasharray')
    expect(sub.w.find('marker path').attributes('fill')).toBe('var(--surface)')
    const imp = render({ kind: 'implements', tier: undefined })
    expect(imp.main.attributes('style')).toContain('stroke-dasharray: 6 4')
    expect(imp.w.find('marker path').attributes('fill')).toBe('var(--surface)')
  })

  it('违规红晕按状态、选中为强调色窄晕；悬停说明写在 title 里', () => {
    expect(render({ violation: 'new' }).w.find('path.dep-violation.new').exists()).toBe(true)
    expect(render({ violation: 'known' }).w.find('path.dep-violation.known').exists()).toBe(true)
    expect(render({ violation: 'allowed' }).w.find('path.dep-violation.allowed').exists()).toBe(true)
    expect(render({}, { selected: true }).w.find('path.edge-selected-glow').exists()).toBe(true)
    expect(render({ title: '依赖（交互使用）：a → b' }).w.find('title').text()).toBe('依赖（交互使用）：a → b')
  })
})

describe('结构视角的显示偏好（useStructurePrefs）', () => {
  beforeEach(() => {
    localStorage.clear()
    resetStructurePrefs()
  })

  it('缺省：只引类型收起、影响面传入、不只看值依赖；同一项目共用一份，按项目记在本地', () => {
    const a = useStructurePrefs('p1')
    expect(a.prefs.value).toEqual(DEFAULT_STRUCTURE_PREFS)
    expect(DEFAULT_STRUCTURE_PREFS).toEqual({
      typeOnly: false,
      impactMode: 'in',
      valuesOnly: false,
      invokesOnly: false,
      uncoveredOnly: false,
      surfaceAlways: false,
    })
    a.setTypeOnly(true)
    a.setImpactMode('both')
    expect(useStructurePrefs('p1').prefs.value).toMatchObject({ typeOnly: true, impactMode: 'both' })
    expect(useStructurePrefs('p2').prefs.value.typeOnly).toBe(false)
    resetStructurePrefs()
    expect(useStructurePrefs('p1').prefs.value).toEqual({ ...DEFAULT_STRUCTURE_PREFS, typeOnly: true, impactMode: 'both' })
  })
})

describe('L20②（ADR-0036）：接到端口点的元素级边', () => {
  it('终点不画记号、不回缩（点就是终点记号）；组装的起点菱形照画；不接元素的边照画终点记号', () => {
    const dot = render({ kind: 'assembly', element: { name: 'get', kind: 'port' } })
    expect(dot.main.attributes('marker-end')).toBeUndefined()
    expect(dot.main.attributes('marker-start')).toContain('dep-start-')
    expect(dot.main.attributes('d')).toContain('100')
    expect(render({ kind: 'use' }).main.attributes('marker-end')).toContain('dep-end-')
  })
})
