/** 架构治理 · 事实比对（K4–K7）：模块依赖、关系的证实与未证实的分档、未描述依赖 */
import { describe, expect, it } from 'vitest'
import {
  assignFiles,
  confirmRelations,
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
    const { index } = loadModel([...files(), { path: 'modules/z.yaml', text: 'relations: [{ id: rel.8, from: core.api, to: core.util, type: calls, via: inject }]' }])
    const own = assignFiles(index, SRC, [])
    const report = governanceReport(index, own, { files: SRC, packages: {} }, CODE, null)
    expect(report.relations.get('rel.8')).toEqual({ status: 'skipped', deps: [], via: 'inject' })
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

describe('K5 通知与流的方向、implements 的证据（ADR-0022）', () => {
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

  it('implements 证据三档：① 接口名或类 implements / extends → 已证实；② 只引数据类型 → 结构性实现；③ 引用了实现 → 证据像 depends', () => {
    const rel = '  - { id: rel.i, from: ui.store, to: core.api, type: implements }\n'
    const plain = dep('src/ui/store/s.ts', 'src/core/api/client.ts')
    // ③ 值导入了对方的函数
    expect(confirm(rel, [{ ...plain, names: ['makeClient'], uses: true }]).get('rel.i')).toMatchObject({ status: 'unconfirmed', likeDepends: true, deps: ['ui.store->core.api'] })
    // ② 只引了数据类型（类型或枚举），没有引用实现
    const structural = confirm(rel, [{ ...plain, kind: 'type', names: ['Plan'] }, { ...plain, names: ['Mode'] }]).get('rel.i')!
    expect(structural).toMatchObject({ status: 'unconfirmed', structural: true })
    expect(structural.likeDepends).toBeUndefined()
    expect(confirm(rel, [{ ...plain, kind: 'type', names: ['get'] }]).get('rel.i')).toMatchObject({ status: 'confirmed', deps: ['ui.store->core.api'] })
    expect(confirm(rel, [{ ...plain, names: ['Base'], heritage: true }]).get('rel.i')!.status).toBe('confirmed')
    expect(confirm(rel, []).get('rel.i')!.likeDepends).toBeUndefined()
  })

  it('结构性实现只提示（info）：不报 lint 问题、不进角标，返工清单建议在类上写明 implements 并列出候选接口', () => {
    const { index, own } = withRelations('  - { id: rel.i, from: ui.store, to: core.api, type: implements }\n')
    const tree = { files: SRC, packages: {} }
    const report = governanceReport(index, own, tree, { ...CODE, deps: DEPS.map(d => ({ ...d, kind: 'type' as const, names: ['Item'] })) }, null)
    expect(report.relations.get('rel.i')!.structural).toBe(true)
    expect(report.issues.some(i => i.message.includes('rel.i'))).toBe(false)
    const item = reworkList({ index, report, issues: [] }).items.find(x => x.id === 'unconfirmed:rel.i')!
    expect(item).toMatchObject({ severity: 'info', code: 'fact.structural' })
    expect(item.actions[0]).toMatchObject({ kind: 'add-implements', snippet: 'class … implements get {' })
    expect(item.actions[0].text).toContain('get')
  })

  it('证据像 depends 报 fact.like-depends（代替 fact.unconfirmed），返工清单建议改为 depends', () => {
    const { index, own } = withRelations('  - { id: rel.i, from: ui.store, to: core.api, type: implements }\n')
    const tree = { files: SRC, packages: {} }
    const report = governanceReport(index, own, tree, { ...CODE, deps: DEPS.map(d => ({ ...d, names: ['makeClient'], uses: true as const })) }, null)
    const issue = report.issues.find(i => i.message.includes('rel.i'))!
    expect(issue).toMatchObject({ severity: 'warning', code: 'fact.like-depends' })
    const item = reworkList({ index, report, issues: [] }).items.find(x => x.id === 'unconfirmed:rel.i')!
    expect(item.code).toBe('fact.like-depends')
    expect(item.actions[0]).toMatchObject({ kind: 'to-depends', snippet: expect.stringContaining('type: depends') })
    expect(item.affected.some(a => a.in === 'source' && a.file === 'src/ui/store/s.ts')).toBe(true)
  })
})

describe('K7 未描述依赖', () => {
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

  it('只引用类型的模块依赖不算；有一条值依赖就算', () => {
    const { index, own } = setup()
    const type = (from: string, to: string): FileDep => ({ ...dep(from, to), kind: 'type' })
    const onlyTypes = liftDeps(index, own, [type('src/ui/view/a.ts', 'src/core/impl/i.ts')]).moduleDeps
    expect(undescribedDeps(index, onlyTypes)).toEqual([])
    const mixed = liftDeps(index, own, [type('src/ui/view/a.ts', 'src/core/impl/i.ts'), dep('src/ui/view/a.ts', 'src/core/impl/i.ts', undefined, 2)]).moduleDeps
    expect(undescribedDeps(index, mixed).map(d => d.key)).toEqual(['ui.view->core.impl'])
  })
})
