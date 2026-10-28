import { describe, expect, it } from 'vitest'
import { FIT, fitArea, fitViewport } from '../../src/layout/canvas'

describe('V14 适应画布的可用区域', () => {
  it('面板收起时用整块画布', () => {
    expect(fitArea(1200, 800, null)).toEqual({ x: 0, y: 0, w: 1200, h: 800 })
  })

  it('面板展开时只用面板左侧、再让出间距，高度不变', () => {
    expect(fitArea(1200, 800, 880)).toEqual({ x: 0, y: 0, w: 880 - FIT.gap, h: 800 })
  })

  it('面板左侧不到画布宽度一半时（窄画布）仍用整块画布', () => {
    expect(fitArea(500, 800, 190)).toEqual({ x: 0, y: 0, w: 500, h: 800 })
  })

  it('内容缩放、居中到可用区域，右边不进面板', () => {
    const area = fitArea(1200, 800, 880)
    const b = { x: 100, y: 50, w: 2000, h: 600 }
    const v = fitViewport(b, area)
    const right = v.x + (b.x + b.w) * v.zoom
    const left = v.x + b.x * v.zoom
    expect(right).toBeLessThanOrEqual(area.w)
    expect(left).toBeGreaterThanOrEqual(0)
    // 左右留白相等（居中），宽度按 8% 留白占满
    expect(left).toBeCloseTo(area.w - right, 6)
    expect(left).toBeCloseTo(area.w * FIT.pad, 6)
  })

  it('缩放不超过上限', () => {
    expect(fitViewport({ x: 0, y: 0, w: 10, h: 10 }, fitArea(1200, 800, null)).zoom).toBe(FIT.maxZoom)
  })
})
