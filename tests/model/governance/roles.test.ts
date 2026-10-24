/** 模块分级的治理（ADR-0027）：U11 疑似共用件、U12 共用件反向依赖、Q13 健康度的共用件提醒、Z4 任意层次的核心进确认范围 */
import { describe, expect, it } from 'vitest'
import { assignFiles, governanceReport, loadModel, projectHealth, reviewScope, reworkList, sharedHealth, type FileDep, type OkHistory, type RawFile } from '@/model'

const dep = (from: string, to: string, uses = true, line = 1): FileDep => ({ from, to, via: to, kind: 'value', line, ...(uses ? { uses: true as const } : {}) })
const SRC = ['src/ui/view.ts', 'src/ui/store.ts', 'src/ui/labels.ts', 'src/core/api.ts', 'src/core/util.ts', 'src/core/impl.ts', 'src/core/x.ts']
const files = (extra: Record<string, string> = {}): RawFile[] =>
  Object.entries({
    'system.yaml': 'system: { id: sys, name: Sys }',
    'modules/m.yaml': `modules:
  - id: ui
    name: UI
    kind: layer
    order: 1
    children:
      - { id: ui.view, name: View, codeRefs: [src/ui/view.ts] }
      - { id: ui.store, name: Store, codeRefs: [src/ui/store.ts] }
      - { id: ui.labels, name: Labels, codeRefs: [src/ui/labels.ts] }
  - id: core
    name: Core
    kind: layer
    order: 2
    children:
      - id: core.api
        name: Api
        codeRefs: [src/core/api.ts]
        children:
          - { id: core.api.deep, name: Deep, role: core }
      - { id: core.util, name: Util, codeRefs: [src/core/util.ts] }
      - { id: core.impl, name: Impl, codeRefs: [src/core/impl.ts] }
      - { id: core.x, name: SharedX, codeRefs: [src/core/x.ts] }
relations:
  - { id: r1, from: ui.view, to: ui.store, type: calls }
  - { id: r2, from: core.x, to: core.impl, type: calls }
`,
    ...extra,
  }).map(([path, text]) => ({ path, text }))

const DEPS = [
  dep('src/ui/view.ts', 'src/core/util.ts'),
  dep('src/core/api.ts', 'src/core/util.ts'),
  dep('src/ui/view.ts', 'src/ui/labels.ts'),
  dep('src/ui/labels.ts', 'src/ui/store.ts', true, 7),
  dep('src/ui/labels.ts', 'src/core/util.ts'),
  dep('src/ui/view.ts', 'src/core/x.ts'),
  dep('src/core/api.ts', 'src/core/x.ts'),
  dep('src/ui/store.ts', 'src/ui/labels.ts', false),
]

function report(extra: Record<string, string> = {}, deps = DEPS) {
  const { index } = loadModel(files(extra))
  const own = assignFiles(index, SRC, [])
  return { index, own, report: governanceReport(index, own, { files: SRC, packages: {} }, { deps, external: {}, parsed: SRC.length }, null) }
}

describe('U11 疑似共用件', () => {
  it('没有 role、入度来自 ≥2 层（或 ≥3 兄弟）、没有运行时出边、不在场景路径上、名称像工具模块，四条全满足才建议，带四条依据', () => {
    const { report: r } = report()
    expect(r.sharedSuggestions.map(s => s.module)).toEqual(['core.util'])
    const s = r.sharedSuggestions[0]
    expect(s.fanIn.layers).toEqual(['ui', 'core'])
    expect(s.nameHit).toBe('util')
    expect(s.reasons).toHaveLength(4)
    expect(s.reasons[0]).toContain('2 个层')
  })

  it('名称不像（core.x 有运行时出边且不像）、已有 role、在场景路径上、只有类型依赖的不建议；ui.labels 只被一层用到也不建议', () => {
    const scenario = 'scenarios:\n  - { id: sc.a, name: A, steps: [{ call: { from: ui.view, to: core.util, label: x } }] }\n'
    expect(report({ 'scenarios/a.yaml': scenario }).report.sharedSuggestions).toEqual([])
    expect(report({ 'intent/roles.yaml': 'roles:\n  core.util: core\n' }).report.sharedSuggestions).toEqual([])
    const typeOnly = DEPS.map(d => (d.to === 'src/core/util.ts' ? { ...d, uses: undefined } : d))
    expect(report({}, typeOnly).report.sharedSuggestions).toEqual([])
  })
})

