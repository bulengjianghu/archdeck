/**
 * ADR-0026「依赖是事实，关系是交互」的规则：M14 总线不作通知的端点、M15 depends 迁移期丢弃并提醒、
 * S19 同步性一致、K5 异步 calls 的证据口径、K6 只剩 implements 一档、K7 未解释的交互只作 info（Q12）、
 * U2 / U3 只看导入图（关系不产生违规）。
 */
import { describe, expect, it } from 'vitest'
import { bindRelation, confirmRelations, governanceReport, liftDeps, load, loadModel, unconfirmedWarns } from '@/model'
import { sampleFiles } from '../fixtures/sample'
import { CODE, DEPS, LAYERS, SRC, dep, files, setup } from './governance/helpers'
import { assignFiles } from '@/model'

/** 只看错误与提醒：未分类（M17）是 info */
const real = <T extends { severity: string }>(issues: T[]) => issues.filter(i => i.severity !== 'info')
const codes = (issues: { code: string; severity: string }[]) => real(issues).map(i => i.code)

describe('M15 depends 已不是关系类型', () => {
  it('读取时丢弃 type: depends 的关系并提醒（带文件与行号），其余照常加载；草图里的同样处理', () => {
    const { model, issues } = load(
      sampleFiles({
        'old.yaml': 'relations:\n  - { id: d1, from: infra.player, to: app.solution, type: depends }\n  - { id: c1, from: infra.player, to: app.fragments, type: calls }\n',
      }),
    )
    const removed = issues.filter(i => i.code === 'relation.depends-removed')
    expect(removed.map(i => [i.severity, i.file, i.line])).toEqual([['warning', 'old.yaml', 2]])
    expect(removed[0].message).toContain('代码事实')
    expect(model.relations.some(r => r.id === 'd1')).toBe(false)
    expect(model.relations.some(r => r.id === 'c1')).toBe(true)
    expect(issues.some(i => i.code === 'schema')).toBe(false)
  })

  it('草图里的 depends 同样丢弃并提醒，草图其余内容照常进模型', () => {
    const sketch = [
      'sketch:',
      '  id: s',
      '  mount: infra',
      '  modules: [{ id: infra.x, name: X }]',
      '  relations:',
      '    - { id: sd, from: infra.x, to: infra.player, type: depends }',
      '    - { id: sc, from: infra.x, to: infra.player, type: calls }',
    ].join('\n')
    const { model, issues } = load(sampleFiles({ 'intent/infra.yaml': sketch }))
    expect(issues.filter(i => i.code === 'relation.depends-removed').map(i => [i.file, i.line])).toEqual([['intent/infra.yaml', 6]])
    expect(model.relations.map(r => r.id)).toContain('sc')
    expect(model.relations.map(r => r.id)).not.toContain('sd')
  })
})

describe('M14 总线不作通知的端点', () => {
  const BUS = 'modules: [{ id: infra.bus, name: Bus, parent: infra, role: bus, responsibility: 事件总线 }]\n'

  it('notifies 的发布者或订阅者是 role: bus 的模块 → error relation.bus-endpoint，剔除该关系', () => {
    const r = loadModel(
      sampleFiles({
        'bus.yaml': `${BUS}relations:\n  - { id: n1, from: infra.player, to: infra.bus, type: notifies }\n  - { id: n2, from: infra.bus, to: app.solution, type: notifies }\n`,
      }),
    )
    const bad = r.issues.filter(i => i.code === 'relation.bus-endpoint')
    expect(bad.map(i => i.severity)).toEqual(['error', 'error'])
    expect(bad[0].message).toContain('订阅者')
    expect(bad[1].message).toContain('发布者')
    expect(r.index.relations.has('n1')).toBe(false)
    expect(r.index.relations.has('n2')).toBe(false)
  })

  it("两端写真正的发布者与订阅者、via: 'bus:<总线>' 留痕不报；对总线的委托不受限；旧写法 via: bus 在恰有一个总线时读作它（M20）", () => {
    const r = loadModel(
      sampleFiles({
        'bus.yaml': `${BUS}relations:\n  - { id: n3, from: infra.player, to: app.solution, type: notifies, via: 'bus:infra.bus' }\n  - { id: c3, from: infra.player, to: infra.bus, type: commands }\n  - { id: n4, from: infra.player, to: app.fragments, type: notifies, via: bus }\n`,
      }),
    )
    expect(codes(r.issues)).toEqual(['relation.via-legacy'])
    expect(r.index.relations.get('n3')!.via).toBe('bus:infra.bus')
    expect(r.index.relations.get('n4')!.via).toBe('bus:infra.bus')
  })
})

