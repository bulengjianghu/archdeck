/**
 * 验收：docs/01-requirements.md §6.8 统一选中（ADR-0012），以 h5player 的「命令执行」验收。
 * 用真实的 model/ 描述驱动协调者（DeskState）；第 7 条（步骤树的「同一步」）在 navigation-tree.test.ts；样式在浏览器中验证。
 */
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { readProject } from '../../vite/readModelDir'
import { createDeskState } from '../../src/state/useDeskState'
import { lanesOf } from '../../src/model'

const ROOT = path.resolve(import.meta.dirname, '../..')

async function open(url: string) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/p/:project', component: { render: () => null } }] })
  await router.push(url)
  const desk = createDeskState(async () => readProject(path.join(ROOT, 'model'), 'h5player', ROOT)!, { project: 'h5player' })
  desk.attachRouter(router)
  await desk.init()
  const query = async () => {
    await new Promise(r => setTimeout(r, 0))
    await nextTick()
    return router.currentRoute.value.query
  }
  return { desk, query }
}

describe('§6.8 统一选中验收', () => {
  it('1. 打开场景选中场景，地址没有 sel 与 step；「下一步」选中第 1 步，地址只有 step', async () => {
    const { desk, query } = await open('/p/h5player')
    desk.openScenario('sc.command')
    expect(desk.selected.value).toEqual({ kind: 'scenario', id: 'sc.command' })
    expect(await query()).not.toHaveProperty('sel')
    expect(await query()).not.toHaveProperty('step')
    desk.next()
    expect(desk.selected.value).toEqual({ kind: 'step', id: desk.playback.value!.frameId })
    const q = await query()
    expect(q.step).toBe(desk.playback.value!.frameId)
    expect(q).not.toHaveProperty('sel')
  })

  it('2、3. 选中步骤时只有它为选中、配对返回只作配对；选中模块时突出泳道、不突出消息，sel 与 step 并存，「下一步」从进度处继续', async () => {
    const { desk, query } = await open('/p/h5player?level=infra.framework&sc=sc.command&alt=1')
    desk.seek('sc.command#hook')
    const sv = desk.scenarioView.value!
    expect(desk.emphasis.value).toMatchObject({ selected: sv.messageOf.get('sc.command#hook') })
    expect(desk.emphasis.value!.paired.size).toBe(1)
    expect(desk.emphasis.value!.lanes.size).toBe(0)
    const at = desk.playback.value!.frameId
    desk.select({ kind: 'module', id: 'infra.framework.state-machine' })
    expect(desk.emphasis.value).toMatchObject({ selected: null })
    expect(desk.emphasis.value!.paired.size).toBe(0)
    expect([...desk.emphasis.value!.lanes]).toEqual(['infra.framework.state-machine'])
    expect(desk.playback.value!.frameId).toBe(at)
    expect(await query()).toMatchObject({ sel: 'm:infra.framework.state-machine', step: at })
    desk.next()
    expect(desk.selected.value!.kind).toBe('step')
    expect(desk.currentIndex.value).toBe(sv.messageOf.get(at!)! + 1)
  })

  it('4. 下钻选中被下钻的模块（当前层次本身，不突出）；返回上级在父层选中退出来的模块，原来的步骤被取消，其泳道突出', async () => {
    const { desk } = await open('/p/h5player?sc=sc.command')
    for (let i = 0; i < 3; i++) desk.next()
    const at = desk.playback.value!.frameId
    desk.drillInto('infra')
    expect(desk.selected.value).toEqual({ kind: 'module', id: 'infra' })
    expect(desk.emphasis.value).toEqual({ selected: null, paired: new Set(), lanes: new Set() })
    desk.next()
    expect(desk.selected.value!.kind).toBe('step')
    desk.goUp()
    expect(desk.selected.value).toEqual({ kind: 'module', id: 'infra' })
    expect(desk.playback.value!.frameId).not.toBe(at)
    const lanes = lanesOf(desk.index.value!, desk.sequence.value!, desk.levelId.value, 'infra')
    expect(lanes.size).toBeGreaterThan(0)
    expect(desk.emphasis.value!.lanes).toEqual(lanes)
  })

  it('5. 选中模块后 Esc 回到选中进度所在的步骤；再按 Esc 返回上级', async () => {
    const { desk } = await open('/p/h5player?level=infra&sc=sc.command')
    desk.next()
    const at = desk.playback.value!.frameId
    desk.select({ kind: 'module', id: 'infra.framework' })
    desk.pressKey('Escape')
    expect(desk.selected.value).toEqual({ kind: 'step', id: at })
    desk.pressKey('Escape')
    expect(desk.levelId.value).toBe(desk.index.value!.rootId)
    expect(desk.selected.value).toEqual({ kind: 'module', id: 'infra' })
  })

  it('6. 选中关系：突出两端泳道', async () => {
    const { desk } = await open('/p/h5player?level=infra.framework&sc=sc.command&alt=1')
    desk.seek('sc.command#hook')
    const idx = desk.index.value!
    const lanesOfEnds = (id: string) => {
      const r = idx.relations.get(id)!
      return new Set([r.from, r.to].flatMap(e => [...lanesOf(idx, desk.sequence.value!, desk.levelId.value, e)]))
    }
    // 回放路径上一条两端落在两条不同泳道上的关系
    const relation = [...desk.plan.value!.frames.values()].map(f => f.relation).find(id => !!id && lanesOfEnds(id).size === 2)!
    expect(relation).toBeTruthy()
    desk.select({ kind: 'relation', id: relation })
    const expected = lanesOfEnds(relation)
    expect(desk.emphasis.value!.lanes).toEqual(expected)
    expect(desk.emphasis.value!.selected).toBeNull()
  })
})
