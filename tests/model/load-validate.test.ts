import { describe, expect, it } from 'vitest'
import { VIA_LABELS, isCoreBetween, load, loadModel, parseVia, scenarioKind, sketchCheck, unclassifiedRelations, validate, viaLabel, type Issue } from '../../src/model'
import { sampleFiles } from '../fixtures/sample'

/** 只看错误与提醒：info（如未分类，M17）不计入 */
const real = <T extends { severity: string }>(issues: T[]) => issues.filter(i => i.severity !== 'info')
const codes = (issues: { code: string; severity: string }[]) => real(issues).map(i => i.code)

describe('load', () => {
  it('合并多个文件：系统、模块树、关系、接口、数据结构', () => {
    const { model, issues } = load(sampleFiles())
    expect(issues).toEqual([])
    expect(model.system).toMatchObject({ id: 'sys', source: { commit: 'abc123' } })
    expect(model.modules.map(m => m.id)).toContain('infra.framework.sm')
    expect(model.modules.find(m => m.id === 'infra')!.parentId).toBe('sys')
    expect(model.modules.find(m => m.id === 'infra.framework.sm')!.parentId).toBe('infra.framework')
    expect(model.relations.find(r => r.id === 'r6')!.payload).toEqual(['ds.cmd'])
    expect(model.relations.find(r => r.id === 'r1')!.payload).toEqual([])
  })

  it('记录实体出处（文件、路径、行号）', () => {
    const { model } = load(sampleFiles())
    const sm = model.modules.find(m => m.id === 'infra.framework.sm')!
    expect(sm.src).toMatchObject({ file: 'modules/infra.yaml', path: 'module.children.1.children.0' })
    expect(sm.src.line).toBe(19)
  })

  it('YAML 语法错误：报行号，跳过该文件', () => {
    const { model, issues } = load(sampleFiles({ 'bad.yaml': 'modules:\n  - id: x\n   name: [' }))
    expect(codes(issues)).toContain('yaml-syntax')
    expect(issues[0]).toMatchObject({ file: 'bad.yaml', severity: 'error' })
    expect(issues[0].line).toBeGreaterThan(0)
    expect(model.modules.some(m => m.id === 'x')).toBe(false)
  })

  it('格式错误（不认识的字段）：定位到字段所在行，跳过该文件', () => {
    const { model, issues } = load(sampleFiles({ 'typo.yaml': 'modules:\n  - id: x\n    name: X\n    responsibilty: 拼错\n' }))
    const issue = issues.find(i => i.code === 'schema')!
    expect(issue.message).toContain('responsibilty')
    expect(issue).toMatchObject({ file: 'typo.yaml', path: 'modules.0', line: 2 })
    expect(model.modules.some(m => m.id === 'x')).toBe(false)
  })

  it('M12：旧名 event 映射为 notifies 并翻转两端，dataflow 映射为 streams；各报一条迁移提醒（带行号）', () => {
    const { model, issues } = load(
      sampleFiles({
        'old.yaml': [
          'relations:',
          '  - { id: ro1, from: infra.player, to: infra.framework.sm, type: event, mode: async }',
          '  - { id: ro2, from: infra.framework.pipeline, to: infra.mus, type: dataflow }',
        ].join('\n'),
      }),
    )
    expect(model.relations.find(r => r.id === 'ro1')).toMatchObject({ type: 'notifies', from: 'infra.framework.sm', to: 'infra.player' })
    expect(model.relations.find(r => r.id === 'ro2')).toMatchObject({ type: 'streams', from: 'infra.framework.pipeline', to: 'infra.mus' })
    const renamed = issues.filter(i => i.code === 'relation-type-renamed')
    expect(renamed.map(i => [i.severity, i.file, i.line])).toEqual([
      ['warning', 'old.yaml', 2],
      ['warning', 'old.yaml', 3],
    ])
    expect(renamed[0].message).toContain('notifies')
  })

  it('M12：未知类型仍是格式错误，提示四类交互（ADR-0029）', () => {
    const bad = load(sampleFiles({ 'b.yaml': 'relations:\n  - { id: rb, from: infra.player, to: infra.mus, type: emits }\n' }))
    expect(bad.issues.find(i => i.code === 'schema')!.message).toContain('queries / commands / notifies / streams')
  })

  it('M20：via 只收四形态（port: / bus: / channel:）与旧的平铺取值，其余为格式错误；Loader 原样读入，由 Validator 映射', () => {
    expect(load(sampleFiles({ 'p.yaml': 'relations:\n  - { id: rp2, from: infra.framework.pipeline, to: infra.mus, type: streams, via: port }\n' })).issues).toEqual([])
    const ok = load(sampleFiles({ 'v.yaml': 'relations:\n  - { id: rv, from: infra.framework.sm, to: infra.framework.pipeline, type: calls, via: http }\n' }))
    expect(ok.issues).toEqual([])
    expect(ok.model.relations.find(r => r.id === 'rv')!.via).toBe('http')
    const bad = load(sampleFiles({ 'v.yaml': 'relations:\n  - { id: rv, from: infra.framework.sm, to: infra.framework.pipeline, type: calls, via: socket }\n' }))
    expect(bad.issues.find(i => i.code === 'schema')).toMatchObject({ file: 'v.yaml' })
    expect(bad.model.relations.some(r => r.id === 'rv')).toBe(false)
  })

  it('system 重复声明报错；未声明时使用默认根并提醒', () => {
    expect(codes(load(sampleFiles({ 'dup.yaml': 'system: { id: other, name: O }' })).issues)).toContain('duplicate-system')
    const { model, issues } = load([{ path: 'a.yaml', text: 'module: { id: a, name: A, responsibility: x }' }])
    expect(codes(issues)).toEqual(['missing-system'])
    expect(model.modules[0].parentId).toBe('system')
  })

  it('内联子模块上的 parent 字段被忽略并提醒', () => {
    const text = 'module:\n  id: a\n  name: A\n  children:\n    - { id: b, name: B, parent: zzz }\n'
    const { model, issues } = load([{ path: 'a.yaml', text }])
    expect(codes(issues)).toContain('nested-parent-ignored')
    expect(model.modules.find(m => m.id === 'b')!.parentId).toBe('a')
  })

  it('空文件不报错', () => {
    expect(load(sampleFiles({ 'empty.yaml': '# 只有注释\n' })).issues).toEqual([])
  })
})

