/**
 * 设计状态的写入（DL-32、DL-33）与服务端锁定（DL-34）、认可后手改草图的指纹比对（DL-35）。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { approvalDrift, load, loadModel, reviewHashes } from '../../src/model'
import { listDesigns, readDesignInfo, readModelDir } from '../../vite/readModelDir'
import { readOwned, registerOwned, ownedFingerprint } from '../../vite/governanceStore'
import { WriteError } from '../../vite/writeModel'
import { DesignLocked, WriteConflict, saveDesignSketches } from '../../vite/writeSketch'
import { designSketchHashes, setDesignStatus } from '../../vite/designStatus'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arch-status-'))
const modelRoot = path.join(root, 'model')
const P = path.join(modelRoot, 'p')
afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

const write = (rel: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(P, rel)), { recursive: true })
  fs.writeFileSync(path.join(P, rel), text)
}
const read = (rel: string) => fs.readFileSync(path.join(P, rel), 'utf8')
const design = () => (parse(read('designs/d/design.yaml')) as { design: Record<string, unknown> }).design

const SKELETON = `sketch:
  id: skeleton
  mount: root
  lifetime: persistent
  closed: [core]
  modules:
    - id: core
      name: Core
      kind: layer
      order: 1
      responsibility: 内核
      children:
        - { id: core.a, name: A, responsibility: a }
`
const SKETCH = `sketch:
  id: d
  mount: core.a
  modules:
    - { id: core.a.x, name: X, responsibility: x }
    - { id: core.a.y, name: Y, responsibility: y }
  relations:
    - { id: rel.x-y, from: core.a.x, to: core.a.y, type: commands }
`

beforeEach(() => {
  fs.rmSync(P, { recursive: true, force: true })
  write('system.yaml', 'system: { id: p, name: P, source: { commit: abc123, generatedAt: "2026-10-22" } }')
  write('intent/skeleton.yaml', SKELETON)
  write('designs/d/design.yaml', '# 人拥有\ndesign:\n  name: D\n  status: draft\n')
  write('designs/d/sketches/core.a.yaml', SKETCH)
  registerOwned(modelRoot, 'p')
})

const seen = () => designSketchHashes(P, 'd')
const accept = () => setDesignStatus(modelRoot, 'p', 'd', { action: 'accept', sketches: seen() }, root)

describe('DL-33 认可', () => {
  it('status: accepted、approval 记日期与各张草图指纹（与 X6 同一算法），design.yaml 的指纹自动更新', () => {
    const r = accept()
    expect(r.status).toBe('accepted')
    const d = design()
    expect(d.status).toBe('accepted')
    expect(d.approval).toEqual({
      at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      sketches: { 'sketches/core.a.yaml': ownedFingerprint(read('designs/d/sketches/core.a.yaml')) },
    })
    expect(read('designs/d/design.yaml')).toContain('# 人拥有')
    expect(readOwned(path.join(P, 'governance'))!.files['designs/d/design.yaml']).toBe(ownedFingerprint(read('designs/d/design.yaml')))
    expect(listDesigns(P)[0].approval?.sketches).toEqual(seen())
  })
  it('DL-49 认可时记下估算：estimate.json 带页面读到的影响面与当前版本各模块的描述指纹；设计信息读回', () => {
    setDesignStatus(modelRoot, 'p', 'd', { action: 'accept', sketches: seen(), estimate: { modules: ['core', 'core', 7], fresh: false } }, root)
    const est = JSON.parse(fs.readFileSync(path.join(P, 'designs/d/estimate.json'), 'utf8'))
    const { index } = loadModel(readModelDir(P, root).files)
    expect(est).toEqual({ at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), modules: ['core'], fresh: false, current: reviewHashes(index) })
    expect(readDesignInfo(path.join(P, 'designs/d'), 'd').estimate).toMatchObject({ modules: ['core'], fresh: false })
    // 估算记录不是人拥有的文件：不登记指纹
    expect(JSON.parse(fs.readFileSync(path.join(P, 'governance/owned.json'), 'utf8')).files['designs/d/estimate.json']).toBeUndefined()
  })

  it('页面读到的指纹与磁盘不符（未保存或外部改动）拒绝', () => {
    expect(() => setDesignStatus(modelRoot, 'p', 'd', { action: 'accept', sketches: { 'sketches/core.a.yaml': 'old' } }, root)).toThrow(WriteConflict)
    expect(() => setDesignStatus(modelRoot, 'p', 'd', { action: 'accept', sketches: {} }, root)).toThrow(WriteConflict)
    expect(design().status).toBe('draft')
  })
  it('有未解决的语义提示（待重连）拒绝', () => {
    write('designs/d/sketches/core.a.yaml', SKETCH.replace('to: core.a.y', 'to: core.a.gone'))
    expect(() => accept()).toThrow(/未解决的提示/)
    expect(design().status).toBe('draft')
  })
  it('已认可再认可拒绝', () => {
    accept()
    expect(() => accept()).toThrow(/已经认可/)
  })
})

describe('DL-33 回到起草与放弃', () => {
  it('回到起草：status: draft、指纹作废、记 withdrawnAt', () => {
    accept()
    setDesignStatus(modelRoot, 'p', 'd', { action: 'withdraw' }, root)
    const d = design()
    expect(d.status).toBe('draft')
    expect(d.approval).toEqual({ at: expect.any(String), withdrawnAt: expect.any(String) })
    expect(approvalDrift(listDesigns(P)[0].approval, seen())).toMatchObject({ missing: true, intact: false })
  })
  it('改一处再认可：指纹更新', () => {
    accept()
    setDesignStatus(modelRoot, 'p', 'd', { action: 'withdraw' }, root)
    write('designs/d/sketches/core.a.yaml', SKETCH.replace('name: X', 'name: X2'))
    accept()
    expect(design().approval).toMatchObject({ sketches: { 'sketches/core.a.yaml': ownedFingerprint(read('designs/d/sketches/core.a.yaml')) } })
    expect((design().approval as Record<string, unknown>).withdrawnAt).toBeUndefined()
  })
  it('放弃：从起草中、从已认可都可；之后一切动作拒绝（只看），项目卡片不列', () => {
    setDesignStatus(modelRoot, 'p', 'd', { action: 'abandon' }, root)
    expect(design().status).toBe('abandoned')
    expect(() => accept()).toThrow(/只看/)
    write('designs/d/design.yaml', 'design:\n  name: D\n  status: accepted\n')
    setDesignStatus(modelRoot, 'p', 'd', { action: 'abandon' }, root)
    expect(design().status).toBe('abandoned')
  })
  it('起草中「回到起草」拒绝；不认识的动作拒绝', () => {
    expect(() => setDesignStatus(modelRoot, 'p', 'd', { action: 'withdraw' }, root)).toThrow(/还没认可/)
    expect(() => setDesignStatus(modelRoot, 'p', 'd', { action: 'archive' as 'accept' }, root)).toThrow(WriteError)
  })
})

describe('DL-34 服务端锁定', () => {
  it('已认可的设计按设计写回草图被拒，提示「回到起草」', () => {
    accept()
    const def = load([{ path: 'designs/d/sketches/core.a.yaml', text: read('designs/d/sketches/core.a.yaml') }]).model.sketches[0].def
    const baseHash = seen()['sketches/core.a.yaml']
    expect(() => saveDesignSketches(modelRoot, 'p', 'd', { sketches: [{ mount: 'core.a', sketch: def, baseHash }] }, root)).toThrow(DesignLocked)
    expect(() => saveDesignSketches(modelRoot, 'p', 'd', { sketches: [{ mount: 'core.a', sketch: def, baseHash }] }, root)).toThrow(/回到起草/)
  })
})

describe('DL-35 认可后手改草图', () => {
  it('在文件里改了草图：指纹比对不符，列出改了的文件', () => {
    accept()
    write('designs/d/sketches/core.a.yaml', SKETCH.replace('name: Y', 'name: 手改'))
    const d = approvalDrift(listDesigns(P)[0].approval, seen())
    expect(d).toMatchObject({ intact: false, changed: ['sketches/core.a.yaml'] })
  })
})
