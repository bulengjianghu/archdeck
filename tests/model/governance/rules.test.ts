/** 架构治理 · 规则（U1–U9）：加载与校验、判定与违规、基线与门禁 */
import { describe, expect, it } from 'vitest'
import {
  gateIssues,
  governanceReport,
  loadModel,
  makeBaseline,
  type Baseline,
} from '@/model'
import { RULES, files, dep, CODE, setup } from './helpers'

describe('U1 规则的加载与校验', () => {
  it('引用不存在的模块提醒并去掉；allow 缺 reason 报错；重复声明用第一处', () => {
    const { index, issues } = loadModel([
      ...files(`
rules:
  modules:
    - { module: nope, mayDependOn: [core] }
    - { module: ui.view, mayDependOn: [ui.store, ghost] }
  allow:
    - { from: ui, to: core, reason: '' }
  cycles: { tolerated: [ghost] }
`),
      { path: 'zz-more.yaml', text: 'rules: { layers: false }' },
    ])
    expect(issues.filter(i => i.code === 'unknown-rule-module')).toHaveLength(3)
    expect(issues.some(i => i.code === 'allow-without-reason' && i.severity === 'error')).toBe(true)
    expect(issues.some(i => i.code === 'duplicate-rules')).toBe(true)
    expect(index.model.rules!.modules).toEqual([{ module: 'ui.view', mayDependOn: ['ui.store'] }])
    expect(index.model.rules!.allow).toEqual([])
    expect(index.model.rules!.layers).toBeUndefined()
  })
})

describe('U2–U6 规则判定与违规', () => {
  it('层规则、白名单、访问面、例外；按种类、规则所在与两端合并', () => {
    const { report } = setup()
    const v = Object.fromEntries(report.violations.map(x => [x.key, x]))
    expect(Object.keys(v).sort()).toEqual([
      'deps:ui.view:ui.view->core.util',
      'exposes:core.api:ui.store->core.api',
      'layer:core:core.impl->ui.view',
      'layer:core:core.util->ui.view',
    ])
    expect(v['exposes:core.api:ui.store->core.api'].files.map(f => f.line)).toEqual([2])
    expect(v['layer:core:core.util->ui.view'].status).toBe('allowed')
    expect(v['layer:core:core.util->ui.view'].allowReason).toBe('测试例外')
    expect(v['layer:core:core.impl->ui.view'].reason).toContain('「Core」不可依赖「UI」')
  })

  it('U2：没写 mayDependOn 的层不限制；rules.layers: false 关闭层规则', () => {
    const off = setup(`rules: { layers: false }`)
    expect(off.report.violations.filter(v => v.kind === 'layer')).toEqual([])
  })

  it('U4：经由文件在模块子树外（别处的入口再导出）不算访问', () => {
    const { index, own, tree } = setup()
    const r = governanceReport(index, own, tree, { ...CODE, deps: [dep('src/ui/store/s.ts', 'src/core/api/client.ts', 'src/core/util/u.ts')] }, null)
    expect(r.violations.filter(v => v.kind === 'exposes')).toEqual([])
  })
})

describe('U7–U9 基线与门禁', () => {
  it('没有基线：违规全部为 rule.violation 提醒，已豁免的不报', () => {
    const { report } = setup()
    const codes = report.issues.filter(i => i.code.startsWith('rule.')).map(i => `${i.code}:${i.severity}`)
    expect(codes).toEqual(Array(3).fill('rule.violation:warning'))
    expect(gateIssues(report)).toEqual([])
  })

  it('有基线：基线外为 rule.new 错误，基线内为 rule.known；已消除的计数', () => {
    const baseline: Baseline = { createdAt: 't', violations: ['deps:ui.view:ui.view->core.util', 'deps:x:gone->gone'], cyclicity: { modules: 9, files: 9 } }
    const { report } = setup(RULES, baseline)
    expect(report.gate).toEqual({ newViolations: 2, knownViolations: 1, resolved: 1, cycleGrew: false })
    expect(gateIssues(report).map(i => i.code)).toEqual(['rule.new', 'rule.new'])
    expect(report.issues.find(i => i.code === 'rule.known')!.severity).toBe('warning')
  })

  it('环度高于基线为 cycle.grew 错误', () => {
    const { report } = setup(RULES, { createdAt: 't', violations: [], cyclicity: { modules: 4, files: 9 } })
    expect(report.gate.cycleGrew).toBe(true)
    expect(gateIssues(report).some(i => i.code === 'cycle.grew' && i.severity === 'error')).toBe(true)
  })

  it('makeBaseline 记录未豁免的违规键与环度', () => {
    const { report } = setup()
    const b = makeBaseline(report, '2026-10-21', 'abc')
    expect(b.violations).toEqual(['deps:ui.view:ui.view->core.util', 'exposes:core.api:ui.store->core.api', 'layer:core:core.impl->ui.view'])
    expect(b.cyclicity).toEqual(report.cyclicity)
    expect(b.commit).toBe('abc')
  })
})
