import { describe, expect, it } from 'vitest'
import { load, loadModel, validate } from '../../src/model'
import { sampleFiles } from '../fixtures/sample'

const codes = (issues: { code: string }[]) => issues.map(i => i.code)

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

  it('K5b：关系的 via 只收枚举值（http / hmr / inject / router / callback），其余为格式错误', () => {
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

  it('样例模型没有问题', () => {
    expect(run({}).issues).toEqual([])
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
    expect(issues.every(i => i.severity === 'warning')).toBe(true)
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