describe('U12 共用件反向依赖', () => {
  it('共用件子树对子树外、不是共用件的模块有值使用 → warning role.shared-reverse，进返工清单「共用件反向依赖」；用别的共用件、只引类型的不算', () => {
    const { index, own, report: r } = report({ 'intent/roles.yaml': 'roles:\n  ui.labels: shared\n  core.util: shared\n' })
    expect(r.sharedReverse.map(d => d.key)).toEqual(['ui.labels->ui.store'])
    const issue = r.issues.find(i => i.code === 'role.shared-reverse')!
    expect(issue.severity).toBe('warning')
    expect(issue.message).toContain('src/ui/labels.ts:7')
    expect(r.violations.some(v => v.from === 'ui.labels')).toBe(false)
    const list = reworkList({ index, issues: [], source: { own, tree: { files: SRC, packages: {} } }, report: r })
    const item = list.items.find(i => i.category === 'shared')!
    expect([item.id, item.severity, item.rules]).toEqual(['shared:ui.labels->ui.store', 'warning', ['U12']])
    expect(item.actions.map(a => a.kind)).toEqual(['fix-code', 'drop-role'])
    expect(list.byCategory.shared).toBe(1)
  })
})

describe('Q13 健康度的共用件提醒', () => {
  it('反向依赖条数；共用件子树行数占已归属行数超过阈值（缺省 20%，sourceLimits.sharedRatio 可改），或近窗口修改占比超过 30% 时标出；没有共用件时不给', () => {
    const { index, own, report: r } = report({ 'intent/roles.yaml': 'roles:\n  ui.labels: shared\n' })
    const lines = Object.fromEntries(SRC.map(f => [f, f === 'src/ui/labels.ts' ? 30 : 10]))
    const h = sharedHealth(index, own, r, lines, null)!
    expect(h).toMatchObject({ modules: 1, reverse: 2, changeRatio: null, limits: { lines: 0.2, changes: 0.3 }, over: true })
    expect(h.lineRatio).toBeCloseTo(30 / 90)
    const loose = report({ 'intent/roles.yaml': 'roles:\n  ui.labels: shared\n', 'limits.yaml': 'sourceLimits: { sharedRatio: 0.5 }\n' })
    const commit = (n: number, files: string[]) => ({ hash: `h${n}`, short: `h${n}`, date: '2026-10-01', subject: 's', fix: false, files: files.map(path => ({ path, added: 1, deleted: 0 })) })
    const history = { status: 'ok', commits: [commit(1, ['src/ui/labels.ts']), commit(2, ['src/ui/view.ts']), commit(3, ['src/core/api.ts'])] } as unknown as OkHistory
    const h2 = sharedHealth(loose.index, loose.own, loose.report, lines, history)!
    expect([h2.over, h2.limits.lines, h2.changeRatio]).toEqual([true, 0.5, 1 / 3])
    expect(sharedHealth(loose.index, loose.own, loose.report, lines, { ...history, commits: history.commits.slice(1) })!.over).toBe(false)
    expect(sharedHealth(...(Object.values(report()).slice(0, 3) as Parameters<typeof sharedHealth>))).toBeNull()
    expect(projectHealth(index, own, r, lines).shared).toMatchObject({ reverse: 2, over: true })
  })
})

describe('Z4 确认范围推广到任意层次的核心', () => {
  it('第三级以下的 role: core 也进确认范围，第二级照旧', () => {
    const { index } = report()
    expect(reviewScope(index)).toEqual(['ui.view', 'ui.store', 'ui.labels', 'core.api', 'core.api.deep', 'core.util', 'core.impl', 'core.x'])
  })
})
