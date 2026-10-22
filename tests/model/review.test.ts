/**
 * 人确认层（docs/02-domain.md §2.19 Z1–Z6）：确认记录的加载、指纹覆盖什么、状态三档与差异、确认范围、健康度计数、来源与批量记录。
 */
import { describe, expect, it } from 'vitest'
import {
  loadModel,
  normalizeSummary,
  reviewCounts,
  reviewDiff,
  reviewDiffText,
  reviewEntries,
  reviewHash,
  reviewScope,
  reviewStates,
  reviewStatus,
  reviewSummary,
  reworkList,
  subtreeOf,
  isReviewSource,
  type RawFile,
} from '@/model'

const MODULES = `
system: { id: sys, name: S }
modules:
  - id: ui
    name: UI
    kind: layer
    order: 1
    abstraction: 界面
    responsibility: 界面层
    includes: [组件, 页面]
    excludes: [业务规则]
    mayDependOn: [core]
    children:
      - { id: ui.view, name: View, core: true, responsibility: "画视图\\n不持有状态", provides: [if.render, if.mount], principle: 用 Vue, codeRefs: [src/ui/**] }
      - id: ui.store
        name: Store
        responsibility: 状态
        children:
          - { id: ui.store.leaf, name: Leaf, responsibility: 叶子 }
  - id: core
    name: Core
    kind: layer
    order: 2
    abstraction: 内核
    responsibility: 内核层
    children:
      - { id: core.api, name: Api, responsibility: 对外接口 }
interfaces:
  - { id: if.render, name: render, owner: ui.view, signature: 'render(vnode): void' }
  - { id: if.mount, name: mount, owner: ui.view, signature: 'mount(el): App' }
`

const files = (reviewed = '', modules = MODULES): RawFile[] => [
  { path: 'modules/m.yaml', text: modules },
  ...(reviewed ? [{ path: 'reviewed.yaml', text: reviewed }] : []),
]
const load = (reviewed = '', modules = MODULES) => loadModel(files(reviewed, modules))
const idx = load().index
const entryYaml = (module: string, hash: string, extra = '') => `reviewed:\n  - { module: ${module}, at: '2026-10-22', hash: ${hash}, source: manual${extra} }\n`

describe('Z1 确认记录是人拥有的文件', () => {
  it('reviewed.yaml 合并进模型，带出处；引用不存在的模块提醒并忽略；同一模块多条取最后一条并提醒', () => {
    const text = `reviewed:\n  - { module: ui.view, at: '2026-10-21', hash: aaaa, source: manual }\n  - { module: nope, at: '2026-10-22', hash: bbbb }\n  - { module: ui.view, at: '2026-10-22', hash: cccc, source: 'sketch:d1', note: 第二次 }\n`
    const { index, issues } = load(text)
    expect(index.model.reviewed).toHaveLength(1)
    expect(index.model.reviewed[0]).toMatchObject({ module: 'ui.view', hash: 'cccc', source: 'sketch:d1', note: '第二次', src: { file: 'reviewed.yaml', path: 'reviewed.2' } })
    expect(issues.map(i => i.code).sort()).toEqual(['duplicate-reviewed', 'unknown-reviewed-module'])
    expect(issues.every(i => i.severity === 'warning')).toBe(true)
  })
  it('格式：缺 module / at / hash、来源写法不对、不认识的字段都是格式错误（M1）', () => {
    for (const bad of [
      `reviewed:\n  - { module: ui.view, at: '2026-10-22' }`,
      `reviewed:\n  - { module: ui.view, at: '2026-10-22', hash: x, source: robot }`,
      `reviewed:\n  - { module: ui.view, at: '2026-10-22', hash: x, extra: 1 }`,
    ]) {
      const { index, issues } = load(bad)
      expect(issues.some(i => i.code === 'schema')).toBe(true)
      expect(index.model.reviewed).toHaveLength(0)
    }
  })
  it('没有 reviewed.yaml 时为空列表', () => {
    expect(idx.model.reviewed).toEqual([])
  })
})

