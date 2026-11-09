/**
 * 视图标签的内容规则（LY-13、LY-15，第二十二轮波 3）：
 * 引用悬停提示取本层可见的节点（peekNodeOf / createRefPeek）；图解空态给相关模块的链接（explainerLinks）；
 * 核对标签的系统 / 层汇总口径（reworkScope）；iframe 桥接把悬停也变成消息（arch:hover）。
 */
import { describe, expect, it } from 'vitest'
import { loadModel, reworkList, reworkScope, SCOPE_CATEGORIES } from '../../src/model'
import { createRefPeek, peekNodeOf } from '../../src/components/dock/refHover'
import { explainerLinks } from '../../src/components/dock/explainerLinks'
import { explainerSrcdoc, isExplainerMessage } from '../../src/components/dock/explainerFrame'
import { sampleFiles, scenarioFiles } from '../fixtures/sample'

const { index } = loadModel(scenarioFiles())

describe('LY-15 引用悬停', () => {
  it('取自己或最近的可见祖先；都不可见为 null', () => {
    const path = index.pathOf.get('infra.framework.sm')!
    expect(peekNodeOf(path, new Set(['infra.framework.sm']))).toBe('infra.framework.sm')
    expect(peekNodeOf(path, new Set(['infra']))).toBe('infra')
    expect(peekNodeOf(path, new Set(['app']))).toBeNull()
  })
  it('进入引用即提示、离开即清除；只在变化时发意图', () => {
    const calls: (string | null)[] = []
    const p = createRefPeek({ pathOf: id => index.pathOf.get(id), visible: () => new Set(['infra']), setHover: id => calls.push(id) })
    p.peek('infra.framework.sm')
    p.peek('infra.framework')
    p.onLeave()
    expect(calls).toEqual(['infra', null])
  })
})

describe('LY-13 图解空态', () => {
  const has = (ids: string[]) => (id: string) => ids.includes(id)
  it('模块没有图解：链到最近的有图解的祖先', () => {
    const r = explainerLinks(index, { kind: 'module', id: 'infra.framework.sm' }, { has: has(['infra']), frame: null, fileOwners: [] })
    expect(r.modules).toEqual(['infra'])
    expect(r.why).toContain('还没有图解')
  })
  it('关系：两端（及其有图解的祖先），只列有图解的', () => {
    const rel = [...index.relations.values()].find(x => index.modules.has(x.from) && index.modules.has(x.to))!
    const r = explainerLinks(index, { kind: 'relation', id: rel.id }, { has: has([rel.from, rel.to]), frame: null, fileOwners: [] })
    expect(r.modules.sort()).toEqual([rel.from, rel.to].sort())
  })
  it('步骤：当前步骤的两端；场景：根；没有任何图解时链接为空、仍说明原因', () => {
    const step = explainerLinks(index, { kind: 'step', id: 'f' }, { has: has(['infra']), frame: { from: 'infra', to: 'app' }, fileOwners: [] })
    expect(step.modules).toEqual(['infra'])
    expect(explainerLinks(index, { kind: 'scenario', id: 'sc.play' }, { has: has([index.rootId]), frame: null, fileOwners: [] }).modules).toEqual([
      index.rootId,
    ])
    const none = explainerLinks(index, { kind: 'actor', id: 'x' }, { has: has([]), frame: null, fileOwners: [] })
    expect(none.modules).toEqual([])
    expect(none.why.length).toBeGreaterThan(0)
  })
})

describe('LY-13 核对汇总（reworkScope）', () => {
  it('根即整份清单；子树只算目标或关系两端落在里面的项；五类各一个计数', () => {
    const bad = loadModel(sampleFiles({ 'extra.yaml': 'relations:\n  - { id: rel.bad, from: infra, to: nowhere, type: calls }\n' }))
    const list = reworkList({ index: bad.index, issues: bad.issues })
    const all = reworkScope(list, bad.index, [bad.index.rootId])
    expect(all.items).toHaveLength(list.items.length)
    expect(Object.keys(all.counts)).toEqual([...SCOPE_CATEGORIES])
    const app = reworkScope(list, bad.index, ['app'])
    expect(app.items.length).toBeLessThanOrEqual(all.items.length)
  })
})

describe('LY-15 图解 iframe 的悬停桥接', () => {
  it('arch:hover 是合法消息（空串 = 离开）；桥接脚本监听悬停', () => {
    expect(isExplainerMessage({ type: 'arch:hover', module: 'a' })).toBe(true)
    expect(isExplainerMessage({ type: 'arch:hover', module: '' })).toBe(true)
    expect(isExplainerMessage({ type: 'arch:other', module: 'a' })).toBe(false)
    expect(explainerSrcdoc('<html><head></head><body></body></html>', {}, 'http://x')).toContain("send('arch:hover'")
  })
})
