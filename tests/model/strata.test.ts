/**
 * 层是分类，不是节点（ADR-0052）：strata / stratum 的读入与校验（ST-6）、旧写法迁移（M26）、任意层级的层规则（U2）、
 * 分层总览的带（O1、O2、O2a）、ST-3–ST-5 的提示、确认指纹（Z2）与草图编辑的级联。
 */
import { describe, expect, it } from 'vitest'
import {
  applyDesignEdit,
  applyEdit,
  loadModel,
  placeSuggestion,
  projectLevel,
  reviewSummary,
  strataFindings,
  stratumKey,
  validateSketch,
  type FileDep,
  type GovernanceReport,
  type ModuleDep,
  type SketchDef,
} from '../../src/model'
import { parse } from 'yaml'
import { sketchText, stratumOfMember } from '../../src/model/intent'
import { layerJudgement } from '../../src/model/governance/rules'

const SYSTEM = 'system: { id: sys, name: S }'
const files = (text: string, extra: Record<string, string> = {}) =>
  Object.entries({ 'system.yaml': SYSTEM, 'm.yaml': text, ...extra }).map(([path, t]) => ({ path, text: t }))
const codes = (issues: { code: string; severity: string }[]) => issues.filter(i => i.severity !== 'info').map(i => `${i.severity}:${i.code}`)

const APP = `
modules:
  - id: app
    name: App
    responsibility: 应用
    children:
      - { id: app.ui, name: UI, role: core, stratum: top, responsibility: 界面 }
      - { id: app.cli, name: CLI, stratum: top, responsibility: 命令行 }
      - { id: app.core, name: Core, role: core, responsibility: 内核 }
      - { id: app.util, name: Util, responsibility: 工具 }
strata:
  app:
    - { id: top, name: 入口, order: 1, asks: 从哪进来？, admits: 它只接用户？, mayDependOn: [base] }
    - { id: base, name: 基础, order: 2, asks: 靠什么？, admits: 它不认识入口？, mayDependOn: [], singular: 只是示例, members: [app.core, app.util] }
`

describe('ST-6 声明的读入与校验', () => {
  it('members 与子模块的 stratum 两种写法归一；子模块按层序排列；层不占级', () => {
    const { index, issues } = loadModel(files(APP))
    expect(codes(issues)).toEqual([])
    expect(index.strata.get('app')!.map(s => [s.id, s.members])).toEqual([
      ['top', ['app.ui', 'app.cli']],
      ['base', ['app.core', 'app.util']],
    ])
    expect(index.stratumOf.get('app.cli')!.id).toBe('top')
    expect(index.pathOf.get('app.core')).toEqual(['sys', 'app', 'app.core'])
    expect(stratumKey(index, index.stratumOf.get('app.ui')!)).toBe('app/top')
  })

  it('全有或全无：没归层、归多层、引用不存在的层或非直接子模块为错误；缺 asks / admits 只提示', () => {
    const bad = APP.replace('stratum: top, responsibility: 命令行', 'responsibility: 命令行')
      .replace('members: [app.core, app.util]', 'members: [app.core, app.util, app.ui, zz]')
      .replace('mayDependOn: [base]', 'mayDependOn: [base, nope]')
      .replace('asks: 从哪进来？, ', '')
    const { issues } = loadModel(files(bad))
    expect(codes(issues).sort()).toEqual(['error:stratum.missing', 'error:stratum.multiple', 'error:stratum.unknown', 'warning:stratum.member-missing'])
    expect(issues.find(i => i.code === 'stratum.principle-missing')!.severity).toBe('info')
  })

  it('同一父模块草图写了的以草图为准：intent/strata.yaml 的不生效（info）', () => {
    const sketch = `sketch:\n  id: skeleton\n  mount: root\n  modules:\n    - { id: app, name: App, responsibility: 应用, children: [{ id: app.ui, name: UI, stratum: one }, { id: app.cli, name: CLI, stratum: one }, { id: app.core, name: Core, stratum: one }, { id: app.util, name: Util, stratum: one }] }\n  strata:\n    app:\n      - { id: one, name: 一层, asks: 问, admits: 判 }\n`
    const { index, issues } = loadModel(files('', { 'intent/skeleton.yaml': sketch, 'intent/strata.yaml': APP.slice(APP.indexOf('strata:')) }))
    expect(index.strata.get('app')!.map(s => s.id)).toEqual(['one'])
    expect(issues.some(i => i.code === 'stratum.shadowed' && i.severity === 'info')).toBe(true)
  })
})

