/**
 * L14 边界角色的位置（ADR-0030）：port 压在父模块框上边（用户一侧）、adapter 压在右边（外部系统一侧）；常显、不折叠进「+N」（O8 的例外）；
 * 普通层次不交给 elk、布局后摆在框线上，边按需正交走线；分层总览里是带内的块——port 压在带的上边、adapter 贴带的右边。
 */
import { describe, expect, it } from 'vitest'
import { loadModel, projectLevel } from '../../src/model'
import { BAND, LAYOUT_VERSION, compassOf, edgeRoute, isOutsideEdge, layoutLayered, layoutView, toElkGraph } from '../../src/layout/layout'
import { sampleFiles } from '../fixtures/sample'

const ZONE = `
modules:
  - { id: infra.zone, parent: infra, name: Zone, responsibility: x }
  - { id: infra.zone.c0, parent: infra.zone, name: C0, role: core, responsibility: x }
  - { id: infra.zone.api, parent: infra.zone, name: API, responsibility: x }
  - { id: infra.zone.ext, parent: infra.zone, name: Ext, responsibility: x }
${Array.from({ length: 8 }, (_, i) => `  - { id: infra.zone.n${i}, parent: infra.zone, name: N${i}, responsibility: x }`).join('\n')}
relations:
  - { id: z1, from: infra.zone.api, to: infra.zone.c0, type: commands }
  - { id: z2, from: infra.zone.c0, to: infra.zone.ext, type: commands }
  - { id: z3, from: infra.zone.n0, to: infra.zone.c0, type: queries }
`
const ROLES = 'roles:\n  infra.zone.api: port\n  infra.zone.ext: adapter\n  infra.zone: port\n  infra.mus: adapter\n'
const { index } = loadModel(sampleFiles({ 'modules/zone.yaml': ZONE, 'intent/roles.yaml': ROLES }))

describe('L14 普通层次', () => {
  const view = projectLevel(index, 'infra.zone')

  it('port / adapter 标在视图节点上（rim），常显、不折叠进「+N」；其余普通模块照常折叠（O8）', () => {
    expect(view.nodes.find(n => n.id === 'infra.zone.api')!.rim).toBe('port')
    expect(view.nodes.find(n => n.id === 'infra.zone.ext')!.rim).toBe('adapter')
    expect(view.fold!.members).toHaveLength(8)
    expect(view.fold!.members).not.toContain('infra.zone.api')
    expect(compassOf(view.nodes.find(n => n.id === 'infra.zone.api')!)).toBe('rim-top')
    expect(compassOf(view.nodes.find(n => n.id === 'infra.zone.ext')!)).toBe('rim-right')
  })

  it('不交给 elk；它们的边是框外边（按需正交走线），内部节点上照常占端口', () => {
    const g = toElkGraph(view)
    expect(g.children!.map(c => c.id)).not.toContain('infra.zone.api')
    expect(g.children!.map(c => c.id)).not.toContain('infra.zone.ext')
    const e = view.edges.find(x => x.relationIds.includes('z1'))!
    const e2 = view.edges.find(x => x.relationIds.includes('z2'))!
    expect(g.children!.find(c => c.id === 'infra.zone.c0')!.ports!.map(p => p.id)).toEqual(expect.arrayContaining([`${e.id}#in`, `${e2.id}#out`]))
    expect(g.edges!.map(x => x.id)).not.toContain(e.id)
    expect(isOutsideEdge(view, e)).toBe(true)
  })

  it('布局后 port 的中心压在父模块框的上边、在所有内部节点之上；adapter 的中心压在右边、在所有内部节点之右；边能走线；布局版本已升级', async () => {
    const pv = await layoutView(view)
    const f = pv.parentFrame!
    const api = pv.nodes.get('infra.zone.api')!
    const ext = pv.nodes.get('infra.zone.ext')!
    expect(api.y + api.h / 2).toBeCloseTo(f.y)
    expect(ext.x + ext.w / 2).toBeCloseTo(f.x + f.w)
    const inner = ['infra.zone.c0', `more:infra.zone`].map(id => pv.nodes.get(id)!)
    for (const b of inner) {
      expect(api.y + api.h).toBeLessThan(b.y)
      expect(ext.x).toBeGreaterThan(b.x + b.w)
    }
    const z1 = view.edges.find(x => x.relationIds.includes('z1'))!
    const z2 = view.edges.find(x => x.relationIds.includes('z2'))!
    // port 的出边从它的底边出发（朝框内）；adapter 的进边从它的左边进入
    const r1 = edgeRoute(pv, z1)!
    expect(r1.points[0].y).toBeCloseTo(api.y + api.h)
    const r2 = edgeRoute(pv, z2)!
    expect(r2.points[r2.points.length - 1].x).toBeCloseTo(ext.x)
    expect(LAYOUT_VERSION).toBe('L14-rims-1')
  })
})

describe('L14 分层总览', () => {
  it('port / adapter 同核心模块常显在带内（不计入 +N）；port 压在带的上边，adapter 贴带的右边，不占核心模块的行', () => {
    const view = projectLevel(index, 'sys')
    const zone = view.nodes.find(n => n.id === 'infra.zone')!
    expect(zone).toMatchObject({ role: 'core', rim: 'port' })
    expect(view.nodes.find(n => n.id === 'infra.mus')).toMatchObject({ role: 'core', rim: 'adapter' })
    expect(view.bands!.find(b => b.layerId === 'infra')!.hiddenCount).toBe(0)
    const pv = layoutLayered(view)
    const band = pv.nodes.get('infra')!
    const z = pv.nodes.get('infra.zone')!
    const mus = pv.nodes.get('infra.mus')!
    expect(z.y + z.h / 2).toBeCloseTo(band.y)
    expect(mus.x + mus.w).toBeCloseTo(band.x + band.w)
    expect(mus.w).toBe(BAND.chip.w)
    // 核心模块在 port 之下
    const core = pv.nodes.get('infra.player')!
    expect(core.y).toBeGreaterThanOrEqual(z.y + z.h)
  })
})
