/**
 * 查询 / 委托的分类建议（ADR-0029 §5「分类是主张」）：classifyRelation 的每条启发式一个用例，交互口吻的说明，
 * 以及 `arch classify --write` 的写回（只改 type 与 description 两个值、不重排文件）。
 */
import { describe, expect, it } from 'vitest'
import {
  classifyRelation,
  interactionDescription,
  loadModel,
  nameLean,
  returnShapeOf,
  signatureReturns,
  type ClassifyCode,
  type FileDep,
  type ModelIndex,
  type ModuleDep,
  type RawFile,
} from '@/model'
import { rewriteRelations } from '../../../scripts/agent/classify'

const MODEL = `
modules:
  - id: ui
    name: 界面
    responsibility: 界面
    children:
      - { id: ui.view, name: 视图, responsibility: 视图 }
  - id: core
    name: 内核
    responsibility: 内核
    children:
      - { id: core.store, name: 状态, responsibility: 状态 }
      - { id: core.calc, name: 计算, responsibility: 计算 }
      - { id: core.util, name: 工具, role: shared, responsibility: 工具 }
      - { id: core.bus, name: 播报, responsibility: 播报 }
      - { id: core.panel, name: 面板, responsibility: 面板 }
interfaces:
  - { id: if.save, name: save, owner: core.store, signature: 'save(x: Item): Promise<void>' }
  - { id: if.price, name: price, owner: core.calc, signature: 'price(x: Item): number' }
relations:
  - { id: r.plain, from: ui.view, to: core.calc, type: calls }
  - { id: r.panel, from: ui.view, to: core.panel, type: calls }
  - { id: r.util, from: ui.view, to: core.util, type: calls }
  - { id: r.bus, from: ui.view, to: core.bus, type: calls }
  - { id: r.emit, from: core.bus, to: ui.view, type: notifies }
  - { id: r.save, from: ui.view, to: core.store, type: calls, interface: if.save }
  - { id: r.price, from: ui.view, to: core.calc, type: calls, interface: if.price }
  - { id: r.words, from: ui.view, to: core.calc, type: calls, description: 'setLimit / startTimer：写入上限并启动计时' }
  - { id: r.read, from: ui.view, to: core.calc, type: calls, description: 'getTotal、isEmpty：取合计' }
`
const files: RawFile[] = [
  { path: 'system.yaml', text: 'system: { id: s, name: S }' },
  { path: 'modules/m.yaml', text: MODEL },
]
const index: ModelIndex = loadModel(files).index
const rel = (id: string) => index.relations.get(id)!

/** 文件依赖与模块依赖：ui.view 的 view.ts 调用目标文件 */
const dep = (to: string, extra: Partial<FileDep> = {}): FileDep => ({ from: 'src/view.ts', to, via: to, kind: 'value', line: 3, uses: true, invokes: true, ...extra })
const report = (pairs: [string, string, FileDep[]][]) => ({
  moduleDeps: new Map<string, ModuleDep>(pairs.map(([from, to, fs]) => [`${from}->${to}`, { key: `${from}->${to}`, from, to, files: fs }])),
})
const DIRECT = new Map<string, string[]>([
  ['ui.view', ['src/view.ts']],
  ['core.store', ['src/store.ts']],
  ['core.calc', ['src/calc.ts']],
  ['core.util', ['src/util.ts']],
  ['core.bus', ['src/bus.ts']],
])
const code = (over: Partial<ClassifyCode> = {}): ClassifyCode => ({ sites: new Map(), decls: new Map(), state: new Map(), direct: DIRECT, ...over })

