/**
 * 验收：docs/01-requirements.md §6.5 运行视角聚焦，以 h5player 的「命令执行」验收。
 * 用真实的 model/ 描述驱动协调者（DeskState）；舞台显示用显示函数验证；面板形态（第 5 条）是纯界面行为，在浏览器中验证。
 */
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { readProject } from '../../vite/readModelDir'
import { createDeskState } from '../../src/state/useDeskState'
import { compareKeys, hierarchyKey, pointPrefix } from '../../src/model'
import { stageDisplay } from '../../src/layout/stage'

const ROOT = path.resolve(import.meta.dirname, '../..')

async function open(url: string) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/p/:project', component: { render: () => null } }] })
  await router.push(url)
  const desk = createDeskState(async () => readProject(path.join(ROOT, 'model'), 'h5player', ROOT)!, { project: 'h5player' })
  desk.attachRouter(router)
  await desk.init()
  return desk
}

describe('§6.5 运行视角聚焦验收', () => {
  it('1. 泳道按层次顺序：同层的在前、Framework 子模块相邻成组、Application 在后；结构图边界节点行顺序一致', async () => {
    const desk = await open('/p/h5player?level=infra.framework&sc=sc.command')
    const model = desk.sequence.value!
    const order = model.participants.filter(p => p.kind !== 'actor')
    const lanes = [...(await import('../../src/layout/sequence')).layoutSequence(model).lanes.keys()]
    const inner = lanes.filter(id => order.some(p => p.nodeId === id)).map(id => order.find(p => p.nodeId === id)!)
    const first = inner.findIndex(p => p.parentId === 'infra.framework')
    const last = inner.map(p => p.parentId).lastIndexOf('infra.framework')
    expect(inner.slice(first, last + 1).every(p => p.parentId === 'infra.framework')).toBe(true)
    expect(inner.findIndex(p => p.id === 'infra.player-index')).toBeLessThan(first)
    expect(inner.findIndex(p => p.id === 'app')).toBeGreaterThan(last)
    expect(inner.find(p => p.id === 'app')!.layer).toBe('app')
    const boundaries = desk.view.value!.nodes.filter(n => n.role === 'boundary').map(n => n.moduleId)
    expect([...boundaries].sort((a, b) => compareKeys(hierarchyKey(desk.index.value!, a), hierarchyKey(desk.index.value!, b)))).toEqual(boundaries)
  })

  it('2. 有显式返回的调用：与配对返回一起突出；钉住模块后突出它参与的消息', async () => {
    const desk = await open('/p/h5player?level=infra.framework&sc=sc.command&alt=1')
    desk.seek('sc.command#hook')
    const sv = desk.scenarioView.value!
    const paired = desk.pairs.value!.get('sc.command#hook')!
    expect(desk.plan.value!.frames.get(paired)!.kind).toBe('return')
    expect([...desk.emphasis.value!].sort()).toEqual([sv.messageOf.get('sc.command#hook')!, sv.messageOf.get(paired)!].sort())
    desk.select({ kind: 'module', id: 'infra.framework.state-machine' })
    expect([...desk.emphasis.value!]).toEqual(desk.pinnedParticipation.value!.messages)
  })

  it('3. 直选分支：改走未选的一支，路线同步；播放头原在旧分支内时退到分支点之前；改选靠前的分支点提示丢弃个数', async () => {
    const desk = await open('/p/h5player?level=infra.framework&sc=sc.command')
    const point = desk.route.value[0].pointId
    // 走「需要改图」并进入分支内
    desk.chooseBranch(point, 0)
    desk.seek('sc.command#swap')
    expect(desk.playback.value!.frameId).toBe('sc.command#swap')
    // 内层还有分支点：选一个，再改选外层
    const innerPoint = desk.route.value[1]?.pointId
    if (innerPoint) desk.chooseBranch(innerPoint, 0)
    const dropped = desk.chooseBranch(point, 1)
    expect(desk.route.value[0].chosen).toBe(1)
    expect(dropped).toBe(innerPoint ? 1 : 0)
    // 停在分支点之前的最后一帧（本层可见时取其可见消息的第一帧）
    const last = pointPrefix(desk.plan.value!, desk.playback.value!.choices, point).at(-1)!.id
    const sv = desk.scenarioView.value!
    const m = sv.messageOf.get(last)
    expect(desk.playback.value!.frameId).toBe(m === undefined ? last : sv.messages[m].frameIds[0])
    expect(desk.walked.value).toBeGreaterThan(0)
  })

  it('4. 舞台默认只显示参与本场景的节点；淡显时其余淡化出现；在画布上显示的对象的静态边出现', async () => {
    const desk = await open('/p/h5player?level=infra.framework&sc=sc.command&step=sc.command%23hook')
    const view = desk.view.value!
    const input = { view, participants: desk.stageParticipants.value, playEdges: new Set<string>(), reveal: new Set<string>() }
    const hide = stageDisplay({ ...input, mode: 'hide' })
    const hidden = [...hide.nodes].filter(([, v]) => v === 'hide').map(([id]) => id)
    expect(hidden.length).toBeGreaterThan(0)
    for (const id of hidden) expect(desk.stageParticipants.value.has(id)).toBe(false)
    const dim = stageDisplay({ ...input, mode: 'dim' })
    for (const id of hidden) expect(dim.nodes.get(id)).toBe('dim')
    const sm = 'infra.framework.state-machine'
    const revealed = stageDisplay({ ...input, mode: 'hide', reveal: new Set([sm]) })
    const smEdges = view.edges.filter(e => e.from === sm || e.to === sm)
    expect(smEdges.length).toBeGreaterThan(0)
    for (const e of smEdges) expect(revealed.edges.get(e.id)).toBe('show')
  })
})
