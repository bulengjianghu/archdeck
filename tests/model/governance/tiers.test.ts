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
  layerUpward,
  layerDrift,
  reviewEntries,
  foldSpanText,
  DEFAULT_PROJECT_OPTIONS,
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

describe('L39 折叠与分层正交、L40 组织判断三态（第十四轮 F1、F5）', () => {
  // 一个核心 + 8 个普通模块（O8 折叠为「+N」）：入口 → m1 → m2 → … → m8 的长链，m8 在最底
  const chain = Array.from({ length: 8 }, (_, i) => `m${i + 1}`)
  const FOLD = `
modules:
  - id: app
    name: App
    responsibility: 应用
    children:
      - { id: app.entry, name: Entry, responsibility: 入口, role: core, codeRefs: [src/entry/**] }
${chain.map(m => `      - { id: app.${m}, name: ${m}, responsibility: ${m}, codeRefs: [src/${m}/**] }`).join('\n')}
`
  const files = ['src/entry/e.ts', ...chain.map(m => `src/${m}/x.ts`)]
  const deps = files.slice(1).map((f, i) => dep(files[i], f))
  function folded() {
    const { index } = loadModel([
      { path: 'system.yaml', text: 'system: { id: sys, name: Sys }' },
      { path: 'modules/app.yaml', text: FOLD },
    ])
    const own = assignFiles(index, files, [])
    const report = governanceReport(index, own, { files, packages: {} }, { deps, external: {}, parsed: files.length }, null)
    return { index, report }
  }

  it('①② 层号对全集算：折叠后「+N」放在成员最上的一层，给出成员的层号跨度；门槛按全集判定', () => {
    const { index, report } = folded()
    const view = projectLevel(index, 'app')
    expect(view.fold?.expanded).toBe(false)
    const t = levelTiers(index, view, report)!
    expect(t.tier.get('app.entry')).toBe(0)
    expect(t.tier.get('more:app')).toBe(1)
    expect(t.foldSpan).toEqual({ node: 'more:app', from: 1, to: 8, members: 8 })
    expect(t.count).toBe(9)
    expect(t.banded).toBe(true)
    expect(t.nodes).toEqual(['app.entry', 'more:app'])
  })

  it('③ 展开即解压：成员落到全集算好的层号，层数不变', () => {
    const { index, report } = folded()
    const open = projectLevel(index, 'app', { ...DEFAULT_PROJECT_OPTIONS, expandedBands: ['app'] })
    const t = levelTiers(index, open, report)!
    expect(chain.map(m => t.tier.get(`app.${m}`))).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(t.count).toBe(9)
    expect(t.foldSpan).toBeUndefined()
  })

  it('L40② 跨 ≥ 3 层提示「该标核心或该拆」；同一层只写一个层号', () => {
    expect(foldSpanText({ from: 1, to: 8 })).toEqual({ tiers: '第 2–9 层', warn: '跨 8 层：该标核心或该拆' })
    expect(foldSpanText({ from: 2, to: 3 })).toEqual({ tiers: '第 3–4 层', warn: null })
    expect(foldSpanText({ from: 2, to: 2 }).tiers).toBe('第 3 层')
  })

  it('L40③ 平铺：子模块之间既没有依赖也没有交互时明说', () => {
    const { index } = folded()
    const t = levelTiers(index, projectLevel(index, 'app', { ...DEFAULT_PROJECT_OPTIONS, expandedBands: ['app'] }), { moduleDeps: new Map() })!
    expect(t.notes).toContainEqual({ kind: 'flat', nodes: 9 })
    expect(tierNoteText({ kind: 'flat', nodes: 9 })).toBe('平铺：本层 9 个子模块彼此独立（没有依赖也没有交互）')
  })
})

describe('K22 扩到声明的层（第十四轮 F8）', () => {
  const LAYERED = `
modules:
  - { id: ui, name: UI, kind: layer, order: 1, abstraction: 呈现, responsibility: 界面, children: [{ id: ui.view, name: View, responsibility: 视图, role: core }] }
  - { id: core, name: Core, kind: layer, order: 2, abstraction: 业务, responsibility: 业务, children: [{ id: core.svc, name: Svc, responsibility: 服务, role: core }] }
relations:
  - { id: r.down, from: ui.view, to: core.svc, type: commands }
  - { id: r.up, from: core.svc, to: ui.view, type: commands }
  - { id: r.note, from: core.svc, to: ui.view, type: notifies }
`
  it('分层总览：下层发起、指向上层的交互为向上；通知是控制反转，直接委托给提示（带间边与核心跨层边同一判定）', () => {
    const { index } = loadModel([
      { path: 'system.yaml', text: 'system: { id: sys, name: Sys }' },
      { path: 'modules/a.yaml', text: LAYERED },
    ])
    const view = projectLevel(index, index.rootId)
    expect(view.mode).toBe('layered')
    const up = layerUpward(index, view)
    const band = up.find(u => u.from === 'core' && u.to === 'ui')
    expect(band).toMatchObject({ inversion: false, relations: ['r.up'] })
    expect(up.some(u => u.from === 'ui')).toBe(false)
    expect(layerUpward(index, view, { core: false }).every(u => !u.edge.startsWith('core:'))).toBe(true)
    // 普通层次不适用
    expect(layerUpward(index, projectLevel(index, 'ui'))).toEqual([])
    // 返工清单：tier.upward 指向声明的层
    const own = assignFiles(index, [], [])
    const report = governanceReport(index, own, { files: [], packages: {} }, { deps: [], external: {}, parsed: 0 }, null)
    const issues = tierIssues(index, report, own).filter(i => i.code === 'tier.upward')
    expect(issues).toHaveLength(1)
    expect(issues[0].message).toContain('声明的层')
  })
})

describe('K24 结构符合性（第十四轮 F3）', () => {
  const LAYERED = `
modules:
  - { id: ui, name: UI, kind: layer, order: 1, abstraction: 呈现, responsibility: 界面, codeRefs: [src/ui/**] }
  - { id: core, name: Core, kind: layer, order: 2, abstraction: 业务, responsibility: 业务, codeRefs: [src/core/**] }
  - { id: base, name: Base, kind: layer, order: 3, abstraction: 底座, responsibility: 底座, codeRefs: [src/base/**] }
`
  const files = ['src/ui/a.ts', 'src/core/b.ts', 'src/base/c.ts']
  function setupLayers(deps: FileDep[]) {
    const { index } = loadModel([
      { path: 'system.yaml', text: 'system: { id: sys, name: Sys }' },
      { path: 'modules/a.yaml', text: LAYERED },
    ])
    const own = assignFiles(index, files, [])
    const report = governanceReport(index, own, { files, packages: {} }, { deps, external: {}, parsed: files.length }, null)
    return { index, own, report }
  }

  it('依赖与声明一致时没有漂移；声明在上、实算在下为倒置；声明的层互相依赖为成环', () => {
    const ok = setupLayers([dep('src/ui/a.ts', 'src/core/b.ts'), dep('src/core/b.ts', 'src/base/c.ts')])
    expect(layerDrift(ok.index, ok.report)).toEqual([])
    const inv = setupLayers([dep('src/core/b.ts', 'src/ui/a.ts'), dep('src/ui/a.ts', 'src/base/c.ts')])
    expect(layerDrift(inv.index, inv.report)).toContainEqual({ kind: 'inverted', parent: inv.index.rootId, above: 'ui', below: 'core', tiers: [1, 0] })
    const cyc = setupLayers([dep('src/ui/a.ts', 'src/core/b.ts'), dep('src/core/b.ts', 'src/ui/a.ts')])
    expect(layerDrift(cyc.index, cyc.report)).toContainEqual({ kind: 'cycle', parent: cyc.index.rootId, layers: ['ui', 'core'] })
  })

  it('返工清单只报已确认的层（info，类别「层的符合性」）；未确认的还是主张，不报', () => {
    const inv = setupLayers([dep('src/core/b.ts', 'src/ui/a.ts')])
    const before = reworkList({ index: inv.index, issues: [], report: inv.report, source: { own: inv.own, tree: { files, packages: {} } } })
    expect(before.items.some(i => i.category === 'conformance')).toBe(false)
    inv.index.model.reviewed.push(...reviewEntries(inv.index, ['ui'], { source: 'manual' }).map(e => ({ ...e, src: { file: 'reviewed.yaml', path: 'reviewed.0' } })))
    const after = reworkList({ index: inv.index, issues: [], report: inv.report, source: { own: inv.own, tree: { files, packages: {} } } })
    const item = after.items.find(i => i.category === 'conformance')!
    expect(item).toMatchObject({ severity: 'info', code: 'tier.drift', rules: ['K24'] })
    expect(item.title).toContain('实算在它之下')
  })
})
