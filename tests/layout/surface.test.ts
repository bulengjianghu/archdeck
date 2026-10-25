/**
 * 表面展开的输入（C6、L20②、L23）：展开触发（选中模块 / 束 / 交互、总是展开表面）、元素端口的并集与排序、端口封顶与「+N」、
 * 并集视图里散开的束换成元素级边（端口封顶外的合成一条接到节点本体）。纯函数。
 */
import { describe, expect, it } from 'vitest'
import type { InteractionBundle, LevelView, SurfaceElement } from '@/model'
import {
  SURFACE_PORT_CAP,
  layoutExpansion,
  restEdgeId,
  spreadEdgeId,
  surfaceExpansion,
  unionView,
  type ElementLink,
  type StructureLinks,
} from '../../src/layout/layout'

const view: LevelView = {
  mode: 'graph',
  parentId: 'p',
  nodes: [
    { id: 'a', moduleId: 'a', role: 'module' },
    { id: 'b', moduleId: 'b', role: 'module' },
    { id: 'c', moduleId: 'c', role: 'module' },
    { id: 'boundary:x', moduleId: 'x', role: 'boundary' },
  ],
  edges: [{ id: 'a->b:queries', kind: 'direct', from: 'a', to: 'b', type: 'queries', relationIds: ['r1', 'r2'], mode: 'sync' }],
} as unknown as LevelView

const el = (from: string, name: string | null, kind: ElementLink['kind'] = 'operation'): ElementLink => ({
  id: `el:${from}->b:use:${name ?? '!'}`,
  from,
  to: 'b',
  bundle: `bundle:${from}->b`,
  element: name,
  ...(name ? { kind } : {}),
})
const links = (elements: ElementLink[]): StructureLinks => ({
  edges: [
    { id: 'bundle:a->b', from: 'a', to: 'b' },
    { id: 'bundle:c->b', from: 'c', to: 'b' },
  ],
  elements,
})
const spread = (name: string): Map<string, InteractionBundle> =>
  new Map([
    [
      'a->b:queries',
      {
        items: [
          { relation: 'r1', element: { name, kind: 'port' } as SurfaceElement },
          { relation: 'r2', element: null },
        ],
        unnamed: 1,
      },
    ],
  ])

describe('surfaceExpansion', () => {
  it('没有选中、没开「总是展开」时不展开；分层总览不展开', () => {
    expect(surfaceExpansion({ view, selection: null, always: false, links: links([el('a', 'run')]), spreads: null })).toBeNull()
    expect(surfaceExpansion({ view: { ...view, mode: 'layered' }, selection: null, always: true, links: links([el('a', 'run')]), spreads: null })).toBeNull()
  })

  it('选中模块：全部依赖方 / 发起方；元素端口为元素级边与交互接到的并集，按种类再按名字', () => {
    const x = surfaceExpansion({
      view,
      selection: { kind: 'module', id: 'b' },
      always: false,
      links: links([el('a', 'run'), el('c', 'Item', 'type')]),
      spreads: spread('get'),
    })!
    expect(x.expand).toEqual([{ node: 'b', elements: ['get', 'run', 'Item'], from: null }])
    expect(x.interactions).toEqual([{ edge: 'a->b:queries', elements: ['get'] }])
  })

  it('选中束不展开（T2-7：只聚焦与高亮）；选中交互：接收方、只散开发起方那一侧', () => {
    const l = links([el('a', 'run'), el('c', 'Item', 'type')])
    expect(surfaceExpansion({ view, selection: { kind: 'dep', id: 'c->b' }, always: false, links: l, spreads: null })).toBeNull()
    expect(surfaceExpansion({ view, selection: { kind: 'relation', id: 'r1' }, always: false, links: l, spreads: spread('get') })!.expand).toEqual([
      { node: 'b', elements: ['get', 'run'], from: ['a'] },
    ])
  })

  it('端口封顶：多于 SURFACE_PORT_CAP 个元素时按接到它的节点数取前若干，其余计「+N」', () => {
    const many = Array.from({ length: SURFACE_PORT_CAP + 4 }, (_, i) => el('a', `e${String(i).padStart(2, '0')}`))
    const x = surfaceExpansion({ view, selection: { kind: 'module', id: 'b' }, always: false, links: links([...many, el('c', 'e19')]), spreads: null })!
    expect(x.expand[0].elements).toHaveLength(SURFACE_PORT_CAP)
    expect(x.expand[0].elements).toContain('e19')
    expect(x.expand[0].more).toBe(4)
  })
})

describe('unionView、layoutExpansion：散开的束', () => {
  it('散开的束换成接到元素端口的元素级边，其余（端口外、越过入口）合成一条接到节点本体；交互束另加接到元素的一段', () => {
    const l: StructureLinks = {
      ...links([el('a', 'run'), el('a', 'Other'), el('a', null), el('c', 'Item')]),
      expand: [{ node: 'b', elements: ['run', 'get'], from: ['a'] }],
      interactions: [{ edge: 'a->b:queries', elements: ['get'] }],
    }
    const u = unionView(view, l)
    const ids = u.edges.map(e => e.id)
    expect(ids).toContain('el:a->b:use:run')
    expect(ids).toContain(restEdgeId('bundle:a->b'))
    expect(ids).not.toContain('bundle:a->b')
    expect(ids).not.toContain('el:a->b:use:Other')
    expect(ids).toContain('bundle:c->b')
    expect(ids).toContain(spreadEdgeId('a->b:queries', 'get'))
    const exp = layoutExpansion(view, l)!
    expect([...exp.nodes]).toEqual([['b', ['run', 'get']]])
    expect(exp.targets.get('el:a->b:use:run')).toEqual({ node: 'b', element: 'run' })
    expect(exp.targets.get(spreadEdgeId('a->b:queries', 'get'))).toEqual({ node: 'b', element: 'get' })
    expect(exp.targets.has(restEdgeId('bundle:a->b'))).toBe(false)
  })
})
