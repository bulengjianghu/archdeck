/** 架构治理 · 事实比对（K4–K7）：模块依赖、关系的证实与未证实的分档、未解释的交互 */
import { describe, expect, it } from 'vitest'
import {
  assemblyFacts,
  assignFiles,
  confirmImplementers,
  confirmRelations,
  heritageFacts,
  governanceReport,
  hostOf,
  liftDeps,
  loadModel,
  reworkList,
  undescribedDeps,
  unconfirmedWarns,
  type FileDep,
} from '@/model'
import { LAYERS, files, SRC, dep, DEPS, CODE, setup } from './helpers'

describe('K4 模块依赖', () => {
  it('两端按归属提升，去掉同模块与祖先后代，未归属的单独计数', () => {
    const { index, own } = setup()
    const { moduleDeps, skipped } = liftDeps(index, own, DEPS)
    expect([...moduleDeps.keys()].sort()).toEqual([
      'core.impl->ui.view',
      'core.util->ui.view',
      'ui.store->core.api',
      'ui.store->core.util',
      'ui.view->core.util',
      'ui.view->ui.store',
    ])
    expect(moduleDeps.get('ui.store->core.api')!.files).toHaveLength(2)
    expect(skipped).toBe(1)
  })

  it('一端是归属冲突文件（G6）的依赖不提升到任何模块，单独列出；冲突解决后自然计入', () => {
    const { index } = setup()
    const own = assignFiles(index, SRC, [])
    own.owners.set('src/core/util/u.ts', ['core.util', 'core.impl'])
    own.conflicts.push('src/core/util/u.ts')
    const deps = [dep('src/ui/view/a.ts', 'src/core/util/u.ts'), dep('src/core/util/u.ts', 'src/ui/view/a.ts'), dep('src/ui/view/a.ts', 'src/ui/store/s.ts')]
    const { moduleDeps, skipped, conflicted } = liftDeps(index, own, deps)
    expect([...moduleDeps.keys()]).toEqual(['ui.view->ui.store'])
    expect(conflicted).toEqual(deps.slice(0, 2))
    expect(skipped).toBe(0)
    const fixed = liftDeps(index, assignFiles(index, SRC, []), deps)
    expect([...fixed.moduleDeps.keys()].sort()).toEqual(['core.util->ui.view', 'ui.view->core.util', 'ui.view->ui.store'])
    expect(fixed.conflicted).toEqual([])
  })
})

