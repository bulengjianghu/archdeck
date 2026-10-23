import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  designSketches,
  isProjectId,
  listDesigns,
  listProjectIds,
  listProjects,
  readDesignRevision,
  readProject,
  readSketchVersion,
  resolveModelRoot,
  sketchPrompt,
} from '../../vite/readModelDir'
import { loadModel } from '../../src/model'

let root: string
let modelRoot: string

function write(rel: string, text: string) {
  const full = path.join(modelRoot, rel)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, text)
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'arch-desk-'))
  modelRoot = path.join(root, 'model')
  write('beta/system.yaml', 'system: { id: beta, name: Beta, description: 第二个, source: { commit: abc } }')
  write(
    'beta/modules/layers.yaml',
    'modules:\n  - { id: up, name: Up, kind: layer, order: 1, abstraction: a, responsibility: x }\n  - { id: down, name: Down, kind: layer, order: 2, abstraction: b, responsibility: x }\n' +
      'relations:\n  - { id: r1, from: up, to: down, type: depends }\n  - { id: r2, from: up, to: nope, type: calls }\n',
  )
  write('alpha/system.yaml', 'system: { id: alpha, name: Alpha }')
  write('alpha/m.yml', 'modules: [{ id: m1, name: M1 }]')
  write('no-system/x.yaml', 'modules: [{ id: z, name: Z }]')
  write('README.md', '不是项目')
  // 设计版本（ADR-0002）
  write(
    'alpha/designs/next/design.yaml',
    'design:\n  name: 下一期\n  status: reviewing\n  goal: 目标\n  adr: docs/adr/0009-next.md\n  base: { commit: c0 }\n  revisions:\n    - { id: r1, date: 2026-10-20, summary: 第一轮, feedback: 改名 }\n    - { id: r2, questions: [要不要拆] }\n    - { id: r9 }\n',
  )
  write('alpha/designs/next/r1/system.yaml', 'system: { id: alpha, name: Alpha }')
  write('alpha/designs/next/r1/m.yaml', 'modules: [{ id: m1, name: M1 }, { id: m2, name: M2 }]')
  write('alpha/designs/next/r2/system.yaml', 'system: { id: alpha, name: Alpha }')
  write('alpha/designs/next/r2/m.yaml', 'modules: [{ id: m1, name: M1 }, { id: m3, name: M3 }]')
  write('alpha/designs/bad/design.yaml', 'design: { status: wip }')
  write('alpha/designs/no-meta/r1/system.yaml', 'system: { id: alpha, name: Alpha }')
  // 草图（X1、DV-10）：gamma 有持久草图；设计 sk 有草图、已定稿（约束当前版本）；设计 plain 没有草图
  write('gamma/system.yaml', 'system: { id: gamma, name: Gamma }')
  write('gamma/m.yml', 'modules: [{ id: core.impl, name: Impl, parent: core, responsibility: x }]')
  write(
    'gamma/intent/skeleton.yaml',
    'sketch: { id: skeleton, mount: root, modules: [{ id: core, name: Core, kind: layer, order: 1, abstraction: a, responsibility: c }] }',
  )
  write('gamma/designs/plain/design.yaml', 'design:\n  name: 无草图\n  revisions:\n    - { id: r1 }\n')
  write('gamma/designs/plain/r1/system.yaml', 'system: { id: gamma, name: Gamma }')
  write(
    'gamma/designs/sk/design.yaml',
    'design:\n  name: 有草图\n  status: accepted\n  accepted:\n    - { deviation: "missing-relation:rel.sk.x", reason: 经注入, at: 2026-10-22 }\n    - { deviation: bad }\n  revisions:\n    - { id: r1 }\n',
  )
  write(
    'gamma/designs/sk/sketches/root.yaml',
    'sketch: { id: sk, mount: root, supersedes: skeleton, modules: [{ id: core, name: Core, kind: layer, children: [{ id: core.api, name: Api }] }] }',
  )
  write(
    'gamma/designs/sk/sketches/core.api.yaml',
    'sketch: { id: sk, mount: core.api, modules: [{ id: core.api.get, name: Get }], relations: [{ id: rel.sk.get-impl, from: core.api.get, to: core.impl, type: calls }] }',
  )
  write('gamma/designs/sk/r1/system.yaml', 'system: { id: gamma, name: Gamma }')
  // 文档：草图版本的「交给 AI」指令从这里截取「按草图扩展」一节
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true })
  fs.writeFileSync(
    path.join(root, 'docs', '04-description-format.md'),
    '## 5. 设计版本\n\n正文。\n\n### 按草图扩展\n\n1. 草图是约束。\n2. 沿用 ID。\n\n## 6. 其他\n\n略。\n',
  )
})

afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

describe('接入层 · 多项目读取', () => {
  it('只有含 system.yaml 的子目录才算项目，按名称排序', () => {
    expect(listProjectIds(modelRoot)).toEqual(['alpha', 'beta', 'gamma'])
    expect(listProjectIds(path.join(root, 'missing'))).toEqual([])
  })

  it('读取项目的全部 YAML（含 .yml），路径相对项目目录', () => {
    const p = readProject(modelRoot, 'beta', root)!
    expect(p.project).toBe('beta')
    expect(p.dir).toBe('model/beta')
    expect(p.files.map(f => f.path)).toEqual(['modules/layers.yaml', 'system.yaml'])
    // designs/ 不属于当前版本
    expect(readProject(modelRoot, 'alpha', root)!.files.map(f => f.path)).toEqual(['m.yml', 'system.yaml'])
  })

  it('不存在的项目或不安全的 ID 返回 null', () => {
    expect(readProject(modelRoot, 'no-system', root)).toBeNull()
    expect(readProject(modelRoot, '../model', root)).toBeNull()
    expect(isProjectId('../x')).toBe(false)
    expect(isProjectId('h5p-arch-desk')).toBe(true)
  })

  it('项目摘要：名称、来源、分层、规模与问题数', () => {
    const [alpha, beta] = listProjects(modelRoot, root)
    expect(beta).toMatchObject({
      id: 'beta',
      name: 'Beta',
      description: '第二个',
      source: { commit: 'abc' },
      layered: true,
      top: [
        { id: 'up', name: 'Up', abstraction: 'a' },
        { id: 'down', name: 'Down', abstraction: 'b' },
      ],
      counts: { modules: 2, relations: 1, interfaces: 0, dataStructures: 0, actors: 0, scenarios: 0 },
      errors: 1,
    })
    expect(alpha).toMatchObject({ id: 'alpha', layered: false, warnings: 1 })
  })

  it('设计版本：有 design.yaml 的子目录才算；缺快照的轮次被忽略并记为问题', () => {
    const designs = listDesigns(path.join(modelRoot, 'alpha'))
    expect(designs.map(d => d.id)).toEqual(['bad', 'next'])
    const next = designs[1]
    expect(next).toMatchObject({ name: '下一期', status: 'reviewing', goal: '目标', base: { commit: 'c0' }, adr: ['docs/adr/0009-next.md'] })
    expect(next.revisions).toEqual([
      { id: 'r1', date: '2026-10-20', summary: '第一轮', feedback: '改名', questions: undefined },
      { id: 'r2', date: undefined, summary: undefined, feedback: undefined, questions: ['要不要拆'] },
    ])
    expect(next.problems).toEqual(['轮次 r9 缺少快照目录 r9/system.yaml，已忽略'])
    expect(designs[0].status).toBe('draft')
    expect(designs[0].problems).toHaveLength(1) // 非法 status；没有轮次不是问题（E8：新建设计后只有草图）
    expect(
      listProjects(modelRoot, root)
        .find(p => p.id === 'alpha')!
        .designs.map(d => d.id),
    ).toEqual(['bad', 'next'])
  })

  it('X1、X4：发现设计的草图与认可的偏差；已定稿设计的草图随当前版本给出，设计某一轮附本设计的草图', () => {
    const designs = listDesigns(path.join(modelRoot, 'gamma'))
    const sk = designs.find(d => d.id === 'sk')!
    expect(sk.sketch).toBe(true)
    expect(sk.sketches).toEqual([
      { mount: 'root', file: 'designs/sk/sketches/root.yaml', needsLayout: true },
      { mount: 'core.api', file: 'designs/sk/sketches/core.api.yaml', needsLayout: true },
    ])
    expect(sk.accepted).toEqual([{ deviation: 'missing-relation:rel.sk.x', reason: '经注入', at: '2026-10-22' }])
    expect(sk.problems).toEqual(['accepted 中有条目缺少 deviation 或 reason'])
    expect(designs.find(d => d.id === 'plain')!.sketch).toBeUndefined()
    const current = readProject(modelRoot, 'gamma', root)!
    expect(current.files.map(f => f.path)).toEqual(['intent/skeleton.yaml', 'm.yml', 'system.yaml'])
    expect(current.sketches?.map(s => [s.design, s.file.path])).toEqual([
      ['sk', 'designs/sk/sketches/root.yaml'],
      ['sk', 'designs/sk/sketches/core.api.yaml'],
    ])
    expect(readDesignRevision(modelRoot, 'gamma', 'sk', 'r1', root)!.sketches?.map(s => s.design)).toEqual(['sk', 'sk'])
    expect(readDesignRevision(modelRoot, 'gamma', 'plain', 'r1', root)!.sketches).toBeUndefined()
    expect(designSketches(path.join(modelRoot, 'gamma'), 'plain')).toEqual([])
  })

  it('DV-10：草图作为版本——system + 持久草图 + 该设计的各张草图（+ 引用的外部模块），对比基线为当前版本，附「交给 AI」的指令', () => {
    const v = readSketchVersion(modelRoot, 'gamma', 'sk', root)!
    expect(v.version).toEqual({ design: 'sk', revision: 'sketch' })
    expect(v.dir).toBe('model/gamma/designs/sk')
    expect(v.files.map(f => f.path)).toEqual(['intent/skeleton.yaml', 'system.yaml', 'sketches/root.yaml', 'sketches/core.api.yaml', 'references.yaml'])
    // X19：草图引用、草图里没有的外部模块取自当前版本，草图版本自成一份可加载的描述
    expect(v.files.at(-1)!.text).toContain('id: core.impl')
    expect(loadModel(v.files).issues.filter(i => i.severity === 'error')).toEqual([])
    expect(v.sketch).toMatchObject({ mount: 'root', path: 'sketches/root.yaml' })
    expect(v.compare).toEqual({ current: { label: '当前版本', dir: 'model/gamma', files: readProject(modelRoot, 'gamma', root)!.files } })
    expect(v.sketchPrompt).toContain('# 按草图扩展：设计「sk」')
    expect(v.sketchPrompt).toContain('## 草图（designs/sk/sketches/core.api.yaml）')
    expect(v.sketchPrompt).toContain('id: sk, mount: core.api')
    expect(v.sketchPrompt).toContain('1. 草图是约束。\n2. 沿用 ID。')
    expect(v.sketchPrompt).not.toContain('## 6. 其他')
    // 同一入口：轮次 sketch 即草图版本；没有草图的设计没有草图版本；读不到文档时只给草图
    expect(readDesignRevision(modelRoot, 'gamma', 'sk', 'sketch', root)).toEqual(v)
    expect(readSketchVersion(modelRoot, 'gamma', 'plain', root)).toBeNull()
    expect(sketchPrompt('sk', [{ path: 'sketches/root.yaml', text: 'sketch: {}' }], path.join(root, 'nowhere'))).toContain(
      '读不到 docs/04-description-format.md',
    )
  })

  it('读设计的某一轮：附当前版本与上一轮作为对比基线', () => {
    const r2 = readDesignRevision(modelRoot, 'alpha', 'next', 'r2', root)!
    expect(r2.version).toEqual({ design: 'next', revision: 'r2' })
    expect(r2.dir).toBe('model/alpha/designs/next/r2')
    expect(r2.files.map(f => f.path)).toEqual(['m.yaml', 'system.yaml'])
    expect(r2.compare?.current.files.map(f => f.path)).toEqual(['m.yml', 'system.yaml'])
    expect(r2.compare?.previous).toMatchObject({ label: '下一期 · r1', dir: 'model/alpha/designs/next/r1' })
    expect(readDesignRevision(modelRoot, 'alpha', 'next', 'r1', root)!.compare?.previous).toBeUndefined()
    expect(readDesignRevision(modelRoot, 'alpha', 'next', 'r9', root)).toBeNull()
    expect(readDesignRevision(modelRoot, 'alpha', '..', 'r1', root)).toBeNull()
  })

  it('模型根目录默认是项目内 model/，可用 ARCH_MODEL_ROOT 覆盖', () => {
    expect(resolveModelRoot('/p', {})).toBe(path.resolve('/p/model'))
    expect(resolveModelRoot('/p', { ARCH_MODEL_ROOT: 'other' })).toBe(path.resolve('/p/other'))
  })
})
