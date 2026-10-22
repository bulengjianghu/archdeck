/**
 * 返工清单（docs/02-domain.md §2.17 Q7–Q9）：按根因聚合、每条的内容与建议动作、Markdown 输出。
 */
import { describe, expect, it } from 'vitest'
import {
  assignFiles,
  governanceReport,
  loadModel,
  projectHealth,
  reworkItemMarkdown,
  reworkList,
  reworkMarkdown,
  type Baseline,
  type FileDep,
  type RawFile,
  type ReworkItem,
} from '@/model'

const MODULES = `
modules:
  - id: ui
    name: UI
    kind: layer
    order: 1
    abstraction: 界面
    responsibility: 界面层
    children:
      - { id: ui.view, name: View, responsibility: 视图, codeRefs: [src/ui/view/**, src/shared/**] }
      - { id: ui.store, name: Store, responsibility: 状态, codeRefs: [src/ui/store/**, src/shared/**] }
      - { id: ui.panel, name: Panel, responsibility: 面板, codeRefs: [src/ui/panel/**] }
  - id: core
    name: Core
    kind: layer
    order: 2
    abstraction: 内核
    responsibility: 内核层
    mayDependOn: []
    children:
      - { id: core.api, name: Api, responsibility: 对外接口, codeRefs: [src/core/api/**], entry: src/core/api/missing.ts }
      - { id: core.impl, name: Impl, responsibility: 实现, codeRefs: [src/core/impl/**] }
      - { id: core.util, name: Util, responsibility: 工具, codeRefs: [src/core/util/**] }
relations:
  - { id: rel.1, from: ui.view, to: ui.store, type: depends }
  - { id: rel.2, from: ui.store, to: core.api, type: calls }
  - { id: rel.3, from: core.impl, to: core.util, type: depends }
  - { id: rel.4, from: ui.view, to: core.api, type: calls }
  - { id: rel.5, from: ui.view, to: core.api, type: dataflow }
  - { id: rel.bad, from: ui.view, to: nowhere, type: calls }
`

const SCENARIO = `
scenario:
  id: sc
  name: 场景
  steps:
    - call: { from: ui.panel, to: core.util, label: 未建模一 }
    - return: { from: core.util, to: ui.panel, label: 未建模二 }
    - call: { from: ui.view, to: core.api, label: 候选不唯一 }
    - call: { from: ui.store, to: core.api, label: 已建模 }
    - call: { from: ui.view, to: ui.view, label: 内部活动 }
`

const files = (): RawFile[] => [
  { path: 'system.yaml', text: 'system: { id: sys, name: Sys }' },
  { path: 'modules/layers.yaml', text: MODULES },
  { path: 'scenarios/sc.yaml', text: SCENARIO },
  { path: 'rules.yaml', text: 'rules:\n  allow:\n    - { from: core.util, to: ui.store, rule: layer, reason: 测试例外 }\n' },
]

const SRC = [
  'src/ui/view/a.ts',
  'src/ui/store/s.ts',
  'src/ui/panel/p.ts',
  'src/shared/x.ts',
  'src/shared/y.ts',
  'src/core/api/index.ts',
  'src/core/impl/i.ts',
  'src/core/impl/j.ts',
  'src/core/util/u.ts',
  'src/core/extra/e1.ts',
  'src/core/extra/e2.ts',
  'src/core/impl/stray/z.ts',
  'src/tools/t.ts',
  'docs/readme.md',
]

const dep = (from: string, to: string, line = 1): FileDep => ({ from, to, via: to, kind: 'value', line })

const DEPS: FileDep[] = [
  dep('src/core/impl/i.ts', 'src/ui/view/a.ts', 3), // core → ui：违规（U2）
  dep('src/core/impl/j.ts', 'src/ui/view/a.ts', 4), // 同一对
  dep('src/core/util/u.ts', 'src/ui/view/a.ts', 5), // 另一依赖方、同一被依赖方 → 同一根因
  dep('src/core/util/u.ts', 'src/ui/store/s.ts', 6), // 已豁免
  dep('src/ui/view/a.ts', 'src/ui/store/s.ts'), // rel.1 证实
  dep('src/ui/view/a.ts', 'src/ui/panel/p.ts', 7), // 未描述依赖
]

function setup(baseline: Baseline | null = null, withFacts = true) {
  const { index, issues } = loadModel(files())
  const own = assignFiles(index, SRC, ['docs/**'])
  const tree = { files: SRC, packages: {} }
  const report = withFacts ? governanceReport(index, own, tree, { deps: DEPS, external: {}, parsed: SRC.length }, baseline) : undefined
  return { index, issues, list: reworkList({ index, issues, source: { own, tree }, ...(report ? { report } : {}) }) }
}

const byCode = (items: ReworkItem[], code: string) => items.filter(i => i.code === code)