describe('K5、K6 关系的证实', () => {
  it('有对应模块依赖为已证实；streams 反向也算；目标态不判定', () => {
    const { report } = setup()
    const st = (id: string) => report.relations.get(id)!.status
    expect(st('rel.1')).toBe('confirmed')
    expect(st('rel.2')).toBe('confirmed')
    expect(st('rel.6')).toBe('confirmed')
    expect(st('rel.3')).toBe('unconfirmed')
    expect(st('rel.4')).toBe('unconfirmed')
    expect(st('rel.5')).toBe('skipped')
  })

  it('依赖落在关系端点的祖先上也算证实（描述比文件粒度细）', () => {
    const { index, own } = setup()
    own.owners.set('src/ui/store/s.ts', ['ui'])
    const { moduleDeps } = liftDeps(index, own, [dep('src/ui/store/s.ts', 'src/core/api/client.ts')])
    expect(confirmRelations(index, moduleDeps).get('rel.2')!.status).toBe('confirmed')
  })

  it('K5a：宿主为自身或最近的有直接归属文件的祖先；两端宿主相同的关系不判定，带宿主', () => {
    const layers = LAYERS.replace(
      '{ id: core.impl, name: Impl, responsibility: 实现, codeRefs: [src/core/impl/**] }',
      '{ id: core.impl, name: Impl, responsibility: 实现, codeRefs: [src/core/impl/**], children: [{ id: core.impl.a, name: A, responsibility: 甲 }, { id: core.impl.b, name: B, responsibility: 乙 }] }',
    ).replace(
      'relations:\n',
      'relations:\n  - { id: rel.c1, from: core.impl.a, to: core.impl.b, type: calls }\n  - { id: rel.c2, from: core.impl.a, to: ui.view, type: calls }\n  - { id: rel.c3, from: core.impl.b, to: core.api, type: calls }\n',
    )
    const { index } = loadModel([files()[0], { path: 'modules/layers.yaml', text: layers }])
    const own = assignFiles(index, SRC, [])
    expect(hostOf(index, own.direct, 'core.impl.a')).toBe('core.impl')
    expect(hostOf(index, own.direct, 'core.api')).toBe('core.api')
    expect(hostOf(index, own.direct, 'core')).toBeUndefined()
    const conf = confirmRelations(index, liftDeps(index, own, DEPS).moduleDeps, own.direct)
    // 同一宿主内的概念拆分：不判定
    expect(conf.get('rel.c1')).toEqual({ status: 'skipped', deps: [], host: 'core.impl' })
    // 宿主不同：照常判定，依赖落在宿主（祖先）上也算证实
    expect(conf.get('rel.c2')!.status).toBe('confirmed')
    expect(conf.get('rel.c3')!.status).toBe('unconfirmed')
    // 不传归属时没有宿主，照常判定
    expect(confirmRelations(index, liftDeps(index, own, DEPS).moduleDeps).get('rel.c1')!.status).toBe('unconfirmed')
  })

  it('K6：编译期关系未证实报 fact.unconfirmed；运行时关系只在两端之间没有任何依赖时报', () => {
    // rel.8：ui.view → core.impl 只有反向依赖（core.impl → ui.view），可由端口解释，只在面板标注
    const { index } = loadModel([...files(), { path: 'modules/z.yaml', text: 'relations: [{ id: rel.8, from: ui.view, to: core.impl, type: calls }]' }])
    const own = assignFiles(index, SRC, [])
    const report = governanceReport(index, own, { files: SRC, packages: {} }, CODE, null)
    const st = (id: string) => report.relations.get(id)!
    expect(st('rel.3')).toMatchObject({ status: 'unconfirmed', isolated: true })
    expect(st('rel.4')).toMatchObject({ status: 'unconfirmed', isolated: true })
    expect(st('rel.8').status).toBe('unconfirmed')
    expect(st('rel.8').isolated).toBeUndefined()
    const warned = report.issues.filter(i => i.code === 'fact.unconfirmed')
    expect(warned.map(i => i.message.match(/「(.+?)」/)![1])).toEqual(['rel.3', 'rel.4'])
    expect(warned[1].message).toContain('两端之间在代码中没有任何依赖')
    expect(unconfirmedWarns(index.relations.get('rel.8')!, st('rel.8'))).toBe(false)
  })

  it('K5b：写了 via 的关系不判定（同 K5a 的 skipped），不报警告、不进返工清单', () => {
    const { index } = loadModel([...files(), { path: 'modules/z.yaml', text: 'relations: [{ id: rel.8, from: core.api, to: core.util, type: commands, via: "channel:inject" }]' }])
    const own = assignFiles(index, SRC, [])
    const report = governanceReport(index, own, { files: SRC, packages: {} }, CODE, null)
    expect(report.relations.get('rel.8')).toEqual({ status: 'skipped', deps: [], via: 'channel:inject' })
    expect(report.issues.some(i => i.code === 'fact.unconfirmed' && i.message.includes('rel.8'))).toBe(false)
  })

  it('K6：祖先与后代之间的依赖（K4 不提升）也算两端有依赖——祖先的文件组装子模块（注入）', () => {
    const { index } = setup()
    const own = assignFiles(index, [...SRC, 'src/core/wire.ts'], [])
    own.owners.set('src/core/wire.ts', ['core'])
    // core 的组装文件同时依赖 core.api 与 core.impl：rel.4（core.api → core.impl）经注入可解释
    const deps = [dep('src/core/wire.ts', 'src/core/api/client.ts'), dep('src/core/wire.ts', 'src/core/impl/i.ts')]
    const { moduleDeps, nested } = liftDeps(index, own, deps)
    expect(moduleDeps.size).toBe(0)
    expect([...nested].sort()).toEqual(['core->core.api', 'core->core.impl'])
    const c = confirmRelations(index, moduleDeps, own.direct, nested).get('rel.4')!
    expect(c.status).toBe('unconfirmed')
    expect(c.isolated).toBeUndefined()
    expect(confirmRelations(index, moduleDeps, own.direct).get('rel.4')!.isolated).toBe(true)
  })
})

