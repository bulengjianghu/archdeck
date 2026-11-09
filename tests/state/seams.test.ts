/**
 * 第二十一轮预留的缝（T1.0，DL-5、DL-17；DL-4 主语表第二十二轮由 LY-11 情境排布表取代）：加一种资料种类、加一行排布表、加一个名称行动作，都不改其他代码。
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_ARRANGEMENTS, docKey, EMPTY_WORKSPACE, workspaceTransition, type DocRef } from '../../src/state/transition'
import { DOC_KIND_VIEWS, docLabel, docTip, type DocKindContext } from '../../src/components/dock/docKinds'
import { NAME_ACTIONS, nameActions, type NameAction, type NameActionContext } from '../../src/components/panel/nameActions'

describe('DL-5 资料种类可扩展', () => {
  // 一种假的资料：类型上不在联合里，标签栏、分组与打开 / 关闭照常
  const fake = { kind: 'notes', design: 'd1' } as unknown as DocRef
  const ctx: DocKindContext = { moduleName: id => id, scenarioName: () => null }

  it('键按种类与其余字段推出；打开、激活、关闭只认键', () => {
    expect(docKey(fake)).toBe('notes:d1')
    const base = EMPTY_WORKSPACE.groups[0].tabs.map(t => t.id)
    let s = workspaceTransition(EMPTY_WORKSPACE, { type: 'open', doc: fake, pin: true })
    s = workspaceTransition(s, { type: 'open', doc: { kind: 'source', path: 'a.ts' } })
    expect(s.groups[0].tabs.map(t => t.id)).toEqual([...base, 'notes:d1', 'src:a.ts'])
    s = workspaceTransition(s, { type: 'close', id: 'notes:d1' })
    expect(s.groups[0].tabs.map(t => t.id)).toEqual([...base, 'src:a.ts'])
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

describe('LY-11 缺省排布是一张表（取代 DL-4 主语表）', () => {
  it('三种情境各一行；草图那一行里有对话', () => {
    expect(Object.keys(DEFAULT_ARRANGEMENTS).sort()).toEqual(['free', 'scenario', 'sketch'])
    expect(DEFAULT_ARRANGEMENTS.sketch.groups[0][0]).toBe('dialogue')
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