describe('Z2 指纹覆盖什么', () => {
  const hashOf = (modules: string, id = 'ui.view') => reviewHash(load('', modules).index, id)
  const base = hashOf(MODULES)
  it('摘要：职责按行、包含 / 不包含、可依赖的层、接口按 ID 排序带签名、直接子模块排序', () => {
    expect(reviewSummary(idx, 'ui.view')).toEqual({
      responsibility: '画视图\n不持有状态',
      includes: [],
      excludes: [],
      mayDependOn: [],
      provides: [
        { id: 'if.mount', signature: 'mount(el): App' },
        { id: 'if.render', signature: 'render(vnode): void' },
      ],
      children: [],
    })
    expect(reviewSummary(idx, 'ui')).toMatchObject({ includes: ['组件', '页面'], excludes: ['业务规则'], mayDependOn: ['core'], children: ['ui.store', 'ui.view'] })
    expect(reviewHash(idx, 'ui.view')).toMatch(/^[0-9a-f]{16}$/)
  })
  it('覆盖：改职责一行、改接口签名、增减子模块、改包含 / 不包含与可依赖的层，指纹都变', () => {
    expect(hashOf(MODULES.replace('不持有状态', '不持有任何状态'))).not.toBe(base)
    expect(hashOf(MODULES.replace("mount(el): App", "mount(el, opts): App"))).not.toBe(base)
    expect(hashOf(MODULES.replace("provides: [if.render, if.mount]", "provides: [if.render]"))).not.toBe(base)
    const parent = hashOf(MODULES, 'ui')
    expect(hashOf(MODULES.replace('includes: [组件, 页面]', 'includes: [组件]'), 'ui')).not.toBe(parent)
    expect(hashOf(MODULES.replace('mayDependOn: [core]', 'mayDependOn: []'), 'ui')).not.toBe(parent)
    expect(hashOf(MODULES.replace('      - id: ui.store\n', '      - { id: ui.extra, name: Extra, responsibility: 多一个 }\n      - id: ui.store\n'), 'ui')).not.toBe(parent)
  })
  it('不覆盖：实现原理、codeRefs、名称、关系、接口的声明顺序、职责的首尾空白', () => {
    expect(hashOf(MODULES.replace('principle: 用 Vue', 'principle: 用 React'))).toBe(base)
    expect(hashOf(MODULES.replace('codeRefs: [src/ui/**]', 'codeRefs: [src/view/**]'))).toBe(base)
    expect(hashOf(MODULES.replace('name: View', 'name: Viewer'))).toBe(base)
    expect(hashOf(MODULES.replace('provides: [if.render, if.mount]', 'provides: [if.mount, if.render]'))).toBe(base)
    expect(hashOf(MODULES.replace('"画视图\\n不持有状态"', '"  画视图  \\n\\n不持有状态\\n"'))).toBe(base)
    expect(hashOf(`${MODULES}relations:\n  - { id: r1, from: ui.view, to: core.api, type: calls }\n`)).toBe(base)
  })
})

describe('Z3 状态三档与差异', () => {
  it('没有记录为未确认；指纹一致为已确认；不一致为需复核', () => {
    expect(reviewStatus(idx, undefined, 'ui.view')).toBe('unreviewed')
    expect(reviewStatus(idx, { hash: reviewHash(idx, 'ui.view') }, 'ui.view')).toBe('reviewed')
    expect(reviewStatus(idx, { hash: 'stale' }, 'ui.view')).toBe('stale')
  })
  it('改一个已确认模块的职责一行：需复核，差异只有那一行的增删', () => {
    const [entry] = reviewEntries(idx, ['ui.view'], { source: 'manual', at: '2026-10-22' })
    const yaml = `reviewed:\n  - ${JSON.stringify(entry)}\n`
    expect(reviewStates(load(yaml).index).get('ui.view')!.status).toBe('reviewed')
    const changed = load(yaml, MODULES.replace('不持有状态', '不持有任何状态')).index
    const st = reviewStates(changed).get('ui.view')!
    expect(st.status).toBe('stale')
    expect(st.diff!.count).toBe(2)
    expect(st.diff!.responsibility).toEqual([
      { kind: 'removed', text: '不持有状态' },
      { kind: 'added', text: '不持有任何状态' },
    ])
    for (const f of ['includes', 'excludes', 'mayDependOn', 'provides', 'children'] as const) expect(st.diff![f]).toEqual([])
    expect(reviewDiffText(st.diff!)).toBe('职责：−「不持有状态」 +「不持有任何状态」')
  })
  it('接口按 ID 增 / 删 / 改（带前后签名），子模块与包含 / 不包含、可依赖的层按项增删', () => {
    const before = normalizeSummary({
      responsibility: '界面层',
      includes: ['组件', '旧项'],
      mayDependOn: ['core', 'gone'],
      provides: [
        { id: 'if.b', signature: 'b(): void' },
        { id: 'if.a', signature: 'a(): void' },
      ],
      children: ['x', 'y'],
    })
    const now = normalizeSummary({
      responsibility: '界面层',
      includes: ['组件', '页面'],
      mayDependOn: ['core'],
      provides: [
        { id: 'if.a', signature: 'a(n): void' },
        { id: 'if.c', signature: 'c(): void' },
      ],
      children: ['y', 'z'],
    })
    const d = reviewDiff(before, now)
    expect(d.responsibility).toEqual([])
    expect(d.includes).toEqual([
      { kind: 'removed', text: '旧项' },
      { kind: 'added', text: '页面' },
    ])
    expect(d.mayDependOn).toEqual([{ kind: 'removed', text: 'gone' }])
    expect(d.provides).toEqual([
      { kind: 'changed', text: 'if.a', before: 'a(): void', after: 'a(n): void' },
      { kind: 'removed', text: 'if.b', before: 'b(): void' },
      { kind: 'added', text: 'if.c', after: 'c(): void' },
    ])
    expect(d.children).toEqual([
      { kind: 'removed', text: 'x' },
      { kind: 'added', text: 'z' },
    ])
    expect(d.count).toBe(8)
  })
  it('记录没有摘要时需复核但列不出差异', () => {
    const st = reviewStates(load(entryYaml('ui.view', 'stale')).index).get('ui.view')!
    expect(st.status).toBe('stale')
    expect(st.diff).toBeUndefined()
  })
  it('需复核项进返工清单：warning、规则 Z3、建议动作是人的动作、没有 YAML 片段；已确认的不进', () => {
    const [entry] = reviewEntries(idx, ['ui.view'], { source: 'manual', at: '2026-10-22' })
    const yaml = `reviewed:\n  - ${JSON.stringify(entry)}\n  - ${JSON.stringify(reviewEntries(idx, ['core.api'], { source: 'manual', at: '2026-10-22' })[0])}\n`
    const loaded = load(yaml, MODULES.replace('不持有状态', '不持有任何状态'))
    const list = reworkList({ index: loaded.index, issues: loaded.issues })
    const items = list.items.filter(i => i.category === 'review')
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      id: 'review:ui.view',
      severity: 'warning',
      rules: ['Z3'],
      code: 'review.stale',
      title: '需复核：View——2026-10-22 确认后职责变了',
      detail: '职责：−「不持有状态」 +「不持有任何状态」',
      at: { in: 'description', file: 'modules/m.yaml' },
      target: { modules: ['ui.view'] },
    })
    expect(items[0].actions).toHaveLength(1)
    expect(items[0].actions[0].kind).toBe('review')
    expect(items[0].actions[0].snippet).toBeUndefined()
    expect(list.byCategory.review).toBe(1)
    expect(reworkList({ index: load(yaml).index, issues: [] }).byCategory.review).toBe(0)
  })
})

