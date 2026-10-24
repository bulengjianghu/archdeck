/** 架构治理 · 端口（ADR-0029）：端口面板（K11，原端口三角）· 端口孤立（U14）· 旧端口三角的迁移期兼容 */
import { describe, expect, it } from 'vitest'
import { loadModel, portEntry, portIssues, portPanel, portTriad, reworkList } from '@/model'
import { LAYERS, files, setup } from './helpers'

const load = (extra: string, implementedBy = '[ui.store]', more = '') => {
  const text = LAYERS.replace("signature: 'get(id: string): Item' }", `signature: 'get(id: string): Item', implementedBy: ${implementedBy} }${more}`).replace(
    'relations:\n',
    `relations:\n${extra}\n`,
  )
  return loadModel([files()[0], { path: 'modules/layers.yaml', text }]).index
}

describe('K11 端口面板（定义 · 实现者 · 使用者）', () => {
  const extra = [
    "  - { id: rel.s, from: ui.view, to: core.api, type: streams, via: 'port:if.get' }",
    '  - { id: rel.d, from: ui.view, to: core.api, type: queries, interface: if.get }',
    '  - { id: rel.n, from: core.api, to: ui.view, type: notifies, interface: if.get }',
    '  - { id: rel.u, from: ui.view, to: core, type: commands }',
  ].join('\n')
  const index = load(extra)

  it('实现者为描述的 implementedBy；使用者为经端口（via: port:<P>）与直接（interface 为 P、to 在定义模块子树内）的交互关系的发起方，没写接口的不算', () => {
    const p = portEntry(index, null, 'if.get')!
    expect(p).toMatchObject({ port: 'if.get', owner: 'core.api', isPort: true })
    expect(p.implementers).toEqual([{ module: 'ui.store', described: true, code: false }])
    expect(p.users.map(u => [u.relation, u.module, u.type, u.how])).toEqual([
      ['rel.s', 'ui.view', 'streams', 'port'],
      ['rel.d', 'ui.view', 'queries', 'direct'],
    ])
  })

  it('模块的端口一节：它声明的每个接口（G12 口径，祖先按子树）各一份；没有声明接口为空', () => {
    expect(portPanel(index, null, 'core').map(p => p.port)).toEqual(['if.get'])
    expect(portPanel(index, null, 'core.impl')).toEqual([])
  })

  it('有代码事实时实现者带证据档（含「仅代码事实」的）、使用者带证实状态', () => {
    const { index: idx, report } = setup()
    // 样例的 if.get 没有实现者也没有经端口的使用者：不算端口
    expect(portEntry(idx, report, 'if.get')).toMatchObject({ isPort: false, implementers: [], users: [] })
    const fake = { relations: new Map([['rel.d', { status: 'confirmed' as const, deps: [] }]]), implementers: new Map([['if.get', { port: 'if.get', owner: 'core.api', implementers: [{ module: 'ui.view', described: false, code: true, status: 'confirmed' as const, deps: [] }] }]]) }
    const p = portEntry(index, fake, 'if.get')!
    expect(p.implementers).toEqual([{ module: 'ui.view', described: false, code: true, status: 'confirmed' }])
    expect(p.users.find(u => u.relation === 'rel.d')!.status).toBe('confirmed')
  })

  it('迁移期兼容：旧端口三角由端口面板换算（实现者 relation 记为 <接口>#<模块>）', () => {
    const t = portTriad(index, null, 'core.api')!
    expect(t.defines).toEqual(['if.get'])
    expect(t.implementers.map(p => [p.relation, p.module])).toEqual([['if.get#ui.store', 'ui.store']])
    expect(t.users.map(p => [p.relation, p.via])).toEqual([
      ['rel.s', 'port:if.get'],
      ['rel.d', undefined],
    ])
    expect(portTriad(index, null, 'core.impl')).toBeNull()
  })
})

describe('U14 端口孤立', () => {
  it('端口没有任何实现者 → warning port.no-implementer；有实现者而没有使用者 → info port.no-user（T0 裁决 11）；不是端口的接口不报', () => {
    const viaOnly = load("  - { id: rel.s, from: ui.view, to: core.api, type: commands, via: 'port:if.get' }", '[]')
    expect(portIssues(viaOnly, null).map(i => [i.code, i.severity])).toEqual([['port.no-implementer', 'warning']])
    const noUser = load('', '[ui.store]')
    expect(portIssues(noUser, null).map(i => [i.code, i.severity])).toEqual([['port.no-user', 'info']])
    expect(portIssues(load('', '[]'), null)).toEqual([])
    const used = load("  - { id: rel.s, from: ui.view, to: core.api, type: commands, via: 'port:if.get' }", '[ui.store]')
    expect(portIssues(used, null)).toEqual([])
  })

  it('定义模块或全部实现者是目标态的不报；返工清单类别「端口孤立」（设计版本没有代码事实时按描述）', () => {
    expect(portIssues(load('', '[core.future]'), null)).toEqual([])
    const viaOnly = load("  - { id: rel.s, from: ui.view, to: core.api, type: commands, via: 'port:if.get' }", '[]')
    const item = reworkList({ index: viaOnly, issues: [] }).items.find(i => i.category === 'port')!
    expect(item).toMatchObject({ severity: 'warning', code: 'port.no-implementer', rules: ['U14'] })
    expect(item.actions[0].kind).toBe('fix-port')
  })
})
