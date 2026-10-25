/**
 * 架构治理 · 模块表面与承载链（ADR-0032）：元素级结构边与束 K14（第八轮口径）、表面元素与匹配 K18、表面指标 K19、越过入口 U18、热表面未声明 U19、
 * U17 按全部束、承载判定 K5d 与模板 K20、通道契约 M21、束内没写接口 M22、交互束按表面散开 D7 / D8、fact.unconfirmed 的缺段原因 D6
 */
import { describe, expect, it } from 'vitest'
import {
  assignFiles,
  carrierGap,
  carrierOf,
  carriersOf,
  entryResolver,
  formOf,
  governanceReport,
  interactionBundle,
  levelDeps,
  loadModel,
  moduleElementEdges,
  parseVia,
  projectLevel,
  structureMetrics,
  surfaceIssues,
  surfaceMetrics,
  surfaceOf,
  viaLabel,
  type CodeDeps,
  type ExportedSymbol,
  type FileDep,
  type SurfaceElement,
  type SurfaceSource,
} from '@/model'

const MODEL = `
modules:
  - { id: a, name: A, responsibility: 发起方, codeRefs: [src/a/**] }
  - { id: b, name: B, responsibility: 端口实现者, codeRefs: [src/b/**], entry: src/b/index.ts }
  - { id: c, name: C, responsibility: 订阅方, codeRefs: [src/c/**] }
  - { id: lib, name: Lib, responsibility: 被依赖方, codeRefs: [src/lib/**], entry: src/lib/index.ts, provides: [if.run, if.Store, if.unused] }
  - { id: bus, name: Bus, role: bus, responsibility: 事件总线, codeRefs: [src/bus/**], entry: src/bus/index.ts }
  - { id: ctr, name: Ctr, responsibility: 通道契约, codeRefs: [src/ctr/**], entry: src/ctr/index.ts }
  - { id: main, name: Main, responsibility: 组装根, codeRefs: [src/main/**] }
interfaces:
  - { id: if.run, name: 'run(x)', owner: lib }
  - { id: if.Store, name: Store, owner: lib, implementedBy: [b] }
  - { id: if.unused, name: 'unused()', owner: lib }
relations:
  - { id: r.direct, from: a, to: lib, type: queries, interface: if.run }
  - { id: r.loose1, from: a, to: lib, type: queries }
  - { id: r.loose2, from: a, to: lib, type: queries, mode: async }
  - { id: r.ml, from: c, to: lib, type: queries, interface: if.run }
  - { id: r.none, from: c, to: a, type: queries }
  - { id: r.port, from: a, to: b, type: commands, via: 'port:if.Store' }
  - { id: r.bus, from: a, to: c, type: notifies, via: 'bus:bus' }
  - { id: r.cb, from: lib, to: a, type: notifies }
  - { id: r.ch, from: a, to: c, type: commands, via: 'channel:ws@ctr' }
  - { id: r.ext, from: a, to: c, type: commands, via: 'channel:http' }
`

const SRC = [
  'src/a/a.ts',
  'src/b/index.ts',
  'src/b/b.ts',
  'src/c/c.ts',
  'src/lib/index.ts',
  'src/lib/run.ts',
  'src/lib/store.ts',
  'src/lib/internal.ts',
  'src/bus/index.ts',
  'src/ctr/index.ts',
  'src/main/main.ts',
]

const call = (from: string, to: string, via: string, names?: string[], line = 1): FileDep => ({
  from,
  to,
  via,
  kind: 'value',
  line,
  uses: true,
  invokes: true,
  invokeKinds: ['call'],
  ...(names ? { names } : {}),
})
const typeOnly = (from: string, to: string, via: string, names: string[], line = 1): FileDep => ({ from, to, via, kind: 'type', line, names })

