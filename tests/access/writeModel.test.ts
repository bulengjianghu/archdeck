/**
 * 描述写入（B1–B6，ADR-0019、ADR-0023）：只追加人拥有的文件，保留注释与其他内容；校验不过的拒绝且不写；归档经确认层写确认记录（X3、Z6）。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { loadModel, reviewHash, reviewStates } from '../../src/model'
import { readModelDir } from '../../vite/readModelDir'
import { WriteError, appendAccepted, appendAllow, appendFeedback, appendIgnore, appendReviewed, appendRole, archiveDesign } from '../../vite/writeModel'

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
  /** 用当前描述算出的指纹（Z6：写入端点只收与它相等的 hash） */
  const current = (module: string) => reviewHash(loadModel(readModelDir(P, root).files).index, module)
  const ledger = () => {
    const f = path.join(P, 'governance', 'ledger.jsonl')
    return fs.existsSync(f)
      ? fs
          .readFileSync(f, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map(l => JSON.parse(l))
      : []
  }
  const entry = (module: string, extra: Record<string, unknown> = {}) => ({
    module,
    at: '2026-10-22',
    hash: current(module),
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
        hash: current('a'),
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
    const r = appendReviewed(modelRoot, 'p', [entry('a', { source: 'sketch:d1' })], root)
    expect(r).toMatchObject({ added: [], updated: ['a'] })
    const text = read('reviewed.yaml')
    expect(text).toContain('# 架构师的确认')
    const list = parse(text).reviewed
    expect(list).toHaveLength(2)
    expect(list[0]).toEqual({ module: 'a', at: '2026-10-22', hash: current('a'), source: 'sketch:d1', summary: entry('a').summary })
    expect(list[0].note).toBeUndefined()
    expect(list[1]).toMatchObject({ module: 'b', hash: 'keep' })
  })
  it('批量：一次写多条，有的更新有的追加；同一批里重复的模块取最后一条；at 缺省为当天', () => {
    write('reviewed.yaml', 'reviewed:\n  - { module: a, at: "2026-10-01", hash: old, source: manual }\n')
    const r = appendReviewed(modelRoot, 'p', [entry('b', { at: undefined }), entry('a', { note: 'first' }), entry('a', { note: 'last' })], root)
    expect(r).toMatchObject({ updated: ['a'], added: ['b'] })
    const list = parse(read('reviewed.yaml')).reviewed
    expect(list.map((e: { module: string; hash: string; note?: string }) => [e.module, e.hash, e.note])).toEqual([
      ['a', current('a'), 'last'],
      ['b', current('b'), undefined],
    ])
    expect(list[1].at).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
  it('Z7：以系统 ID 记一条确认（指纹只覆盖简介）；简介变了再拿旧指纹写即拒绝', () => {
    write('system.yaml', 'system: { id: p, name: P, description: "给谁用。按什么分。" }')
    const r = appendReviewed(modelRoot, 'p', [entry('p', { summary: { description: '给谁用。按什么分。' } })], root)
    expect(r).toMatchObject({ added: ['p'] })
    expect(parse(read('reviewed.yaml')).reviewed[0]).toMatchObject({ module: 'p', hash: current('p') })
    const stale = entry('p')
    write('system.yaml', 'system: { id: p, name: P, description: "给谁用。按别的分。" }')
    expect(() => appendReviewed(modelRoot, 'p', [stale], root)).toThrow('指纹不符')
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
  it('hash 不符：任一条的 hash 不等于用当前描述算出的指纹即拒绝整次写入，不写文件、不记拦截记录', () => {
    expect(() => appendReviewed(modelRoot, 'p', [entry('a'), entry('b', { hash: 'aaaa0000bbbb1111' })], root)).toThrow('指纹不符')
    expect(fs.existsSync(path.join(P, 'reviewed.yaml'))).toBe(false)
    expect(ledger()).toEqual([])
    // 描述在确认前变了：页面带来的旧指纹被拒绝
    const stale = entry('a')
    write('modules/m.yaml', 'modules:\n  - { id: a, name: A, responsibility: 改过的职责 }\n  - { id: b, name: B, responsibility: y }\n')
    expect(() => appendReviewed(modelRoot, 'p', [stale], root)).toThrow(WriteError)
  })
  it('写后多一行拦截记录：tool reviewed、来源、模块数、设计 ID（可选）', () => {
    appendReviewed(modelRoot, 'p', [entry('a'), entry('b')], root, { origin: 'page' })
    expect(ledger()).toEqual([{ at: expect.any(String), tool: 'reviewed', origin: 'page', modules: 2 }])
    appendReviewed(modelRoot, 'p', [entry('a')], root)
    appendReviewed(modelRoot, 'p', [entry('b', { source: 'sketch:d' })], root, { origin: 'archive', design: 'd' })
    expect(ledger().slice(1)).toEqual([
      { at: expect.any(String), tool: 'reviewed', origin: 'cli', modules: 1 },
      { at: expect.any(String), tool: 'reviewed', origin: 'archive', modules: 1, design: 'd' },
    ])
  })
})

describe('X4 认可偏差 · X3 归档 / 晋升', () => {
  const SKETCH = 'sketch:\n  id: d\n  mount: a\n  modules:\n    - { id: a.x, name: X }\n  relations:\n    - { id: rel.d.x-b, from: a.x, to: b, type: calls }\n'
  it('认可偏差追加到 design.accepted（键、理由、日期）；理由必填；重复的拒绝', () => {
    appendAccepted(modelRoot, 'p', 'd', 'missing-relation:rel.d.x-b', '经注入', root)
    const acc = parse(read('designs/d/design.yaml')).design.accepted
    expect(acc).toEqual([{ deviation: 'missing-relation:rel.d.x-b', reason: '经注入', at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) }])
    expect(read('designs/d/design.yaml')).toContain('# 设计')
    expect(() => appendAccepted(modelRoot, 'p', 'd', 'missing-relation:rel.d.x-b', '再来一次', root)).toThrow('已经认可过')
    expect(() => appendAccepted(modelRoot, 'p', 'd', 'field:a', ' ', root)).toThrow('理由')
    expect(() => appendAccepted(modelRoot, 'p', 'nope', 'field:a', 'x', root)).toThrow('设计不存在')
  })

  it('归档：没有草图、已归档、核验不一致都拒绝；一致后状态改为 implemented，为草图覆盖的模块写确认记录（来源 sketch:<设计>，Z6），指纹随之更新', () => {
    expect(() => archiveDesign(modelRoot, 'p', 'd', root)).toThrow('没有草图')
    write('designs/d/sketches/a.yaml', SKETCH)
    // a.x 不存在：error，拒绝
    expect(() => archiveDesign(modelRoot, 'p', 'd', root)).toThrow('不能归档：草图「a」核验不一致（1 个错误')
    write(
      'modules/m.yaml',
      'modules:\n  - { id: a, name: A, responsibility: x }\n  - { id: b, name: B, responsibility: y }\n  - { id: a.x, name: X, parent: a, responsibility: z }\n',
    )
    // 关系没有对应：warning，认可后一致
    expect(() => archiveDesign(modelRoot, 'p', 'd', root)).toThrow('1 个未认可的提醒')
    appendAccepted(modelRoot, 'p', 'd', 'missing-relation:rel.d.x-b', '经注入', root)
    write('reviewed.yaml', '# 架构师的确认\nreviewed:\n  - { module: b, at: "2026-10-01", hash: keep, source: manual }\n')
    const r = archiveDesign(modelRoot, 'p', 'd', root)
    expect(r).toMatchObject({ file: 'model/p/designs/d/design.yaml', outcome: 'archive', reviewed: { count: 1, file: 'model/p/reviewed.yaml' } })
    expect(parse(read('designs/d/design.yaml')).design.status).toBe('implemented')
    // 联调：确认层按它的口径算指纹与摘要；草图没画的 b 原样保留
    const { index } = loadModel(readModelDir(P, root).files)
    const list = parse(read('reviewed.yaml')).reviewed
    expect(read('reviewed.yaml')).toContain('# 架构师的确认')
    expect(list).toHaveLength(2)
    expect(list[0]).toMatchObject({ module: 'b', hash: 'keep', source: 'manual' })
    expect(list[1]).toEqual({
      module: 'a.x',
      at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      hash: reviewHash(index, 'a.x'),
      source: 'sketch:d',
      summary: { responsibility: 'z' },
    })
    expect(reviewStates(index).get('a.x')).toMatchObject({ status: 'reviewed' })
    expect(JSON.parse(read('governance/owned.json')).files['reviewed.yaml']).toBeTruthy()
    // 归档写确认记录走同一路径：拦截记录多一行，来源 archive、带设计 ID
    const lines = read('governance/ledger.jsonl')
      .split('\n')
      .filter(Boolean)
      .map(l => JSON.parse(l))
    expect(lines).toEqual([{ at: expect.any(String), tool: 'reviewed', origin: 'archive', modules: 1, design: 'd' }])
    expect(() => archiveDesign(modelRoot, 'p', 'd', root)).toThrow('已归档')
    expect(fs.existsSync(path.join(modelRoot, 'p', 'governance', 'owned.json'))).toBe(true)
  })

  it('晋升：声明 supersedes 的草图整份替换 intent/<ID>.yaml（id、lifetime 改写，去掉 supersedes），设计同样归档', () => {
    write(
      'intent/skeleton.yaml',
      'sketch:\n  id: skeleton\n  mount: root\n  lifetime: persistent\n  closed: [a]\n  modules:\n    - { id: a, name: A, kind: layer, order: 1, abstraction: x, responsibility: x }\n    - { id: b, name: B, kind: layer, order: 2, abstraction: y, responsibility: y }\n',
    )
    write(
      'designs/d/sketches/root.yaml',
      '# 新骨架\nsketch:\n  id: d\n  mount: root\n  supersedes: skeleton\n  closed: [a]\n  modules:\n    - { id: a, name: A, kind: layer, order: 1, abstraction: x, responsibility: x, children: [{ id: a.x, name: X }] }\n    - { id: b, name: B, kind: layer, order: 2, abstraction: y, responsibility: y }\n  layout:\n    modules: { a: { x: 1, y: 2 } }\n',
    )
    write('modules/m.yaml', 'modules:\n  - { id: a.x, name: X, parent: a, responsibility: z }\n')
    const r = archiveDesign(modelRoot, 'p', 'd', root)
    expect(r).toMatchObject({ outcome: 'promote', promoted: 'model/p/intent/skeleton.yaml', promotedAll: ['model/p/intent/skeleton.yaml'] })
    const text = read('intent/skeleton.yaml')
    expect(text).toContain('# 新骨架')
    expect(parse(text).sketch).toMatchObject({ id: 'skeleton', lifetime: 'persistent' })
    expect(parse(text).sketch.supersedes).toBeUndefined()
    expect(parse(text).sketch.modules).toHaveLength(2)
    expect(parse(text).sketch.modules[0].children).toEqual([{ id: 'a.x', name: 'X' }])
    // X15：晋升连 layout 一并替换
    expect(parse(text).sketch.layout).toEqual({ modules: { a: { x: 1, y: 2 } } })
    expect(parse(read('designs/d/design.yaml')).design.status).toBe('implemented')
  })
})

describe('U11、M16 认可角色（appendRole → intent/roles.yaml）', () => {
  it('没有文件时新建；保留注释、只追加；加载后模块带 role；记指纹与拦截记录；不存在的模块、已有不同角色、草图写了 role 的拒绝', () => {
    appendRole(modelRoot, 'p', { module: 'a', role: 'shared' }, root)
    expect(parse(read('intent/roles.yaml'))).toEqual({ roles: { a: 'shared' } })
    write('intent/roles.yaml', `# 人拥有\n${read('intent/roles.yaml')}`)
    appendRole(modelRoot, 'p', { module: 'b', role: 'core' }, root)
    expect(read('intent/roles.yaml')).toContain('# 人拥有')
    expect(parse(read('intent/roles.yaml'))).toEqual({ roles: { a: 'shared', b: 'core' } })
    const { index } = loadModel(readModelDir(P, root).files)
    expect([index.modules.get('a')!.role, index.modules.get('b')!.role]).toEqual(['shared', 'core'])
    expect(() => appendRole(modelRoot, 'p', { module: 'a', role: 'core' }, root)).toThrow('只追加')
    expect(() => appendRole(modelRoot, 'p', { module: 'zz', role: 'shared' }, root)).toThrow('模块不存在')
    expect(() => appendRole(modelRoot, 'p', { module: 'a', role: 'x' as never }, root)).toThrow(WriteError)
    const ledger = read('governance/ledger.jsonl')
      .trim()
      .split('\n')
      .map(l => JSON.parse(l))
    expect(ledger.filter(e => e.tool === 'roles').map(e => [e.module, e.role])).toEqual([
      ['a', 'shared'],
      ['b', 'core'],
    ])
    expect(JSON.parse(read('governance/owned.json')).files['intent/roles.yaml']).toMatch(/^[0-9a-f]{40}$/)
    write(
      'intent/skeleton.yaml',
      'sketch:\n  id: skeleton\n  mount: root\n  modules:\n    - { id: c, name: C, kind: layer, order: 1, children: [{ id: c.x, name: X, role: core }] }\n',
    )
    expect(() => appendRole(modelRoot, 'p', { module: 'c.x', role: 'shared' }, root)).toThrow('草图')
  })
})