describe('ST-6 只有草图的版本（DV-10）带来的 intent/strata.yaml', () => {
  // 草图作为版本：当前版本的 system.yaml + intent/** + 设计的草图，没有 modules/
  const STRATA = `strata:\n  app:\n    - { id: top, name: 入口, asks: 问, admits: 判, members: [app.ui, app.cli] }\n    - { id: base, name: 基础, asks: 问, admits: 判, members: [app.core] }\n  gone:\n    - { id: x, name: X, asks: 问, admits: 判, members: [gone.a] }\n`
  const version = (kids: string) =>
    loadModel([
      { path: 'system.yaml', text: SYSTEM },
      { path: 'intent/strata.yaml', text: STRATA },
      { path: 'sketches/root.yaml', text: `sketch:\n  id: d\n  mount: root\n  modules:\n    - { id: app, name: App, responsibility: 应用, children: [${kids}] }\n` },
    ])
  const real = (issues: { code: string; severity: string }[]) => issues.filter(i => i.severity !== 'info').map(i => i.code)

  it('父模块与缺的成员不在本版本里不提醒；剩下的成员仍覆盖全部子模块时照用', () => {
    const { index, issues } = version('{ id: app.ui, name: UI, responsibility: u }, { id: app.core, name: Core, responsibility: c }')
    expect(real(issues)).toEqual([])
    expect(index.strata.get('app')!.map(s => [s.id, s.members])).toEqual([
      ['top', ['app.ui']],
      ['base', ['app.core']],
    ])
    expect(index.strata.has('gone')).toBe(false)
  })

  it('设计在这一层加了不在任何一层的子模块：本版本不用这份声明（info），不报全有或全无', () => {
    const { index, issues } = version('{ id: app.ui, name: UI, responsibility: u }, { id: app.core, name: Core, responsibility: c }, { id: app.edit, name: Edit, responsibility: e }')
    expect(real(issues)).toEqual([])
    expect(issues.find(i => i.code === 'stratum.not-inherited')!.severity).toBe('info')
    expect(index.strata.has('app')).toBe(false)
  })

  it('当前版本（有 modules/）照常提醒父模块不存在', () => {
    const { issues } = loadModel(files(APP, { 'modules/x.yaml': 'modules: []', 'intent/strata.yaml': STRATA.slice(STRATA.indexOf('  gone:')).replace(/^/, 'strata:\n') }))
    expect(real(issues)).toContain('stratum.parent-missing')
  })
})

describe('M26 旧写法迁移', () => {
  it('非根层级的 kind: layer 溶解：成员上提一级、层变成父模块的层（局部 ID 去前缀），提醒 layer.nested', () => {
    const text = `modules:\n  - id: m\n    name: M\n    children:\n      - { id: m.hi, name: 上, kind: layer, order: 1, mayDependOn: [m.lo], children: [{ id: m.a, name: A }] }\n      - { id: m.lo, name: 下, kind: layer, order: 2, children: [{ id: m.b, name: B }, { id: m.c, name: C }] }\n`
    const { index, issues } = loadModel(files(text))
    expect(issues.filter(i => i.code === 'layer.nested')).toHaveLength(2)
    expect(index.childrenOf.get('m')).toEqual(['m.a', 'm.b', 'm.c'])
    expect(index.modules.has('m.hi')).toBe(false)
    expect(index.strata.get('m')!.map(s => [s.id, s.mayDependOn, s.members])).toEqual([
      ['hi', ['lo'], ['m.a']],
      ['lo', undefined, ['m.b', 'm.c']],
    ])
  })
})

describe('U2 任意层级的层规则', () => {
  it('最近公共祖先声明了分层：同层或在 mayDependOn 里才允许；兄弟的后代按所在的子模块判', () => {
    const { index } = loadModel(files(APP.replace('{ id: app.core, name: Core, role: core, responsibility: 内核 }', '{ id: app.core, name: Core, role: core, responsibility: 内核, children: [{ id: app.core.x, name: X }] }')))
    expect(layerJudgement(index, 'app.ui', 'app.core.x')).toMatchObject({ allowed: true })
    expect(layerJudgement(index, 'app.core.x', 'app.ui')).toMatchObject({ allowed: false })
    expect(layerJudgement(index, 'app.ui', 'app.cli')).toMatchObject({ allowed: true })
    // 祖先与后代之间、没有分层的父模块下不判
    expect(layerJudgement(index, 'app', 'app.ui')).toBeNull()
  })
})

