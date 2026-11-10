/**
 * 把手角标（L23b、O4，ADR-0033）：角标文本 `×N · M 把手`、悬停按所属子模块分组；分层总览核心跨层边同样带（coreHandleBadges），总览不展开表面。纯函数。
 */
import { describe, expect, it } from 'vitest'
import { loadModel, type LevelView, type ViewEdge } from '@/model'
import { coreHandleBadges, handleBadge, handleLabel } from '../../src/layout/layout'

const MODEL = `
modules:
  - { id: fam, name: 自建时钟族, responsibility: 发起方 }
  - id: lat
    name: 延迟决策律
    responsibility: 接收方
    children:
      - { id: lat.run, name: 运行骨架, responsibility: 运行 }
      - { id: lat.meters, name: 计量, responsibility: 计量 }
      - { id: lat.timers, name: 计时器, responsibility: 计时器 }
interfaces:
  - { id: if.run, name: runLatencyLaw, owner: lat.run, signature: 'runLatencyLaw(): void' }
  - { id: if.freeze, name: FreezeMeter, owner: lat.meters, signature: 'class FreezeMeter {}' }
  - { id: if.hold, name: HoldUnseen, owner: lat.timers, signature: 'class HoldUnseen {}' }
  - { id: if.visible, name: visibleTimers, owner: lat.timers, signature: 'visibleTimers(): void' }
  - { id: if.within, name: within, owner: lat.timers, signature: 'within(): void' }
relations:
  - { id: r1, from: fam, to: lat.timers, type: commands, interface: if.visible }
  - { id: r2, from: fam, to: lat.run, type: commands, interface: if.run }
  - { id: r3, from: fam, to: lat.meters, type: commands, interface: if.freeze }
  - { id: r4, from: fam, to: lat.timers, type: commands, interface: if.hold }
  - { id: r5, from: fam, to: lat.timers, type: commands, interface: if.within }
  - { id: r6, from: fam, to: lat, type: commands }
  - { id: r7, from: fam, to: lat, type: commands }
`
const { index } = loadModel([
  { path: 'system.yaml', text: 'system: { id: sys, name: Sys }' },
  { path: 'modules/m.yaml', text: MODEL },
])

const edge = (relationIds: string[], id = 'fam->lat:commands'): ViewEdge => ({
  id,
  kind: 'aggregate',
  from: 'fam',
  to: 'lat',
  type: 'commands',
  relationIds,
  mode: 'sync',
})
const graph = (e: ViewEdge): LevelView =>
  ({
    mode: 'graph',
    parentId: 'sys',
    nodes: [
      { id: 'fam', moduleId: 'fam', role: 'module', hasChildren: false },
      { id: 'lat', moduleId: 'lat', role: 'module', hasChildren: true },
    ],
    edges: [e],
  }) as unknown as LevelView

describe('L23b：角标文本', () => {
  it('×N · M 把手；M 为 0 只写 ×N；N 为 1 不写', () => {
    expect(handleLabel(5, 5)).toBe('×5 · 5 把手')
    expect(handleLabel(3, 0)).toBe('×3')
    expect(handleLabel(1, 1)).toBe('')
  })

  it('M 按接口去重、没写接口的不计；悬停按所属子模块分组、组按条数降序，各条「接口名 · 子模块 · 种类」', () => {
    const e = edge(['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7'])
    const b = handleBadge(index, graph(e), e)!
    expect(b.label).toBe('×7 · 5 把手')
    const lines = b.title.split('\n')
    expect(lines[0]).toBe('自建时钟族 → 延迟决策律 · 委托 ×7 · 5 把手（L23b）')
    expect(lines.filter(l => !l.startsWith('  ')).slice(1)).toEqual(['计时器（3 条）', '本体（2 条）', '运行骨架（1 条）', '计量（1 条）'])
    expect(lines).toContain('  visibleTimers · 计时器 · 委托')
    expect(lines).toContain('  （没写接口） · 本体 · 委托')
  })

  it('全部没写接口：只写 ×N', () => {
    const e = edge(['r6', 'r7'])
    expect(handleBadge(index, graph(e), e)!.label).toBe('×2')
  })
})

describe('O4、L23b：分层总览核心跨层边的角标数据', () => {
  it('每条核心边给角标与悬停分组；普通层次（非总览）为空', () => {
    const core = edge(['r1', 'r2', 'r3', 'r4', 'r5'], 'core:fam->lat:commands')
    const view = { ...graph(edge(['r6'])), mode: 'layered', edges: [], coreEdges: [core] } as unknown as LevelView
    const m = coreHandleBadges(view, index)
    expect(m.get(core.id)?.label).toBe('×5 · 5 把手')
    expect(m.get(core.id)?.handles.groups.map(g => g.sub)).toEqual(['lat.timers', 'lat.run', 'lat.meters'])
    expect(coreHandleBadges(graph(core), index).size).toBe(0)
  })
})