const DEPS: FileDep[] = [
  call('src/a/a.ts', 'src/lib/run.ts', 'src/lib/index.ts', ['run', 'helper']), // 0：经入口，两个元素
  typeOnly('src/a/a.ts', 'src/lib/store.ts', 'src/lib/index.ts', ['Store'], 2), // 1：端口元素，只引类型
  call('src/a/a.ts', 'src/lib/internal.ts', 'src/lib/internal.ts', ['secret'], 3), // 2：越过入口
  { ...typeOnly('src/b/b.ts', 'src/lib/store.ts', 'src/lib/index.ts', ['Store']), inherits: [{ name: 'Store', clause: 'implements', decl: 'interface' }] }, // 3：端口实现
  call('src/b/b.ts', 'src/lib/run.ts', 'src/lib/index.ts', ['helper'], 2), // 4
  call('src/c/c.ts', 'src/lib/run.ts', 'src/lib/index.ts', ['helper']), // 5
  call('src/c/c.ts', 'src/lib/index.ts', 'src/lib/index.ts', undefined, 2), // 6：namespace 导入，整模块
  { ...call('src/main/main.ts', 'src/b/b.ts', 'src/b/index.ts', ['B']), invokeKinds: ['new'] }, // 7：组装
  call('src/a/a.ts', 'src/bus/index.ts', 'src/bus/index.ts', ['publish'], 4), // 8：发布
  call('src/c/c.ts', 'src/bus/index.ts', 'src/bus/index.ts', ['subscribe'], 3), // 9：订阅
  typeOnly('src/a/a.ts', 'src/ctr/index.ts', 'src/ctr/index.ts', ['Msg'], 5), // 10：通道契约，只有发起方一侧
]

const sym = (name: string, kind: ExportedSymbol['kind'], from?: string, line = 1): ExportedSymbol => ({ name, kind, line, ...(from ? { from } : {}) })
const EXPORTS: Record<string, ExportedSymbol[]> = {
  'src/lib/index.ts': [
    sym('run', 'function', 'src/lib/run.ts', 3),
    sym('helper', 'function', 'src/lib/run.ts', 9),
    sym('Store', 'interface', 'src/lib/store.ts'),
    sym('Item', 'type', 'src/lib/store.ts', 7),
    sym('LIMIT', 'const', undefined, 2),
    { ...sym('Mode', 'enum'), line: 4 },
  ],
  'src/b/index.ts': [sym('B', 'class', 'src/b/b.ts')],
  'src/bus/index.ts': [sym('publish', 'function'), sym('subscribe', 'function')],
  'src/ctr/index.ts': [sym('Msg', 'interface')],
}
EXPORTS['src/lib/index.ts'][4] = { ...EXPORTS['src/lib/index.ts'][4], data: true }

function setup(deps = DEPS, exports: Record<string, ExportedSymbol[]> | null = EXPORTS) {
  const { index, issues } = loadModel([
    { path: 'system.yaml', text: 'system: { id: sys, name: Sys }' },
    { path: 'modules.yaml', text: MODEL },
  ])
  const own = assignFiles(index, SRC, [])
  const tree = { files: SRC, packages: {} }
  const code: CodeDeps = { deps, external: {}, parsed: SRC.length }
  const report = governanceReport(index, own, tree, code, null)
  const src: SurfaceSource = { entryOf: entryResolver(index, own, tree), own, ...(exports ? { exportsOf: (f: string) => exports[f] ?? null } : {}) }
  return { index, issues, own, report, src }
}

const brief = (e: SurfaceElement) => `${e.name}:${e.kind}:${e.state}`

