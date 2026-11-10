/** 架构治理 · agent 查询（Q1、Q2、Q4）：定位与模块说明、写前判定、拦截记录统计 */
import { describe, expect, it } from 'vitest'
import {
  checkDependency,
  describeModule,
  locateFile,
  rulesFor,
  summarizeLedger,
  type LedgerEntry,
} from '@/model'
import { SRC, setup } from './helpers'

describe('Q1 定位与模块说明', () => {
  it('生效的规则：所在层、祖先链上的白名单与访问面', () => {
    const { index, entryOf } = setup()
    expect(rulesFor(index, 'ui.view', entryOf)).toEqual({
      layers: [{ layer: 'ui', mayDependOn: ['core'] }],
      deps: [{ module: 'ui.view', mayDependOn: ['ui.store'], reason: '视图只认状态' }],
      exposes: [],
    })
    expect(rulesFor(index, 'core.api', entryOf).exposes).toEqual([{ module: 'core.api', exposes: ['entry'], entry: 'src/core/api/index.ts' }])
  })

  it('文件定位给出归属、各级职责、接口、出入的违规', () => {
    const { index, own, report, entryOf } = setup()
    const at = locateFile(index, own, new Set(SRC), report, entryOf, 'src/core/api/client.ts')
    expect(at.status).toBe('owned')
    expect(at.module!.path.map(p => p.id)).toEqual(['core', 'core.api'])
    expect(at.module!.interfaces).toEqual([{ id: 'if.get', name: 'get', signature: 'get(id: string): Item' }])
    expect(at.module!.violations.in.map(v => v.kind)).toEqual(['exposes'])
    expect(locateFile(index, own, new Set(SRC), report, entryOf, 'src/tests/x.ts').status).toBe('unowned')
    expect(locateFile(index, own, new Set(SRC), report, entryOf, 'nope.ts').status).toBe('missing')
    const d = describeModule(index, own, report, entryOf, 'ui')!
    expect(d.cycles).toEqual([['core.util', 'ui.store', 'ui.view']])
  })
})

describe('Q2 写前判定', () => {
  it('denied：给出违反的规则与理由', () => {
    const { index, own, report, entryOf } = setup()
    const r = checkDependency(index, own, report, entryOf, 'src/core/impl/i.ts', [{ to: 'src/ui/store/s.ts', via: 'src/ui/store/s.ts' }])
    expect(r.verdict).toBe('denied')
    expect(r.checks[0].hits.map(h => h.kind)).toEqual(['layer'])
    expect(r.targets.map(t => t.id)).toEqual(['ui.store'])
  })

  it('allowed：有规则约束且通过，并给出覆盖它的关系', () => {
    const { index, own, report, entryOf } = setup()
    const r = checkDependency(index, own, report, entryOf, 'ui.view', [{ to: 'ui.store' }])
    expect(r.verdict).toBe('allowed')
    expect(r.checks[0].describedBy).toEqual(['rel.1'])
  })

  it('unconstrained：没有规则约束；同一模块内不受约束', () => {
    const { index, own, report, entryOf } = setup()
    expect(checkDependency(index, own, report, entryOf, 'ui.store', [{ to: 'ui.view' }]).verdict).toBe('unconstrained')
    const inner = checkDependency(index, own, report, entryOf, 'src/core/api/index.ts', [{ to: 'src/core/api/client.ts' }])
    expect(inner.verdict).toBe('unconstrained')
    expect(inner.notes[0]).toContain('同一模块内')
  })

  it('访问面：绕过入口 denied，经入口 allowed', () => {
    const { index, own, report, entryOf } = setup()
    const deep = checkDependency(index, own, report, entryOf, 'src/ui/store/s.ts', [{ to: 'src/core/api/client.ts', via: 'src/core/api/client.ts' }])
    expect(deep.checks[0].hits.map(h => h.kind)).toEqual(['exposes'])
    const viaEntry = checkDependency(index, own, report, entryOf, 'src/ui/store/s.ts', [{ to: 'src/core/api/client.ts', via: 'src/core/api/index.ts' }])
    expect(viaEntry.verdict).toBe('allowed')
  })

  it('环影响：加入后形成或扩大模块环', () => {
    const { index, own, report, entryOf } = setup(`rules: { layers: false }`)
    const r = checkDependency(index, own, report, entryOf, 'core.api', [{ to: 'ui.view' }])
    expect(r.checks[0].cycle).toEqual({ before: 0, after: 4, createsOrGrows: true })
    const same = checkDependency(index, own, report, entryOf, 'core.util', [{ to: 'ui.store' }])
    expect(same.checks[0].cycle.createsOrGrows).toBe(false)
  })

  it('依赖方未归属时说明无法判定', () => {
    const { index, own, report, entryOf } = setup()
    const r = checkDependency(index, own, report, entryOf, 'src/tests/x.ts', [{ to: 'ui.view' }])
    expect(r.checks).toEqual([])
    expect(r.notes[0]).toContain('无法判定')
  })
})

describe('Q4 拦截记录的统计', () => {
  it('按判定统计，扫描给出首末值', () => {
    const c = { modules: 9, files: 9 }
    const entries: LedgerEntry[] = [
      { at: '1', tool: 'check_dependency', client: 'mcp', from: 'a', to: 'b', verdict: 'denied', rules: ['layer', 'deps'], cycle: true },
      { at: '2', tool: 'check_dependency', client: 'cli', from: 'a', to: 'c', verdict: 'allowed', rules: [], cycle: false },
      { at: '3', tool: 'rescan', client: 'mcp', violations: 5, newViolations: 1, cyclicity: c },
      { at: '4', tool: 'rescan', client: 'mcp', violations: 3, newViolations: 0, cyclicity: { modules: 4, files: 9 } },
    ]
    const s = summarizeLedger(entries)
    expect(s.checks).toBe(2)
    expect(s.byVerdict).toEqual({ allowed: 1, denied: 1, unconstrained: 0 })
    expect(s.deniedByRule).toEqual({ layer: 1, deps: 1, exposes: 0 })
    expect(s.cycleFlags).toBe(1)
    expect(s.rescans).toBe(2)
    expect(s.first!.violations).toBe(5)
    expect(s.last!.cyclicity.modules).toBe(4)
  })
})
