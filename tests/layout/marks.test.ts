/** L37（第十四轮 F16，ADR-0043）：节点注记的位置表与静息态上限 */
import { describe, expect, it } from 'vitest'
import { NODE_MARK_SLOTS, REST_MARKS, markShown, presentMarks, restMarks, type NodeData } from '../../src/layout/canvas'

const base: NodeData = { moduleId: 'm', name: 'M', childCount: 0, selected: false, dim: false }
const metrics = { ca: 1, ce: 2, instability: 0.6, band: null }
const cross = { in: 1, out: 0, side: 'right' as const, title: '' }

describe('L37 节点注记的位置表', () => {
  it('每槽只表一个维度，槽不重复；计入上限的是写字的槽', () => {
    expect(new Set(NODE_MARK_SLOTS.map(s => s.slot)).size).toBe(NODE_MARK_SLOTS.length)
    expect(new Set(NODE_MARK_SLOTS.map(s => s.dimension)).size).toBe(NODE_MARK_SLOTS.length)
    expect(NODE_MARK_SLOTS.filter(s => s.counted).map(s => s.slot)).toEqual(['top-left', 'bottom-left', 'bottom-right', 'outside'])
    expect(REST_MARKS).toBe(3)
  })

  it('静息态超过 3 个时按 状态 ＞ 环 ＞ 量 ＞ 没画出来的线 ＞ 界外 收起；悬停或选中时全部出现', () => {
    const d: NodeData = { ...base, cycle: 1, metrics, sharedCount: 2, crossFold: cross, change: 'added' }
    expect(presentMarks(d)).toEqual(['state', 'cycle', 'metrics', 'unseen', 'cross'])
    const rest = restMarks(d, false)
    expect(rest.restHidden).toEqual(['unseen', 'cross'])
    expect(markShown(rest, 'metrics')).toBe(true)
    expect(markShown(rest, 'cross')).toBe(false)
    expect(restMarks(d, true).restHidden).toBeUndefined()
  })

  it('不超过上限时不动；另直连与共用同属「没画出来的线」一个注记', () => {
    const d: NodeData = { ...base, metrics, sharedCount: 1, direct: { count: 2, title: '' } }
    expect(presentMarks(d)).toEqual(['metrics', 'unseen'])
    expect(restMarks(d, false)).toBe(d)
  })
})

describe('L36 层的状态记号', () => {
  it('声明的层按确认状态：指纹一致为已确认，未确认与需复核为待确认；算出的层另有文字', async () => {
    const { LAYER_STATUS, layerStatusOf } = await import('../../src/layout/layout')
    expect(layerStatusOf('reviewed')).toBe('confirmed')
    expect(layerStatusOf('stale')).toBe('pending')
    expect(layerStatusOf('unreviewed')).toBe('pending')
    expect([LAYER_STATUS.computed.text, LAYER_STATUS.pending.text, LAYER_STATUS.confirmed.text]).toEqual(['算出', '待确认', '已确认'])
  })
})