describe('O1、O2、O2a 分层总览的带', () => {
  it('多成员层的带节点为 s:<父模块>/<层>，带内画成员（不超七全显）；成员的边映射到带', () => {
    const view = projectLevel(loadModel(files(APP + 'relations:\n  - { id: r1, from: app.cli, to: app.util, type: queries }\n')).index, 'app')
    expect(view.mode).toBe('layered')
    expect(view.bands!.map(b => [b.layerId, b.coreModuleIds, b.hiddenCount])).toEqual([
      ['s:app/top', ['app.ui', 'app.cli'], 0],
      ['s:app/base', ['app.core', 'app.util'], 0],
    ])
    expect(view.edges.map(e => e.id)).toEqual(['s:app/top->s:app/base:queries'])
    expect(view.alias).toMatchObject({ 'app.cli': 's:app/top' })
  })

  it('多成员层超七：普通成员折成「+N」，核心常显', () => {
    const kids = Array.from({ length: 9 }, (_, i) => `      - { id: big.k${i}, name: K${i}, stratum: all${i === 0 ? ', role: core' : ''} }`).join('\n')
    const text = `modules:\n  - id: big\n    name: Big\n    children:\n${kids}\n      - { id: big.z, name: Z, stratum: other }\nstrata:\n  big:\n    - { id: all, name: 全部, order: 1 }\n    - { id: other, name: 其他, order: 2 }\n`
    const view = projectLevel(loadModel(files(text)).index, 'big')
    expect(view.bands![0]).toMatchObject({ layerId: 's:big/all', coreModuleIds: ['big.k0'], hiddenCount: 8 })
    // 单成员层的带即成员
    expect(view.bands![1].layerId).toBe('big.z')
  })
})

describe('ST-3–ST-5、ST-2', () => {
  const dep = (from: string, to: string, kind: FileDep['kind'] = 'value'): ModuleDep => ({
    key: `${from}->${to}`,
    from,
    to,
    files: [{ from: `${from}.ts`, to: `${to}.ts`, via: `${to}.ts`, kind, line: 1 }],
  })
  const report = (deps: ModuleDep[]) => ({ moduleDeps: new Map(deps.map(d => [d.key, d])) }) as Pick<GovernanceReport, 'moduleDeps'>

  it('ST-4 单成员层没写 singular 提示；ST-3 可依赖方向上下层更易变提示；ST-5 底层只引类型的向上 import 提示', () => {
    const text = APP.replace(', singular: 只是示例', '').replace('members: [app.core, app.util]', 'members: [app.core, app.util]').replace(
      '{ id: app.cli, name: CLI, stratum: top, responsibility: 命令行 }',
      '{ id: app.cli, name: CLI, stratum: top, responsibility: 命令行 }\n      - { id: app.solo, name: Solo, stratum: solo, responsibility: 独 }',
    ) + '    - { id: solo, name: 独层, order: 3, asks: 问, admits: 判 }\n'
    const { index } = loadModel(files(text))
    expect(strataFindings(index).map(f => f.issue.code)).toEqual(['stratum.singular'])
    // 下层（base）依赖上层两个模块、上层不依赖下层：base 的 I = 1、top 的 I = 0 → 逆序；底层 base 只引类型地依赖上层 → ST-5
    const r = report([dep('app.core', 'app.ui', 'type'), dep('app.util', 'app.cli', 'type')])
    expect(strataFindings(index, r).map(f => f.issue.code).sort()).toEqual(['stratum.instability-order', 'stratum.singular', 'stratum.type-upward', 'stratum.type-upward'])
  })

  it('ST-2 归属建议：各层按职责文字与原则、成员的字面重合度排序（mode strata）；没有子模块时为 null', () => {
    const { index } = loadModel(files(APP))
    const r = placeSuggestion(index, 'app', '从哪进来的入口')!
    expect(r.mode).toBe('strata')
    expect(r.candidates[0].layer).toBe('top')
    expect(placeSuggestion(index, 'app.ui', 'x')).toBeNull()
  })

  it('M33（ADR-0060）：未声明分层的父模块按子模块的一句话职责排序（mode children）；父模块否定边界带去向且与职责文字重合的直接给出去向', () => {
    const text = [
      'modules:',
      '  - id: p',
      '    name: P',
      '    responsibility: 父',
      '    excludes: [画面渲染 → p.b, 拉流]',
      '    children:',
      '      - { id: p.a, name: A, responsibility: 解码, summary: 软解视频帧 }',
      '      - { id: p.b, name: B, responsibility: 渲染, summary: 把画面渲染到画布 }',
    ].join('\n')
    const { index } = loadModel([{ path: 'm.yaml', text }])
    const r = placeSuggestion(index, 'p', '画面渲染与截图')!
    expect(r.mode).toBe('children')
    expect(r.candidates.map(c => c.layer)).toEqual(['p.b', 'p.a'])
    expect(r.candidates[0].summary).toBe('把画面渲染到画布')
    expect(r.excluded).toEqual([{ text: '画面渲染', to: 'p.b', score: expect.any(Number) }])
    expect(r.excluded[0].score).toBeGreaterThan(0)
    expect(placeSuggestion(index, 'p', '解码')!.excluded).toEqual([])
  })
})

