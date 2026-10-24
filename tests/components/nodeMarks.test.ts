// @vitest-environment jsdom
/** 节点角上的记号（T3 裁决 7）：端口记号占上边框右半时，环与「共用 ×N」移到下边框、热度让到左下角；L14 角色记号；O12「组装根」角标 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import DiffMark from '../../src/components/nodes/DiffMark.vue'
import RimTag from '../../src/components/nodes/RimTag.vue'
import type { NodeData } from '../../src/layout/canvas'

const base: NodeData = { moduleId: 'm', name: 'M', childCount: 0, selected: false, dim: false }

describe('节点角标的统一布局', () => {
  it('没有顶边端口记号：环与共用骑在上边框右侧；有时移到下边框，热度色块让到左下角', () => {
    const plain = mount(DiffMark, { props: { data: { ...base, cycle: 2, sharedCount: 3, heat: { tier: 2, value: 5, count: 3, kind: 'changes' } as never } } })
    expect(plain.find('.cycle-mark').classes()).not.toContain('lowered')
    expect(plain.find('.heat-badge').classes()).not.toContain('left')
    const withPorts = mount(DiffMark, {
      props: {
        data: { ...base, cycle: 2, sharedCount: 3, heat: { tier: 2, value: 5, count: 3, kind: 'changes' } as never, ports: { side: 'top', items: [] } },
      },
    })
    expect(withPorts.find('.cycle-mark').classes()).toContain('lowered')
    expect(withPorts.find('.shared-mark').classes()).toContain('lowered')
    expect(withPorts.find('.heat-badge').classes()).toContain('left')
    // 端口记号在左边（自左向右布局）时不冲突，照常在上边框
    const left = mount(DiffMark, { props: { data: { ...base, cycle: 2, ports: { side: 'left', items: [] } } } })
    expect(left.find('.cycle-mark').classes()).not.toContain('lowered')
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
