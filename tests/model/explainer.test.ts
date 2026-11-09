/** EX-1–EX-9、M32：图解的查找、导航、依据指纹与过期、引用原文、检查与写入依据 */
import { describe, expect, it } from 'vitest'
import {
  archRefs,
  explainerBasis,
  explainerIssues,
  explainerModules,
  explainerNav,
  explainerOf,
  explainerRefs,
  explainerStatus,
  formatBasis,
  loadModel,
  parseBasis,
  plainText,
  readBasisMeta,
  writeBasisMeta,
  type RawFile,
} from '../../src/model'

const YAML = `
system: { id: s, name: 系统 }
modules:
  - id: p
    name: 父模块
    summary: 给宿主一次可靠的会话
    responsibility: 父模块的职责。
    invariants: [命令单通道串行施用]
    children:
      - id: p.a
        name: 甲
        summary: 按序施用全部命令
        invariants: [甲只读不写会话状态]
        children:
          - { id: p.a.x, name: 甲内一, responsibility: 内部一 }
          - { id: p.a.y, name: 甲内二, responsibility: 内部二 }
      - { id: p.b, name: 乙, summary: 决定会话变成什么 }
      - { id: p.c, name: 丙, responsibility: 丙的职责。, explainer: explainers/c-doc.html }
  - { id: q, name: 别处, summary: 提供别处的能力 }
relations:
  - { id: r1, from: p.a.x, to: p.b, type: commands, purpose: 交给决定 }
  - { id: r2, from: p.a.x, to: p.a.y, type: queries }
  - { id: r3, from: p.b, to: q, type: queries }
`

const page = (body: string, meta = '') => `<!doctype html><html><head><meta charset="utf-8">${meta}<title>t</title></head><body>${body}</body></html>`

function files(explainers: Record<string, string>, yaml = YAML): RawFile[] {
  return [{ path: 'modules/m.yaml', text: yaml }, ...Object.entries(explainers).map(([path, text]) => ({ path, text }))]
}

const P_BODY = '<p><span data-arch="p.a" data-field="summary"></span>，然后 <span data-arch="p.b">乙</span>。</p>'

describe('EX-1、M32 查找', () => {
  it('约定路径 explainers/<ID>.html；写了 explainer 取它；文件不在为没有；系统根按约定路径', () => {
    const { index } = loadModel(files({ 'explainers/p.html': page(P_BODY), 'explainers/c-doc.html': page(''), 'explainers/s.html': page('') }))
    expect(explainerOf(index, 'p')).toBe('explainers/p.html')
    expect(explainerOf(index, 'p.c')).toBe('explainers/c-doc.html')
    expect(explainerOf(index, 'p.a')).toBeNull()
    expect(explainerOf(index, 's')).toBe('explainers/s.html')
    expect(explainerOf(index, 'nope')).toBeNull()
    expect([...explainerModules(index).keys()]).toEqual(['s', 'p', 'p.c'])
  })

  it('图解文件不按 YAML 解析（不报语法错）；写了 explainer 而文件缺失提醒 module.explainer-missing；没人认领的文件提醒 explainer.orphan', () => {
    const { issues } = loadModel(files({ 'explainers/zz.html': page('<p>孤儿</p>') }))
    expect(issues.some(i => i.code === 'yaml-syntax' || i.code === 'schema')).toBe(false)
    expect(issues.find(i => i.code === 'module.explainer-missing')?.message).toContain('p.c')
    expect(issues.find(i => i.code === 'explainer.orphan')?.file).toBe('explainers/zz.html')
  })
})

describe('EX-4 导航', () => {
  it('↑ 最近的有图解的祖先（含根）；↓ 每条子树里最近的有图解的后代', () => {
    const { index } = loadModel(files({ 'explainers/s.html': page(''), 'explainers/c-doc.html': page(''), 'explainers/p.a.x.html': page('') }))
    expect(explainerNav(index, 'p.a.x')).toEqual({ up: 's', down: [] })
    expect(explainerNav(index, 's').down).toEqual(['p.a.x', 'p.c'])
    expect(explainerNav(index, 'p').up).toBe('s')
  })
})

describe('EX-6 依据指纹', () => {
  const { index } = loadModel(files({}))
  const keys = Object.keys(explainerBasis(index, 'p').items)

  it('本模块的描述 + 直接子模块的 summary / invariants + 子模块之间的关系', () => {
    expect(keys).toEqual(expect.arrayContaining(['p#responsibility', 'p#summary', 'p#invariants', 'p#children', 'p.a#summary', 'p.a#invariants', 'p.b#summary', 'rel:r1']))
  })

  it('子模块内部（孙模块、子模块内部的关系）与子树外的关系不进依据', () => {
    expect(keys.some(k => k.startsWith('p.a.x') || k.startsWith('p.a.y'))).toBe(false)
    expect(keys).not.toContain('rel:r2')
    expect(keys).not.toContain('rel:r3')
  })

  it('格式化与读回一致；坏的或版本不认识的读成 null', () => {
    const b = explainerBasis(index, 'p')
    expect(parseBasis(formatBasis(b))).toEqual(b)
    expect(parseBasis('v9 abc')).toBeNull()
    expect(parseBasis('v1 abc broken')).toBeNull()
    expect(parseBasis(null)).toBeNull()
  })
})