describe('Z4 确认范围与子树', () => {
  it('范围为核心模块与第二级模块（分层时即各层的直接子模块），按声明顺序', () => {
    expect(reviewScope(idx)).toEqual(['ui.view', 'ui.store', 'core.api'])
    const flat = load('', `modules:\n  - { id: a, name: A, responsibility: a, children: [{ id: a.b, name: B, responsibility: b, children: [{ id: a.b.c, name: C, responsibility: c, core: true }] }] }\n`).index
    expect(reviewScope(flat)).toEqual(['a.b', 'a.b.c'])
  })
  it('「也确认子模块」：子树内每个模块各一条独立记录', () => {
    const ids = subtreeOf(idx, 'ui.store')
    expect(ids).toEqual(['ui.store', 'ui.store.leaf'])
    const entries = reviewEntries(idx, ids, { source: 'manual', at: '2026-10-22', note: '一次记入' })
    expect(entries.map(e => e.module)).toEqual(ids)
    expect(entries.every(e => e.note === '一次记入' && e.hash === reviewHash(idx, e.module))).toBe(true)
  })
})

describe('Z5 健康度计数', () => {
  it('只数范围内的模块：已确认 a / 范围 b · 需复核 c；范围外的记录不计', () => {
    expect(reviewCounts(idx)).toEqual({ scope: 3, reviewed: 0, stale: 0 })
    const ok = reviewEntries(idx, ['ui.view', 'ui.store.leaf'], { source: 'manual', at: '2026-10-22' })
    const yaml = `reviewed:\n  - ${JSON.stringify(ok[0])}\n  - ${JSON.stringify(ok[1])}\n  - { module: core.api, at: '2026-10-22', hash: stale, source: manual }\n`
    expect(reviewCounts(load(yaml).index)).toEqual({ scope: 3, reviewed: 1, stale: 1 })
  })
})

describe('Z6 来源与批量记录', () => {
  it('来源只能是 manual 或 sketch:<设计 ID>', () => {
    expect(isReviewSource('manual')).toBe(true)
    expect(isReviewSource('sketch:phase2-dynamic')).toBe(true)
    expect(isReviewSource('sketch:')).toBe(false)
    expect(isReviewSource('robot')).toBe(false)
    expect(isReviewSource(undefined)).toBe(false)
  })
  it('reviewEntries 给出记录的全部字段：当天日期缺省、现在的指纹与摘要（空字段省略）、来源', () => {
    const [e] = reviewEntries(idx, ['ui.view'], { source: 'sketch:d1' })
    expect(e.at).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(e).toMatchObject({ module: 'ui.view', source: 'sketch:d1', hash: reviewHash(idx, 'ui.view') })
    expect(e.summary).toEqual({
      responsibility: '画视图\n不持有状态',
      provides: [
        { id: 'if.mount', signature: 'mount(el): App' },
        { id: 'if.render', signature: 'render(vnode): void' },
      ],
    })
    expect(e.note).toBeUndefined()
  })
})
