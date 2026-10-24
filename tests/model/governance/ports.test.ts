/** 架构治理 · 端口三角（K11、ADR-0022）：定义 · 实现者 · 使用者 */
import { describe, expect, it } from 'vitest'
import { loadModel, portTriad } from '@/model'
import { LAYERS, files, setup } from './helpers'

describe('K11 端口三角', () => {
  const extra = [
    '  - { id: rel.i, from: ui.store, to: core.api, type: implements }',
    '  - { id: rel.n, from: core.api, to: ui.view, type: notifies }',
    '  - { id: rel.s, from: ui.view, to: core.api, type: streams, via: port }',
    '  - { id: rel.d, from: ui.view, to: core, type: calls }',
  ].join('\n')
  const { index } = loadModel([files()[0], { path: 'modules/layers.yaml', text: LAYERS.replace('relations:\n', `relations:\n${extra}\n`) }])

  it('定义为本模块的接口；实现者为入边 implements；使用者为入边 calls / streams（含经 via 的），通知不算', () => {
    const t = portTriad(index, null, 'core.api')!
    expect(t.defines).toEqual(['if.get'])
    expect(t.implementers.map(p => [p.relation, p.module])).toEqual([['rel.i', 'ui.store']])
    expect(t.users.map(p => [p.relation, p.module, p.type, p.via])).toEqual([
      ['rel.s', 'ui.view', 'streams', 'port'],
      ['rel.2', 'ui.store', 'calls', undefined],
    ])
  })

  it('祖先按子树计：接口与入边落在子模块上也算；子树内部的关系不算', () => {
    const t = portTriad(index, null, 'core')!
    expect(t.defines).toEqual(['if.get'])
    expect(t.users.map(p => p.relation).sort()).toEqual(['rel.2', 'rel.d', 'rel.s'])
  })

  it('没有声明接口的模块没有端口三角；有代码事实时每项带证实状态', () => {
    expect(portTriad(index, null, 'core.impl')).toBeNull()
    const { index: idx, report } = setup()
    expect(portTriad(idx, report, 'core.api')!.users).toEqual([{ relation: 'rel.2', module: 'ui.store', type: 'calls', status: 'confirmed' }])
  })
})
