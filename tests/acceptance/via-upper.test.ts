/**
 * 验收：docs/01-requirements.md §6.9 经由上层关系（ADR-0014），以 h5player 的「方案切换事务」「命令执行」验收。
 * 用真实的 model/ 描述驱动协调者（DeskState）与时序模型；样式在浏览器中验证（e2e/via-upper.spec.ts）。
 */
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { readModelDir, readProject } from '../../vite/readModelDir'
import { createDeskState } from '../../src/state/useDeskState'
import { buildSequence, loadModel, planScenario, projectLevel, projectScenario, stageEnds, DEFAULT_PROJECT_OPTIONS } from '../../src/model'

const ROOT = path.resolve(import.meta.dirname, '../..')

async function open(url: string) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/p/:project', component: { render: () => null } }] })
  await router.push(url)
  const desk = createDeskState(async () => readProject(path.join(ROOT, 'model'), 'h5player', ROOT)!, { project: 'h5player' })
  desk.attachRouter(router)
  await desk.init()
  return desk
}

const current = (desk: Awaited<ReturnType<typeof open>>) => desk.run.scenarioView.value!.messages[desk.run.currentIndex.value!]

describe('§6.9 经由上层关系验收', () => {
  it('1、2. 「方案切换事务」在 infra.framework 层的 beginXxxModelSwitch() 为经由上层关系：临时线带对应关系，时序图标出；定位后选中该关系', async () => {
    const desk = await open('/p/h5player?level=infra.framework&sc=sc.switch-transaction&step=sc.switch-transaction%23begin')
    const at = current(desk).at
    expect(at).toMatchObject({ kind: 'upper', to: 'infra.framework.model-registry', relationId: 'rel.solution.stage-swap-framework' })
    const msg = desk.run.sequence.value!.messages.find(m => m.frameIds.includes('sc.switch-transaction#begin'))!
    expect(msg).toMatchObject({ temp: 'upper', relationId: 'rel.solution.stage-swap-framework' })
    desk.revealRelation('rel.solution.stage-swap-framework')
    await nextTick()
    expect(desk.selected.value).toEqual({ kind: 'relation', id: 'rel.solution.stage-swap-framework' })
    expect(desk.levelId.value).not.toBe('infra.framework')
  })

  it('3. 「命令执行」的 pre / post hook 及其返回：描述补上 Framework 回调 lifecycle 钩子的关系后，infra.framework 与 infra.framework.state-machine 两层都不再是未建模', async () => {
    for (const level of ['infra.framework', 'infra.framework.state-machine']) {
      const desk = await open(`/p/h5player?level=${level}&sc=sc.command&step=sc.command%23hook&alt=1`)
      expect(desk.run.frame.value).toMatchObject({ relation: 'rel.framework.sm-engine-solution-hooks', relationInferred: true })
      expect(current(desk).at.kind).toBe('edge')
      const ret = desk.run.sequence.value!.messages.find(m => m.label === 'success / ErrorBase')!
      expect(ret.temp).toBeUndefined()
    }
  })

  it('4. 两个场景的全部层次与分支上不再出现未建模', () => {
    const { index } = loadModel(readModelDir(path.join(ROOT, 'model/h5player'), ROOT).files)
    const levels = [index.rootId, ...[...index.modules.keys()].filter(id => (index.childrenOf.get(id)?.length ?? 0) > 0)]
    const unmodeled = new Set<string>()
    let upper = 0
    for (const id of ['sc.switch-transaction', 'sc.command']) {
      const plan = planScenario(index, id)
      for (const level of levels) {
        const view = projectLevel(index, level, { ...DEFAULT_PROJECT_OPTIONS, scenarioEnds: stageEnds(plan) })
        const seq = buildSequence(index, view, plan, new Map(), projectScenario(index, view, plan, new Map()))
        for (const m of seq.messages) {
          if (m.temp === 'upper') upper++
          if (m.temp === 'unmodeled') for (const f of m.frameIds) unmodeled.add(`${level} ${plan.frames.get(f)!.label}`)
        }
      }
    }
    expect(upper).toBeGreaterThan(0)
    expect([...unmodeled]).toEqual([])
  })
})