describe('S19 场景消息与 calls 的同步性一致', () => {
  const rel = (mode: string) => `relations:\n  - { id: cx, from: infra.player, to: infra.mus, type: calls${mode} }\n`
  const step = (kind: string) => `scenario: { id: sc.x, name: X, steps: [{ ${kind}: { from: infra.player, to: infra.mus } }] }`

  it('async 消息对应同步的 calls、call 消息对应异步的 calls → warning step.sync-mismatch，不改绑定', () => {
    const a = loadModel(sampleFiles({ 'x.yaml': rel(''), 'scenarios/x.yaml': step('async') }))
    expect(real(a.issues).map(i => [i.code, i.severity])).toEqual([['step.sync-mismatch', 'warning']])
    const steps = a.index.scenarios.get('sc.x')!.steps
    expect(bindRelation(a.index, { kind: 'async', ...(steps[0] as { msg: { from: string; to: string } }).msg }).relation).toBe('cx')
    const b = loadModel(sampleFiles({ 'x.yaml': rel(', mode: async'), 'scenarios/x.yaml': step('call') }))
    expect(codes(b.issues)).toEqual(['step.sync-mismatch'])
  })

  it('一致时不提醒；notifies / streams 与 return 不比同步性', () => {
    expect(codes(loadModel(sampleFiles({ 'x.yaml': rel(', mode: async'), 'scenarios/x.yaml': step('async') })).issues)).toEqual([])
    expect(codes(loadModel(sampleFiles({ 'x.yaml': rel(''), 'scenarios/x.yaml': step('call') })).issues)).toEqual([])
    const n = 'relations:\n  - { id: nx, from: infra.player, to: infra.mus, type: notifies }\n'
    expect(codes(loadModel(sampleFiles({ 'x.yaml': n, 'scenarios/x.yaml': step('async') })).issues)).toEqual([])
  })

  it('S13 推断：两端之间同向的 calls 有多条时，同步性与消息一致的恰好一条即认定', () => {
    const two = 'relations:\n  - { id: cs, from: infra.player, to: infra.mus, type: calls }\n  - { id: ca, from: infra.player, to: infra.mus, type: calls, mode: async }\n'
    const { index } = loadModel(sampleFiles({ 'x.yaml': two }))
    expect(bindRelation(index, { kind: 'call', from: 'infra.player', to: 'infra.mus' })).toMatchObject({ relation: 'cs', inferred: true })
    expect(bindRelation(index, { kind: 'async', from: 'infra.player', to: 'infra.mus' })).toMatchObject({ relation: 'ca', inferred: true })
    // return 不比同步性：仍有两条候选，不推断
    expect(bindRelation(index, { kind: 'return', from: 'infra.mus', to: 'infra.player' }).relation).toBeUndefined()
  })
})

describe('K5、K6：异步 calls 与运行时关系的未证实', () => {
  const withRelations = (extra: string) => {
    const { index } = loadModel([files()[0], { path: 'modules/layers.yaml', text: LAYERS.replace('relations:\n', `relations:\n${extra}`) }])
    return { index, own: assignFiles(index, SRC, []) }
  }

  it('K5：异步的 calls 与同步同一口径——发起方 → 接收方的模块依赖即证实；写了 via 的不判定', () => {
    const { index, own } = withRelations('  - { id: rel.a, from: ui.view, to: ui.store, type: calls, mode: async }\n  - { id: rel.cb, from: core.impl, to: ui.store, type: calls, mode: async, via: callback }\n')
    const c = confirmRelations(index, liftDeps(index, own, DEPS).moduleDeps)
    expect(c.get('rel.a')!.status).toBe('confirmed')
    expect(c.get('rel.cb')).toMatchObject({ status: 'skipped', via: 'channel:callback' })
  })

  it('K6（ADR-0029）：交互关系只有反向依赖时不报警告，两端之间没有任何依赖时报；编译期一档移到端口实现者（接口的 implementedBy）', () => {
    const { index, own } = withRelations('  - { id: rel.r, from: ui.store, to: ui.view, type: commands, mode: async }\n')
    const c = confirmRelations(index, liftDeps(index, own, DEPS).moduleDeps)
    const r = index.relations.get('rel.r')!
    expect(c.get('rel.r')).toMatchObject({ status: 'unconfirmed' })
    expect(unconfirmedWarns(r, c.get('rel.r')!)).toBe(false)
    expect(unconfirmedWarns(r, { status: 'unconfirmed', deps: [], isolated: true })).toBe(true)
  })
})

describe('Q12、K7：描述求准——未解释的交互只作 info，不进 lint 问题', () => {
  it('有值使用却没有交互覆盖的模块依赖列为未解释的交互，但不产生 warning / error', () => {
    const { report } = setup()
    expect(report.undescribed.length).toBeGreaterThan(0)
    expect(report.issues.some(i => i.code.startsWith('fact.undescribed'))).toBe(false)
  })
})

describe('U2、U3：mayDependOn 只看导入图（ADR-0026）', () => {
  it('违反层规则或白名单的关系不产生违规；违规只由模块依赖（代码事实）给出', () => {
    const before = setup().report.violations.map(v => `${v.kind}:${v.from}->${v.to}`)
    const extra = '  - { id: rel.x1, from: core.impl, to: ui.panel, type: calls }\n  - { id: rel.x2, from: ui.view, to: core.impl, type: calls }\n'
    const { index } = loadModel([files()[0], { path: 'modules/layers.yaml', text: LAYERS.replace('relations:\n', `relations:\n${extra}`) }, files()[2]])
    const own = assignFiles(index, SRC, [])
    const after = governanceReport(index, own, { files: SRC, packages: {} }, CODE, null).violations.map(v => `${v.kind}:${v.from}->${v.to}`)
    expect(after).toEqual(before)
    // 同一对模块有了导入才违规
    const withImport = governanceReport(index, own, { files: SRC, packages: {} }, { ...CODE, deps: [...DEPS, dep('src/ui/view/a.ts', 'src/core/impl/i.ts', undefined, 9)] }, null)
    expect(withImport.violations.some(v => v.from === 'ui.view' && v.to === 'core.impl')).toBe(true)
  })
})
