// @vitest-environment jsdom
/** 节点注记的位置表（L37）：环在名称行、共用与另直连在下边右、热度在右下角内；L14 角色记号；O12「组装根」角标 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import DiffMark from '../../src/components/nodes/DiffMark.vue'
import RimTag from '../../src/components/nodes/RimTag.vue'
import CycleMark from '../../src/components/nodes/CycleMark.vue'
import type { NodeData } from '../../src/layout/canvas'

const base: NodeData = { moduleId: 'm', name: 'M', childCount: 0, selected: false, dim: false }

describe('节点角标的统一布局', () => {
  it('L37：环编号在名称行（不随端口记号挪动）；「共用 ×N」固定在下边右、热度色块固定在右下角内；收起的注记不画', () => {
    const heat = { tier: 2, value: 5, count: 3, kind: 'changes' } as never
    const w = mount(DiffMark, { props: { data: { ...base, cycle: 2, sharedCount: 3, heat, ports: { side: 'top', items: [] } } } })
    expect(w.find('.cycle-mark').exists()).toBe(false)
    expect(w.find('[data-testid="unseen-marks"]').text()).toBe('共用 ×3')
    expect(w.find('.heat-badge').classes()).not.toContain('left')
    expect(mount(CycleMark, { props: { data: { ...base, cycle: 2 } } }).text()).toBe('↻ 2')
    expect(
      mount(CycleMark, { props: { data: { ...base, cycle: 2, restHidden: ['cycle'] } } })
        .find('.cycle-mark')
        .exists(),
    ).toBe(false)
    const hidden = mount(DiffMark, { props: { data: { ...base, sharedCount: 3, change: 'added', restHidden: ['unseen', 'state'] } } })
    expect(hidden.find('[data-testid="unseen-marks"]').exists()).toBe(false)
    expect(hidden.find('.diff-mark').exists()).toBe(false)
  })

  it('L37、L38：「另直连 N」与「共用 ×N」同在下边右一槽', () => {
    const w = mount(DiffMark, { props: { data: { ...base, sharedCount: 1, direct: { count: 2, title: 't' } } } })
    expect(w.find('[data-testid="unseen-marks"]').text().replace(/\s+/g, ' ')).toBe('共用 ×1 · 另直连 2')
  })

  it('O13：结构视角下「共用 ×N」按依赖计，悬停文字为「依赖 ×N（含只引类型）」；交互视角照 O10', () => {
    const s = mount(DiffMark, { props: { data: { ...base, sharedCount: 3, sharedByDeps: true } } })
    expect(s.find('.shared-mark').attributes('title')).toMatch(/^依赖 ×3（含只引类型）/)
    const i = mount(DiffMark, { props: { data: { ...base, sharedCount: 3 } } })
    expect(i.find('.shared-mark').attributes('title')).toMatch(/^用到本层共用件架上的 3 个共用件/)
  })

  it('O12：组装根角标在上边框左侧（与变更角标同一组），含多个时标 ×N', () => {
    const w = mount(DiffMark, { props: { data: { ...base, change: 'added', assemblyRoot: 2 } } })
    expect(w.find('.diff-mark').text()).toContain('新增')
    expect(w.find('.assembly-root').text()).toBe('组装根 ×2')
    expect(
      mount(DiffMark, { props: { data: { ...base, assemblyRoot: 1 } } })
        .find('.assembly-root')
        .text(),
    ).toBe('组装根')
  })

  it('L14：边界角色记号「端口」/「适配器」（模块块、分层总览的块与草图节点共用，跟在名字后）', () => {
    expect(mount(RimTag, { props: { rim: 'port' } }).text()).toBe('端口')
    expect(mount(RimTag, { props: { rim: 'adapter' } }).attributes('data-rim')).toBe('adapter')
  })
})

describe('L36 分层总览的带写状态记号', () => {
  it('带标题旁写「已确认 / 待确认」；不给状态时不画', async () => {
    const BandNode = (await import('../../src/components/nodes/BandNode.vue')).default
    const band = { abstraction: 'a', mayDependOn: [], hiddenCount: 0 }
    const stubs = { global: { stubs: { Handles: true } } }
    const w = mount(BandNode, { props: { data: { ...base, band: { ...band, status: 'confirmed' as const } } }, ...stubs })
    expect(w.find('[data-testid="layer-status"]').text()).toBe('已确认')
    expect(
      mount(BandNode, { props: { data: { ...base, band } }, ...stubs })
        .find('[data-testid="layer-status"]')
        .exists(),
    ).toBe(false)
  })
})

describe('L39②、L40② 「+N」写成员的层号跨度', () => {
  it('折叠 N · 第 X–Y 层；跨 ≥ 3 层时第二行提示；不分层时只写 +N', async () => {
    const MoreNode = (await import('../../src/components/nodes/MoreNode.vue')).default
    const w = mount(MoreNode, { props: { data: { ...base, hiddenCount: 8, foldTiers: { tiers: '深度 2–9', warn: '跨 8 个深度：该标核心或该拆' } } } })
    expect(w.find('[data-testid="fold-tiers"]').text()).toBe('折叠 8 · 深度 2–9')
    expect(w.find('[data-testid="fold-warn"]').text()).toBe('跨 8 个深度：该标核心或该拆')
    const plain = mount(MoreNode, { props: { data: { ...base, hiddenCount: 8 } } })
    expect(plain.find('[data-testid="fold-tiers"]').exists()).toBe(false)
    expect(plain.text()).toBe('+8 个其他模块')
  })
})