describe('K18 表面元素与匹配', () => {
  it('入口导出与声明接口按名字匹配：已声明且导出 / 导出未声明 / 声明未导出；端口类为端口；再导出穿透到声明文件', () => {
    const { index, report, src } = setup()
    const s = surfaceOf(index, src, 'lib', report)!
    expect(s.entry).toBe('src/lib/index.ts')
    expect(s.exports).toBe(true)
    expect(s.elements.map(brief)).toEqual([
      'Store:port:declared-exported',
      'helper:operation:exported-only',
      'run:operation:declared-exported',
      'Item:type:exported-only',
      'LIMIT:data:exported-only',
      'Mode:data:exported-only',
      'unused:operation:declared-only',
    ])
    expect(s.elements.find(e => e.name === 'run')).toMatchObject({ interfaceId: 'if.run', exportKind: 'function', file: 'src/lib/run.ts', line: 3 })
    expect(s.elements.find(e => e.name === 'LIMIT')).toMatchObject({ file: 'src/lib/index.ts', line: 2 })
  })

  it('入口导出没读到：被引用的名字按用法推断种类（guessed），没被引用的声明接口导出与否未知（declared）', () => {
    const { index, report, src } = setup(DEPS, null)
    const s = surfaceOf(index, src, 'lib', report)!
    expect(s.exports).toBe(false)
    expect(s.elements.map(brief)).toEqual(['Store:port:declared-exported', 'helper:operation:exported-only', 'run:operation:declared-exported', 'unused:operation:declared'])
    expect(s.elements.find(e => e.name === 'helper')!.guessed).toBe(true)
  })

  it('C8：没有代码事实（设计版本，K8）时表面只有声明接口；没有入口的模块不判越过入口', () => {
    const { index, src, report } = setup()
    expect(surfaceOf(index, null, 'lib')!).toMatchObject({ facts: false, entry: null })
    expect(surfaceOf(index, null, 'lib')!.elements.map(brief)).toEqual(['Store:port:declared', 'run:operation:declared', 'unused:operation:declared'])
    expect(surfaceOf(index, src, 'a', report)).toMatchObject({ entry: null, elements: [] })
    expect(surfaceOf(index, src, 'nope', report)).toBeNull()
  })
})

describe('K14 元素级结构边与束（第八轮）', () => {
  it('形态由元素与用法决定：端口元素的 implements → 端口实现；new 落到类 → 组装；其余 → 使用', () => {
    const port: SurfaceElement = { module: 'lib', name: 'Store', kind: 'port', state: 'declared-exported' }
    const cls: SurfaceElement = { module: 'b', name: 'B', kind: 'operation', state: 'exported-only', exportKind: 'class' }
    const fn: SurfaceElement = { module: 'b', name: 'make', kind: 'operation', state: 'exported-only', exportKind: 'function' }
    expect(formOf(DEPS[3], port)).toBe('implements')
    expect(formOf(DEPS[7], cls)).toBe('assembly')
    expect(formOf(DEPS[7], fn)).toBe('use')
    expect(formOf({ ...DEPS[7], inherits: [{ name: 'B', clause: 'extends', decl: 'class' }] }, cls)).toBe('subclass')
    expect(formOf(DEPS[0], null)).toBe('use')
  })

  it('一对节点同方向一条束：最强形态、形态集合、混合、最强档、文件合计、元素数、越过入口数；元素级边各接各的元素', () => {
    const { index, report, src } = setup()
    const { bundles, elementEdges } = levelDeps(index, projectLevel(index, 'sys'), report, { surface: src })
    const ab = bundles.find(b => b.id === 'bundle:a->lib')!
    expect(ab).toMatchObject({ form: 'use', forms: ['use'], tier: 'invokes', files: 3, elements: 3, bypass: 1 })
    expect(ab.mixed).toBeUndefined()
    expect(ab.edges).toEqual(['el:a->lib:use:helper', 'el:a->lib:use:run', 'el:a->lib:use:Store', 'el:a->lib:use:!'])
    const store = elementEdges.find(e => e.id === 'el:a->lib:use:Store')!
    expect(store).toMatchObject({ tier: 'type', element: { kind: 'port' }, bundle: 'bundle:a->lib' })
    expect(elementEdges.find(e => e.id === 'el:a->lib:use:!')).toMatchObject({ bypass: true, element: null, tier: 'invokes' })
    const bl = bundles.find(b => b.id === 'bundle:b->lib')!
    expect(bl).toMatchObject({ form: 'implements', forms: ['implements', 'use'], mixed: true, tier: 'invokes', elements: 2 })
    expect(bundles.find(b => b.id === 'bundle:main->b')).toMatchObject({ form: 'assembly', forms: ['assembly'] })
    // namespace 导入接到模块本体
    expect(elementEdges.find(e => e.id === 'el:c->lib:use:*')).toMatchObject({ element: null })
    expect(elementEdges.find(e => e.id === 'el:c->lib:use:*')!.bypass).toBeUndefined()
  })

  it('没给表面来源时元素级边都接到模块本体、不判越过入口', () => {
    const { index, report } = setup()
    const r = levelDeps(index, projectLevel(index, 'sys'), report)
    expect(r.bundles.find(b => b.id === 'bundle:a->lib')!.edges).toEqual(['el:a->lib:use:*'])
    expect(r.elementEdges.every(e => !e.element && !e.bypass)).toBe(true)
  })

  it('K17、U15：覆盖与规则判定按束；A7：U17 逆稳定标全部束（不只依赖）', () => {
    const { index, report, src } = setup()
    const { bundles } = levelDeps(index, projectLevel(index, 'sys'), report, { surface: src, threshold: -2 })
    expect(bundles.find(b => b.id === 'bundle:a->lib')!.coverage.relations).toEqual(['r.cb', 'r.direct', 'r.loose1', 'r.loose2'])
    expect(bundles.find(b => b.id === 'bundle:main->b')!.againstStability).toBeDefined()
    expect(bundles.find(b => b.id === 'bundle:main->b')!.form).toBe('assembly')
    expect(bundles.every(b => b.ruling.verdict === 'unconstrained')).toBe(true)
  })
})

