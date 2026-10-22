/**
 * 草图写回与轮次发现（B2 修订、B6、E8、Q11、X7i，ADR-0024）：整份写回比对指纹、服务端校验、文档合并保留未改动节点的注释；
 * 新建设计；持久草图版本带指纹；轮次从目录发现、说明读 revision.yaml；「交给 AI」附改动摘要；sketch-check 由设计推出项目。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { applyEdit, load, type SketchDef } from '../../src/model'
import { listDesigns, readDesignRevision, readIntentVersion, readModelDir, sketchHash } from '../../vite/readModelDir'
import { readLedger, readOwned, registerOwned } from '../../vite/governanceStore'
import { WriteError, appendFeedback } from '../../vite/writeModel'
import { SketchInvalid, WriteConflict, createDesign, saveSketch } from '../../vite/writeSketch'
import { createService } from '../../scripts/agent/service'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arch-sketch-'))
const modelRoot = path.join(root, 'model')
const P = path.join(modelRoot, 'p')
afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

const write = (rel: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(P, rel)), { recursive: true })
  fs.writeFileSync(path.join(P, rel), text)
}
const read = (rel: string) => fs.readFileSync(path.join(P, rel), 'utf8')

const SKELETON = `# 骨架
sketch:
  id: skeleton
  lifetime: persistent
  closed: [core]
  modules:
    - id: core   # 内核层
      name: Core
      kind: layer
      order: 1
      responsibility: 内核
      children:
        - { id: core.a, name: A, responsibility: a }
`
const DESIGN_SKETCH = `# 设计的草图
sketch:
  id: d
  modules:
    - id: core.a.x   # 要钉住的
      parent: core.a
      name: X
      responsibility: x
    - { id: core.a.y, parent: core.a, name: Y, responsibility: y }
  relations:
    - { id: rel.x-y, from: core.a.x, to: core.a.y, type: calls }
`

beforeEach(() => {
  fs.rmSync(P, { recursive: true, force: true })
  write('system.yaml', 'system: { id: p, name: P, source: { commit: abc123, generatedAt: "2026-10-22" } }')
  write('intent/skeleton.yaml', SKELETON)
  write('designs/d/design.yaml', '# 设计\ndesign:\n  name: D\n  status: draft\n  revisions:\n    - { id: r1, summary: 旧写法的说明, feedback: 第一轮意见 }\n')
  write('designs/d/sketch.yaml', DESIGN_SKETCH)
  for (const r of ['r1', 'r2', 'r10']) write(`designs/d/${r}/system.yaml`, 'system: { id: p, name: P }')
  write('designs/d/r2/revision.yaml', 'revision:\n  date: "2026-10-23"\n  summary: 第二轮\n  questions: [要不要拆]\n')
  registerOwned(modelRoot, 'p')
})

const sketchOf = (rel: string): SketchDef => load([{ path: rel, text: read(rel) }]).model.sketches[0].def
const persistent = () => load([{ path: 'intent/skeleton.yaml', text: read('intent/skeleton.yaml') }]).model.sketches
const edit = (def: SketchDef, op: Parameters<typeof applyEdit>[1]) => {
  const r = applyEdit(def, op, { persistent: persistent(), designSketch: true })
  if (!r.ok) throw new Error(r.reason)
  return r.sketch
}

describe('E8 轮次从目录发现', () => {
  it('含 system.yaml 的 r<N>/ 按数字排序；说明读 revision.yaml，旧设计的说明照常合并；revision.yaml 不属于该轮的描述', () => {
    const d = listDesigns(P)[0]
    expect(d.revisions.map(r => r.id)).toEqual(['r1', 'r2', 'r10'])
    expect(d.revisions[0]).toMatchObject({ summary: '旧写法的说明', feedback: '第一轮意见' })
    expect(d.revisions[1]).toMatchObject({ date: '2026-10-23', summary: '第二轮', questions: ['要不要拆'], feedback: undefined })
    expect(d.problems).toEqual([])
    expect(readModelDir(path.join(P, 'designs/d/r2'), root).files.map(f => f.path)).toEqual(['system.yaml'])
    expect(readDesignRevision(modelRoot, 'p', 'd', 'r10', root)?.version).toEqual({ design: 'd', revision: 'r10' })
  })

  it('两处都写说明时以 revision.yaml 为准并记为问题；revisions[] 有、目录没有的 id 记为问题', () => {
    write('designs/d/r1/revision.yaml', 'revision: { summary: 新写法 }\n')
    write('designs/d/design.yaml', 'design:\n  name: D\n  revisions:\n    - { id: r1, summary: 旧 }\n    - { id: r7, feedback: x }\n')
    const d = listDesigns(P)[0]
    expect(d.revisions[0].summary).toBe('新写法')
    expect(d.problems).toEqual([
      '轮次 r7 缺少快照目录 r7/system.yaml，已忽略',
      expect.stringContaining('轮次 r1 的 summary 在 design.yaml 与 r1/revision.yaml 两处都写了'),
    ])
  })

  it('只有草图、还没有轮次的设计不是问题', () => {
    write('designs/n/design.yaml', 'design: { name: N }\n')
    write('designs/n/sketch.yaml', 'sketch: { id: n, modules: [] }\n')
    expect(listDesigns(P).find(x => x.id === 'n')).toMatchObject({ revisions: [], problems: [], sketch: true })
  })

  it('B2：该轮在 revisions[] 里还没有条目时新建 { id, feedback }；目录不存在的轮次仍拒绝', () => {
    appendFeedback(modelRoot, 'p', 'd', 'r2', '第二轮意见', root)
    const revs = parse(read('designs/d/design.yaml')).design.revisions
    expect(revs[1]).toEqual({ id: 'r2', feedback: expect.stringMatching(/页面记录）第二轮意见\n$/) })
    expect(read('designs/d/design.yaml')).toContain('# 设计')
    expect(() => appendFeedback(modelRoot, 'p', 'd', 'r9', 'x', root)).toThrow('轮次不存在')
  })
})

describe('B6 草图整份写回', () => {
  const rel = 'designs/d/sketch.yaml'
  const save = (sketch: SketchDef, baseHash = sketchHash(read(rel))) =>
    saveSketch(modelRoot, 'p', { target: { kind: 'design', design: 'd' }, sketch, baseHash }, root)

  it('合并进 YAML 文档：未改动的节点连同注释保留，新条目跟随同一列表的写法；写后更新指纹、记拦截记录', () => {
    let s = edit(sketchOf(rel), { op: 'addModule', parent: 'core.a', name: 'Z' })
    s = edit(s, { op: 'connect', from: 'core.a.y', to: 'core.a.z', type: 'notifies' })
    s = edit(s, { op: 'updateModule', id: 'core.a.y', patch: { name: 'Y2' } })
    const out = save(s)
    const text = read(rel)
    expect(text).toContain('# 设计的草图')
    expect(text).toMatch(/- id: core\.a\.x +# 要钉住的/)
    expect(text).toMatch(/- \{ id: rel\.y-z, from: core\.a\.y, to: core\.a\.z, type: notifies \}/)
    expect(sketchOf(rel)).toEqual(s)
    expect(out.hash).toBe(sketchHash(text))
    expect(readOwned(path.join(P, 'governance'))!.files[rel]).toBe(sketchHash(text))
    expect(readLedger(path.join(P, 'governance')).at(-1)).toMatchObject({ tool: 'sketch', origin: 'page', file: rel, design: 'd' })
  })

  it('删掉的条目注释随之消失，其余照旧', () => {
    save(edit(sketchOf(rel), { op: 'removeModule', id: 'core.a.x' }))
    const text = read(rel)
    expect(text).not.toContain('要钉住的')
    expect(text).toContain('# 设计的草图')
  })

  it('X7i：文件指纹与读取时不符即拒绝（409），文件不动', () => {
    const before = read(rel)
    expect(() => save(sketchOf(rel), 'stale')).toThrow(WriteConflict)
    expect(read(rel)).toBe(before)
  })

  it('X7f：服务端再校验一遍，有 error 拒绝（422，附问题），文件不动', () => {
    const before = read(rel)
    const bad = { ...sketchOf(rel), modules: [...sketchOf(rel).modules!, { id: 'core.q', parent: 'core', name: 'Q', responsibility: 'q' }] }
    let err: unknown
    try {
      save(bad)
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(SketchInvalid)
    expect((err as SketchInvalid).validation.issues.map(i => i.code)).toEqual(['sketch.contradiction'])
    expect(read(rel)).toBe(before)
  })

  it('持久草图同样整份写回；路径只由 ID 拼出', () => {
    const def = edit(sketchOf('intent/skeleton.yaml'), { op: 'updateModule', id: 'core', patch: { responsibility: '内核与规则' } })
    expect(() => saveSketch(modelRoot, 'p', { target: { kind: 'persistent', id: 'skeleton' }, sketch: def, baseHash: 'x' }, root)).toThrow(WriteConflict)
    saveSketch(modelRoot, 'p', { target: { kind: 'persistent', id: 'skeleton' }, sketch: def, baseHash: sketchHash(read('intent/skeleton.yaml')) }, root)
    expect(read('intent/skeleton.yaml')).toMatch(/- id: core +# 内核层/)
    expect(read('intent/skeleton.yaml')).toContain('responsibility: 内核与规则')
    expect(() => saveSketch(modelRoot, 'p', { target: { kind: 'persistent', id: '../x' }, sketch: def, baseHash: '' }, root)).toThrow(WriteError)
  })
})

describe('B6 新建设计', () => {
  it('写 design.yaml（status: draft、base 取当前版本）与草图，两者登记指纹；没有轮次也能列出', () => {
    const r = createDesign(
      modelRoot,
      'p',
      { id: 'n', name: '新设计', goal: '一句话', sketch: { id: 'ignored', lifetime: 'until-implemented', modules: [] } },
      root,
    )
    expect(r.files).toEqual(['model/p/designs/n/design.yaml', 'model/p/designs/n/sketch.yaml'])
    expect(parse(read('designs/n/design.yaml')).design).toEqual({
      id: 'n',
      name: '新设计',
      status: 'draft',
      goal: '一句话',
      base: { commit: 'abc123', generatedAt: '2026-10-22' },
    })
    expect(parse(read('designs/n/sketch.yaml')).sketch).toEqual({ id: 'n', lifetime: 'until-implemented', modules: [] })
    const owned = readOwned(path.join(P, 'governance'))!.files
    expect(Object.keys(owned)).toEqual(expect.arrayContaining(['designs/n/design.yaml', 'designs/n/sketch.yaml']))
    expect(listDesigns(P).find(d => d.id === 'n')).toMatchObject({ status: 'draft', sketch: true, problems: [] })
  })

  it('设计已存在（409）、ID 不合法、名称为空、底稿校验不过：拒绝', () => {
    expect(() => createDesign(modelRoot, 'p', { id: 'd', name: 'D', sketch: { id: 'd' } }, root)).toThrow(WriteConflict)
    expect(() => createDesign(modelRoot, 'p', { id: '../x', name: 'X', sketch: { id: 'x' } }, root)).toThrow(WriteError)
    expect(() => createDesign(modelRoot, 'p', { id: 'x', name: ' ', sketch: { id: 'x' } }, root)).toThrow(WriteError)
    expect(() =>
      createDesign(modelRoot, 'p', { id: 'x', name: 'X', sketch: { id: 'x', modules: [{ id: 'core.q', parent: 'core', name: 'Q' }] } }, root),
    ).toThrow(SketchInvalid)
  })
})

describe('草图版本的指纹、持久草图版本与改动摘要', () => {
  it('设计的草图版本附 sketch { file, hash }；持久草图版本 = system.yaml + intent/**，附指纹，对比基线为当前版本', () => {
    expect(readDesignRevision(modelRoot, 'p', 'd', 'sketch', root)!.sketch).toEqual({
      file: 'designs/d/sketch.yaml',
      hash: sketchHash(read('designs/d/sketch.yaml')),
    })
    const v = readIntentVersion(modelRoot, 'p', 'skeleton', root)!
    expect(v.version).toEqual({ intent: 'skeleton' })
    expect(v.files.map(f => f.path)).toEqual(['intent/skeleton.yaml', 'system.yaml'])
    expect(v.sketch).toEqual({ file: 'intent/skeleton.yaml', hash: sketchHash(read('intent/skeleton.yaml')) })
    expect(v.compare?.current.label).toBe('当前版本')
    expect(readIntentVersion(modelRoot, 'p', 'nope', root)).toBeNull()
  })

  it('L-2：「交给 AI」附草图相对上一次提交的改动摘要；没有提交过时全部算新增', () => {
    const committed = () => DESIGN_SKETCH
    write(
      'designs/d/sketch.yaml',
      DESIGN_SKETCH.replace('name: X', 'name: X2').replace('    - { id: core.a.y, parent: core.a, name: Y, responsibility: y }\n', ''),
    )
    const prompt = readDesignRevision(modelRoot, 'p', 'd', 'sketch', root, { committed })!.sketchPrompt!
    expect(prompt).toContain('## 本次改动（草图相对上一次提交）')
    expect(prompt).toMatch(/- 修改模块「core\.a\.x」（X2）：name/)
    expect(prompt).toMatch(/- 删除模块「core\.a\.y」/)
    const fresh = readDesignRevision(modelRoot, 'p', 'd', 'sketch', root, { committed: () => null })!.sketchPrompt!
    expect(fresh).toMatch(/- 新增模块「core\.a\.x」/)
    expect(readDesignRevision(modelRoot, 'p', 'd', 'sketch', root)!.sketchPrompt).not.toContain('本次改动')
  })
})

describe('Q11 sketch-check 由设计推出项目', () => {
  it('只有一个项目有这个设计时不必 --project；没有或多个时报错并列出候选', () => {
    write('../q/system.yaml', 'system: { id: q, name: Q }')
    const svc = createService({ root, modelRoot, client: 'cli' } as Parameters<typeof createService>[0])
    expect(svc.sketchCheck(undefined, 'd', 'r1').project).toBe('p')
    expect(() => svc.sketchCheck(undefined, 'nope')).toThrow('没有项目有设计「nope」')
    write('../q/designs/d/design.yaml', 'design: { name: D }\n')
    write('../q/designs/d/sketch.yaml', 'sketch: { id: d, modules: [] }\n')
    expect(() => svc.sketchCheck(undefined, 'd')).toThrow('多个项目都有设计「d」')
    fs.rmSync(path.join(modelRoot, 'q'), { recursive: true, force: true })
  })
})
