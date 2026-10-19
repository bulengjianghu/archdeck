import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { isProjectId, listProjectIds, listProjects, readProject, resolveModelRoot } from '../../vite/readModelDir'

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
      counts: { modules: 2, relations: 1, interfaces: 0, dataStructures: 0 },
      errors: 1,
    })
    expect(alpha).toMatchObject({ id: 'alpha', layered: false, warnings: 1 })
  })

  it('模型根目录默认是项目内 model/，可用 ARCH_MODEL_ROOT 覆盖', () => {
    expect(resolveModelRoot('/p', {})).toBe(path.resolve('/p/model'))
    expect(resolveModelRoot('/p', { ARCH_MODEL_ROOT: 'other' })).toBe(path.resolve('/p/other'))
  })
})
