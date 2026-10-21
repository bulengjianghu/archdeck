import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { isProjectId, listDesigns, listProjectIds, listProjects, readDesignRevision, readProject, resolveModelRoot, versionFile } from '../../vite/readModelDir'

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
    'design:\n  name: 下一期\n  status: reviewing\n  goal: 目标\n  base: { commit: c0 }\n  revisions:\n    - { id: r1, date: 2026-10-20, summary: 第一轮, feedback: 改名 }\n    - { id: r2, questions: [要不要拆] }\n    - { id: r9 }\n',
  )
  write('alpha/designs/next/r1/system.yaml', 'system: { id: alpha, name: Alpha }')
  write('alpha/designs/next/r1/m.yaml', 'modules: [{ id: m1, name: M1 }, { id: m2, name: M2 }]')
  write('alpha/designs/next/r2/system.yaml', 'system: { id: alpha, name: Alpha }')
  write('alpha/designs/next/r2/m.yaml', 'modules: [{ id: m1, name: M1 }, { id: m3, name: M3 }]')
  write('alpha/designs/bad/design.yaml', 'design: { status: wip }')
  write('alpha/designs/no-meta/r1/system.yaml', 'system: { id: alpha, name: Alpha }')
})

afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

describe('接入层 · 多项目读取', () => {
  it('只有含 system.yaml 的子目录才算项目，按名称排序', () => {
    expect(listProjectIds(modelRoot)).toEqual(['alpha', 'beta'])
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
    expect(next).toMatchObject({ name: '下一期', status: 'reviewing', goal: '目标', base: { commit: 'c0' } })
    expect(next.revisions).toEqual([
      { id: 'r1', date: '2026-10-20', summary: '第一轮', feedback: '改名', questions: undefined },
      { id: 'r2', date: undefined, summary: undefined, feedback: undefined, questions: ['要不要拆'] },
    ])
    expect(next.problems).toEqual(['轮次 r9 缺少快照目录 r9/system.yaml，已忽略'])
    expect(designs[0].status).toBe('draft')
    expect(designs[0].problems).toHaveLength(2) // 非法 status + 没有轮次
    expect(
      listProjects(modelRoot, root)
        .find(p => p.id === 'alpha')!
        .designs.map(d => d.id),
    ).toEqual(['bad', 'next'])
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
    expect(versionFile('alpha', { design: 'next', revision: 'r2' })).toBe('models/alpha/designs/next/r2.json')
  })

  it('模型根目录默认是项目内 model/，可用 ARCH_MODEL_ROOT 覆盖', () => {
    expect(resolveModelRoot('/p', {})).toBe(path.resolve('/p/model'))
    expect(resolveModelRoot('/p', { ARCH_MODEL_ROOT: 'other' })).toBe(path.resolve('/p/other'))
  })
})