describe('K19 表面指标', () => {
  it('W = 被外部引用的不同元素数，B = 越过入口的文件依赖条数，元素扇入 = 使用它的模块数', () => {
    const { index, report, src } = setup()
    const m = surfaceMetrics(index, report, src, 'lib')
    expect(m).toMatchObject({ entry: 'src/lib/index.ts', w: 3, b: 1, whole: 1 })
    expect(m.uses.map(u => `${u.element.name}×${u.modules.length}`)).toEqual(['helper×3', 'Store×2', 'run×1'])
    expect(m.bypasses.map(f => `${f.from}:${f.line}`)).toEqual(['src/a/a.ts:3'])
    expect(surfaceMetrics(index, report, src, 'a')).toMatchObject({ w: null, b: null })
  })

  it('structureMetrics 给了表面来源时有入口的模块带 W / B，没给时不带', () => {
    const { index, report, src } = setup()
    expect(structureMetrics(index, report, { surface: src }).get('lib')).toMatchObject({ w: 3, b: 1 })
    expect(structureMetrics(index, report, { surface: src }).get('a')!.w).toBeUndefined()
    expect(structureMetrics(index, report).get('lib')!.w).toBeUndefined()
  })
})

describe('U18 越过入口、U19 热表面未声明（info）', () => {
  it('一个被依赖模块一条越过入口；导出未声明、被 3 个模块使用的元素提示声明接口；都进治理报告的问题', () => {
    const { index, report, src } = setup()
    const issues = surfaceIssues(index, report, src)
    expect(issues.map(i => `${i.severity}:${i.code}`)).toEqual(['info:surface.bypass', 'info:surface.hot-undeclared'])
    expect(issues[0].message).toContain('src/a/a.ts:3')
    expect(issues[1].message).toContain('「helper」被 3 个模块使用')
    expect(report.issues.filter(i => i.code.startsWith('surface.')).length).toBe(2)
    // 阈值 4：不提示
    expect(surfaceIssues(index, report, src, 4).map(i => i.code)).toEqual(['surface.bypass'])
  })
})

