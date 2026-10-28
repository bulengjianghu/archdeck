/** K23（第十四轮 F9、F10，ADR-0046）：线的级别——例外、环内、可推出、骨架 */
import { describe, expect, it } from 'vitest'
import { gradeBundles, type GradeInput } from '@/model'

type B = GradeInput['bundles'][number]
const b = (from: string, to: string, extra: Partial<B> = {}): B => ({
  id: `bundle:${from}->${to}`,
  from,
  to,
  tier: 'invokes',
  ruling: { verdict: 'none', violations: [], allowedBy: [] } as unknown as B['ruling'],
  ...extra,
})
const inner = (n: string) => !n.startsWith('boundary:') && n !== 'shelf'

describe('K23 线的级别', () => {
  it('91 §2：a→b→c 与直连 a→c——a→c 可推出，记在依赖方 a 的「另直连」，替代路径经 b', () => {
    const g = gradeBundles({ bundles: [b('a', 'b'), b('b', 'c'), b('a', 'c')], inner, cycleEdges: new Set() })
    expect(g.grade.get('bundle:a->c')).toBe('reducible')
    expect(g.grade.get('bundle:a->b')).toBe('skeleton')
    expect(g.via.get('bundle:a->c')).toEqual(['b'])
    expect(g.direct.get('a')).toEqual(['bundle:a->c'])
  })

  it('F10：例外 = 违规 ∪ 向上 ∪ 逆稳定 ∪ 未解释——既不被约简，也不参与路径', () => {
    const bundles = [b('a', 'b', { unexplained: true }), b('b', 'c'), b('a', 'c')]
    const g = gradeBundles({ bundles, inner, cycleEdges: new Set() })
    expect(g.exceptions.get('bundle:a->b')).toEqual(['unexplained'])
    // a→b 是例外、不进路径：a→c 不可推出
    expect(g.grade.get('bundle:a->c')).toBe('skeleton')
    const v = gradeBundles({
      bundles: [b('x', 'y', { ruling: { status: 'new' } as B['ruling'], againstStability: { from: 0.1, to: 0.9 } })],
      inner,
      cycleEdges: new Set(),
    })
    expect(v.exceptions.get('bundle:x->y')).toEqual(['violation', 'against'])
  })

  it('F10「向上」：依赖方所在的算出的层在被依赖方之下；「+N」不判', () => {
    const tier = new Map([
      ['top', 0],
      ['low', 2],
      ['more:p', 1],
    ])
    const g = gradeBundles({ bundles: [b('low', 'top', { tier: 'type' }), b('more:p', 'top')], inner, cycleEdges: new Set(), tier, noTier: new Set(['more:p']) })
    expect(g.exceptions.get('bundle:low->top')).toEqual(['upward'])
    expect(g.grade.get('bundle:more:p->top')).toBe('skeleton')
  })

  it('F10：环上的束按组（不是逐条例外时）；环内的束不进约简宇宙', () => {
    const g = gradeBundles({ bundles: [b('a', 'b'), b('b', 'a'), b('a', 'c')], inner, cycleEdges: new Set(['a->b', 'b->a']) })
    expect([...g.cycle]).toEqual(['bundle:a->b', 'bundle:b->a'])
    expect(g.grade.get('bundle:a->c')).toBe('skeleton')
  })

  it('边界、共用件、只引类型不在宇宙里（按原规则）', () => {
    const g = gradeBundles({ bundles: [b('boundary:x', 'a'), b('a', 'shelf'), b('a', 'b', { tier: 'type' })], inner, cycleEdges: new Set() })
    expect([...g.grade.values()]).toEqual(['other', 'other', 'other'])
  })
})
