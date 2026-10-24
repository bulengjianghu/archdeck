/**
 * 决策链接（E9，DV-13）：模块的 adrs（整数）对到 docs/adr/<四位编号>-*.md；标题取文件第一行；不继承；找不到文件报 module.adr-missing（源码归属阶段）。
 */
import { describe, expect, it } from 'vitest'
import { adrDir, adrFile, adrIssues, adrLabel, ancestorAdrs, assignFiles, load, loadModel, moduleAdrs, sourceIssues } from '../../src/model'

const SYSTEM = { path: 'system.yaml', text: 'system: { id: sys, name: S }' }
const MODULES = {
  path: 'modules.yaml',
  text: `modules:
  - id: core
    name: Core
    kind: layer
    adrs: [3]
    children:
      - id: core.a
        name: A
        adrs: [25, 27, 99]
        children:
          - { id: core.a.x, name: X }
`,
}
const FILES = ['docs/adr/0003-x.md', 'docs/adr/0025-sketch-as-thinking-medium.md', 'docs/adr/0027-module-roles.md', 'docs/adr/README.md', 'docs/adr/old/0099-x.md']
const TITLES = { 'docs/adr/0025-sketch-as-thinking-medium.md': '草图是思考的介质', 'docs/adr/0027-module-roles.md': '模块分级' }

describe('E9 决策链接', () => {
  const index = loadModel([SYSTEM, MODULES]).index

  it('adrs 是整数列表，随模块加载；schema 拒绝字符串与 0', () => {
    expect(index.modules.get("core.a")!.adrs).toEqual([25, 27, 99])
    const bad = load([SYSTEM, { path: 'm.yaml', text: "modules:\n  - { id: m, name: M, adrs: ['0025'] }\n" }])
    expect(bad.issues.some(i => i.code === 'schema')).toBe(true)
    const dup = load([SYSTEM, { path: 'm.yaml', text: 'modules:\n  - { id: m, name: M, adrs: [25, 25] }\n' }])
    expect(dup.issues.some(i => i.code === 'schema')).toBe(true)
    const zero = load([SYSTEM, { path: 'm.yaml', text: 'modules:\n  - { id: m, name: M, adrs: [0] }\n' }])
    expect(zero.issues.some(i => i.code === 'schema')).toBe(true)
  })

  it('编号对到 <adrDir>/<四位编号>-*.md（不进子目录）；显示为 ADR-0025；目录缺省 docs/adr、可由 system.source.adrDir 改', () => {
    expect(adrLabel(25)).toBe('ADR-0025')
    expect(adrFile(FILES, 'docs/adr', 25)).toBe('docs/adr/0025-sketch-as-thinking-medium.md')
    expect(adrFile(FILES, 'docs/adr', 99)).toBeNull()
    expect(adrDir(index.model.system)).toBe('docs/adr')
    expect(adrDir({ source: { adrDir: './decisions/' } })).toBe('decisions')
  })

  it('模块自己写的按顺序列出（编号、文件、标题）；不继承：祖先的另计', () => {
    expect(moduleAdrs(index, 'core.a', FILES, TITLES)).toEqual([
      { n: 25, label: 'ADR-0025', file: 'docs/adr/0025-sketch-as-thinking-medium.md', title: '草图是思考的介质' },
      { n: 27, label: 'ADR-0027', file: 'docs/adr/0027-module-roles.md', title: '模块分级' },
      { n: 99, label: 'ADR-0099', file: null },
    ])
    expect(moduleAdrs(index, 'core.a.x', FILES, TITLES)).toEqual([])
    expect(ancestorAdrs(index, 'core.a.x')).toEqual([
      { id: 'core', n: 3 },
      { id: 'core.a', n: 25 },
      { id: 'core.a', n: 27 },
      { id: 'core.a', n: 99 },
    ])
    expect(ancestorAdrs(index, 'core')).toEqual([])
  })

  it('找不到文件的报提醒 module.adr-missing（警告），与归属警告一起出现在 sourceIssues', () => {
    const issues = adrIssues(index, FILES)
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ severity: 'warning', code: 'module.adr-missing', file: 'modules.yaml' })
    expect(issues[0].message).toContain('ADR-0099')
    const own = assignFiles(index, FILES, ['docs/**'])
    expect(sourceIssues(index, own, { files: FILES, packages: {} }).filter(i => i.code === 'module.adr-missing')).toHaveLength(1)
  })
})
