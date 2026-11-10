/**
 * 第六轮（ADR-0029、ADR-0030）的场景与核验规则：S12 / S13 / S19 按四类绑定与推断，U13 查询有副作用（按场景闭包），
 * R17 场景按类别筛选的数据面，X4 的类型口径（未分类与查询 / 委托对应）与草图声明的实现者（sketch.missing-implementer）。
 */
import { describe, expect, it } from 'vitest'
import { bindRelation, filterScenariosByKind, loadModel, planScenario, querySideEffects, reworkList, sketchCheck, syncMismatch, typesCorrespond, type Issue } from '@/model'
import { sampleFiles } from '../fixtures/sample'

const real = (issues: Issue[]) => issues.filter(i => i.severity !== 'info')
const codes = (issues: Issue[]) => real(issues).map(i => i.code)

describe('S12、S13、S19：步骤按四类交互绑定', () => {
  const rel = (type: string, extra = '') => `relations:\n  - { id: rx, from: infra.player, to: infra.mus, type: ${type}${extra} }\n`
  const step = (kind: string) => `scenario: { id: sc.x, name: X, steps: [{ ${kind}: { from: infra.player, to: infra.mus } }] }`
  const check = (type: string, extra: string, kind: string) => codes(loadModel(sampleFiles({ 'x.yaml': rel(type, extra), 'scenarios/x.yaml': step(kind) })).issues)

  it('S12：四类与未分类都能被步骤引用与推断（消息与箭头同向）', () => {
    for (const t of ['queries', 'commands', 'notifies', 'streams', 'calls']) {
      const { index } = loadModel(sampleFiles({ 'x.yaml': rel(t) }))
      expect(bindRelation(index, { kind: t === 'notifies' ? 'async' : 'call', from: 'infra.player', to: 'infra.mus' })).toMatchObject({ relation: 'rx', inferred: true })
    }
  })

  it('S19：查询为 call（可配 return；mode: async 的查询为 async，T0 裁决 1）；委托与未分类按 mode；通知一律 async；流不比', () => {
    expect(check('queries', '', 'call')).toEqual([])
    expect(check('queries', '', 'async')).toEqual(['step.sync-mismatch'])
    expect(check('queries', ', mode: async', 'async')).toEqual([])
    expect(check('commands', '', 'call')).toEqual([])
    expect(check('commands', ', mode: async', 'call')).toEqual(['step.sync-mismatch'])
    expect(check('commands', ', mode: async', 'async')).toEqual([])
    expect(check('calls', ', mode: async', 'call')).toEqual(['step.sync-mismatch'])
    expect(check('notifies', '', 'async')).toEqual([])
    expect(check('notifies', '', 'call')).toEqual(['step.sync-mismatch'])
    expect(check('streams', '', 'call')).toEqual([])
    expect(check('streams', '', 'async')).toEqual([])
    const { index } = loadModel(sampleFiles({ 'x.yaml': rel('notifies') }))
    expect(syncMismatch(index.relations.get('rx')!, 'return')).toBe(false)
    const msg = real(loadModel(sampleFiles({ 'x.yaml': rel('notifies'), 'scenarios/x.yaml': step('call') })).issues)[0].message
    expect(msg).toContain('一律异步')
  })

  it('S13：候选多条时，消息形态与关系类型一致的恰好一条即认定（不再限于全是 calls）；return 不比', () => {
    const two = 'relations:\n  - { id: rq, from: infra.player, to: infra.mus, type: queries }\n  - { id: rn, from: infra.player, to: infra.mus, type: notifies }\n'
    const { index } = loadModel(sampleFiles({ 'x.yaml': two }))
    expect(bindRelation(index, { kind: 'call', from: 'infra.player', to: 'infra.mus' })).toMatchObject({ relation: 'rq', inferred: true })
    expect(bindRelation(index, { kind: 'async', from: 'infra.player', to: 'infra.mus' })).toMatchObject({ relation: 'rn', inferred: true })
    expect(bindRelation(index, { kind: 'return', from: 'infra.mus', to: 'infra.player' }).relation).toBeUndefined()
    // 形态一致的有两条（查询与流都对得上 call）：不推断
    const ambiguous = loadModel(sampleFiles({ 'x.yaml': 'relations:\n  - { id: rq, from: infra.player, to: infra.mus, type: queries }\n  - { id: rs, from: infra.player, to: infra.mus, type: streams }\n' })).index
    expect(bindRelation(ambiguous, { kind: 'call', from: 'infra.player', to: 'infra.mus' }).relation).toBeUndefined()
  })
})