describe('validate', () => {
  const run = (extra: Record<string, string>) => validate(load(sampleFiles(extra)).model)

  it('样例模型没有问题（未分类只提示，M17）', () => {
    expect(real(run({}).issues)).toEqual([])
  })

  it('模块 ID 重复：报错并保留首次定义', () => {
    const { model, issues } = run({ 'z.yaml': 'modules: [{ id: infra.mus, name: Dup, parent: app, responsibility: x }]' })
    expect(codes(issues)).toEqual(['duplicate-module'])
    expect(model.modules.find(m => m.id === 'infra.mus')!.name).toBe('MUs')
  })

  it('父模块不存在：剔除该模块及其后代，只对根因报一次', () => {
    const text = 'module:\n  id: orphan\n  name: O\n  parent: nope\n  responsibility: x\n  children: [{ id: orphan.kid, name: K, responsibility: x }]\n'
    const { model, issues } = run({ 'z.yaml': text })
    expect(codes(issues)).toEqual(['unknown-parent'])
    expect(model.modules.some(m => m.id.startsWith('orphan'))).toBe(false)
  })

  it('父链成环：剔除环上模块', () => {
    const text = 'modules:\n  - { id: c1, name: C1, parent: c2, responsibility: x }\n  - { id: c2, name: C2, parent: c1, responsibility: x }\n'
    const { model, issues } = run({ 'z.yaml': text })
    expect(codes(issues)).toContain('parent-cycle')
    expect(model.modules.some(m => m.id === 'c1' || m.id === 'c2')).toBe(false)
  })

  it('关系：端点不存在、自环、祖先与后代、ID 重复都会被剔除', () => {
    const text = [
      'relations:',
      '  - { id: x1, from: nope, to: app, type: calls }',
      '  - { id: x2, from: app, to: app, type: calls }',
      '  - { id: x3, from: infra.framework, to: infra.framework.sm, type: calls }',
      '  - { id: r1, from: app, to: domain, type: calls }',
    ].join('\n')
    const { model, issues } = run({ 'z.yaml': text })
    expect(codes(issues)).toEqual(['unknown-endpoint', 'self-relation', 'ancestor-relation', 'duplicate-relation'])
    expect(model.relations.map(r => r.id)).toEqual(['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7'])
  })

  it('引用不存在的接口 / 数据结构：提醒并去掉该引用，实体保留', () => {
    const text = [
      'modules: [{ id: m1, name: M1, parent: app, responsibility: x, provides: [if.sm, if.none], dataStructures: [ds.none] }]',
      'relations: [{ id: x1, from: m1, to: domain, type: calls, interface: if.none, payload: [ds.cmd, ds.none] }]',
    ].join('\n')
    const { model, issues } = run({ 'z.yaml': text })
    expect(real(issues).every(i => i.severity === 'warning')).toBe(true)
    expect(model.modules.find(m => m.id === 'm1')).toMatchObject({ provides: ['if.sm'], dataStructures: [] })
    expect(model.relations.find(r => r.id === 'x1')).toMatchObject({ interface: undefined, payload: ['ds.cmd'] })
  })

  it('层：缺 order / abstraction、mayDependOn 指向非同级层、同级混入非层模块', () => {
    const bad = validate(load([
      { path: 's.yaml', text: 'system: { id: s, name: S }' },
      { path: 'l.yaml', text: 'modules:\n  - { id: l1, name: L1, kind: layer, responsibility: x, mayDependOn: [l2, zz] }\n  - { id: l2, name: L2, kind: layer, order: 2, abstraction: y, responsibility: x }' },
    ]).model)
    expect(codes(bad.issues).sort()).toEqual(['layer-missing-abstraction', 'layer-missing-order', 'unknown-layer'])
    expect(bad.model.modules.find(m => m.id === 'l1')!.mayDependOn).toEqual(['l2'])

    const mixed = run({ 'z.yaml': 'modules: [{ id: misc, name: Misc, responsibility: x }]' })
    expect(codes(mixed.issues)).toEqual(['mixed-layer-siblings'])
  })

  it('M13：pull 只对 streams 有意义，写在其他类型上提醒并去掉', () => {
    const ok = loadModel(sampleFiles({ 'p.yaml': 'relations:\n  - { id: rq, from: infra.mus, to: infra.framework.pipeline, type: streams, pull: true }\n' }))
    expect(real(ok.issues)).toEqual([])
    expect(ok.index.relations.get('rq')!.pull).toBe(true)
    const bad = loadModel(sampleFiles({ 'p.yaml': 'relations:\n  - { id: rq, from: infra.mus, to: infra.framework.pipeline, type: calls, pull: true }\n' }))
    expect(codes(bad.issues)).toEqual(['pull-not-streams'])
    expect(bad.index.relations.get('rq')!.pull).toBeUndefined()
  })

  it('职责为空时提醒', () => {
    expect(codes(run({ 'z.yaml': 'modules: [{ id: m1, name: M1, parent: app }]' }).issues)).toEqual(['missing-responsibility'])
  })
})

