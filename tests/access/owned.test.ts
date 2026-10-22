/**
 * 指纹门禁（X6）：owned.json 的登记、写入端点的自动更新、lint 的比对。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { compareOwned } from '../../src/model'
import { governanceDir, ownedFingerprint, ownedHashes, readOwned, registerOwned, touchOwned } from '../../vite/governanceStore'
import { appendAllow, appendFeedback } from '../../vite/writeModel'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arch-owned-'))
const modelRoot = path.join(root, 'model')
const P = path.join(modelRoot, 'p')
afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

function write(rel: string, text: string) {
  fs.mkdirSync(path.dirname(path.join(P, rel)), { recursive: true })
  fs.writeFileSync(path.join(P, rel), text)
}
const lint = () => compareOwned(readOwned(governanceDir(modelRoot, 'p')), ownedHashes(P))

beforeEach(() => {
  fs.rmSync(P, { recursive: true, force: true })
  write('system.yaml', 'system: { id: p, name: P }')
  write('intent/skeleton.yaml', 'sketch:\n  id: skeleton\n  modules:\n    - { id: a, name: A, kind: layer, order: 1, abstraction: x, responsibility: x }\n    - { id: b, name: B, kind: layer, order: 2, abstraction: y, responsibility: y }\n')
  write('modules/m.yaml', 'modules:\n  - { id: a.x, name: X, parent: a, responsibility: x }\n')
  write('rules.yaml', 'rules:\n  allow: []\n')
  write('designs/d/design.yaml', 'design:\n  name: D\n  revisions:\n    - { id: r1 }\n')
  write('designs/d/sketch.yaml', 'sketch: { id: d, modules: [{ id: a.y, name: Y, parent: a }] }\n')
  write('designs/d/r1/system.yaml', 'system: { id: p, name: P }')
  write('designs/d/r1/intent/skeleton.yaml', 'sketch: { id: skeleton }')
})

describe('X6 指纹门禁', () => {
  it('人拥有的文件：草图、rules、source-ignore、design.yaml、reviewed.yaml；设计各轮快照里的不算', () => {
    expect(Object.keys(ownedHashes(P)).sort()).toEqual(['designs/d/design.yaml', 'designs/d/sketch.yaml', 'intent/skeleton.yaml', 'rules.yaml'])
    expect(ownedHashes(P)['rules.yaml']).toBe(ownedFingerprint('rules:\n  allow: []\n'))
  })

  it('没有登记时提醒 owned.none；arch own 登记后 0 个问题；登记后改动报错 owned.changed，删除也算；新加的文件未登记只提醒', () => {
    expect(lint().map(i => i.code)).toEqual(['owned.none'])
    const r = registerOwned(modelRoot, 'p', '2026-10-22T00:00:00Z')
    expect(r.files).toEqual(['designs/d/design.yaml', 'designs/d/sketch.yaml', 'intent/skeleton.yaml', 'rules.yaml'])
    expect(JSON.parse(fs.readFileSync(r.file, 'utf8'))).toMatchObject({ updatedAt: '2026-10-22T00:00:00Z' })
    expect(lint()).toEqual([])
    write('rules.yaml', 'rules:\n  allow: [{ from: a, to: b, reason: AI 偷偷加的 }]\n')
    fs.rmSync(path.join(P, 'designs/d/sketch.yaml'))
    write('source-ignore.yaml', 'sourceIgnore: []')
    expect(lint().map(i => [i.severity, i.code, i.file])).toEqual([
      ['error', 'owned.changed', 'designs/d/sketch.yaml'],
      ['error', 'owned.changed', 'rules.yaml'],
      ['warning', 'owned.unregistered', 'source-ignore.yaml'],
    ])
    registerOwned(modelRoot, 'p')
    expect(lint()).toEqual([])
  })

  it('写入端点写人拥有的文件后自动更新该文件的指纹；没有 owned.json 时新建、只含这一项', () => {
    registerOwned(modelRoot, 'p')
    appendAllow(modelRoot, 'p', { from: 'a', to: 'b', reason: '过渡期' }, root)
    expect(lint()).toEqual([])
    appendFeedback(modelRoot, 'p', 'd', 'r1', '同意', root)
    expect(lint()).toEqual([])
    fs.rmSync(path.join(governanceDir(modelRoot, 'p'), 'owned.json'))
    appendAllow(modelRoot, 'p', { from: 'b', to: 'a', reason: 'x' }, root)
    expect(Object.keys(readOwned(governanceDir(modelRoot, 'p'))!.files)).toEqual(['rules.yaml'])
    expect(lint().map(i => i.code)).toEqual(['owned.unregistered', 'owned.unregistered', 'owned.unregistered'])
    // 不是人拥有的文件不登记
    touchOwned(modelRoot, 'p', 'modules/m.yaml')
    expect(Object.keys(readOwned(governanceDir(modelRoot, 'p'))!.files)).toEqual(['rules.yaml'])
  })
})
