/**
 * 第二十一轮预留的三处缝（T1.0，DL-4、DL-5、DL-17）：加一种资料种类、加一行主语表、加一个名称行动作，都不改其他代码。
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_DOC_TABLE, defaultDocFor, docKey, EMPTY_WORKSPACE, workspaceTransition, type DocRef } from '../../src/state/transition'
import { DOC_KIND_VIEWS, docLabel, docTip, type DocKindContext } from '../../src/components/dock/docKinds'
import { NAME_ACTIONS, nameActions, type NameAction, type NameActionContext } from '../../src/components/panel/nameActions'

describe('DL-5 资料种类可扩展', () => {
  // 一种假的资料：类型上不在联合里，标签栏、分组与打开 / 关闭照常
  const fake = { kind: 'notes', design: 'd1' } as unknown as DocRef
  const ctx: DocKindContext = { moduleName: id => id, scenarioName: () => null }

  it('键按种类与其余字段推出；打开、激活、关闭只认键', () => {
    expect(docKey(fake)).toBe('notes:d1')
    let s = workspaceTransition(EMPTY_WORKSPACE, { type: 'open', doc: fake, pin: true })
    s = workspaceTransition(s, { type: 'open', doc: { kind: 'sequence' } })
    expect(s.groups[0].tabs.map(t => t.id)).toEqual(['notes:d1', 'seq'])
    s = workspaceTransition(s, { type: 'closeDoc', id: 'notes:d1' })
    expect(s.groups[0].tabs.map(t => t.id)).toEqual(['seq'])
  })

  it('标签名：种类表里加一行就有名字与说明；没登记也退回种类名', () => {
    expect(docLabel(fake, ctx)).toBe('notes')
    const views = { ...DOC_KIND_VIEWS, notes: { label: () => '设计说明', tip: () => '设计说明 · 目标态' } }
    expect(docLabel(fake, ctx, views)).toBe('设计说明')
    expect(docTip(fake, ctx, views)).toBe('设计说明 · 目标态')
  })

  it('「对话」是其中一种：一个项目一份，键 dlg', () => {
    expect(docKey({ kind: 'dialogue' })).toBe('dlg')
    expect(docLabel({ kind: 'dialogue' }, ctx)).toBe('对话')
  })
})

describe('DL-4 辅助栏缺省主语表', () => {
  const has = (id: string) => id === 'withStory'

  it('结构 / 交互 → 题解（有图解开图解，否则理解页）；运行 → 时序图；草图 → 对话；题解没选中模块时为空', () => {
    expect(defaultDocFor('structure', { module: 'withStory', hasExplainer: has })).toEqual({ kind: 'explainer', module: 'withStory' })
    expect(defaultDocFor('interaction', { module: 'plain', hasExplainer: has })).toEqual({ kind: 'facts', module: 'plain' })
    expect(defaultDocFor('run', { module: 'plain', hasExplainer: has })).toEqual({ kind: 'sequence' })
    expect(defaultDocFor('sketch', { module: 'plain', hasExplainer: has })).toEqual({ kind: 'dialogue' })
    expect(defaultDocFor('structure', { hasExplainer: has })).toBeNull()
  })

  it('加一行：新画布状态只在表里加一行，函数不改', () => {
    const table = { ...DEFAULT_DOC_TABLE, review: 'dialogue' as const }
    expect(defaultDocFor('review', { hasExplainer: has }, table)).toEqual({ kind: 'dialogue' })
    expect(defaultDocFor('review', { hasExplainer: has })).toBeNull()
  })
})

describe('DL-17 名称行动作槽', () => {
  const ctx = (o: Partial<NameActionContext> = {}): NameActionContext => ({
    hasExplainer: id => id === 'm',
    current: true,
    sketching: false,
    openExplainer: () => {},
    openDialogue: () => {},
    ...o,
  })

  it('身份卡：有图解的模块「图解 ›」+「讨论 ›」；事实卡只有「讨论 ›」；设计版本与草图编辑里没有「讨论 ›」', () => {
    expect(nameActions('id-card', 'm', ctx()).map(a => a.label)).toEqual(['图解 ›', '讨论 ›'])
    expect(nameActions('id-card', 'x', ctx()).map(a => a.label)).toEqual(['讨论 ›'])
    expect(nameActions('fact-card', 'm', ctx()).map(a => a.label)).toEqual(['讨论 ›'])
    expect(nameActions('id-card', 'x', ctx({ current: false }))).toEqual([])
    expect(nameActions('id-card', 'x', ctx({ sketching: true }))).toEqual([])
  })

  it('加一个动作：表里加一行即出现在槽里，按表的次序', () => {
    const calls: string[] = []
    const extra: NameAction = { id: 'pin', label: '钉住 ›', title: '', places: ['fact-card'], when: () => true, run: (_c, m) => calls.push(m) }
    const list = nameActions('fact-card', 'm', ctx(), [...NAME_ACTIONS, extra])
    expect(list.map(a => a.id)).toEqual(['discuss', 'pin'])
    list[1].run(ctx(), 'm')
    expect(calls).toEqual(['m'])
  })
})
