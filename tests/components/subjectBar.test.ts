/**
 * 主语条的一行（LY-7）与面板分部（LY-13）：subjectLabel 是纯函数——所在路径（祖先，不含根与自己）› 名称 + ID + 角色徽标；
 * cardShown——「描述」放核对卡以外的卡，「核对」只放核对卡
 */
import { describe, expect, it } from 'vitest'
import { loadModel } from '../../src/model'
import { subjectLabel } from '../../src/components/dock/subjectLabel'
import { cardShown } from '../../src/components/shared/panelPart'
import { scenarioFiles } from '../fixtures/sample'

const { index } = loadModel(scenarioFiles())

describe('LY-7 主语条', () => {
  it('系统：系统名、根 ID、徽标「系统」，没有路径', () => {
    expect(subjectLabel(index, { kind: 'system' })).toEqual({ path: [], name: index.model.system.name, id: index.rootId, badge: '系统' })
  })
  it('模块：路径是祖先（不含根与自己），ID 是模块 ID', () => {
    const l = subjectLabel(index, { kind: 'module', id: 'infra.framework.sm' })
    expect(l.id).toBe('infra.framework.sm')
    expect(l.name).toBe(index.modules.get('infra.framework.sm')!.name)
    expect(l.path).toEqual(['infra', 'infra.framework'].map(id => index.modules.get(id)!.name))
  })
  it('路径至多最后两级', () => {
    const deep = [...(index.pathOf.get('infra.framework.sm') ?? [])].filter(x => x !== index.rootId)
    expect(subjectLabel(index, { kind: 'module', id: 'infra.framework.sm' }).path.length).toBeLessThanOrEqual(Math.min(2, deep.length - 1))
  })
  it('步骤：路径是场景名，名称是步骤标签，ID 位是「第 i / N 步」', () => {
    expect(subjectLabel(index, { kind: 'step', id: 'f' }, { scenario: '播放', label: 'A → B', position: '第 2 / 5 步' })).toEqual({
      path: ['播放'],
      name: 'A → B',
      id: '第 2 / 5 步',
      badge: '步骤',
    })
  })
  it('场景、关系、端口等都给出名称与类别徽标', () => {
    expect(subjectLabel(index, { kind: 'scenario', id: 'sc.play' })).toMatchObject({ id: 'sc.play', badge: '场景' })
    const rel = [...index.relations.values()][0]
    expect(subjectLabel(index, { kind: 'relation', id: rel.id })).toMatchObject({ badge: '关系', name: expect.stringContaining('→') })
  })
})

describe('LY-13 面板分部', () => {
  it('描述放核对卡以外的卡；核对只放核对卡', () => {
    expect(['understand', 'check', 'related'].map(k => cardShown('description', k))).toEqual([true, false, true])
    expect(['understand', 'check', 'related'].map(k => cardShown('check', k))).toEqual([false, true, false])
    expect(cardShown('all', 'check')).toBe(true)
  })
})
