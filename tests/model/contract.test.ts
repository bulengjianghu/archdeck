import { describe, expect, it } from 'vitest'
import { contractCoverage, contractNote, firstSentence, invariantsOf, load, loadModel, purposeOf, reworkList, summaryOf, textWidth, truncateWidth, validate } from '../../src/model'

const run = (text: string) => validate(load([{ path: 'm.yaml', text }]).model)
const infos = (text: string, code: string) => run(text).issues.filter(i => i.code === code)

describe('描述契约（ADR-0053）', () => {
  it('M27：summary 超过 30 字提示 info module.summary-long（带出处与字段路径）；30 字以内不提示', () => {
    const long = '把'.repeat(31)
    const text = `modules:\n  - { id: a, name: A, responsibility: x, summary: ${long} }\n  - { id: b, name: B, responsibility: x, summary: ${'把'.repeat(30)} }`
    const issues = infos(text, 'module.summary-long')
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ severity: 'info', file: 'm.yaml', path: 'modules.0.summary', line: 2 })
    expect(issues[0].message).toContain('31 字')
  })

  it('M27：核心模块没写 summary 提示 info module.missing-summary；非核心模块不提示；写了不提示', () => {
    const text = [
      'modules:',
      '  - { id: a, name: A, role: core, responsibility: x }',
      '  - { id: b, name: B, role: core, responsibility: x, summary: 给出播放会话 }',
      '  - { id: c, name: C, responsibility: x }',
    ].join('\n')
    const issues = infos(text, 'module.missing-summary')
    expect(issues.map(i => i.message)).toEqual([expect.stringContaining('「a」是核心模块')])
    expect(issues[0].severity).toBe('info')
  })

  it('M28：invariants 两种写法归一为 { text, adr? }，去掉空条；超过 3 条提示 info module.invariants-many', () => {
    const { model, issues } = run(
      [
        'modules:',
        '  - id: a',
        '    name: A',
        '    responsibility: x',
        '    invariants: [命令单通道串行, { text: 会话是资源唯一属主, adr: 12 }, "  "]',
        '  - { id: b, name: B, responsibility: x, invariants: [一, 二, 三, 四] }',
      ].join('\n'),
    )
    expect(invariantsOf(model.modules.find(m => m.id === 'a')!)).toEqual([{ text: '命令单通道串行' }, { text: '会话是资源唯一属主', adr: 12 }])
    const many = issues.filter(i => i.code === 'module.invariants-many')
    expect(many).toHaveLength(1)
    expect(many[0]).toMatchObject({ severity: 'info', path: 'modules.1.invariants' })
    expect(many[0].message).toContain('4 条')
  })

  it('M28：不变式写错形状（缺 text、adr 不是整数）是格式错误（M1）', () => {
    const bad = load([{ path: 'm.yaml', text: 'modules:\n  - { id: a, name: A, invariants: [{ adr: 3 }] }\n  - { id: b, name: B, invariants: [{ text: x, adr: "0012" }] }' }])
    expect(bad.issues.filter(i => i.code === 'schema').map(i => i.line)).toEqual([2, 3])
    expect(bad.model.modules).toEqual([])
  })

  it('M29：purpose 超过 20 字提示 info relation.purpose-long；20 字以内不提示', () => {
    const text = [
      'modules: [{ id: a, name: A, responsibility: x }, { id: b, name: B, responsibility: x }]',
      'relations:',
      `  - { id: r1, from: a, to: b, type: queries, purpose: ${'取'.repeat(21)} }`,
      `  - { id: r2, from: a, to: b, type: commands, purpose: ${'取'.repeat(20)} }`,
    ].join('\n')
    const issues = infos(text, 'relation.purpose-long')
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ severity: 'info', path: 'relations.0.purpose' })
  })

  it('M27–M29：契约提示都是 info，进返工清单（描述类，带规则编号），不计入错误与提醒', () => {
    const { index, issues } = loadModel([
      {
        path: 'm.yaml',
        text: `modules: [{ id: a, name: A, role: core, responsibility: x }, { id: b, name: B, responsibility: x, summary: ${'把'.repeat(31)} }]\nrelations: [{ id: r, from: a, to: b, type: queries, purpose: ${'取'.repeat(21)} }]`,
      },
    ])
    const mine = issues.filter(i => /^(module\.(summary-long|missing-summary|invariants-many)|relation\.purpose-long)$/.test(i.code))
    expect(mine.map(i => i.severity)).toEqual(['info', 'info', 'info'])
    const rework = reworkList({ index, issues })
    expect(rework.items.filter(i => i.code === 'module.missing-summary').map(i => [i.category, i.rules])).toEqual([['description', ['M27']]])
    expect(rework.items.filter(i => i.code === 'relation.purpose-long').map(i => i.rules)).toEqual([['M29']])
  })

  it('M30：字数按显示宽度——全角计 1、半角计 ½、空白不计，向上取整', () => {
    expect(textWidth('播放会话')).toBe(4)
    expect(textWidth('DeskState')).toBe(5)
    expect(textWidth('取 Kit 状态')).toBe(5)
    expect(textWidth('')).toBe(0)
  })

  it('M30：首句在 。！？； 与后跟空白或行尾的 .!?; 处断开；版本号、文件名里的点不断', () => {
    expect(firstSentence('收宿主命令。再施用')).toBe('收宿主命令')
    expect(firstSentence('门面；内核')).toBe('门面')
    expect(firstSentence('Reads v1.2 files. Then')).toBe('Reads v1.2 files')
    expect(firstSentence('  没有句末标点  ')).toBe('没有句末标点')
  })

  it('M30：截断到上限并加「…」（「…」计 1 字），不超长时原样', () => {
    expect(truncateWidth('一二三', 3)).toBe('一二三')
    expect(truncateWidth('一二三四', 3)).toBe('一二…')
    expect(textWidth(truncateWidth('a'.repeat(100), 20))).toBeLessThanOrEqual(20)
  })

  it('M30：summaryOf——写了取 summary（超长也原样）；没写取职责首句截断并标待提炼；都没有为空', () => {
    expect(summaryOf({ summary: ' 给出播放会话 ', responsibility: '长文。' })).toEqual({ text: '给出播放会话', pending: false })
    expect(summaryOf({ summary: '把'.repeat(40) })).toEqual({ text: '把'.repeat(40), pending: false })
    expect(summaryOf({ responsibility: '列出全部项目。点击进入' })).toEqual({ text: '列出全部项目', pending: true })
    const cut = summaryOf({ responsibility: `${'列'.repeat(50)}。` })!
    expect(cut).toEqual({ text: `${'列'.repeat(29)}…`, pending: true })
    expect(summaryOf({})).toBeNull()
    expect(summaryOf({ summary: '  ', responsibility: '' })).toBeNull()
  })

  it('M30：purposeOf——写了取 purpose；没写取说明首句截断到 20 字并标待提炼；都没有为空', () => {
    expect(purposeOf({ purpose: '取会话状态', description: '经 binder 惰性创建。' })).toEqual({ text: '取会话状态', pending: false })
    expect(purposeOf({ description: '经 binder 惰性创建 StateMachineControllerAndMore；再…' })).toEqual({ text: '经 binder 惰性创建 StateMachineController…', pending: true })
    expect(purposeOf({})).toBeNull()
  })

  it('M31：覆盖计数与摘要——summary / 有职责的模块、核心缺、purpose / 关系、写了不变式的模块、超长、超 3 条', () => {
    const { index } = loadModel([
      {
        path: 'm.yaml',
        text: [
          'modules:',
          `  - { id: a, name: A, role: core, responsibility: x, summary: ${'把'.repeat(31)}, invariants: [一, 二, 三, 四] }`,
          '  - { id: b, name: B, role: core, responsibility: x }',
          '  - { id: c, name: C }',
          'relations:',
          '  - { id: r1, from: a, to: b, type: queries, purpose: 取状态 }',
          '  - { id: r2, from: b, to: c, type: commands }',
        ].join('\n'),
      },
    ])
    const c = contractCoverage(index)
    expect(c).toEqual({ modules: 2, summary: 1, coreMissing: 1, relations: 2, purpose: 1, invariants: 1, long: 1, many: 1 })
    expect(contractNote(c)).toBe('契约：summary 1 / 有职责的 2（核心缺 1）· purpose 1 / 2 · invariants 1 个模块 · 超长 1、不变式超 3 条 1')
  })
})
