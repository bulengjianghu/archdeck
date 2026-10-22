/** 架构治理 · 步骤的代码证据（S16）：四档等级、via 与参与者两种不判定、目标态与同宿主、return 反向、经入口、排序与条数上限 */
import { describe, expect, it } from 'vitest'
import { assignFiles, entryResolver, interfaceName, loadModel, scenarioEvidence, stepEvidence, EVIDENCE_LIMIT, type FileDep, type RawFile } from '@/model'
import { LAYERS, SRC, dep } from './helpers'

const EXTRA = `
actors:
  - { id: actor.user, name: 用户, kind: user }
modules:
  - { id: ui.store.part, name: Part, parent: ui.store, responsibility: 概念子模块（没有自己的文件） }
interfaces:
  - { id: if.ui.render, name: 渲染界面, owner: ui.view, signature: 'render(): void' }
relations:
  - { id: rel.inject, from: ui.view, to: core.impl, type: calls, via: inject }
  - { id: rel.notify, from: core.impl, to: ui.store, type: notifies }
`

const files: RawFile[] = [
  { path: 'system.yaml', text: 'system: { id: sys, name: Sys }' },
  { path: 'modules/layers.yaml', text: LAYERS },
  { path: 'modules/extra.yaml', text: EXTRA },
]
const { index } = loadModel(files)
const own = assignFiles(index, SRC, [])
const entryOf = entryResolver(index, own, { files: SRC, packages: {} })

const named = (d: FileDep, ...names: string[]): FileDep => ({ ...d, names })
const DEPS: FileDep[] = [
  named(dep('src/ui/store/s.ts', 'src/core/api/client.ts', 'src/core/api/index.ts', 7), 'get'), // 经入口
  named(dep('src/ui/store/s.ts', 'src/core/api/client.ts', 'src/core/api/client.ts', 9), 'get'), // 直接导入目标文件
  named(dep('src/ui/store/s.ts', 'src/core/api/client.ts', 'src/core/api/client.ts', 3), 'other'),
  named(dep('src/ui/store/s.ts', 'src/core/util/u.ts', 'src/core/api/index.ts', 5), 'get'), // 目标不在 core.api，经由是它的入口
  dep('src/ui/store/s.ts', 'src/core/impl/i.ts'), // 订阅者导入发布者（notifies 反向）
]

describe('S16 步骤的候选调用点', () => {
  it('接口名：name 是标识符时用它，否则取 ID 末段', () => {
    expect(interfaceName(index, 'if.get')).toBe('get')
    expect(interfaceName(index, 'if.ui.render')).toBe('render')
  })

  it('按名字匹配：导入名含接口名的候选，直接导入目标文件的在前，同文件按行号；经由为接收方入口的也算', () => {
    const e = stepEvidence({ kind: 'call', from: 'ui.store', to: 'core.api', interface: 'if.get' }, index, own, DEPS, entryOf)
    expect(e.level).toBe('name')
    if (e.level !== 'name') return
    expect(e.name).toBe('get')
    expect(e.candidates.map(d => `${d.from}:${d.line}→${d.to}`)).toEqual([
      'src/ui/store/s.ts:9→src/core/api/client.ts',
      'src/ui/store/s.ts:5→src/core/util/u.ts',
      'src/ui/store/s.ts:7→src/core/api/client.ts',
    ])
    expect(e.total).toBe(3)
  })

  it('按模块依赖：有接口但导入名对不上，或步骤没有接口，列出两端之间的全部依赖', () => {
    const noName = stepEvidence({ kind: 'call', from: 'ui.store', to: 'core.api', interface: 'if.ui.render' }, index, own, DEPS)
    expect(noName).toMatchObject({ level: 'module', name: 'render', total: 3 })
    const noIf = stepEvidence({ kind: 'call', from: 'ui.store', to: 'core.api' }, index, own, DEPS)
    expect(noIf.level).toBe('module')
    expect(noIf).not.toHaveProperty('name')
  })

  it('按模块依赖最多列 10 条，值依赖在前，另给总数', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ ...dep('src/ui/store/s.ts', 'src/core/api/client.ts', 'src/core/api/client.ts', i + 1), kind: i < 3 ? ('type' as const) : ('value' as const) }))
    const e = stepEvidence({ kind: 'call', from: 'ui.store', to: 'core.api' }, index, own, many)
    expect(e.level === 'module' && e.candidates.length).toBe(EVIDENCE_LIMIT)
    expect(e.level === 'module' && e.total).toBe(12)
    expect(e.level === 'module' && e.candidates.map(d => d.kind)).toEqual([...Array(9).fill('value'), 'type'])
  })

  it('无证据：两端之间没有任何依赖', () => {
    expect(stepEvidence({ kind: 'call', from: 'ui.view', to: 'core.util', interface: 'if.get' }, index, own, DEPS)).toEqual({ level: 'none', name: 'get' })
  })

  it('不判定：一端是外部参与者', () => {
    expect(stepEvidence({ kind: 'call', from: 'actor.user', to: 'ui.view' }, index, own, DEPS)).toEqual({ level: 'skipped', reason: 'actor' })
  })

  it('不判定：关系写了 via（同 K5b）', () => {
    expect(stepEvidence({ kind: 'call', from: 'ui.view', to: 'core.impl', relation: 'rel.inject' }, index, own, DEPS)).toEqual({
      level: 'skipped',
      reason: 'via',
      via: 'inject',
    })
  })

  it('不判定：一端是目标态；两端文件相同（概念子模块以宿主的文件承载，同 K5a）', () => {
    expect(stepEvidence({ kind: 'call', from: 'core.util', to: 'core.future' }, index, own, DEPS)).toEqual({ level: 'skipped', reason: 'target' })
    expect(stepEvidence({ kind: 'call', from: 'ui.store', to: 'ui.store.part' }, index, own, DEPS)).toEqual({ level: 'skipped', reason: 'host', host: 'ui.store' })
  })

  it('return 反过来：接收方的文件导入发送方', () => {
    expect(stepEvidence({ kind: 'return', from: 'core.api', to: 'ui.store', interface: 'if.get' }, index, own, DEPS, entryOf).level).toBe('name')
    expect(stepEvidence({ kind: 'call', from: 'core.api', to: 'ui.store', interface: 'if.get' }, index, own, DEPS, entryOf).level).toBe('none')
  })

  it('notifies 两个方向都算：订阅者导入发布者也是证据', () => {
    expect(stepEvidence({ kind: 'async', from: 'core.impl', to: 'ui.store', relation: 'rel.notify' }, index, own, DEPS).level).toBe('module')
    expect(stepEvidence({ kind: 'async', from: 'core.impl', to: 'ui.store' }, index, own, DEPS).level).toBe('none')
  })

  it('场景汇总：按帧计各等级', () => {
    const frames = new Map(
      (
        [
          ['a', { kind: 'call', from: 'ui.store', to: 'core.api', interface: 'if.get' }],
          ['b', { kind: 'call', from: 'ui.store', to: 'core.api' }],
          ['c', { kind: 'call', from: 'ui.view', to: 'core.util' }],
          ['d', { kind: 'call', from: 'actor.user', to: 'ui.view' }],
        ] as const
      ).map(([id, f]) => [id, { ...f, id }]),
    )
    const s = scenarioEvidence({ frames } as never, index, own, DEPS, entryOf)
    expect(s.counts).toEqual({ name: 1, module: 1, none: 1, skipped: 1 })
    expect(s.frames.get('c')?.level).toBe('none')
  })
})