describe('ADR-0029 §5：查询 / 委托的启发式', () => {
  it('目标是共用件 → 查询', () => {
    const c = classifyRelation(index, null, rel('r.util'))
    expect(c.type).toBe('queries')
    expect(c.reasons.join()).toContain('共用件')
  })

  it('有返回值且结果被使用（赋值、await）→ 查询', () => {
    const d = dep('src/calc.ts', { names: ['total'] })
    const c = classifyRelation(
      index,
      report([['ui.view', 'core.calc', [d]]]),
      rel('r.plain'),
      code({
        sites: new Map([['src/view.ts\0src/calc.ts', [{ name: 'total', called: true, used: true, line: 3 }]]]),
        decls: new Map([['src/calc.ts\0total', { kind: 'function', returns: 'value', signature: 'function total(xs: Item[]): number' }]]),
      }),
    )
    expect(c.type).toBe('queries')
    expect(c.reasons.join()).toContain('有返回值且结果被使用')
  })

  it('返回 void / Promise<void>，或作为语句调用不取结果 → 委托', () => {
    const d = dep('src/store.ts', { names: ['persist'] })
    const c = classifyRelation(
      index,
      report([['ui.view', 'core.store', [d]]]),
      rel('r.save'),
      code({
        sites: new Map([['src/view.ts\0src/store.ts', [{ name: 'persist', called: true, used: false, awaited: true }]]]),
        decls: new Map([['src/store.ts\0persist', { kind: 'function', returns: 'promise-void' }]]),
      }),
    )
    expect(c.type).toBe('commands')
    expect(c.reasons.join()).toContain('Promise<void>')
  })

  it('目标不持有状态 → 查询；目标持有 store、类实例、IO → 委托', () => {
    const none = classifyRelation(index, report([['ui.view', 'core.calc', [dep('src/calc.ts')]]]), rel('r.plain'), code())
    expect(none.reasons.join()).toContain('目标不持有状态')
    expect(none.type).toBe('queries')
    const held = classifyRelation(
      index,
      report([['ui.view', 'core.calc', [dep('src/calc.ts')]]]),
      rel('r.plain'),
      code({ state: new Map([['src/calc.ts', { store: 'reactive', instance: 'this.items', io: 'writeFileSync' }]]) }),
    )
    expect(held.type).toBe('commands')
    expect(held.reasons.join()).toMatch(/持有状态.*实例状态.*IO|IO.*持有状态/s)
  })

  it('没有文件依赖时，按目标模块直接归属的文件看状态持有', () => {
    const c = classifyRelation(index, report([]), rel('r.plain'), code({ state: new Map([['src/calc.ts', { store: 'ref' }]]) }))
    expect(c.reasons.join()).toContain('目标持有状态')
  })

  it('链路上有通知（目标会发出 notifies）→ 委托', () => {
    const c = classifyRelation(index, null, rel('r.bus'))
    expect(c.type).toBe('commands')
    expect(c.reasons.join()).toContain('r.emit')
  })

  it('接口签名：返回 Promise<void> → 委托；有返回值 → 查询', () => {
    expect(classifyRelation(index, null, rel('r.save')).type).toBe('commands')
    expect(classifyRelation(index, null, rel('r.price')).type).toBe('queries')
    expect(signatureReturns('save(x: Item): Promise<void>')).toBe('promise-void')
    expect(signatureReturns('get(id: string): Item')).toBe('value')
    expect(signatureReturns('interface X { a: string }')).toBeUndefined()
    expect(returnShapeOf('void')).toBe('void')
    expect(returnShapeOf('Promise<Item[]>')).toBe('promise-value')
  })

  it('名字像命令（set、start …）→ 委托；像查询（get、is …）→ 查询', () => {
    expect(classifyRelation(index, null, rel('r.words')).type).toBe('commands')
    expect(classifyRelation(index, null, rel('r.read')).type).toBe('queries')
    expect(nameLean('setLimit')).toBe('commands')
    expect(nameLean('selectFile')).toBe('commands')
    expect(nameLean('selectedOf')).toBe('queries')
    expect(nameLean('moduleName')).toBe('queries')
    expect(nameLean('useDesk')).toBeUndefined()
    expect(nameLean('Foo')).toBeUndefined()
  })

  it('渲染子组件（目标是 .vue）→ 委托', () => {
    const c = classifyRelation(index, report([['ui.view', 'core.panel', [dep('src/Panel.vue')]]]), rel('r.panel'), code({ direct: new Map([['core.panel', ['src/Panel.vue']]]) }))
    expect(c.type).toBe('commands')
    expect(c.summary).toBe('渲染 Panel')
  })

  it('句柄上的成员（useX() 的结果）只按名字看，不按结果使用计分', () => {
    const d = dep('src/calc.ts', { names: ['useCalc'] })
    const c = classifyRelation(
      index,
      report([['ui.view', 'core.calc', [d]]]),
      rel('r.plain'),
      code({ sites: new Map([['src/view.ts\0src/calc.ts', [{ name: 'useCalc', called: true, used: true }, { name: 'useCalc', member: 'resetAll', called: true, used: true, handle: true }]]]) }),
    )
    expect(c.reasons.join()).not.toContain('调用点')
    expect(c.reasons.join()).toContain('resetAll')
  })

  it('只有继承或只有组装的使用：标出 factOnly（关系可删、由子类 / 组装事实承载）', () => {
    const ext = classifyRelation(index, report([['ui.view', 'core.calc', [dep('src/calc.ts', { invokeKinds: ['extends'] })]]]), rel('r.plain'), code())
    expect(ext.factOnly).toBe('extends')
    const asm = classifyRelation(index, report([['ui.view', 'core.calc', [dep('src/calc.ts', { invokeKinds: ['new'] })]]]), rel('r.plain'), code())
    expect(asm.factOnly).toBe('assembly')
  })

  it('证据不足：低置信度，按委托并请人核对', () => {
    const bare = loadModel([files[0], { path: 'modules/m.yaml', text: MODEL.replace(/relations:[\s\S]*/, 'relations:\n  - { id: r.x, from: ui.view, to: core.panel, type: calls }\n') }]).index
    const c = classifyRelation(bare, null, bare.relations.get('r.x')!)
    expect(c).toMatchObject({ type: 'commands', confidence: 'low' })
    expect(c.reasons.join()).toContain('请人核对')
  })

  it('置信度：分差大且有代码证据为高', () => {
    const d = dep('src/calc.ts', { names: ['total'] })
    const c = classifyRelation(
      index,
      report([['ui.view', 'core.calc', [d]]]),
      rel('r.read'),
      code({
        sites: new Map([['src/view.ts\0src/calc.ts', [{ name: 'total', called: true, used: true }]]]),
        decls: new Map([['src/calc.ts\0total', { kind: 'function', returns: 'value' }]]),
      }),
    )
    expect(c.confidence).toBe('high')
  })
})