describe('K5 通知与流的方向（ADR-0022）', () => {
  const withRelations = (extra: string) => {
    const { index } = loadModel([files()[0], { path: 'modules/layers.yaml', text: LAYERS.replace('relations:\n', `relations:\n${extra}`) }])
    const own = assignFiles(index, SRC, [])
    return { index, own }
  }
  const confirm = (extra: string, deps: FileDep[]) => {
    const { index, own } = withRelations(extra)
    return confirmRelations(index, liftDeps(index, own, deps).moduleDeps, own.direct)
  }

  it('notifies 接受反向的依赖（订阅者导入发布者）为证实，知识方向为反向；calls 只有反向依赖时未证实', () => {
    const c = confirm(
      '  - { id: rel.n, from: core.util, to: ui.store, type: notifies }\n  - { id: rel.k, from: core.util, to: ui.view, type: calls }\n',
      [dep('src/ui/store/s.ts', 'src/core/util/u.ts'), dep('src/ui/view/a.ts', 'src/core/util/u.ts')],
    )
    expect(c.get('rel.n')).toMatchObject({ status: 'confirmed', knows: 'reverse' })
    expect(c.get('rel.k')).toMatchObject({ status: 'unconfirmed' })
    expect(c.get('rel.k')!.isolated).toBeUndefined()
  })

  it('同向依赖证实时知识方向为同向；两个方向都有时为 both', () => {
    const { report } = setup()
    expect(report.relations.get('rel.1')!.knows).toBe('forward')
    const c = confirm('', [dep('src/ui/store/s.ts', 'src/core/util/u.ts'), dep('src/core/util/u.ts', 'src/ui/store/s.ts')])
    expect(c.get('rel.6')!.knows).toBe('both')
  })

  it('K5（ADR-0029）：查询与委托（含未分类）与原 calls 同一口径——发起方 → 接收方的模块依赖即证实，只有反向依赖时未证实', () => {
    const c = confirm(
      '  - { id: rel.q, from: ui.view, to: core.util, type: queries, mode: async }\n  - { id: rel.c, from: ui.store, to: ui.view, type: commands }\n',
      [dep('src/ui/view/a.ts', 'src/core/util/u.ts')],
    )
    expect(c.get('rel.q')).toMatchObject({ status: 'confirmed', knows: 'forward' })
    expect(c.get('rel.c')!.status).toBe('unconfirmed')
  })
})