describe('Q7 内容与按根因聚合', () => {
  it('同一组重叠的 codeRefs 导致的冲突文件合并为一条，带全部受影响文件', () => {
    const { list } = setup()
    const [c] = byCode(list.items, 'source.conflict')
    expect(byCode(list.items, 'source.conflict')).toHaveLength(1)
    expect(c.affected.map(a => a.file)).toEqual(['src/shared/x.ts', 'src/shared/y.ts'])
    expect(c.title).toContain('View「src/shared/**」')
    expect(c.title).toContain('Store「src/shared/**」')
    expect(c.target.modules).toEqual(['ui.store', 'ui.view'])
  })

  it('未归属文件按所在目录聚合', () => {
    const { list } = setup()
    const items = byCode(list.items, 'source.unowned')
    expect(items.map(i => i.id).sort()).toEqual(['ownership:unowned:src/core/extra', 'ownership:unowned:src/tools'])
    expect(items.find(i => i.id.endsWith('src/core/extra'))!.affected).toHaveLength(2)
  })

  it('违规按（基线状态、种类、规则所在、被依赖方）聚合；已豁免单独一条', () => {
    const { list } = setup()
    const v = list.items.filter(i => i.category === 'violation')
    const open = v.find(i => i.status === 'open')!
    expect(v.filter(i => i.status === 'open')).toHaveLength(1)
    expect(open.title).toContain('2 个模块 → View')
    expect(open.detail).toBe('依赖方：Impl、Util')
    expect(open.affected.map(a => `${a.file}:${a.line}`)).toEqual(['src/core/impl/i.ts:3', 'src/core/impl/j.ts:4', 'src/core/util/u.ts:5'])
    expect(v.find(i => i.status === 'allowed')!.severity).toBe('info')
  })

  it('结构中未建模的步骤按两端（不论方向）聚合；内部活动与已绑定关系的不算；与层次无关', () => {
    const { list } = setup()
    const items = list.items.filter(i => i.category === 'unmodeled')
    expect(items.map(i => i.id).sort()).toEqual(['unmodeled:core.util<->ui.panel', 'unmodeled:core.api<->ui.view'].sort())
    expect(items.find(i => i.id === 'unmodeled:core.util<->ui.panel')!.affected).toHaveLength(2)
  })

  it('S5a 的未建模提醒不重复列在描述问题里；校验问题照常列出并带规则编号', () => {
    const { list, issues } = setup()
    expect(issues.some(i => i.code === 'step-unmodeled')).toBe(true)
    const desc = list.items.filter(i => i.category === 'description')
    expect(desc.some(i => i.code === 'step-unmodeled')).toBe(false)
    const bad = desc.find(i => i.code === 'unknown-endpoint')!
    expect(bad.severity).toBe('error')
    expect(bad.rules).toEqual(['M5'])
    expect(bad.at).toMatchObject({ in: 'description', file: 'modules/layers.yaml' })
    expect(bad.at!.line).toBeGreaterThan(0)
  })

  it('返工项 ID 稳定：重新计算结果相同', () => {
    expect(setup().list.items.map(i => i.id)).toEqual(setup().list.items.map(i => i.id))
  })

  it('没有代码事实时只含描述、归属与未建模', () => {
    const { list } = setup(null, false)
    expect(list.facts).toBe(false)
    expect(new Set(list.items.map(i => i.category))).toEqual(new Set(['description', 'ownership', 'unmodeled']))
  })
})