describe('U13 查询有副作用（按场景闭包，T0 裁决 14）', () => {
  const RELS = [
    'relations:',
    '  - { id: q1, from: infra.player, to: app.solution, type: queries }',
    '  - { id: c1, from: app.solution, to: domain.services, type: commands }',
    '  - { id: n1, from: domain.services, to: domain.models, type: notifies }',
    '  - { id: q2, from: app.fragments, to: domain.services, type: queries }',
  ].join('\n')
  const run = (steps: string) => {
    const r = loadModel(sampleFiles({ 'u.yaml': RELS, 'scenarios/u.yaml': `scenario:\n  id: sc.u\n  name: U\n  steps:\n${steps}` }))
    return { ...r, effects: querySideEffects(r.index, planScenario(r.index, 'sc.u')) }
  }

  it('查询帧之后、发送方落在接收集合（从 B 的子树开始、逐帧扩大）中的连续帧里有委托 / 通知 → warning query.side-effect，一对一条', () => {
    const { effects, issues, index } = run(
      [
        '    - call: { from: infra.player, to: app.solution, relation: q1 }',
        '    - call: { from: app.solution, to: domain.services, relation: c1 }',
        '    - async: { from: domain.services, to: domain.models, relation: n1 }',
      ].join('\n') + '\n',
    )
    expect(effects.map(e => [e.query, e.effect])).toEqual([
      ['q1', 'c1'],
      ['q1', 'n1'],
    ])
    const issue = real(issues).filter(i => i.code === 'query.side-effect')
    expect(issue.map(i => i.severity)).toEqual(['warning', 'warning'])
    expect(issue[0]).toMatchObject({ file: 'scenarios/u.yaml' })
    const items = reworkList({ index, issues }).items.filter(i => i.category === 'query-side-effect')
    expect(items.map(i => i.id)).toEqual(['query-side-effect:q1->c1', 'query-side-effect:q1->n1'])
    expect(items[0]).toMatchObject({ severity: 'warning', rules: ['U13'], actions: [{ kind: 'to-command' }] })
    expect(items[0].affected).toHaveLength(2)
  })

  it('闭包到配对的 return 为止；没有显式返回时到第一条发送方不在集合中的帧为止', () => {
    const paired = run(
      [
        '    - call: { from: infra.player, to: app.solution, relation: q1 }',
        '    - return: { from: app.solution, to: infra.player }',
        '    - call: { from: app.solution, to: domain.services, relation: c1 }',
      ].join('\n') + '\n',
    )
    expect(paired.effects).toEqual([])
    const broken = run(
      [
        '    - call: { from: infra.player, to: app.solution, relation: q1 }',
        '    - call: { from: app.fragments, to: domain.services, relation: q2 }',
        '    - call: { from: app.solution, to: domain.services, relation: c1 }',
      ].join('\n') + '\n',
    )
    expect(broken.effects).toEqual([])
  })

  it('alt 各分支分别算：只在一个分支里有副作用也报', () => {
    const { effects } = run(
      [
        '    - call: { from: infra.player, to: app.solution, relation: q1 }',
        '    - alt:',
        '        - when: 命中缓存',
        '          steps: []',
        '        - when: 未命中',
        '          steps:',
        '            - call: { from: app.solution, to: domain.services, relation: c1 }',
      ].join('\n') + '\n',
    )
    expect(effects.map(e => e.effect)).toEqual(['c1'])
  })
})

describe('R17 场景按类别筛选（数据面）', () => {
  it('main 只留主流程（kind 缺省为 main），all 全部，保持顺序', () => {
    const list = [{ id: 'a' }, { id: 'b', kind: 'exception' as const }, { id: 'c', kind: 'main' as const }, { id: 'd', kind: 'maintenance' as const }]
    expect(filterScenariosByKind(list, 'main').map(s => s.id)).toEqual(['a', 'c'])
    expect(filterScenariosByKind(list, 'all').map(s => s.id)).toEqual(['a', 'b', 'c', 'd'])
  })
})

describe('X4 的口径（ADR-0029：X23、X24）', () => {
  const SKETCH = (rels: string, ifs = '') =>
    `sketch:\n  id: d\n  mount: infra\n  modules:\n    - { id: infra.player, name: Player }\n    - { id: infra.mus, name: MUs }\n  relations:\n${rels}${ifs}`

  it('关系按两端 + 类型对应：版本里的未分类与草图的 queries / commands 视为对应，其余类型不对应', () => {
    expect(typesCorrespond('calls', 'queries')).toBe(true)
    expect(typesCorrespond('commands', 'calls')).toBe(true)
    expect(typesCorrespond('queries', 'commands')).toBe(false)
    expect(typesCorrespond('calls', 'notifies')).toBe(false)
    // 版本里 infra.player → infra.mus 是一条 calls（未分类）
    const { index } = loadModel(sampleFiles({ 'u.yaml': 'relations:\n  - { id: u1, from: infra.player, to: infra.mus, type: calls }\n' }))
    const sk = (type: string) => loadModel([{ path: 'designs/d/sketches/infra.yaml', text: SKETCH(`    - { id: s1, from: infra.player, to: infra.mus, type: ${type} }\n`) }]).index.model.sketches[0]
    const missing = (type: string) => sketchCheck(sk(type), index).deviations.filter(d => d.code === 'sketch.missing-relation').length
    expect(missing('commands')).toBe(0)
    expect(missing('queries')).toBe(0)
    expect(missing('notifies')).toBe(1)
  })

  it('X24：草图声明的实现者既不在版本里该接口的 implementedBy、也不在代码事实的实现者中 → warning sketch.missing-implementer', () => {
    const { index } = loadModel(sampleFiles())
    const ifs = "  interfaces:\n    - { id: if.model, name: Model, implementedBy: [infra.mus, infra.player] }\n"
    const sketch = loadModel([{ path: 'designs/d/sketches/infra.yaml', text: SKETCH('    - { id: s1, from: infra.player, to: infra.mus, type: queries }\n', ifs) }]).index.model.sketches[0]
    const devs = sketchCheck(sketch, index).deviations.filter(d => d.code === 'sketch.missing-implementer')
    expect(devs.map(d => [d.key, d.severity])).toEqual([['missing-implementer:if.model#infra.player', 'warning']])
    // 代码事实里有它（K5c）也算对应
    const coded = new Map([['if.model', { implementers: [{ module: 'infra.player', code: true }] }]])
    expect(sketchCheck(sketch, index, { implementers: coded }).deviations.filter(d => d.code === 'sketch.missing-implementer')).toEqual([])
  })
})