describe('K5c 端口实现者的证据（ADR-0029，原 implements 三档）', () => {
  /** if.get（core.api 定义）的实现者写 ui.store */
  const withImpl = (implementedBy = '[ui.store]', extra = '') => {
    const text = LAYERS.replace("signature: 'get(id: string): Item' }", `signature: 'get(id: string): Item', implementedBy: ${implementedBy} }`).replace('relations:\n', `relations:\n${extra}`)
    const { index } = loadModel([files()[0], { path: 'modules/layers.yaml', text }])
    return { index, own: assignFiles(index, SRC, []) }
  }
  const facts = (deps: FileDep[], implementedBy?: string) => {
    const { index, own } = withImpl(implementedBy)
    const { moduleDeps, nested } = liftDeps(index, own, deps)
    return confirmImplementers(index, moduleDeps, own.direct, nested).get('if.get')!
  }
  const plain: FileDep = { ...dep('src/ui/store/s.ts', 'src/core/api/client.ts'), uses: undefined, invokes: undefined }

  it('三档：① 引用接口名或类 implements / extends 解析到它 → 已证实；② 只引数据类型 → 结构性实现；③ 引用了实现 → 证据像使用；没有依赖 → 未证实', () => {
    const one = (deps: FileDep[]) => facts(deps).implementers[0]
    expect(one([{ ...plain, kind: 'type', names: ['get'] }])).toMatchObject({ module: 'ui.store', described: true, status: 'confirmed', deps: ['ui.store->core.api'] })
    expect(one([{ ...plain, inherits: [{ name: 'get', clause: 'implements', decl: 'interface' }] }])).toMatchObject({ status: 'confirmed', code: true })
    expect(one([{ ...plain, kind: 'type', names: ['Item'] }])).toMatchObject({ status: 'unconfirmed', structural: true })
    expect(one([{ ...plain, names: ['makeClient'], uses: true }])).toMatchObject({ status: 'unconfirmed', likeDepends: true })
    expect(one([])).toMatchObject({ status: 'unconfirmed', isolated: true })
    // 实现另一个名字的接口不算这个端口的证据
    expect(one([{ ...plain, names: ['Base'], inherits: [{ name: 'Base', clause: 'extends', decl: 'class' }] }])).toMatchObject({ status: 'unconfirmed', structural: true })
  })

  it('「仅代码事实」的实现者：类 implements / extends 解析到接口、描述没写的模块列入端口（described: false）；描述有、事实没有的照常判定', () => {
    const p = facts([{ ...dep('src/ui/view/a.ts', 'src/core/api/client.ts'), inherits: [{ name: 'get', clause: 'implements' }] }], '[]')
    expect(p.owner).toBe('core.api')
    expect(p.implementers).toEqual([expect.objectContaining({ module: 'ui.view', described: false, code: true, status: 'confirmed' })])
    // 没有实现者（描述与事实都没有）的接口不进结果
    const { index, own } = withImpl('[]')
    expect(confirmImplementers(index, liftDeps(index, own, []).moduleDeps).has('if.get')).toBe(false)
  })

  it('K6：描述写了的实现者未证实时报 fact.unconfirmed，证据像使用报 fact.like-depends（定位到接口）；结构性实现只提示（info），不报 lint 问题', () => {
    const { index, own } = withImpl()
    const tree = { files: SRC, packages: {} }
    const like = governanceReport(index, own, tree, { ...CODE, deps: [{ ...plain, names: ['makeClient'], uses: true }] }, null)
    const issue = like.issues.find(i => i.code === 'fact.like-depends')!
    expect(issue).toMatchObject({ severity: 'warning', file: 'modules/layers.yaml' })
    expect(issue.message).toContain('证据像使用')
    const likeItem = reworkList({ index, report: like, issues: [] }).items.find(x => x.id === 'unconfirmed:if.get#ui.store')!
    expect(likeItem.actions[0]).toMatchObject({ kind: 'drop-implementer', snippet: expect.stringContaining('type: queries') })
    expect(likeItem.affected.some(a => a.in === 'source' && a.file === 'src/ui/store/s.ts')).toBe(true)
    const structural = governanceReport(index, own, tree, { ...CODE, deps: [{ ...plain, kind: 'type', names: ['Item'] }] }, null)
    expect(structural.issues.some(i => i.code.startsWith('fact.') && i.message.includes('get'))).toBe(false)
    const item = reworkList({ index, report: structural, issues: [] }).items.find(x => x.id === 'unconfirmed:if.get#ui.store')!
    expect(item).toMatchObject({ severity: 'info', code: 'fact.structural' })
    expect(item.actions[0]).toMatchObject({ kind: 'add-implements', snippet: 'class … implements get {' })
    const none = governanceReport(index, own, tree, { ...CODE, deps: [] }, null)
    expect(none.issues.filter(i => i.code === 'fact.unconfirmed' && i.message.includes('if.get')).map(i => i.message)).toEqual([expect.stringContaining('没有实现者 → 定义模块的依赖')])
  })

  it('不判定：实现者或定义模块是目标态', () => {
    const { index, own } = withImpl('[core.future]')
    const p = confirmImplementers(index, liftDeps(index, own, DEPS).moduleDeps, own.direct).get('if.get')!
    expect(p.implementers[0]).toMatchObject({ module: 'core.future', status: 'skipped' })
  })

  it('K5b（ADR-0029）：经端口 port:<P>——发起方对定义模块有依赖、且接收方是 P 的已证实实现者 → 已证实（经端口）；to 写定义模块时只看前一半；否则不判定', () => {
    const rels = [
      "  - { id: rel.p, from: ui.view, to: ui.store, type: commands, via: 'port:if.get' }",
      "  - { id: rel.o, from: ui.view, to: core.api, type: commands, via: 'port:if.get' }",
      "  - { id: rel.x, from: core.impl, to: ui.store, type: commands, via: 'port:if.get' }",
      "  - { id: rel.b, from: ui.view, to: ui.store, type: notifies, via: 'channel:hmr' }",
    ].join('\n')
    const { index, own } = withImpl('[ui.store]', `${rels}\n`)
    const deps = [
      { ...dep('src/ui/view/a.ts', 'src/core/api/client.ts'), names: ['get'] },
      { ...plain, kind: 'type' as const, names: ['get'] },
    ]
    const { moduleDeps, nested } = liftDeps(index, own, deps)
    const impl = confirmImplementers(index, moduleDeps, own.direct, nested)
    const c = confirmRelations(index, moduleDeps, own.direct, nested, impl)
    expect(c.get('rel.p')).toMatchObject({ status: 'confirmed', port: 'if.get', via: 'port:if.get' })
    expect(c.get('rel.o')).toMatchObject({ status: 'confirmed', port: 'if.get' })
    // core.impl 对 core.api 没有依赖：不判定
    expect(c.get('rel.x')).toMatchObject({ status: 'skipped', via: 'port:if.get' })
    expect(c.get('rel.b')).toMatchObject({ status: 'skipped', via: 'channel:hmr' })
    // 接收方不是已证实的实现者：不判定
    const unproven = confirmRelations(index, moduleDeps, own.direct, nested, new Map())
    expect(unproven.get('rel.p')!.status).toBe('skipped')
  })
})