describe('Q8 返工项的内容与排序', () => {
  it('严重度：新增违规与环度上升为 error，已知为 warning，未描述依赖与可收紧基线为 info', () => {
    const baseline: Baseline = {
      createdAt: 't',
      violations: ['layer:core:core.util->ui.view', 'layer:core:gone->ui.view'],
      cyclicity: { modules: 0, files: 0 },
    }
    const { list } = setup(baseline)
    const v = list.items.filter(i => i.category === 'violation')
    expect(v.find(i => i.status === 'new')!).toMatchObject({ severity: 'error', code: 'rule.new' })
    expect(v.find(i => i.status === 'known')!).toMatchObject({ severity: 'warning', code: 'rule.known' })
    expect(list.items.find(i => i.code === 'baseline.resolved')!.severity).toBe('info')
    expect(list.items.find(i => i.id === 'undescribed:ui.view->ui.panel')!).toMatchObject({ severity: 'info', target: { dep: 'ui.view->ui.panel' } })
  })

  it('按严重度、类别、受影响数排序', () => {
    const { list } = setup()
    const sev = { error: 0, warning: 1, info: 2 }
    const ranks = list.items.map(i => sev[i.severity])
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b))
    expect(list.counts.error + list.counts.warning + list.counts.info).toBe(list.items.length)
  })

  it('建议动作：冲突收窄 codeRefs；未归属补 codeRefs（建议归属）或加忽略（整个目录为 <目录>/*）', () => {
    const { list } = setup()
    expect(byCode(list.items, 'source.conflict')[0].actions.map(a => a.kind)).toEqual(['add-code-refs'])
    const extra = list.items.find(i => i.id === 'ownership:unowned:src/core/extra')!
    expect(extra.actions.map(a => a.kind)).toEqual(['add-code-refs', 'add-ignore'])
    expect(extra.actions[1]).toMatchObject({ file: 'source-ignore.yaml', snippet: 'sourceIgnore:\n  - src/core/extra/*' })
    // 同目录子树里没有已归属文件时往上找：src/core 下归属最多的是 Impl
    expect(extra.actions[0].snippet).toBe('codeRefs: [src/core/impl/**, src/core/extra/*]')
    const tools = list.items.find(i => i.id === 'ownership:unowned:src/tools')!
    expect(tools.actions[1].snippet).toBe('sourceIgnore:\n  - src/tools/*')
  })

  it('建议动作：违规改代码或加例外（多条时写在规则所在上）；未描述依赖补关系；entry 不存在改描述', () => {
    const { list } = setup()
    const open = list.items.find(i => i.status === 'open')!
    expect(open.actions.map(a => a.kind)).toEqual(['fix-code', 'add-exception'])
    expect(open.actions[1].snippet).toBe('allow:\n  - { from: core, to: ui.view, rule: layer, reason: <写理由> }')
    expect(open.rules).toEqual(['U2', 'U6', 'U8'])
    const und = list.items.find(i => i.id === 'undescribed:ui.view->ui.panel')!
    expect(und.actions[0]).toMatchObject({ kind: 'add-relation', file: 'modules/layers.yaml' })
    expect(und.affected).toEqual([{ in: 'source', file: 'src/ui/view/a.ts', line: 7, note: '→ src/ui/panel/p.ts' }])
    expect(byCode(list.items, 'source.entry')[0].actions[0].kind).toBe('fix-description')
  })

  it('未证实：只列编译期关系，建议改正关系或检查 codeRefs', () => {
    const { list } = setup()
    const u = list.items.filter(i => i.category === 'unconfirmed')
    expect(u.map(i => i.target.relation)).toEqual(['rel.3'])
    expect(u[0].actions.map(a => a.kind)).toEqual(['fix-relation', 'add-code-refs'])
  })

  it('未建模：两端之间有多条运行时关系时补步骤 relation 并列出候选，否则补关系', () => {
    const { list } = setup()
    const amb = list.items.find(i => i.id === 'unmodeled:core.api<->ui.view')!
    expect(amb.actions[0].kind).toBe('add-step-relation')
    expect(amb.actions[0].snippet).toContain('relation: rel.4')
    expect(amb.actions[0].snippet).toContain('relation: rel.5')
    const none = list.items.find(i => i.id === 'unmodeled:core.util<->ui.panel')!
    expect(none.actions[0].kind).toBe('add-relation')
    expect(none.at).toMatchObject({ in: 'description', file: 'scenarios/sc.yaml' })
  })
})

describe('Q9 Markdown', () => {
  it('描述文件加模型目录前缀，带行号、规则、建议与 YAML 片段', () => {
    const { list } = setup()
    const md = reworkMarkdown(list, 'Sys', { modelDir: 'model/sys', sourceRoot: '/src/root' })
    expect(md).toContain('# 返工清单：Sys')
    expect(md).toContain('/src/root')
    expect(md).toMatch(/`model\/sys\/modules\/layers\.yaml:\d+`/)
    expect(md).toContain('`src/core/impl/i.ts:3 → src/ui/view/a.ts`')
    expect(md).toContain('```yaml')
    const one = reworkItemMarkdown(list.items[0], { modelDir: 'model/sys' })
    expect(md).toContain(one)
  })

  it('受影响位置超过上限时截断并注明', () => {
    const { list } = setup()
    const conflict = byCode(list.items, 'source.conflict')[0]
    expect(reworkItemMarkdown(conflict, { limit: 1 })).toContain('…另 1 处')
  })
})

describe('Q10 项目健康度', () => {
  const health = (baseline: Baseline | null) => {
    const { index } = loadModel(files())
    const own = assignFiles(index, SRC, ['docs/**'])
    const report = governanceReport(index, own, { files: SRC, packages: {} }, { deps: DEPS, external: {}, parsed: SRC.length }, baseline)
    return projectHealth(index, own, report)
  }

  it('没有基线：违规为绝对数，delta 为 null；环、未证实、未归属与冲突计数', () => {
    const h = health(null)
    expect(h.violations).toEqual({ count: 2, new: 0, resolved: 0, allowed: 1, delta: null })
    expect(h.cycles).toEqual({ count: 0, maxSize: 0, cyclicity: 0, baseline: null })
    expect(h.unconfirmed).toBe(1)
    expect(h.unowned).toBe(3)
    expect(h.conflicts).toBe(2)
  })

  it('有基线：delta = 新增 − 已消除', () => {
    const h = health({ createdAt: 't', violations: ['layer:core:core.util->ui.view', 'layer:core:gone->ui.view', 'layer:core:gone2->ui.view'], cyclicity: { modules: 4, files: 0 } })
    expect(h.violations).toMatchObject({ count: 2, new: 1, resolved: 2, delta: -1 })
    expect(h.cycles!.baseline).toBe(4)
  })
})