describe('loadModel', () => {
  it('串起 load → validate → buildIndex，汇总问题', () => {
    const { index, issues } = loadModel(sampleFiles({ 'z.yaml': 'relations: [{ id: x1, from: nope, to: app, type: calls }]' }))
    expect(codes(issues)).toEqual(['unknown-endpoint'])
    expect(index.rootId).toBe('sys')
    expect(index.childrenOf.get('sys')).toEqual(['infra', 'app', 'domain'])
    expect(index.pathOf.get('infra.framework.sm')).toEqual(['sys', 'infra', 'infra.framework', 'infra.framework.sm'])
    expect(index.outRelations.get('infra.framework.sm')).toEqual(['r1', 'r6'])
  })

  it('层按 order 排序，与文件顺序无关', () => {
    const { index } = loadModel(sampleFiles({ 'modules/app-domain.yaml': sampleFiles().find(f => f.path === 'modules/app-domain.yaml')!.text.replace('order: 2', 'order: 0') }))
    expect(index.childrenOf.get('sys')).toEqual(['app', 'infra', 'domain'])
  })
})

describe('M16 role 字段与旧写法 core 的迁移', () => {
  const files = (extra: Record<string, string> = {}) =>
    Object.entries({ 'system.yaml': 'system: { id: s, name: S }', ...extra }).map(([path, text]) => ({ path, text }))
  it('core: true 映射为 role: core 并提醒（带行号）；core: false 去掉；与 role 同写时以 role 为准；role 其余取值为格式错误', () => {
    const { index, issues } = loadModel(
      files({
        'modules/a.yaml':
          'modules:\n  - id: a\n    name: A\n    core: true\n    children:\n      - { id: a.x, name: X, core: false }\n      - { id: a.y, name: Y, core: true, role: shared }\n',
        'modules/b.yaml': 'modules:\n  - { id: b, name: B, role: boss }\n',
      }),
    )
    expect(index.modules.get('a')!.role).toBe('core')
    expect(index.modules.get('a.x')!.role).toBeUndefined()
    expect(index.modules.get('a.y')!.role).toBe('shared')
    expect('core' in index.modules.get('a')!).toBe(false)
    const legacy = issues.filter(i => i.code === 'module.core-legacy')
    expect(legacy.map(i => [i.line, i.message.includes('以 role 为准')])).toEqual([
      [4, false],
      [7, true],
    ])
    expect(issues.some(i => i.code === 'schema' && i.file === 'modules/b.yaml')).toBe(true)
  })

  it('intent/roles.yaml 作为 role 的来源：草图写了的以草图为准（不同时提醒），没写的取它；不存在的模块提醒；核验不把它当草图偏差', () => {
    const { index, issues } = loadModel(
      files({
        'intent/skeleton.yaml': 'sketch:\n  id: skeleton\n  mount: root\n  modules:\n    - { id: l, name: L, kind: layer, order: 1, children: [{ id: l.a, name: A, role: core }, { id: l.b, name: B }] }\n',
        'intent/roles.yaml': 'roles:\n  l.a: shared\n  l.b: shared\n  l.c: core\n  nope: bus\n',
        'modules/l.yaml': 'modules:\n  - { id: l.c, name: C, parent: l }\n',
      }),
    )
    expect(['l.a', 'l.b', 'l.c'].map(id => index.modules.get(id)!.role)).toEqual(['core', 'shared', 'core'])
    expect(index.modules.get('l.b')!.roleFrom).toBe('roles')
    expect(issues.filter(i => i.code.startsWith('roles.')).map(i => [i.code, i.line])).toEqual([
      ['roles.shadowed', 2],
      ['roles.unknown-module', 5],
    ])
    expect(sketchCheck(index.model.sketches[0], index).deviations.filter(d => d.code === 'sketch.field')).toEqual([])
    // 只有草图的版本（没有 modules/，DV-10）本来只画一部分模块：指向本版本没有的模块不提醒
    const sketchOnly = loadModel(
      files({
        'intent/skeleton.yaml': 'sketch:\n  id: skeleton\n  mount: root\n  modules:\n    - { id: l, name: L, kind: layer, order: 1, children: [{ id: l.a, name: A }] }\n',
        'intent/roles.yaml': 'roles:\n  l.a: shared\n  l.a.deep: core\n',
      }),
    )
    expect(sketchOnly.index.modules.get('l.a')!.role).toBe('shared')
    expect(sketchOnly.issues.filter(i => i.code === 'roles.unknown-module')).toEqual([])
  })
})