describe('K12 子类事实、K13 组装事实与组装根（ADR-0029、ADR-0030）', () => {
  it('K12：类 extends 另一模块的类（不是端口）→ 子类事实，按模块对聚合带文件证据；extends 指向描述的接口名的不算（按 K5c 是实现者）', () => {
    const { index, own } = setup()
    const deps = [
      { ...dep('src/ui/view/a.ts', 'src/core/impl/i.ts'), inherits: [{ name: 'BaseView', clause: 'extends' as const, decl: 'class' }], invokeKinds: ['extends' as const] },
      { ...dep('src/ui/store/s.ts', 'src/core/api/client.ts'), inherits: [{ name: 'get', clause: 'extends' as const, decl: 'class' }] },
      { ...dep('src/ui/store/s.ts', 'src/core/util/u.ts'), inherits: [{ name: 'Port', clause: 'implements' as const, decl: 'interface' }] },
    ]
    const facts = heritageFacts(index, liftDeps(index, own, deps).moduleDeps)
    expect(facts.map(f => [f.key, f.files.length])).toEqual([['ui.view->core.impl', 1]])
  })

  it('K12（T2 裁决 3）：默认导入的 extends（解析出名字与声明种类）算子类事实；只有 * 的（命名空间导入）不算', () => {
    const { index, own } = setup()
    const deps = [
      { ...dep('src/ui/view/a.ts', 'src/core/impl/i.ts'), inherits: [{ name: 'BaseView', clause: 'extends' as const, decl: 'default' }], invokeKinds: ['extends' as const] },
      { ...dep('src/ui/store/s.ts', 'src/core/util/u.ts'), inherits: [{ name: '*', clause: 'extends' as const }], invokeKinds: ['extends' as const] },
    ]
    const facts = heritageFacts(index, liftDeps(index, own, deps).moduleDeps)
    expect(facts.map(f => f.key)).toEqual(['ui.view->core.impl'])
  })

  it('K13：new、工厂、容器注册 → 组装事实，按模块对聚合；组装根 = 组装图入度 0、出度 ≥ 1', () => {
    const { index, own } = setup()
    const deps = [
      { ...dep('src/core/api/index.ts', 'src/core/impl/i.ts'), invokeKinds: ['new' as const] },
      { ...dep('src/core/impl/i.ts', 'src/core/util/u.ts'), invokeKinds: ['call' as const, 'factory' as const] },
      { ...dep('src/ui/view/a.ts', 'src/ui/store/s.ts'), invokeKinds: ['call' as const] },
    ]
    const { facts, roots } = assemblyFacts(liftDeps(index, own, deps).moduleDeps)
    expect(facts.map(f => [f.key, f.kinds])).toEqual([
      ['core.api->core.impl', ['new']],
      ['core.impl->core.util', ['factory']],
    ])
    expect(roots).toEqual(['core.api'])
    const { report } = setup()
    expect(report.assembly).toEqual([])
    expect(report.subclasses).toEqual([])
  })
})