describe('EX-7 过期', () => {
  const base = loadModel(files({})).index
  const meta = `<meta name="arch-basis" content="${formatBasis(explainerBasis(base, 'p'))}">`

  it('依据一致时不过期', () => {
    const { index } = loadModel(files({ 'explainers/p.html': page(P_BODY, meta) }))
    expect(explainerStatus(index, 'p')).toMatchObject({ stale: false, changes: [] })
  })

  it('子模块的 summary 改了：过期，1 处改动，说出是谁的什么', () => {
    const { index } = loadModel(files({ 'explainers/p.html': page(P_BODY, meta) }, YAML.replace('按序施用全部命令', '按序施用命令与回报')))
    const st = explainerStatus(index, 'p')!
    expect(st.stale).toBe(true)
    expect(st.changes).toEqual([{ key: 'p.a#summary', kind: 'changed', label: '甲的一句话职责' }])
  })

  it('孙模块的描述改了：父模块的图解不过期', () => {
    const { index } = loadModel(files({ 'explainers/p.html': page(P_BODY, meta) }, YAML.replace('内部一', '内部一改了')))
    expect(explainerStatus(index, 'p')!.stale).toBe(false)
  })

  it('子模块之间新增一条关系：增 1', () => {
    const more = YAML + '  - { id: r4, from: p.b, to: p.c, type: queries }\n'
    const { index } = loadModel(files({ 'explainers/p.html': page(P_BODY, meta) }, more))
    expect(explainerStatus(index, 'p')!.changes).toEqual([{ key: 'rel:r4', kind: 'added', label: '关系 乙 → 丙' }])
  })

  it('没有 arch-basis 按过期计，改动为空', () => {
    const { index } = loadModel(files({ 'explainers/p.html': page(P_BODY) }))
    expect(explainerStatus(index, 'p')).toMatchObject({ stale: true, recorded: null, changes: [] })
  })
})

describe('EX-2 引用原文', () => {
  it('引用到的模块给出 summary（回退标待提炼）、不变式，以及有没有自己的图解；不存在的模块不列', () => {
    const body = P_BODY + '<span data-arch="p.c" data-field="summary"></span><span data-arch="nope"></span>'
    const { index } = loadModel(files({ 'explainers/p.html': page(body), 'explainers/c-doc.html': page('') }))
    const refs = explainerRefs(index, 'p')
    expect(refs['p.a']).toEqual({ name: '甲', summary: { text: '按序施用全部命令', pending: false }, invariants: [{ text: '甲只读不写会话状态' }], explainer: false })
    expect(refs['p.c'].summary).toEqual({ text: '丙的职责', pending: true })
    expect(refs['p.c'].explainer).toBe(true)
    expect(refs.nope).toBeUndefined()
  })
})

describe('EX-8 检查', () => {
  const issuesOf = (body: string, meta = '') => explainerIssues(loadModel(files({ 'explainers/p.html': page(body, meta) })).index)
  const codes = (body: string) => issuesOf(body).map(i => i.code)

  it('data-arch 指向不存在的模块是错误，带文件与行号', () => {
    const i = issuesOf('\n\n<a data-arch="nope">x</a>').find(x => x.code === 'explainer.unknown-module')!
    expect(i).toMatchObject({ severity: 'error', file: 'explainers/p.html' })
    expect(i.line).toBe(3)
  })

  it('data-field 只认 summary / invariants', () => {
    expect(codes('<span data-arch="p.a" data-field="responsibility"></span>')).toContain('explainer.unknown-field')
    expect(codes('<span data-arch="p.a" data-field="invariants"></span>')).not.toContain('explainer.unknown-field')
  })

  it('正文抄写了某个模块的 summary 或不变式原文：提醒改成引用；data-field 元素里的不算', () => {
    expect(codes('<p>甲会按序施用全部命令。</p>')).toContain('explainer.copied-text')
    expect(codes('<p>注意：甲只读不写会话状态。</p>')).toContain('explainer.copied-text')
    expect(codes('<span data-arch="p.a" data-field="summary">按序施用全部命令</span>')).not.toContain('explainer.copied-text')
  })

  it('父模块的图解链到孙模块：越级提醒；链到子模块、兄弟或别处不算', () => {
    expect(codes('<a data-arch="p.a.x">x</a>')).toContain('explainer.too-deep')
    expect(codes('<a data-arch="p.a">a</a><a data-arch="q">q</a>')).not.toContain('explainer.too-deep')
  })

  it('没有依据提醒 no-basis；过期提醒 stale 并带改动数', () => {
    expect(codes('')).toContain('explainer.no-basis')
    const stale = issuesOf('', '<meta name="arch-basis" content="v1 0000 p#summary=00000000">').find(i => i.code === 'explainer.stale')!
    expect(stale.message).toMatch(/基于旧描述 · \d+ 处改动/)
  })
})

describe('EX-9 写入依据（只改 arch-basis 那一个 meta）', () => {
  it('有则替换，没有则插在 head 之后；正文不动', () => {
    const html = page('<p>正文</p>')
    const once = writeBasisMeta(html, 'v1 aaa')
    expect(readBasisMeta(once)).toBe('v1 aaa')
    const twice = writeBasisMeta(once, 'v1 bbb')
    expect(readBasisMeta(twice)).toBe('v1 bbb')
    expect(twice.match(/arch-basis/g)).toHaveLength(1)
    expect(twice.replace(/\n\s*<meta name="arch-basis"[^>]*>/, '')).toBe(html)
  })

  it('读 HTML：script 里的 data-arch 不算引用；正文去标签、去空白、解实体', () => {
    expect(archRefs('<script>const s = "<a data-arch=\\"x\\">"</script><b data-arch="p">p</b>').map(r => r.module)).toEqual(['p'])
    expect(plainText('<p>a &amp; b</p>\n<style>.x{}</style>')).toBe('a&b')
  })
})