describe('第六轮：四类交互、via、端口实体、角色与场景类别（ADR-0029、ADR-0030）', () => {
  const lm = (yaml: string, name = 'z.yaml') => loadModel(sampleFiles({ [name]: yaml }))
  const issuesOf = (r: { issues: Issue[] }, code: string) => r.issues.filter(i => i.code === code)

  it('四类交互照常读入，mode 只用于查询与委托（查询可异步，T0 裁决 1）', () => {
    const r = lm(
      [
        'relations:',
        '  - { id: q1, from: app.solution, to: domain.models, type: queries, mode: async }',
        '  - { id: c1, from: app.solution, to: domain.services, type: commands, mode: async }',
        '  - { id: n1, from: domain.services, to: app.fragments, type: notifies }',
      ].join('\n'),
    )
    expect(real(r.issues)).toEqual([])
    expect(['q1', 'c1', 'n1'].map(id => [r.index.relations.get(id)!.type, r.index.relations.get(id)!.mode])).toEqual([
      ['queries', 'async'],
      ['commands', 'async'],
      ['notifies', undefined],
    ])
  })

  it('M13：notifies / streams 写了 mode 提醒 relation.mode-ignored 并去掉（通知一律异步、流不比）', () => {
    const r = lm(
      [
        'relations:',
        '  - { id: n1, from: domain.services, to: app.fragments, type: notifies, mode: async }',
        '  - { id: s1, from: infra.framework.pipeline, to: infra.mus, type: streams, mode: sync }',
        '  - { id: q1, from: app.solution, to: domain.models, type: queries, mode: sync }',
      ].join('\n'),
    )
    expect(issuesOf(r, 'relation.mode-ignored').map(i => [i.severity, i.line])).toEqual([
      ['warning', 2],
      ['warning', 3],
    ])
    expect([r.index.relations.get('n1')!.mode, r.index.relations.get('s1')!.mode, r.index.relations.get('q1')!.mode]).toEqual([undefined, undefined, 'sync'])
  })

  it('M17：calls 读作未分类——留在索引里，提示 relation.unclassified（info，带行号，不是错误也不是提醒）', () => {
    const r = lm('relations:\n  - { id: u1, from: app.fragments, to: domain.services, type: calls }\n')
    expect(r.index.relations.get('u1')!.type).toBe('calls')
    const u = issuesOf(r, 'relation.unclassified').find(i => i.message.includes('u1'))!
    expect(u).toMatchObject({ severity: 'info', file: 'z.yaml', line: 2 })
    // 样例里的三条 calls 同样只提示
    expect(issuesOf(r, 'relation.unclassified')).toHaveLength(4)
  })

  it('M17：迁移完成后（第六轮 T2）implements 为格式错误（M1）：整份文件跳过，实现者写在接口的 implementedBy', () => {
    const r = lm('relations:\n  - { id: ri, from: infra.mus, to: infra.framework, type: implements, interface: if.sm }\n')
    expect(r.index.relations.has('ri')).toBe(false)
    expect(issuesOf(r, 'schema').map(i => [i.severity, i.file])).toEqual([['error', 'z.yaml']])
    expect(issuesOf(r, 'relation.implements-migrated')).toEqual([])
    // 写在接口上的实现者照常读取
    const ok = lm('interfaces:\n  - { id: if.x, name: X, owner: infra.framework, implementedBy: [infra.mus] }\n')
    expect(ok.index.interfaces.get('if.x')!.implementedBy).toEqual(['infra.mus'])
  })

  it('M18：implementedBy 每项须是存在的模块（参与者不可），不是时提醒并去掉；重复的去重', () => {
    const r = lm(
      'actors:\n  - { id: actor.u, name: U, kind: user }\ninterfaces:\n  - { id: if.p, name: P, owner: domain.services, implementedBy: [app.fragments, nope, actor.u, app.fragments] }\n',
    )
    expect(r.index.interfaces.get('if.p')!.implementedBy).toEqual(['app.fragments'])
    expect(issuesOf(r, 'unknown-implementer').map(i => i.severity)).toEqual(['warning', 'warning'])
  })

  it('M20：旧的平铺 via 读成四形态并提醒 relation.via-legacy——通道五个、port 为端口未指明、bus 恰有一个总线模块时读作它', () => {
    const rel = (id: string, via: string, type = 'calls') => `  - { id: ${id}, from: app.fragments, to: domain.services, type: ${type}, via: ${via} }`
    const r = lm(['relations:', rel('v1', 'http'), rel('v2', 'hmr'), rel('v3', 'inject'), rel('v4', 'router'), rel('v5', 'callback'), rel('v6', 'port'), rel('v7', 'bus', 'notifies')].join('\n'))
    expect(['v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7'].map(id => r.index.relations.get(id)!.via)).toEqual([
      'channel:http',
      'channel:hmr',
      'channel:inject',
      'channel:router',
      'channel:callback',
      'port',
      'bus',
    ])
    expect(issuesOf(r, 'relation.via-legacy')).toHaveLength(7)
    // 恰有一个总线模块：bus 读作 bus:<它>
    const withBus = lm(['modules:\n  - { id: domain.bus, name: Bus, parent: domain, role: bus, responsibility: x }', 'relations:', rel('v7', 'bus', 'notifies')].join('\n'))
    expect(withBus.index.relations.get('v7')!.via).toBe('bus:domain.bus')
  })

  it('M11：via 的目标须存在且对路——port:<P> 须是已声明的接口，bus:<M> 须是 role: bus 的模块；否则提醒 relation.via-target 并去掉 via', () => {
    const r = lm(
      [
        'modules:\n  - { id: domain.bus, name: Bus, parent: domain, role: bus, responsibility: x }',
        'relations:',
        "  - { id: p1, from: app.fragments, to: domain.models, type: commands, via: 'port:if.model' }",
        "  - { id: p2, from: app.fragments, to: domain.models, type: commands, via: 'port:if.none' }",
        "  - { id: b1, from: app.fragments, to: domain.services, type: notifies, via: 'bus:domain.bus' }",
        "  - { id: b2, from: app.fragments, to: domain.services, type: notifies, via: 'bus:domain.models' }",
        "  - { id: h1, from: app.fragments, to: domain.services, type: commands, via: 'channel:postMessage' }",
      ].join('\n'),
    )
    expect(['p1', 'p2', 'b1', 'b2', 'h1'].map(id => r.index.relations.get(id)!.via)).toEqual(['port:if.model', undefined, 'bus:domain.bus', undefined, 'channel:postMessage'])
    expect(issuesOf(r, 'relation.via-target').map(i => i.line)).toEqual([5, 7])
    expect(load(sampleFiles({ 'z.yaml': "relations:\n  - { id: x, from: app.fragments, to: domain.models, type: commands, via: 'socket:x' }\n" })).issues[0].code).toBe('schema')
  })

  it('裁决 4：被 via: port: 引用、或描述写了实现者的接口才算端口（port），其余接口只是对外能力；port 不参与版本对比', () => {
    const r = lm("relations:\n  - { id: p1, from: app.fragments, to: domain.models, type: commands, via: 'port:if.sm' }\n")
    expect(['if.sm', 'if.plan', 'if.model'].map(id => !!r.index.interfaces.get(id)!.port)).toEqual([true, true, true])
    const plain = lm('interfaces:\n  - { id: if.x, name: X, owner: domain.services }\n')
    expect(plain.index.interfaces.get('if.x')!.port).toBeUndefined()
    expect(plain.index.interfaces.get('if.sm')!.port).toBeUndefined()
  })

  it('M14：总线作通知端点的报错提示改写为 via: bus:<总线模块>', () => {
    const r = lm('modules:\n  - { id: domain.bus, name: Bus, parent: domain, role: bus, responsibility: x }\nrelations:\n  - { id: n, from: domain.bus, to: app.fragments, type: notifies }\n')
    expect(issuesOf(r, 'relation.bus-endpoint')[0].message).toContain("via: 'bus:domain.bus'")
  })

  it('M16：role 取值加 port / adapter（ADR-0030），roles.yaml 同样可写；其余为格式错误', () => {
    const r = loadModel([
      { path: 'system.yaml', text: 'system: { id: s, name: S }' },
      { path: 'modules/a.yaml', text: 'modules:\n  - { id: a, name: A, role: port }\n  - { id: b, name: B }\n' },
      { path: 'intent/roles.yaml', text: 'roles:\n  b: adapter\n' },
    ])
    expect([r.index.modules.get('a')!.role, r.index.modules.get('b')!.role]).toEqual(['port', 'adapter'])
    expect(real(r.issues).filter(i => i.code === 'schema')).toEqual([])
  })

  it('M19：场景 kind 取 main / exception / maintenance，缺省 main；其余为格式错误', () => {
    const sc = (kind?: string) =>
      `scenario:\n  id: sc.k\n  name: K\n${kind ? `  kind: ${kind}\n` : ''}  steps:\n    - call: { from: app.solution, to: domain.services }\n`
    expect(scenarioKind(lm(sc()).index.scenarios.get('sc.k')!)).toBe('main')
    expect(scenarioKind(lm(sc('exception')).index.scenarios.get('sc.k')!)).toBe('exception')
    expect(scenarioKind(lm(sc('maintenance')).index.scenarios.get('sc.k')!)).toBe('maintenance')
    const bad = load(sampleFiles({ 's.yaml': sc('weird') }))
    expect(bad.issues.map(i => i.code)).toEqual(['schema'])
  })

  it('M17、裁决 12：核心之间——两端各在某核心子树内、且不在同一个核心子树内；摘要「未分类 N（核心之间 M）」', () => {
    const r = lm(
      [
        'relations:',
        '  - { id: u1, from: infra.framework.pipeline, to: domain.services, type: calls }', // 核心 framework → 核心 services
        '  - { id: u2, from: infra.framework.pipeline, to: infra.framework.sm, type: calls }', // 同一核心 framework 内
        '  - { id: u3, from: app.fragments, to: domain.services, type: calls }', // fragments 不是核心
      ].join('\n'),
    )
    expect(isCoreBetween(r.index, r.index.relations.get('u1')!)).toBe(true)
    expect(isCoreBetween(r.index, r.index.relations.get('u2')!)).toBe(false)
    expect(isCoreBetween(r.index, r.index.relations.get('u3')!)).toBe(false)
    const { all, core } = unclassifiedRelations(r.index)
    // 样例：r1 sm（核心 framework 内）→ solution（核心）、r2 solution（核心）→ services（核心）、r6 sm → pipeline（同一核心内）
    expect(all.map(x => x.id)).toEqual(['r1', 'r2', 'r6', 'u1', 'u2', 'u3'])
    expect(core.map(x => x.id)).toEqual(['r1', 'r2', 'u1'])
  })

  it('parseVia 与 viaLabel：四形态与迁移期的未指明', () => {
    expect([parseVia('port:if.a'), parseVia('bus:m'), parseVia('channel:http'), parseVia('port'), parseVia('http')]).toEqual([
      { kind: 'port', target: 'if.a' },
      { kind: 'bus', target: 'm' },
      { kind: 'channel', target: 'http' },
      { kind: 'port' },
      undefined,
    ])
    const { index } = loadModel(sampleFiles())
    expect([viaLabel('port:if.sm', index), viaLabel('channel:http'), viaLabel('channel:ws'), viaLabel('port'), viaLabel('bus:infra.mus', index)]).toEqual([
      '端口 sendCommand',
      'HTTP',
      'ws',
      '端口（未指明）',
      '总线 MUs',
    ])
    expect(VIA_LABELS['channel:hmr']).toBe('HMR 事件')
  })
})