describe('Z2 分层进父模块的指纹', () => {
  it('一层一行；没声明的模块摘要为空，旧指纹不变', () => {
    const { index } = loadModel(files(APP))
    expect(reviewSummary(index, 'app').strata).toEqual(['1 | top | 入口 | 从哪进来？ | 它只接用户？ |  | base | app.cli,app.ui', '2 | base | 基础 | 靠什么？ | 它不认识入口？ |  |  | app.core,app.util'])
    expect(reviewSummary(index, 'app.ui').strata).toEqual([])
  })
})

describe('草图里的分层（ST-6、X14）与编辑的级联', () => {
  const sketch: SketchDef = {
    id: 'd',
    mount: 'app',
    modules: [
      { id: 'app.ui', name: 'UI', responsibility: 'u' },
      { id: 'app.cli', name: 'CLI', responsibility: 'c' },
      { id: 'app.core', name: 'Core', responsibility: 'k' },
    ],
    strata: { app: [{ id: 'top', name: '入口', members: ['app.ui', 'app.cli'], mayDependOn: ['base'] }, { id: 'base', name: '基础', members: ['app.core'] }] },
  }
  const v = (def: SketchDef) => validateSketch(def, { persistent: [], file: 'designs/d/sketches/app.yaml' })

  it('引用错为格式错误，没归层为语义提示，层依赖成环提示', () => {
    expect(v(sketch).ok).toBe(true)
    expect(v({ ...sketch, strata: { app: [{ id: 'top', name: '入口', members: ['app.ui', 'app.zz'] }] } }).errors.map(e => e.code)).toEqual(['sketch.ref'])
    const partial = v({ ...sketch, strata: { app: [{ id: 'top', name: '入口', members: ['app.ui', 'app.cli'] }] } })
    expect(partial.warnings.map(w => w.code)).toEqual(['sketch.stratum'])
    const cyc = v({ ...sketch, strata: { app: [{ ...sketch.strata!.app[0] }, { id: 'base', name: '基础', members: ['app.core'], mayDependOn: ['top'] }] } })
    expect(cyc.warnings.map(w => w.code)).toEqual(['sketch.layer-cycle'])
  })

  it('删除模块：成员里去掉；合并同层的两个模块：结果留在这层，原成员去掉', () => {
    const removed = applyEdit(sketch, { op: 'removeModule', id: 'app.core' }, { persistent: [], designSketch: true })
    expect(removed.ok && removed.sketch.strata!.app.map(s => s.id)).toEqual(['top'])
    const merged = applyDesignEdit({ app: sketch }, { op: 'merge', sketch: 'app', ids: ['app.ui', 'app.cli'], name: '入口', id: 'entry' }, { design: 'd', persistent: [] })
    if (!merged.ok) throw new Error(merged.reason)
    const app = merged.design.app
    expect(app.strata!.app[0].members).toEqual([])
    expect(app.modules!.find(m => m.id === 'app.entry')).toMatchObject({ stratum: 'top' })
    expect(v(app).ok).toBe(true)
  })

  // ── DL-44：草图里指定层（ADR-0063 修订节）──
  const ctx = { persistent: [], designSketch: true }
  const added = () => {
    const r = applyEdit(sketch, { op: 'addModule', parent: 'app', name: 'Agent', id: 'app.agent' }, ctx)
    if (!r.ok) throw new Error(r.reason)
    return r.sketch
  }

  it('DL-44 setStratum：新框不属于任何一层 → 指定后写进该层 members、提示消失；换层从原层去掉；同层重设不变', () => {
    const fresh = added()
    expect(v(fresh).warnings.map(w => w.message).join()).toContain('在选中面板的「层」里指定')
    const set = applyEdit(fresh, { op: 'setStratum', id: 'app.agent', stratum: 'base' }, ctx)
    if (!set.ok) throw new Error(set.reason)
    expect(set.sketch.strata!.app.find(s => s.id === 'base')!.members).toEqual(['app.core', 'app.agent'])
    expect(v(set.sketch).ok && v(set.sketch).warnings).toEqual([])
    // 换层：从 base 去掉、进 top
    const moved = applyEdit(set.sketch, { op: 'setStratum', id: 'app.agent', stratum: 'top' }, ctx)
    if (!moved.ok) throw new Error(moved.reason)
    expect(moved.sketch.strata!.app.map(s => [s.id, s.members])).toEqual([
      ['top', ['app.ui', 'app.cli', 'app.agent']],
      ['base', ['app.core']],
    ])
    // 同层重设：内容不变
    const same = applyEdit(moved.sketch, { op: 'setStratum', id: 'app.agent', stratum: 'top' }, ctx)
    expect(same.ok && same.sketch).toEqual(moved.sketch)
    // 框自己写的 stratum 被成员写法取代
    const own: SketchDef = { ...sketch, modules: [...sketch.modules!, { id: 'app.x', name: 'X', stratum: 'top' }] }
    const conv = applyEdit(own, { op: 'setStratum', id: 'app.x', stratum: 'base' }, ctx)
    if (!conv.ok) throw new Error(conv.reason)
    expect(conv.sketch.modules!.find(m => m.id === 'app.x')!.stratum).toBeUndefined()
    expect(conv.sketch.strata!.app.find(s => s.id === 'base')!.members).toContain('app.x')
  })

  it('DL-44 setStratum 的拒绝：层不存在、框不在本草图、本草图没有分层、根草图的顶层', () => {
    const fresh = added()
    const no = (def: SketchDef, op: { id: string; stratum: string }) => {
      const r = applyEdit(def, { op: 'setStratum', ...op }, ctx)
      return r.ok ? '' : r.reason
    }
    expect(no(fresh, { id: 'app.agent', stratum: 'zz' })).toContain('没有层「zz」')
    expect(no(fresh, { id: 'app.nope', stratum: 'top' })).toContain('草图里没有模块')
    expect(no({ ...fresh, strata: undefined }, { id: 'app.agent', stratum: 'top' })).toContain('没有声明分层')
    const root: SketchDef = { id: 'skeleton', mount: 'root', modules: [{ id: 'ui', name: 'UI' }], strata: { root: [{ id: 'ui', name: 'UI', members: ['ui'] }] } }
    expect(no(root, { id: 'ui', stratum: 'ui' })).toContain('moveIn')
  })

  it('DL-44 写回草图文件：setStratum 后的 YAML 带 members，读回再校验不再提示', () => {
    const set = applyEdit(added(), { op: 'setStratum', id: 'app.agent', stratum: 'base' }, ctx)
    if (!set.ok) throw new Error(set.reason)
    const text = sketchText(set.sketch)
    expect(text).toMatch(/members:\n\s+- app\.core\n\s+- app\.agent/)
    const back = (parse(text) as { sketch: SketchDef }).sketch
    expect(v(back).warnings).toEqual([])
  })

  it('DL-44 继承：改 ID 跟着改成员；拆分各部分继承原层；合并跨层无法继承 → 提示要求指定', () => {
    const renamed = applyDesignEdit({ app: sketch }, { op: 'rename', sketch: 'app', id: 'app.core', newId: 'kernel' }, { design: 'd', persistent: [] })
    if (!renamed.ok) throw new Error(renamed.reason)
    expect(stratumOfMember(renamed.design.app, 'app', 'app.kernel')?.id).toBe('base')
    expect(v(renamed.design.app).warnings).toEqual([])
    const split = applyDesignEdit(
      { app: sketch },
      { op: 'split', sketch: 'app', id: 'app.core', parts: [{ name: '甲', id: 'k1' }, { name: '乙', id: 'k2' }] },
      { design: 'd', persistent: [] },
    )
    if (!split.ok) throw new Error(split.reason)
    expect(['app.k1', 'app.k2'].map(id => stratumOfMember(split.design.app, 'app', id)?.id)).toEqual(['base', 'base'])
    expect(v(split.design.app).warnings).toEqual([])
    const mixed = applyDesignEdit({ app: sketch }, { op: 'merge', sketch: 'app', ids: ['app.ui', 'app.core'], name: '混', id: 'mix' }, { design: 'd', persistent: [] })
    if (!mixed.ok) throw new Error(mixed.reason)
    expect(stratumOfMember(mixed.design.app, 'app', 'app.mix')).toBeUndefined()
    expect(v(mixed.design.app).warnings.map(w => w.message).join()).toContain('「层」里指定')
  })
})
