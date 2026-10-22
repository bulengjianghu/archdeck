/**
 * 描述写入（B1–B5，ADR-0019）：只追加人拥有的文件，保留注释与其他内容；校验不过的拒绝且不写。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { WriteError, appendAllow, appendFeedback, appendIgnore, appendReviewed } from '../../vite/writeModel'

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

describe('Z1、Z6 确认记录（appendReviewed）', () => {
  const entry = (module: string, extra: Record<string, unknown> = {}) => ({
    module,
    at: '2026-10-22',
    hash: 'aaaa0000bbbb1111',
    source: 'manual',
    summary: { responsibility: 'x', provides: [{ id: 'if.a', signature: 'a(): void' }] },
    ...extra,
  })
  it('追加：没有文件时新建 reviewed.yaml，写进 module / at / hash / source / note / summary', () => {
    const r = appendReviewed(modelRoot, 'p', [entry('a', { note: '  看过了  ' })], root)
    expect(r).toMatchObject({ file: 'model/p/reviewed.yaml', added: ['a'], updated: [] })
    const list = parse(read('reviewed.yaml')).reviewed
    expect(list).toEqual([
      {
        module: 'a',
        at: '2026-10-22',
        hash: 'aaaa0000bbbb1111',
        source: 'manual',
        note: '看过了',
        summary: { responsibility: 'x', provides: [{ id: 'if.a', signature: 'a(): void' }] },
      },
    ])
  })
  it('更新：同一模块再次确认时覆盖那一条、不多一条，保留文件注释与其他记录', () => {
    write(
      'reviewed.yaml',
      '# 架构师的确认\nreviewed:\n  - { module: a, at: "2026-10-01", hash: old, source: manual, note: 旧话 }\n  - { module: b, at: "2026-10-01", hash: keep, source: manual }\n',
    )
    const r = appendReviewed(modelRoot, 'p', [entry('a', { hash: 'new1', source: 'sketch:d1' })], root)
    expect(r).toMatchObject({ added: [], updated: ['a'] })
    const text = read('reviewed.yaml')
    expect(text).toContain('# 架构师的确认')
    const list = parse(text).reviewed
    expect(list).toHaveLength(2)
    expect(list[0]).toEqual({ module: 'a', at: '2026-10-22', hash: 'new1', source: 'sketch:d1', summary: entry('a').summary })
    expect(list[0].note).toBeUndefined()
    expect(list[1]).toMatchObject({ module: 'b', hash: 'keep' })
  })
  it('批量：一次写多条，有的更新有的追加；同一批里重复的模块取最后一条；at 缺省为当天', () => {
    write('reviewed.yaml', 'reviewed:\n  - { module: a, at: "2026-10-01", hash: old, source: manual }\n')
    const r = appendReviewed(modelRoot, 'p', [entry('b', { at: undefined }), entry('a', { hash: 'first' }), entry('a', { hash: 'last' })], root)
    expect(r).toMatchObject({ updated: ['a'], added: ['b'] })
    const list = parse(read('reviewed.yaml')).reviewed
    expect(list.map((e: { module: string; hash: string }) => [e.module, e.hash])).toEqual([
      ['a', 'last'],
      ['b', 'aaaa0000bbbb1111'],
    ])
    expect(list[1].at).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
  it('校验：模块必须存在、hash 必填、source 只能是 manual 或 sketch:<设计 ID>、at 为日期；一条不过整批不写；root 缺省为模型根目录的上一级', () => {
    expect(() => appendReviewed(modelRoot, 'p', [entry('zz')], root)).toThrow('模块不存在')
    expect(() => appendReviewed(modelRoot, 'p', [entry('a'), entry('b', { source: 'robot' })], root)).toThrow('source')
    expect(() => appendReviewed(modelRoot, 'p', [entry('a', { hash: ' ' })], root)).toThrow('hash')
    expect(() => appendReviewed(modelRoot, 'p', [entry('a', { at: '昨天' })], root)).toThrow('at')
    expect(() => appendReviewed(modelRoot, 'p', [], root)).toThrow(WriteError)
    expect(fs.existsSync(path.join(P, 'reviewed.yaml'))).toBe(false)
    expect(appendReviewed(modelRoot, 'p', [entry('a')]).file).toBe('model/p/reviewed.yaml')
  })
  it('写入后 AI 生成的描述文件不变', () => {
    const m = read('modules/m.yaml')
    appendReviewed(modelRoot, 'p', [entry('a'), entry('b')], root)
    expect(read('modules/m.yaml')).toBe(m)
  })
})
