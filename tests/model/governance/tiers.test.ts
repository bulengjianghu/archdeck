/** 按依赖分层与拆分信号（L28、L29、K21、K22，ADR-0038） */
import { describe, expect, it } from 'vitest'
import {
  assignFiles,
  governanceReport,
  levelTiers,
  loadModel,
  projectLevel,
  splitSignals,
  tierIssues,
  tierNodes,
  tierNoteText,
  isInversion,
  reworkList,
  BAND_MIN_NODES,
  type FileDep,
} from '@/model'

const MODEL = `
modules:
  - id: app
    name: App
    responsibility: 应用
    children:
      - { id: app.entry, name: Entry, responsibility: 入口, codeRefs: [src/entry/**] }
      - { id: app.mid, name: Mid, responsibility: 中间, codeRefs: [src/mid/**] }
      - { id: app.cyc1, name: Cyc1, responsibility: 环一, codeRefs: [src/cyc1/**] }
      - { id: app.cyc2, name: Cyc2, responsibility: 环二, codeRefs: [src/cyc2/**] }
      - { id: app.base, name: Base, responsibility: 底, codeRefs: [src/base/**] }
      - { id: app.iso, name: Iso, responsibility: 孤立, codeRefs: [src/iso/**, src/shared.ts] }
      - { id: app.conc, name: Conc, responsibility: 概念, codeRefs: [src/shared.ts] }
      - { id: app.ghost, name: Ghost, responsibility: 不占文件 }
relations:
  - { id: r.down, from: app.entry, to: app.mid, type: commands }
  - { id: r.up, from: app.base, to: app.mid, type: commands }
  - { id: r.notify, from: app.base, to: app.entry, type: notifies }
  - { id: r.port, from: app.base, to: app.cyc1, type: queries, via: 'channel:callback' }
  - { id: r.iso, from: app.iso, to: app.mid, type: commands }
`
const SRC = ['src/entry/e.ts', 'src/mid/m.ts', 'src/cyc1/c.ts', 'src/cyc2/c.ts', 'src/base/b.ts', 'src/iso/i.ts', 'src/shared.ts']
const dep = (from: string, to: string): FileDep => ({ from, to, via: to, kind: 'value', line: 1, uses: true, invokes: true })
const DEPS: FileDep[] = [
  dep('src/entry/e.ts', 'src/mid/m.ts'),
  dep('src/entry/e.ts', 'src/cyc1/c.ts'),
  dep('src/mid/m.ts', 'src/base/b.ts'),
  dep('src/cyc1/c.ts', 'src/cyc2/c.ts'),
  dep('src/cyc2/c.ts', 'src/cyc1/c.ts'),
  dep('src/cyc1/c.ts', 'src/base/b.ts'),
  // 只引类型：不影响层号
  { ...dep('src/base/b.ts', 'src/entry/e.ts'), kind: 'type' },
]

function setup() {
  const { index } = loadModel([
    { path: 'system.yaml', text: 'system: { id: sys, name: Sys }' },
    { path: 'modules/app.yaml', text: MODEL },
  ])
  const own = assignFiles(index, SRC, [])
  const report = governanceReport(index, own, { files: SRC, packages: {} }, { deps: DEPS, external: {}, parsed: SRC.length }, null)
  const view = projectLevel(index, 'app')
  return { index, own, report, view, tiers: levelTiers(index, view, report)! }
}

describe('L28 按本层值依赖分层', () => {
  it('被依赖的贴底、没人依赖的置顶、按最长链排；只引类型不影响层号', () => {
    const { tiers } = setup()
    expect(tiers.tier.get('app.entry')).toBe(0)
    expect(tiers.tier.get('app.mid')).toBe(1)
    expect(tiers.tier.get('app.base')).toBe(2)
    expect(tiers.count).toBe(3)
  })

  it('环合组：整组同层，组号复用 Y4', () => {
    const { tiers } = setup()
    expect(tiers.groups).toEqual([['app.cyc1', 'app.cyc2']])
    expect(tiers.tier.get('app.cyc1')).toBe(tiers.tier.get('app.cyc2'))
    expect(tiers.groupIds[0]).toBeGreaterThan(0)
  })

  it('孤立的不占层；交互边不影响层号', () => {
    const { tiers } = setup()
    expect(tiers.isolated).toEqual(['app.iso', 'app.conc', 'app.ghost'])
    expect(tiers.tier.has('app.iso')).toBe(false)
  })

  it('tierNodes：入口对齐——没人依赖的短链也提到顶层', () => {
    const t = tierNodes(['a', 'b', 'c', 'd'], [
      ['a', 'b'],
      ['b', 'c'],
      ['d', 'c'],
    ])
    expect([...t.tier]).toEqual([
      ['a', 0],
      ['b', 1],
      ['c', 2],
      ['d', 0],
    ])
  })

  it('分层总览不适用', () => {
    const { index, view } = setup()
    expect(levelTiers(index, { ...view, mode: 'layered' }, { moduleDeps: new Map() })).toBeNull()
  })
})