describe('K7 未解释的交互', () => {
  it('没有关系覆盖（方向一致，streams 不论方向）', () => {
    const { index, own } = setup()
    const { moduleDeps } = liftDeps(index, own, DEPS)
    expect(
      undescribedDeps(index, moduleDeps)
        .map(d => d.key)
        .sort(),
    ).toEqual(['core.impl->ui.view', 'core.util->ui.view', 'ui.view->core.util'])
  })

  it('notifies 与 streams 覆盖两个方向的依赖；calls 只覆盖同向', () => {
    const { index } = loadModel([files()[0], { path: 'modules/layers.yaml', text: LAYERS.replace('relations:\n', 'relations:\n  - { id: rel.n, from: core.impl, to: ui.view, type: notifies }\n') }])
    const md = (from: string, to: string) => new Map([[`${from}->${to}`, { key: `${from}->${to}`, from, to, files: [dep('x', 'y')] }]])
    expect(undescribedDeps(index, md('ui.view', 'core.impl'))).toEqual([])
    expect(undescribedDeps(index, md('core.api', 'ui.store')).map(d => d.key)).toEqual(['core.api->ui.store'])
  })

  it('只引类型（含枚举）的模块依赖不算；有一条值使用（uses）就算', () => {
    const { index, own } = setup()
    const type = (from: string, to: string): FileDep => ({ ...dep(from, to), kind: 'type', uses: undefined, invokes: undefined })
    const onlyTypes = liftDeps(index, own, [type('src/ui/view/a.ts', 'src/core/impl/i.ts')]).moduleDeps
    expect(undescribedDeps(index, onlyTypes)).toEqual([])
    // 值导入了枚举：kind 为 value，但没有引用函数、类或变量
    const enumOnly = liftDeps(index, own, [{ ...dep('src/ui/view/a.ts', 'src/core/impl/i.ts'), names: ['Mode'], uses: undefined, invokes: undefined }]).moduleDeps
    expect(undescribedDeps(index, enumOnly)).toEqual([])
    const mixed = liftDeps(index, own, [type('src/ui/view/a.ts', 'src/core/impl/i.ts'), dep('src/ui/view/a.ts', 'src/core/impl/i.ts', undefined, 2)]).moduleDeps
    expect(undescribedDeps(index, mixed).map(d => d.key)).toEqual(['ui.view->core.impl'])
  })

  it('纯值读取（常量、只读值、只读成员：uses 而没有 invokes）不算，由事实承载；有一处交互使用（invokes）就算（第五轮 T4 口径）', () => {
    const { index, own } = setup()
    const read = (line: number): FileDep => ({ ...dep('src/ui/view/a.ts', 'src/core/impl/i.ts', undefined, line), names: ['LABELS'], invokes: undefined })
    const onlyReads = liftDeps(index, own, [read(1), read(2)]).moduleDeps
    expect([...onlyReads.values()].some(d => d.files.some(f => f.uses))).toBe(true)
    expect(undescribedDeps(index, onlyReads)).toEqual([])
    const withCall = liftDeps(index, own, [read(1), dep('src/ui/view/a.ts', 'src/core/impl/i.ts', undefined, 3)]).moduleDeps
    expect(undescribedDeps(index, withCall).map(d => d.key)).toEqual(['ui.view->core.impl'])
  })
})

describe('K7 的三种新覆盖（ADR-0029、ADR-0030、T0 裁决 5）', () => {
  const md = (files: FileDep[], from = 'ui.view', to = 'core.impl') => new Map([[`${from}->${to}`, { key: `${from}->${to}`, from, to, files }]])

  it('只有 extends（子类事实）或只有组装使用（new、工厂、注册）的依赖不算未解释；同时有调用的仍算', () => {
    const { index } = setup()
    const f = (kinds: ('call' | 'extends' | 'new' | 'factory' | 'register')[]) => ({ ...dep('src/ui/view/a.ts', 'src/core/impl/i.ts'), invokeKinds: kinds })
    expect(undescribedDeps(index, md([f(['extends'])]))).toEqual([])
    expect(undescribedDeps(index, md([f(['new']), f(['factory', 'register'])]))).toEqual([])
    expect(undescribedDeps(index, md([f(['new', 'call'])])).map(d => d.key)).toEqual(['ui.view->core.impl'])
    // 没有种类的旧事实按调用看待
    expect(undescribedDeps(index, md([dep('src/ui/view/a.ts', 'src/core/impl/i.ts')])).map(d => d.key)).toEqual(['ui.view->core.impl'])
  })

  it('依赖方是被依赖方子树内某端口的实现者（描述或「仅代码事实」）时不算', () => {
    const text = LAYERS.replace("signature: 'get(id: string): Item' }", "signature: 'get(id: string): Item', implementedBy: [ui.view] }")
    const { index } = loadModel([files()[0], { path: 'modules/layers.yaml', text }])
    const own = assignFiles(index, SRC, [])
    const { moduleDeps, nested } = liftDeps(index, own, [dep('src/ui/view/a.ts', 'src/core/api/client.ts')])
    expect(undescribedDeps(index, moduleDeps).map(d => d.key)).toEqual(['ui.view->core.api'])
    const impl = confirmImplementers(index, moduleDeps, own.direct, nested)
    expect(undescribedDeps(index, moduleDeps, impl)).toEqual([])
  })
})

