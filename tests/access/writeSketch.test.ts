/**
 * 草图写回与轮次发现（B2 修订、B6、B7、E8、Q11、X7i、X20，ADR-0024、ADR-0025）：整份写回比对指纹、服务端校验、文档合并保留未改动节点的注释；
 * 按设计写回多张草图（新文件、级联改名、删除子草图、整次拒绝）；新建设计；草图版本与持久草图版本带指纹；轮次从目录发现、说明读 revision.yaml；
 * 「交给 AI」附改动摘要与相对基线的血缘摘要；sketch-check 由设计推出项目。
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
import { SketchInvalid, WriteConflict, createDesign, saveDesignSketches, saveSketch } from '../../vite/writeSketch'
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
  mount: root
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
  mount: core.a
  modules:
    - id: core.a.x   # 要钉住的
      name: X
      responsibility: x
    - { id: core.a.y, name: Y, responsibility: y }
  relations:
    - { id: rel.x-y, from: core.a.x, to: core.a.y, type: calls }
`

beforeEach(() => {
  fs.rmSync(P, { recursive: true, force: true })
  write('system.yaml', 'system: { id: p, name: P, source: { commit: abc123, generatedAt: "2026-10-22" } }')
  write('intent/skeleton.yaml', SKELETON)
  write('designs/d/design.yaml', '# 设计\ndesign:\n  name: D\n  status: draft\n  revisions:\n    - { id: r1, summary: 旧写法的说明, feedback: 第一轮意见 }\n')
  write('designs/d/sketches/core.a.yaml', DESIGN_SKETCH)
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
    write('designs/n/sketches/core.a.yaml', 'sketch: { id: n, mount: core.a, modules: [] }\n')
    expect(listDesigns(P).find(x => x.id === 'n')).toMatchObject({
      revisions: [],
      problems: [],
      sketch: true,
      sketches: [{ mount: 'core.a', file: 'designs/n/sketches/core.a.yaml', needsLayout: true }],
    })
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
  const rel = 'designs/d/sketches/core.a.yaml'
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
    const bad = { ...sketchOf(rel), modules: [...sketchOf(rel).modules!, { id: 'core.q', name: 'Q', responsibility: 'q' }] }
    let err: unknown
    try {
      save(bad)
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(SketchInvalid)
    expect((err as SketchInvalid).validation.errors.map(i => i.code)).toEqual(['sketch.id-prefix'])
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

describe('X20、B7 按设计写回', () => {
  const rel = 'designs/d/sketches/core.a.yaml'
  const hash = (r: string) => sketchHash(read(r))

  it('一次写多张：改过的整份合并、推出并改过的写成新文件、丢掉没有关系的引用节点；每个文件更新指纹并记拦截记录', () => {
    const a = { ...edit(sketchOf(rel), { op: 'addReference', id: 'core' }), layout: { modules: { 'core.a.x': { x: 1, y: 2 }, core: { x: 9, y: 9 } } } }
    const fresh: SketchDef = { id: 'd', mount: 'core.a.x', modules: [{ id: 'core.a.x.inner', name: 'Inner' }] }
    const out = saveDesignSketches(
      modelRoot,
      'p',
      'd',
      {
        sketches: [
          { mount: 'core.a', sketch: a, baseHash: hash(rel) },
          { mount: 'core.a.x', sketch: fresh, baseHash: null },
        ],
      },
      root,
    )
    expect(out.files.map(f => f.file)).toEqual(['model/p/designs/d/sketches/core.a.yaml', 'model/p/designs/d/sketches/core.a.x.yaml'])
    expect(out.dropped).toEqual([{ mount: 'core.a', ids: ['core'] }])
    expect(sketchOf(rel).layout).toEqual({ modules: { 'core.a.x': { x: 1, y: 2 } } })
    expect(read(rel)).toMatch(/- id: core\.a\.x +# 要钉住的/)
    expect(sketchOf('designs/d/sketches/core.a.x.yaml')).toMatchObject({ mount: 'core.a.x', modules: [{ id: 'core.a.x.inner' }] })
    const owned = readOwned(path.join(P, 'governance'))!.files
    expect(owned['designs/d/sketches/core.a.x.yaml']).toBe(hash('designs/d/sketches/core.a.x.yaml'))
    expect(readLedger(path.join(P, 'governance')).slice(-2)).toEqual([
      expect.objectContaining({ tool: 'sketch', file: rel, design: 'd' }),
      expect.objectContaining({ tool: 'sketch', file: 'designs/d/sketches/core.a.x.yaml', design: 'd', created: true }),
    ])
  })

  it('X12、B7：级联改名写到新文件名并删旧文件；删掉的子草图删文件；只动 designs/<设计>/sketches/*', () => {
    write('designs/d/sketches/core.a.x.yaml', 'sketch: { id: d, mount: core.a.x, modules: [{ id: core.a.x.i, name: I }] }\n')
    write('designs/d/sketches/core.a.y.yaml', 'sketch: { id: d, mount: core.a.y, modules: [] }\n')
    const renamed: SketchDef = { id: 'd', mount: 'core.a.z', modules: [{ id: 'core.a.z.i', name: 'I', from: ['core.a.x.i'] }] }
    const parent = edit(sketchOf(rel), { op: 'renameModule', id: 'core.a.x', newId: 'core.a.z' })
    saveDesignSketches(
      modelRoot,
      'p',
      'd',
      {
        sketches: [
          { mount: 'core.a', sketch: parent, baseHash: hash(rel) },
          { mount: 'core.a.z', sketch: renamed, baseHash: hash('designs/d/sketches/core.a.x.yaml'), renamedFrom: 'core.a.x' },
        ],
        removed: [{ mount: 'core.a.y', baseHash: hash('designs/d/sketches/core.a.y.yaml') }],
      },
      root,
    )
    expect(fs.readdirSync(path.join(P, 'designs/d/sketches')).sort()).toEqual(['core.a.yaml', 'core.a.z.yaml'])
    expect(sketchOf('designs/d/sketches/core.a.z.yaml').modules![0]).toEqual({ id: 'core.a.z.i', name: 'I', from: ['core.a.x.i'] })
    const owned = readOwned(path.join(P, 'governance'))!.files
    expect(owned['designs/d/sketches/core.a.x.yaml']).toBeUndefined()
    expect(owned['designs/d/sketches/core.a.y.yaml']).toBeUndefined()
    expect(readLedger(path.join(P, 'governance')).slice(-2)).toEqual([
      expect.objectContaining({ file: 'designs/d/sketches/core.a.z.yaml', renamedFrom: 'designs/d/sketches/core.a.x.yaml' }),
      expect.objectContaining({ file: 'designs/d/sketches/core.a.y.yaml', removed: true }),
    ])
    expect(read('intent/skeleton.yaml')).toBe(SKELETON)
  })

  it('X7i：任一文件指纹不符、新文件已存在、mount 与写入位置不一致——整次拒绝，一个文件都不写', () => {
    const before = read(rel)
    const fresh: SketchDef = { id: 'd', mount: 'core.a.x', modules: [] }
    const other = edit(sketchOf(rel), { op: 'updateModule', id: 'core.a.y', patch: { name: 'Y2' } })
    expect(() =>
      saveDesignSketches(
        modelRoot,
        'p',
        'd',
        {
          sketches: [
            { mount: 'core.a.x', sketch: fresh, baseHash: null },
            { mount: 'core.a', sketch: other, baseHash: 'stale' },
          ],
        },
        root,
      ),
    ).toThrow(WriteConflict)
    expect(fs.existsSync(path.join(P, 'designs/d/sketches/core.a.x.yaml'))).toBe(false)
    expect(read(rel)).toBe(before)
    expect(() => saveDesignSketches(modelRoot, 'p', 'd', { sketches: [{ mount: 'core.a', sketch: fresh, baseHash: hash(rel) }] }, root)).toThrow(WriteError)
    expect(() => saveDesignSketches(modelRoot, 'p', 'd', { sketches: [{ mount: '../x', sketch: { ...fresh, mount: '../x' }, baseHash: null }] }, root)).toThrow(
      WriteError,
    )
  })
})

describe('B6 新建设计', () => {
  it('写 design.yaml（status: draft；没有 git 时省略 base.commit）与草图，两者登记指纹；没有轮次也能列出', () => {
    const r = createDesign(
      modelRoot,
      'p',
      { id: 'n', name: '新设计', goal: '一句话', sketch: { id: 'ignored', mount: 'core.a', lifetime: 'until-implemented', modules: [] } },
      root,
    )
    expect(r.files).toEqual(['model/p/designs/n/design.yaml', 'model/p/designs/n/sketches/core.a.yaml'])
    expect(parse(read('designs/n/design.yaml')).design).toEqual({
      id: 'n',
      name: '新设计',
      status: 'draft',
      goal: '一句话',
      base: { generatedAt: '2026-10-22' },
    })
    expect(parse(read('designs/n/sketches/core.a.yaml')).sketch).toEqual({ id: 'n', mount: 'core.a', lifetime: 'until-implemented', modules: [] })
    const owned = readOwned(path.join(P, 'governance'))!.files
    expect(Object.keys(owned)).toEqual(expect.arrayContaining(['designs/n/design.yaml', 'designs/n/sketches/core.a.yaml']))
    expect(listDesigns(P).find(d => d.id === 'n')).toMatchObject({ status: 'draft', sketch: true, problems: [] })
  })

  it('05 裁决 3：给挂载点时 base.commit = 仓库 HEAD，底稿从 HEAD 那一版描述复制（不带文字），不写初始布局（X22：画布按中心区宽度排）；挂载点不能是层', () => {
    const base = () => ({
      commit: 'f00dcafe',
      files: [...readModelDir(P, root).files, { path: 'modules/q.yaml', text: 'modules:\n  - { id: core.a.q, name: Q, parent: core.a, responsibility: q }\n' }],
    })
    createDesign(modelRoot, 'p', { id: 'm', name: 'M', mount: 'core.a' }, root, { base })
    expect(parse(read('designs/m/design.yaml')).design.base).toEqual({ commit: 'f00dcafe', generatedAt: '2026-10-22' })
    const seed = parse(read('designs/m/sketches/core.a.yaml')).sketch
    expect(seed).toMatchObject({ id: 'm', mount: 'core.a', modules: [{ id: 'core.a.q', name: 'Q' }] })
    expect(seed.modules[0].responsibility).toBeUndefined()
    expect(seed.layout).toBeUndefined()
    expect(() => createDesign(modelRoot, 'p', { id: 'l', name: 'L', mount: 'core' }, root, { base })).toThrow(WriteError)
    expect(() => createDesign(modelRoot, 'p', { id: 'l', name: 'L', mount: 'core.zz' }, root, { base })).toThrow(WriteError)
  })

  it('设计已存在（409）、ID 不合法、名称为空、底稿校验不过：拒绝', () => {
    expect(() => createDesign(modelRoot, 'p', { id: 'd', name: 'D', sketch: { id: 'd', mount: 'core.a' } }, root)).toThrow(WriteConflict)
    expect(() => createDesign(modelRoot, 'p', { id: '../x', name: 'X', sketch: { id: 'x', mount: 'core.a' } }, root)).toThrow(WriteError)
    expect(() => createDesign(modelRoot, 'p', { id: 'x', name: ' ', sketch: { id: 'x', mount: 'core.a' } }, root)).toThrow(WriteError)
    expect(() => createDesign(modelRoot, 'p', { id: 'x', name: 'X' }, root)).toThrow(WriteError)
    expect(() =>
      createDesign(modelRoot, 'p', { id: 'x', name: 'X', sketch: { id: 'x', mount: 'core.a', modules: [{ id: 'core.q', name: 'Q' }] } }, root),
    ).toThrow(SketchInvalid)
  })
})

describe('草图版本的指纹、持久草图版本与改动摘要', () => {
  it('设计的草图版本附主草图与全部草图（挂载点、路径、载荷里的路径、指纹）；持久草图版本 = system.yaml + intent/**，附指纹，对比基线为当前版本', () => {
    const ref = {
      mount: 'core.a',
      file: 'designs/d/sketches/core.a.yaml',
      path: 'sketches/core.a.yaml',
      hash: sketchHash(read('designs/d/sketches/core.a.yaml')),
      needsLayout: true,
    }
    const sv = readDesignRevision(modelRoot, 'p', 'd', 'sketch', root)!
    expect(sv.sketch).toEqual(ref)
    expect(sv.sketchFiles).toEqual([ref])
    expect(sv.files.map(f => f.path)).toEqual(['intent/skeleton.yaml', 'system.yaml', 'sketches/core.a.yaml'])
    const v = readIntentVersion(modelRoot, 'p', 'skeleton', root)!
    expect(v.version).toEqual({ intent: 'skeleton' })
    expect(v.files.map(f => f.path)).toEqual(['intent/skeleton.yaml', 'system.yaml'])
    expect(v.sketch).toEqual({ file: 'intent/skeleton.yaml', path: 'intent/skeleton.yaml', hash: sketchHash(read('intent/skeleton.yaml')) })
    expect(v.compare?.current.label).toBe('当前版本')
    expect(readIntentVersion(modelRoot, 'p', 'nope', root)).toBeNull()
  })

  it('F-52：持久草图也有「交给 AI」的指令——草图全文 + 交给 AI 时的改动摘要（与去掉这张草图后的当前版本比，其余描述没有的模块算新增）', () => {
    write(
      'modules/core.yaml',
      'modules:\n  - { id: core, name: Core, kind: layer, order: 1, responsibility: 内核 }\n  - { id: core.b, name: B, parent: core, responsibility: b }\n',
    )
    const prompt = readIntentVersion(modelRoot, 'p', 'skeleton', root)!.sketchPrompt!
    expect(prompt).toContain('# 按草图扩展：持久草图「skeleton」')
    expect(prompt).toContain('## 草图（intent/skeleton.yaml）')
    expect(prompt).toContain('- id: core   # 内核层')
    expect(prompt).toContain('## 交给 AI 时的改动摘要（与去掉这张草图后的当前版本比，按血缘）')
    expect(prompt).toContain('- 新增 A')
    write(
      'modules/core.yaml',
      'modules:\n  - { id: core, name: Core, kind: layer, order: 1, responsibility: 内核 }\n  - { id: core.a, name: A, parent: core, responsibility: a }\n',
    )
    expect(readIntentVersion(modelRoot, 'p', 'skeleton', root)!.sketchPrompt).not.toContain('## 交给 AI 时的改动摘要')
  })

  it('L-2：「交给 AI」附草图相对上一次提交的改动摘要；没有提交过时全部算新增', () => {
    const committed = () => DESIGN_SKETCH
    write('designs/d/sketches/core.a.yaml', DESIGN_SKETCH.replace('name: X', 'name: X2').replace('    - { id: core.a.y, name: Y, responsibility: y }\n', ''))
    const prompt = readDesignRevision(modelRoot, 'p', 'd', 'sketch', root, { committed })!.sketchPrompt!
    expect(prompt).toContain('## 本次改动（草图相对上一次提交）')
    expect(prompt).toMatch(/- 修改模块「core\.a\.x」（X2）：name/)
    expect(prompt).toMatch(/- 删除模块「core\.a\.y」/)
    const fresh = readDesignRevision(modelRoot, 'p', 'd', 'sketch', root, { committed: () => null })!.sketchPrompt!
    expect(fresh).toMatch(/- 新增模块「core\.a\.x」/)
    expect(readDesignRevision(modelRoot, 'p', 'd', 'sketch', root)!.sketchPrompt).not.toContain('本次改动')
  })

  it('X17、X20：「交给 AI」附各张草图全文与相对基线的变更摘要（按血缘措辞）', () => {
    write('designs/d/design.yaml', 'design:\n  name: D\n  base: { commit: abc123 }\n')
    write('designs/d/sketches/core.a.yaml', 'sketch:\n  id: d\n  mount: core.a\n  modules:\n    - { id: core.a.xy, name: XY, from: [core.a.x, core.a.y] }\n')
    const base = [
      { path: 'system.yaml', text: 'system: { id: p, name: P }' },
      { path: 'intent/skeleton.yaml', text: SKELETON },
      { path: 'modules/a.yaml', text: 'modules:\n  - { id: core.a.x, name: X, parent: core.a }\n  - { id: core.a.y, name: Y, parent: core.a }\n' },
    ]
    const payload = readDesignRevision(modelRoot, 'p', 'd', 'sketch', root, { baseline: () => base })!
    const prompt = payload.sketchPrompt!
    expect(prompt).toContain('## 草图（designs/d/sketches/core.a.yaml）')
    expect(prompt).toContain('## 相对基线的变更（按血缘）\n\n- 合并 X、Y 为 XY')
    // 05 裁决 3：载荷带基线（底稿与「相对基线」读同一份）；读不到时省略
    expect(payload.compare?.baseline?.files).toEqual(base)
    expect(readDesignRevision(modelRoot, 'p', 'd', 'sketch', root, { baseline: () => null })!.compare?.baseline).toBeUndefined()
  })
})

describe('Q11 sketch-check 由设计推出项目', () => {
  it('只有一个项目有这个设计时不必 --project；没有或多个时报错并列出候选', () => {
    write('../q/system.yaml', 'system: { id: q, name: Q }')
    const svc = createService({ root, modelRoot, client: 'cli' } as Parameters<typeof createService>[0])
    expect(svc.sketchCheck(undefined, 'd', 'r1').project).toBe('p')
    expect(() => svc.sketchCheck(undefined, 'nope')).toThrow('没有项目有设计「nope」')
    write('../q/designs/d/design.yaml', 'design: { name: D }\n')
    write('../q/designs/d/sketches/root.yaml', 'sketch: { id: d, mount: root, modules: [] }\n')
    expect(() => svc.sketchCheck(undefined, 'd')).toThrow('多个项目都有设计「d」')
    fs.rmSync(path.join(modelRoot, 'q'), { recursive: true, force: true })
  })
})