describe('L29 层带门槛与提示', () => {
  it('不足 7 个节点不画层带；大环与本层无依赖给提示', () => {
    const { tiers } = setup()
    expect(tiers.nodes.length).toBeGreaterThanOrEqual(BAND_MIN_NODES)
    expect(tiers.banded).toBe(true)
    const big = tierNodes(['a', 'b', 'c'], [
      ['a', 'b'],
      ['b', 'c'],
      ['c', 'a'],
    ])
    expect(big.groups).toHaveLength(1)
    expect(tierNoteText({ kind: 'big-cycle', group: 1, size: 3, of: 3 })).toContain('照样分层')
    expect(tierNoteText({ kind: 'no-deps', interactions: 2 })).toContain('不分层')
  })

  it('本层没有值依赖却有交互：不分层，提示 no-deps', () => {
    const { index, view } = setup()
    const t = levelTiers(index, view, { moduleDeps: new Map() })!
    expect(t.count).toBe(0)
    expect(t.notes.some(n => n.kind === 'no-deps')).toBe(true)
  })
})

describe('K22 向上的线', () => {
  it('通知、写了 via 的是控制反转；直接委托向上给提示', () => {
    const { tiers, view } = setup()
    const by = (from: string, to: string) => tiers.upward.find(u => u.from === from && u.to === to)
    expect(by('app.base', 'app.entry')?.inversion).toBe(true)
    expect(by('app.base', 'app.cyc1')?.inversion).toBe(true)
    expect(by('app.base', 'app.mid')).toMatchObject({ inversion: false, relations: ['r.up'] })
    // 向下的不算
    expect(tiers.upward.some(u => u.from === 'app.entry')).toBe(false)
    expect(view.edges.length).toBeGreaterThan(tiers.upward.length)
    expect(isInversion({ type: 'streams' })).toBe(true)
    expect(isInversion({ type: 'commands', via: 'port:p' })).toBe(true)
    expect(isInversion({ type: 'commands' })).toBe(false)
  })

  it('不是控制反转的向上边进 info 提醒 tier.upward', () => {
    const { index, report, own } = setup()
    const up = tierIssues(index, report, own).filter(i => i.code === 'tier.upward')
    expect(up).toHaveLength(1)
    expect(up[0].severity).toBe('info')
    expect(up[0].message).toContain('r.up')
  })
})

describe('K21 拆分信号', () => {
  it('子模块不占文件、兄弟共用文件', () => {
    const { index, own } = setup()
    const s = splitSignals(index, own, 'app')
    expect(s.noFiles).toEqual(['app.ghost'])
    expect(s.shared).toEqual([{ file: 'src/shared.ts', modules: ['app.iso', 'app.conc'] }])
  })

  it('直接交互却两个方向都没有值依赖的兄弟', () => {
    const { tiers } = setup()
    // iso → mid（直接委托，无依赖）、base → entry（通知没写 via，两端之间只有只引类型）；base → cyc1 写了 via 不算；base → mid 有反向的值依赖
    expect(tiers.undepended.map(p => `${p.from}->${p.to}`).sort()).toEqual(['app.base->app.entry', 'app.iso->app.mid'])
  })

  it('提醒为 info，进治理报告，不卡门禁', () => {
    const { index, report, own } = setup()
    const codes = tierIssues(index, report, own).map(i => i.code)
    expect(codes).toContain('split.no-files')
    expect(codes).toContain('split.undepended')
    expect(report.issues.filter(i => i.code.startsWith('split.') || i.code.startsWith('tier.')).every(i => i.severity === 'info')).toBe(true)
  })
})

describe('K21、K22 返工清单', () => {
  it('「模块拆分与分层」类：每条带规则编号、定位与建议动作', () => {
    const { index, report, own } = setup()
    const list = reworkList({ index, issues: [], source: { own, tree: { files: SRC, packages: {} } }, report })
    const split = list.items.filter(i => i.category === 'split')
    expect(split.map(i => i.code).sort()).toEqual(['split.no-files', 'split.undepended', 'tier.upward'])
    const up = split.find(i => i.code === 'tier.upward')!
    expect(up).toMatchObject({ severity: 'info', rules: ['K22'], target: { modules: ['app.base', 'app.mid'], relation: 'r.up' } })
    expect(split.find(i => i.code === 'split.no-files')!.actions[0].kind).toBe('split-file')
    expect(list.byCategory.split).toBe(3)
  })
})