describe('K5d、K20 承载判定与模板', () => {
  const verdicts = () => {
    const { index, report, src } = setup()
    return { index, report, src, map: carriersOf(index, report, src) }
  }

  it('各模板的判定：直接、经端口（含组装者）、经总线、回调注册齐全；元素对不上回退模块级；通道缺一侧为缺段、没写契约为外部承载；没有依赖为无承载', () => {
    const { map } = verdicts()
    const v = Object.fromEntries([...map].map(([id, c]) => [id, `${c.template}:${c.verdict}`]))
    expect(v).toEqual({
      'r.direct': 'direct:complete',
      'r.loose1': 'direct:complete',
      'r.loose2': 'direct:complete',
      'r.ml': 'direct:module-level',
      'r.none': 'direct:none',
      'r.port': 'port:complete',
      'r.bus': 'bus:complete',
      'r.cb': 'callback:complete',
      'r.ch': 'channel:partial',
      'r.ext': 'channel:external',
    })
    expect(map.get('r.port')!.segments.map(s => `${s.role}:${s.edge?.element?.name ?? '-'}`)).toEqual(['use-port:Store', 'implement:Store', 'assemble:B'])
    expect(map.get('r.cb')!.segments[0]).toMatchObject({ role: 'register', from: 'a', to: 'lib' })
    expect(map.get('r.ch')!.segments.map(s => `${s.role}${s.missing ? '!' : ''}`)).toEqual(['contract-from', 'contract-to!'])
  })

  it('经端口缺组装者为缺段；元素级边找不到时（没有入口）按 K5 回退为模块级', () => {
    const { index, report, src } = setup(DEPS.filter((_, i) => i !== 7))
    const edges = moduleElementEdges(index, report, src)
    expect(carrierOf(index, report, edges, index.relations.get('r.port')!)).toMatchObject({ verdict: 'partial' })
    const noEntry: SurfaceSource = { ...src, entryOf: () => null }
    const flat = moduleElementEdges(index, report, noEntry)
    expect(carrierOf(index, report, flat, index.relations.get('r.direct')!)!.verdict).toBe('module-level')
  })

  it('D6：fact.unconfirmed 的消息加缺段原因，不新增错误级别', () => {
    const { index, report, src, map } = verdicts()
    expect(carrierGap(index, map.get('r.none'))).toBe('；承载（直接）缺 C → A的操作')
    expect(carrierGap(index, map.get('r.direct'))).toBe('')
    const unconfirmed = report.issues.find(i => i.code === 'fact.unconfirmed' && i.message.includes('r.none'))!
    expect(unconfirmed.severity).toBe('warning')
    expect(unconfirmed.message).toContain('承载（直接）缺 C → A的操作')
    expect(src).toBeDefined()
  })
})

describe('M21 通道的契约模块、M22 束内没写接口', () => {
  it('parseVia：channel:<名>@<模块 ID> 给出通道名与契约模块，旧写法不变；viaLabel 带契约', () => {
    expect(parseVia('channel:ws@ctr')).toEqual({ kind: 'channel', target: 'ws@ctr', name: 'ws', contract: 'ctr' })
    expect(parseVia('channel:http')).toEqual({ kind: 'channel', target: 'http' })
    const { index } = setup()
    expect(viaLabel('channel:ws@ctr', index)).toBe('ws（契约 Ctr）')
  })

  it('契约模块不存在时提醒并按不写契约读取；同一对端点同一种类两条以上没写接口时 info 提示', () => {
    const { index, issues } = loadModel([
      { path: 'system.yaml', text: 'system: { id: sys, name: Sys }' },
      { path: 'modules.yaml', text: MODEL.replace("'channel:ws@ctr'", "'channel:ws@nope'") },
    ])
    expect(index.relations.get('r.ch')!.via).toBe('channel:ws')
    expect(issues.some(i => i.code === 'relation.via-target' && i.message.includes('M21'))).toBe(true)
    const m22 = issues.filter(i => i.code === 'relation.indistinct')
    expect(m22.map(i => i.severity)).toEqual(['info', 'info'])
    expect(m22[0].message).toContain('「r.loose1」、「r.loose2」')
    expect(m22[1].message).toContain('「r.ch」、「r.ext」')
  })
})

describe('D7、D8 交互束按表面散开', () => {
  it('按 relation.interface 接到接收方表面的元素，没写接口的接到模块本体；同步 / 异步不一致标混合', () => {
    const { index, report, src } = setup()
    const s = surfaceOf(index, src, 'lib', report)
    const b = interactionBundle(index, s, ['r.direct', 'r.loose1', 'r.loose2'])
    expect(b.items.map(i => `${i.relation}:${i.element?.name ?? '-'}`)).toEqual(['r.direct:run', 'r.loose1:-', 'r.loose2:-'])
    expect(b.mixed).toEqual({ mode: true })
    expect(b.unnamed).toBe(2)
    expect(interactionBundle(index, null, ['r.direct']).items[0].element).toBeNull()
  })
})
