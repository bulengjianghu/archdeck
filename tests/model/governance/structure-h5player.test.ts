/**
 * 结构视图（ADR-0031）以 h5player 的真实描述与本机源码验证：K14 的投影、K15 的影响面、K16 的指标、K17 与 K7 同口径、Q14 的查询核心、Q15 的入度最高共用件。
 * 源码在本地是前提（G1），不设跳过；只读查询，不写拦截记录。
 */
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { createService, type Loaded } from '../../../scripts/agent/service'
import { impactOf, levelDeps, projectLevel, sharedHealth, structureMetrics, topSharedFanIn } from '@/model'

const ROOT = path.resolve(import.meta.dirname, '../../..')
const svc = createService({ root: ROOT, client: 'cli', env: { ...process.env, ARCH_PROJECT: 'h5player' } })
let l: Loaded

beforeAll(() => {
  l = svc.load()
}, 60_000)

describe('h5player 结构视图', () => {
  it('K14、K17：根层每条束两端是不同的带，一对节点一条；束都有档与覆盖；未解释的束与 K7 同口径', () => {
    const view = projectLevel(l.index, l.index.rootId)
    const { bundles } = levelDeps(l.index, view, l.report)
    expect(bundles.length).toBeGreaterThan(0)
    expect(bundles.every(e => e.from !== e.to)).toBe(true)
    expect(new Set(bundles.map(b => `${b.from}->${b.to}`)).size).toBe(bundles.length)
    expect(bundles.every(e => e.tier && e.coverage)).toBe(true)
    // 组装事实（K13）在 h5player 有 145 条量级，根层至少一条束含组装形态
    expect(bundles.some(e => e.forms.includes('assembly'))).toBe(true)
    const undescribed = new Set(l.report.undescribed.map(d => d.key))
    for (const e of bundles) expect(!!e.unexplained).toBe(e.deps.some(k => undescribed.has(k)))
  })

  it('L15、K14（T3 裁决 9 核对）：根层只引类型计数为 0——每对带之间都有交互使用，按「取最强一档」聚合成交互使用；下钻后有只引类型的边', () => {
    const root = levelDeps(l.index, projectLevel(l.index, l.index.rootId), l.report)
    expect(root.bundles.length).toBeGreaterThan(0)
    expect(root.bundles.every(e => e.tier === 'invokes')).toBe(true)
    const typeOnly = (bs: readonly { tier: string }[]) => bs.filter(b => b.tier === 'type').length
    const counts = [...l.index.childrenOf.get(l.index.rootId)!].flatMap(layer => [layer, ...(l.index.childrenOf.get(layer) ?? [])]).map(id =>
      typeOnly(levelDeps(l.index, projectLevel(l.index, id, { showBoundaries: true }), l.report).bundles),
    )
    expect(counts.some(n => n > 0)).toBe(true)
  })

  it('K16、Q14：扇入最高的叶子模块是框架公共类型契约（Ca 99），I 稳定；metrics --top 与模型层同一结果', () => {
    const m = structureMetrics(l.index, l.report)
    expect(m.get('infra.framework.contracts')).toMatchObject({ ca: 99, band: 'stable' })
    const top = svc.metrics(undefined, { top: 10 })
    expect(top.kind).toBe('list')
    if (top.kind !== 'list') return
    expect(top.modules).toHaveLength(10)
    expect(top.modules[0]).toMatchObject({ id: 'infra.framework.contracts', ca: 99 })
    expect(top.modules.map(r => r.ca)).toEqual([...top.modules.map(r => r.ca)].sort((a, b) => b - a))
    const detail = svc.metrics(undefined, { module: 'infra.framework.contracts' })
    expect(detail.kind === 'module' && detail.topDependents.length).toBe(5)
    // --level：父模块的子模块
    const level = svc.metrics(undefined, { level: 'infra.framework' })
    expect(level.kind === 'list' && level.modules.map(r => r.id)).toEqual(l.index.childrenOf.get('infra.framework'))
  })

  it('K15、Q14：影响面按距离分组、标出环成员；只看值依赖时不更大；只给一个方向', () => {
    const all = svc.impact('infra.framework.contracts')
    expect(all.metrics.ca).toBe(99)
    expect(all.incoming!.byDistance[0]).toMatchObject({ distance: 1 })
    expect(all.incoming!.byDistance[0].modules).toHaveLength(99)
    expect(all.incoming!.modules).toBeGreaterThanOrEqual(99)
    expect(all.incoming!.byDistance.flatMap(g => g.modules).some(m => m.inCycle)).toBe(true)
    const values = svc.impact('infra.framework.contracts', undefined, { valuesOnly: true })
    expect(values.incoming!.modules).toBeLessThanOrEqual(all.incoming!.modules)
    const onlyIn = svc.impact('infra.framework.contracts', undefined, { direction: 'in' })
    expect(onlyIn.outgoing).toBeUndefined()
    expect(() => svc.impact('nope')).toThrow('不是模块')
    // 与模型层同一结果（Q6）
    expect(impactOf(l.index, l.report, 'infra.framework.contracts')!.incoming).toHaveLength(all.incoming!.modules)
  })

  it('Q15：唯一的共用件是事件总线（bus），没有模块依赖它，健康度不给「入度最高的共用件」；把框架公共类型契约认作共用件即给出 Ca 99', () => {
    const s = sharedHealth(l.index, l.own, l.report)!
    expect(s.modules).toBe(1)
    expect(structureMetrics(l.index, l.report).get('infra.framework.kernel.event-bus')!.ca).toBe(0)
    expect(s.topFanIn).toBeUndefined()
    const total = l.index.modules.size - (l.index.modules.has(l.index.rootId) ? 1 : 0)
    expect(topSharedFanIn(l.index, l.report, ['infra.framework.kernel.event-bus', 'infra.framework.contracts'])).toEqual({
      module: 'infra.framework.contracts',
      ca: 99,
      ratio: 99 / total,
    })
  })
})
