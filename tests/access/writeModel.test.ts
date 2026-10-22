/**
 * 描述写入（B1–B5，ADR-0019）：只追加人拥有的文件，保留注释与其他内容；校验不过的拒绝且不写。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { WriteError, appendAccepted, appendAllow, appendFeedback, appendIgnore, archiveDesign } from '../../vite/writeModel'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arch-write-'))
const modelRoot = path.join(root, 'model')
const P = path.join(modelRoot, 'p')
afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

function write(rel: string, text: string) {
  fs.mkdirSync(path.dirname(path.join(P, rel)), { recursive: true })
  fs.writeFileSync(path.join(P, rel), text)
}
const read = (rel: string) => fs.readFileSync(path.join(P, rel), 'utf8')

beforeEach(() => {
  fs.rmSync(P, { recursive: true, force: true })
  write('system.yaml', 'system: { id: p, name: P }')
  write('modules/m.yaml', 'modules:\n  - { id: a, name: A, responsibility: x }\n  - { id: b, name: B, responsibility: y }\n')
  write('rules.yaml', '# 架构师的意图\nrules:\n  allow:\n    - { from: b, to: a, reason: 旧例外 }\n')
  write('designs/d/design.yaml', '# 设计\ndesign:\n  name: D\n  revisions:\n    - { id: r1, feedback: 第一轮意见 }\n    - id: r2\n')
  write('designs/d/r1/system.yaml', 'system: { id: p, name: P }')
  write('designs/d/r2/system.yaml', 'system: { id: p, name: P }')
})

describe('B2 记录评审意见', () => {
  it('追加到该轮 feedback（已有内容后空一行、带日期），保留注释', () => {
    appendFeedback(modelRoot, 'p', 'd', 'r1', '把 B 拆开', root)
    appendFeedback(modelRoot, 'p', 'd', 'r2', '同意', root)
    const text = read('designs/d/design.yaml')
    expect(text).toContain('# 设计')
    const revs = parse(text).design.revisions
    expect(revs[0].feedback).toMatch(/^第一轮意见\n\n（\d{4}-\d{2}-\d{2} 页面记录）把 B 拆开\n$/)
    expect(revs[1].feedback).toMatch(/页面记录）同意/)
  })
  it('空文本、不存在的轮次、坏 ID 拒绝', () => {
    expect(() => appendFeedback(modelRoot, 'p', 'd', 'r1', '  ', root)).toThrow(WriteError)
    expect(() => appendFeedback(modelRoot, 'p', 'd', 'r9', 'x', root)).toThrow('轮次不存在')
    expect(() => appendFeedback(modelRoot, 'p', '..', 'r1', 'x', root)).toThrow(WriteError)
  })
})

describe('B3 加例外', () => {
  it('追加到 rules.allow，理由带日期，保留注释与已有例外', () => {
    const r = appendAllow(modelRoot, 'p', { from: 'a', to: 'b', rule: 'layer', reason: '过渡期' }, root)
    expect(r.file).toBe('model/p/rules.yaml')
    const text = read('rules.yaml')
    expect(text).toContain('# 架构师的意图')
    const allow = parse(text).rules.allow
    expect(allow).toHaveLength(2)
    expect(allow[1]).toMatchObject({ from: 'a', to: 'b', rule: 'layer', reason: expect.stringMatching(/^过渡期（\d{4}/) })
  })
  it('理由必填、模块必须存在、规则种类合法、重复的拒绝；拒绝时不写', () => {
    const before = read('rules.yaml')
    expect(() => appendAllow(modelRoot, 'p', { from: 'a', to: 'b', reason: ' ' }, root)).toThrow('理由')
    expect(() => appendAllow(modelRoot, 'p', { from: 'a', to: 'zz', reason: 'x' }, root)).toThrow('模块不存在')
    expect(() => appendAllow(modelRoot, 'p', { from: 'a', to: 'b', rule: 'bad' as never, reason: 'x' }, root)).toThrow('rule')
    expect(() => appendAllow(modelRoot, 'p', { from: 'b', to: 'a', reason: 'x' }, root)).toThrow('已经存在')
    expect(read('rules.yaml')).toBe(before)
  })
  it('没有 rules.yaml 时新建', () => {
    fs.rmSync(path.join(P, 'rules.yaml'))
    appendAllow(modelRoot, 'p', { from: 'a', to: 'b', reason: 'x' }, root)
    expect(parse(read('rules.yaml')).rules.allow[0]).toMatchObject({ from: 'a', to: 'b' })
  })
})

describe('B4 加入忽略', () => {
  it('追加到 source-ignore.yaml；没有文件时新建；重复与越界的拒绝', () => {
    appendIgnore(modelRoot, 'p', 'docs/*', root)
    appendIgnore(modelRoot, 'p', 'tools/x.ts', root)
    expect(parse(read('source-ignore.yaml')).sourceIgnore).toEqual(['docs/*', 'tools/x.ts'])
    expect(() => appendIgnore(modelRoot, 'p', 'docs/*', root)).toThrow('已在忽略清单')
    expect(() => appendIgnore(modelRoot, 'p', '../etc/*', root)).toThrow(WriteError)
    expect(() => appendIgnore(modelRoot, 'p', '/abs', root)).toThrow(WriteError)
  })
})

describe('B1 只写人拥有的文件', () => {
  it('写入后 AI 生成的描述文件不变', () => {
    const m = read('modules/m.yaml')
    const s = read('system.yaml')
    appendIgnore(modelRoot, 'p', 'a/*', root)
    appendAllow(modelRoot, 'p', { from: 'a', to: 'b', reason: 'x' }, root)
    appendFeedback(modelRoot, 'p', 'd', 'r1', 'x', root)
    expect(read('modules/m.yaml')).toBe(m)
    expect(read('system.yaml')).toBe(s)
    expect(() => appendIgnore(modelRoot, 'nope', 'a/*', root)).toThrow('项目不存在')
  })
})

describe('X4 认可偏差 · X3 归档 / 晋升', () => {
  const SKETCH = 'sketch:\n  id: d\n  modules:\n    - { id: a.x, name: X, parent: a }\n  relations:\n    - { id: rel.d.x-b, from: a.x, to: b, type: calls }\n'
  it('认可偏差追加到 design.accepted（键、理由、日期）；理由必填；重复的拒绝', () => {
    appendAccepted(modelRoot, 'p', 'd', 'missing-relation:rel.d.x-b', '经注入', root)
    const acc = parse(read('designs/d/design.yaml')).design.accepted
    expect(acc).toEqual([{ deviation: 'missing-relation:rel.d.x-b', reason: '经注入', at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) }])
    expect(read('designs/d/design.yaml')).toContain('# 设计')
    expect(() => appendAccepted(modelRoot, 'p', 'd', 'missing-relation:rel.d.x-b', '再来一次', root)).toThrow('已经认可过')
    expect(() => appendAccepted(modelRoot, 'p', 'd', 'field:a', ' ', root)).toThrow('理由')
    expect(() => appendAccepted(modelRoot, 'p', 'nope', 'field:a', 'x', root)).toThrow('设计不存在')
  })

  it('归档：没有草图、已归档、核验不一致都拒绝；一致后状态改为 implemented，确认记录经 appendReviewed（桩：pending），指纹随之更新', () => {
    expect(() => archiveDesign(modelRoot, 'p', 'd', root)).toThrow('没有草图')
    write('designs/d/sketch.yaml', SKETCH)
    // a.x 不存在：error，拒绝
    expect(() => archiveDesign(modelRoot, 'p', 'd', root)).toThrow('不能归档：核验不一致（1 个错误')
    write(
      'modules/m.yaml',
      'modules:\n  - { id: a, name: A, responsibility: x }\n  - { id: b, name: B, responsibility: y }\n  - { id: a.x, name: X, parent: a, responsibility: z }\n',
    )
    // 关系没有对应：warning，认可后一致
    expect(() => archiveDesign(modelRoot, 'p', 'd', root)).toThrow('1 个未认可的提醒')
    appendAccepted(modelRoot, 'p', 'd', 'missing-relation:rel.d.x-b', '经注入', root)
    const r = archiveDesign(modelRoot, 'p', 'd', root)
    expect(r).toMatchObject({ file: 'model/p/designs/d/design.yaml', outcome: 'archive', reviewed: { count: 1, pending: true } })
    expect(parse(read('designs/d/design.yaml')).design.status).toBe('implemented')
    expect(() => archiveDesign(modelRoot, 'p', 'd', root)).toThrow('已归档')
    expect(fs.existsSync(path.join(modelRoot, 'p', 'governance', 'owned.json'))).toBe(true)
  })

  it('晋升：声明 supersedes 的草图整份替换 intent/<ID>.yaml（id、lifetime 改写，去掉 supersedes），设计同样归档', () => {
    write(
      'intent/skeleton.yaml',
      'sketch:\n  id: skeleton\n  lifetime: persistent\n  closed: [a]\n  modules:\n    - { id: a, name: A, kind: layer, order: 1, abstraction: x, responsibility: x }\n    - { id: b, name: B, kind: layer, order: 2, abstraction: y, responsibility: y }\n',
    )
    write(
      'designs/d/sketch.yaml',
      '# 新骨架\nsketch:\n  id: d\n  supersedes: skeleton\n  closed: [a]\n  modules:\n    - { id: a, name: A, kind: layer, order: 1, abstraction: x, responsibility: x }\n    - { id: b, name: B, kind: layer, order: 2, abstraction: y, responsibility: y }\n    - { id: a.x, name: X, parent: a }\n',
    )
    write('modules/m.yaml', 'modules:\n  - { id: a.x, name: X, parent: a, responsibility: z }\n')
    const r = archiveDesign(modelRoot, 'p', 'd', root)
    expect(r).toMatchObject({ outcome: 'promote', promoted: 'model/p/intent/skeleton.yaml' })
    const text = read('intent/skeleton.yaml')
    expect(text).toContain('# 新骨架')
    expect(parse(text).sketch).toMatchObject({ id: 'skeleton', lifetime: 'persistent' })
    expect(parse(text).sketch.supersedes).toBeUndefined()
    expect(parse(text).sketch.modules).toHaveLength(3)
    expect(parse(read('designs/d/design.yaml')).design.status).toBe('implemented')
  })
})
