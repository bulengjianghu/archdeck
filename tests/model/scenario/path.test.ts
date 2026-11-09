/** 场景投影 · 回放路径（F6）与单步落点（R7、R13） */
import { describe, expect, it } from 'vitest'
import {
  choiceList,
  choicesFor,
  choicesFromList,
  chooseBranch,
  currentMessage,
  landing,
  loadModel,
  planScenario,
  resolvePath,
  stepAfter,
  stepBefore,
  walkedCount,
} from '../../../src/model'
import { scenarioFiles } from '../../fixtures/sample'
import { plan, ALT, take, ids, project } from './helpers'

describe('回放路径', () => {
  it('F6：未选分支时路径在分支点截止，报告该分支点及全部选项', () => {
    const r = resolvePath(plan, new Map())
    expect(r.frames.map(f => f.id)).toEqual(['sc.play#start', 'sc.play#1', 'sc.play#2'])
    expect(r.pending?.id).toBe(ALT)
    expect(r.pending?.options.map(o => [o.when, o.first?.id])).toEqual([
      ['需要改图', 'sc.play#update'],
      ['无需改图', undefined],
    ])
  })

  it('F6：选择后路径延长；无效的选择被忽略', () => {
    expect(ids(plan, take(1))).toEqual(['sc.play#start', 'sc.play#1', 'sc.play#2', 'sc.play#4/0', 'sc.play#4/1', 'sc.play#done'])
    expect(ids(plan, new Map([[ALT, 5], ['nope', 0]]))).toEqual(['sc.play#start', 'sc.play#1', 'sc.play#2'])
  })

  describe('多个分支点', () => {
    const { index: idx } = loadModel(
      scenarioFiles({
        'scenarios/x.yaml': `scenario:
  id: sc.two
  name: Two
  steps:
    - alt:
        - when: A
          steps:
            - call: { id: a1, from: infra.player, to: infra.framework.sm }
            - alt:
                - when: A1
                  steps: [{ call: { id: a11, from: infra.framework.sm, to: app.solution } }]
                - when: A2
                  steps: [{ call: { id: a12, from: infra.framework.sm, to: infra.framework.pipeline } }]
        - when: B
          steps: [{ call: { id: b1, from: app.solution, to: domain.services } }]
    - alt:
        - when: X
          steps: [{ call: { id: x1, from: infra.player, to: infra.framework.sm } }]
        - when: Y
          steps: []
    - call: { id: end, from: infra.framework.sm, to: infra.player }`,
      }),
    )
    const p2 = planScenario(idx, 'sc.two')
    const [P0, P00, P1] = ['sc.two#0', 'sc.two#0.alt0.1', 'sc.two#1']

    it('F6b：改选会丢弃该分支点之后的选择；选同一项不丢弃', () => {
      const all = new Map([[P0, 0], [P00, 1], [P1, 1]])
      expect(chooseBranch(p2, all, P0, 0)).toEqual(all)
      expect([...chooseBranch(p2, all, P00, 0)]).toEqual([[P0, 0], [P00, 0]])
      expect([...chooseBranch(p2, all, P0, 1)]).toEqual([[P0, 1]])
      expect(chooseBranch(p2, all, P0, 9)).toEqual(all)
    })

    it('R13 · choicesFor：已在路径上时保留现有选择；在未选分支上时先改选所需的分支', () => {
      const all = new Map([[P0, 0], [P00, 1], [P1, 1]])
      expect(choicesFor(p2, all, 'sc.two#a12')).toEqual(all)
      expect([...choicesFor(p2, all, 'sc.two#a11')!]).toEqual([[P0, 0], [P00, 0]])
      expect([...choicesFor(p2, all, 'sc.two#b1')!]).toEqual([[P0, 1]])
      expect([...choicesFor(p2, new Map(), 'sc.two#x1')!]).toEqual([[P0, 0], [P00, 0], [P1, 0]])
      expect(choicesFor(p2, all, 'nope')).toBeNull()
    })

    it('F6c：已选分支按路径上分支点的先后有序编码，可往返', () => {
      const all = new Map([[P0, 0], [P00, 1], [P1, 1]])
      expect(choiceList(p2, all)).toEqual([0, 1, 1])
      expect(choicesFromList(p2, [0, 1, 1])).toEqual(all)
      expect(choicesFromList(p2, [1, 0])).toEqual(new Map([[P0, 1], [P1, 0]]))
      expect([...choicesFromList(p2, [0, 7, 1])]).toEqual([[P0, 0]])
    })
  })
})

describe('单步与落点', () => {
  const v = project('sys')

  it('R7：单步按本层可见消息前进 / 后退，取消息覆盖的第一帧', () => {
    expect(stepAfter(v, null)).toBe('sc.play#start')
    expect(stepAfter(v, 'sc.play#3.alt0.1.loop.0')).toBe('sc.play#4/0')
    expect(stepAfter(v, 'sc.play#4/1')).toBe('sc.play#done')
    expect(stepAfter(v, 'sc.play#done')).toBeNull()
    expect(stepBefore(v, 'sc.play#done')).toBe('sc.play#4/1')
    expect(stepBefore(v, 'sc.play#4/1')).toBe('sc.play#4/0')
    expect(stepBefore(v, 'sc.play#start')).toBeNull()
  })

  it('R7：下钻后同一帧在更细的层次上步子更小；播放头在本层不可见时按路径顺序找前后', () => {
    const infra = project('infra')
    expect(currentMessage(infra, 'sc.play#4/1')).toBeNull()
    expect(stepAfter(infra, 'sc.play#4/1')).toBe('sc.play#done')
    expect(stepBefore(infra, 'sc.play#4/1')).toBe('sc.play#3.alt0.1.loop.0')
    expect(walkedCount(infra, 'sc.play#4/1')).toBe(5)
  })

  it('R13：指向某帧时落在其所在可见消息的第一帧；本层不可见时就是它自己', () => {
    expect(landing(v, 'sc.play#2')).toBe('sc.play#2')
    expect(landing(project('infra'), 'sc.play#4/1')).toBe('sc.play#4/1')
  })

  it('已走过的消息数 = 从头播放到播放头为止经过的消息', () => {
    expect(walkedCount(v, null)).toBe(0)
    expect(walkedCount(v, 'sc.play#4/1')).toBe(7)
    expect(currentMessage(v, 'sc.play#4/1')).toBe(6)
  })
})