describe('交互口吻的说明（谁调谁做什么）', () => {
  it('查询写「取」、委托写「交给」；没有说明时用 summary；可重复改写', () => {
    const q = interactionDescription(index, rel('r.read'), 'queries')
    expect(q).toBe('视图向计算取：getTotal、isEmpty：取合计')
    expect(interactionDescription(index, { ...rel('r.read'), description: q }, 'commands')).toBe('视图交给计算：getTotal、isEmpty：取合计')
    expect(interactionDescription(index, rel('r.plain'), 'commands', '渲染 Calc')).toBe('视图交给计算：渲染 Calc')
    expect(interactionDescription(index, rel('r.plain'), 'queries')).toBe('视图向计算取结果')
    expect(interactionDescription(index, { from: 'ui.view', to: 'core.calc', description: '视图调用 total 求合计' }, 'queries')).toBe('视图向计算取：调用 total 求合计')
  })
})

describe('arch classify --write：只改 type 与 description 两个值', () => {
  const TEXT = [
    'relations:',
    '  # 注释保留',
    '  - {id: r.a, from: x, to: y, type: calls, description: 旧说明}',
    '  - { id: r.b, from: x, to: y, type: calls }',
    '  - id: r.c',
    '    from: x',
    '    to: y',
    '    type: calls',
    '    via: http',
    '  - { id: r.d, from: x, to: y, type: notifies, description: 不动 }',
    '  - { id: r.e, from: x, to: y, type: calls, description: "带引号" }',
    '',
  ].join('\n')

  it('流式与块式都按原位替换，没有说明的补一个，非 calls 与未列出的不动', () => {
    const edits = new Map([
      ['r.a', { type: 'queries' as const, description: '新说明, 含逗号' }],
      ['r.b', { type: 'commands' as const, description: '交给 y' }],
      ['r.c', { type: 'queries' as const, description: '取 z' }],
      ['r.d', { type: 'queries' as const, description: '不该改' }],
      ['r.e', { type: 'commands' as const }],
    ])
    const r = rewriteRelations(TEXT, edits)
    expect(r).toMatchObject({ types: 4, descriptions: 3 })
    const lines = r.text.split('\n')
    expect(lines[1]).toBe('  # 注释保留')
    expect(lines[2]).toBe('  - {id: r.a, from: x, to: y, type: queries, description: "新说明, 含逗号"}')
    expect(lines[3]).toBe('  - { id: r.b, from: x, to: y, type: commands, description: 交给 y }')
    expect(lines.slice(4, 10)).toEqual(['  - id: r.c', '    from: x', '    to: y', '    type: queries', '    description: 取 z', '    via: http'])
    expect(lines[10]).toBe('  - { id: r.d, from: x, to: y, type: notifies, description: 不动 }')
    expect(lines[11]).toBe('  - { id: r.e, from: x, to: y, type: commands, description: "带引号" }')
    // 再跑一次没有 calls 可改
    expect(rewriteRelations(r.text, edits)).toMatchObject({ types: 0, descriptions: 0 })
  })
})
