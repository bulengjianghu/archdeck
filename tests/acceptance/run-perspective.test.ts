/**
 * 验收：docs/01-requirements.md §6.2 运行视角，以 h5p-arch-desk 自身的场景与 h5player 迁移的两个场景验收。
 * 用真实的 model/ 描述驱动协调者（DeskState），逐条对照验收标准；界面截图另附。
 */
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { readProject, type ModelPayload } from '../../vite/readModelDir'
import { createDeskState } from '../../src/state/useDeskState'
import { loadModel, type RawFile } from '../../src/model'

const ROOT = path.resolve(import.meta.dirname, '../..')
const payload = (project: string, extra: RawFile[] = []): ModelPayload => {
  const p = readProject(path.join(ROOT, 'model'), project, ROOT)!
  return { ...p, files: [...p.files, ...extra] }
}

async function open(project: string, url = `/p/${project}`, extra: RawFile[] = []) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/p/:project', component: { render: () => null } }] })
  await router.push(url)
  const desk = createDeskState(async () => payload(project, extra), { project })
  desk.attachRouter(router)
  await desk.init()
  const settle = async () => {
    await new Promise(r => setTimeout(r, 0))
    await nextTick()
  }
  /** 连按 n 次「下一步」；到分支点或末尾后多按无效 */
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) desk.next()
  }
  return { desk, router, settle, step }
}

describe('§6.2 运行视角验收', () => {
  it('1. 在根层通过「运行」选一个场景：进入运行视角、层次不变、停在开头且面板显示场景；逐步前进；只突出参与者与走过的边；出现时序图；参与者泳道在最左', async () => {
    for (const [project, sc] of [
      ['h5player', 'sc.command'],
      ['h5p-arch-desk', 'sc.open-and-play'],
    ]) {
      const { desk, step } = await open(project)
      const root = desk.levelId.value
      desk.openScenario(sc)
      expect(desk.playing.value).toBe(true)
      expect(desk.viewpoint.value).toBe('interaction')
      expect(desk.levelId.value).toBe(root)
      expect(desk.playback.value).toMatchObject({ scenarioId: sc, frameId: null })
      expect(desk.selected.value).toEqual({ kind: 'scenario', id: sc })
      expect(desk.run.walked.value).toBe(0)
      step(2)
      const sv = desk.run.scenarioView.value!
      const active = new Set(sv.messages.flatMap(m => (m.at.kind === 'internal' ? [m.at.node] : [m.at.from, m.at.to])))
      expect(active.size).toBeGreaterThan(0)
      expect(active.size).toBeLessThan(desk.view.value!.nodes.length)
      expect(desk.run.sequence.value!.participants[0].kind).toBe('actor')
      expect(desk.run.walked.value).toBe(2)
    }
  })

  it('2. 回放中双击下钻：选中被下钻的模块，播放头仍是同一帧；泳道变细、可见消息不少于上一层、单步粒度变细', async () => {
    const { desk, step } = await open('h5player')
    desk.openScenario('sc.command')
    // 先走过两个分支点（需要改图 → 事务成功），再回到第一步、前进到一半
    step(20)
    desk.chooseBranch(desk.run.branchPoint.value!.id, 0)
    step(20)
    desk.chooseBranch(desk.run.branchPoint.value!.id, 0)
    desk.seek(desk.run.scenarioView.value!.messages[0].frameIds[0])
    step(3)
    const frame = desk.playback.value!.frameId
    // 两端都在 Infrastructure 内的帧：根层按核心模块与「其他」泳道画，下钻后拆到子模块，可见消息不少于根层
    const idx = desk.index.value!
    const inInfra = desk.run.path.value!.frames.filter(f => [f.from, f.to].every(id => idx.pathOf.get(id)?.includes('infra'))).map(f => f.id)
    const messagesOf = () => new Set(inInfra.map(id => desk.run.scenarioView.value!.messageOf.get(id)).filter(m => m !== undefined))
    const rootMessages = messagesOf().size
    const rootLanes = desk.run.sequence.value!.participants.map(p => p.nodeId)
    desk.drillInto('infra')
    expect(desk.playback.value!.frameId).toBe(frame)
    expect(desk.selected.value).toEqual({ kind: 'module', id: 'infra' })
    expect(messagesOf().size).toBeGreaterThanOrEqual(rootMessages)
    // 泳道变细：根层 Infrastructure 的非核心模块画在「Infrastructure · 其他」泳道上，下钻后换成它的子模块
    const lanes = desk.run.sequence.value!.participants.map(p => p.nodeId)
    expect(lanes).not.toContain('infra')
    // 下钻后出现根层没有的更细的泳道
    expect(lanes.some(id => !rootLanes.includes(id))).toBe(true)
    expect(lanes).toEqual(expect.arrayContaining(['infra.player-index', 'infra.framework']))
  })

  it('3. 单步到 alt：展开全部选项，未选时不能再前进；选一支后继续；退回分支点之前再前进沿用已选分支；在分支点改选后其后的选择被丢弃', async () => {
    const { desk, step } = await open('h5player')
    desk.openScenario('sc.command')
    step(20)
    const point = desk.run.branchPoint.value!
    const stuck = desk.playback.value!.frameId
    desk.next()
    expect(desk.playback.value!.frameId).toBe(stuck)
    expect(point.options.map(o => o.when)).toEqual(['需要改图（方案或三元组变化）', '无需改图'])
    desk.chooseBranch(point.id, 0)
    step(20)
    // ref 内联的「方案切换事务」里还有一个分支点
    const inner = desk.run.branchPoint.value!
    expect(inner.id).not.toBe(point.id)
    desk.chooseBranch(inner.id, 1)
    const at = desk.playback.value!.frameId
    desk.prev()
    desk.prev()
    desk.next()
    desk.next()
    expect(desk.playback.value!.frameId).toBe(at)
    expect(desk.playback.value!.choices.get(inner.id)).toBe(1)
    // 回到外层分支点之前，在外层分支点改选
    desk.chooseBranch(point.id, 1)
    expect(desk.playback.value!.choices.get(inner.id)).toBeUndefined()
    expect(desk.playback.value!.choices.get(point.id)).toBe(1)
  })

  it('4. 在时序图上点一条之前的消息：后退到这一步，已走过的边与「从头单步到这一步」完全一致；推断的关系有「推断」标记', async () => {
    const { desk, step } = await open('h5player', '/p/h5player?level=infra')
    desk.openScenario('sc.command')
    step(30)
    desk.chooseBranch(desk.run.branchPoint.value!.id, 1)
    step(30)
    // 舞台叠加依赖异步布局：负载高时 300ms 不一定够，等到布局完成为止
    const layoutReady = async () => {
      for (let i = 0; i < 100 && !desk.run.overlay.value; i++) await new Promise(r => setTimeout(r, 50))
    }
    await layoutReady()
    const target = desk.run.sequence.value!.messages.find(m => m.pathIndex === 2)!
    desk.seek(target.frameIds[0])
    const viaSeek = { frame: desk.playback.value!.frameId, walked: [...desk.run.overlay.value!.walked.keys()] }
    // 从头单步到这一步
    desk.closeScenario()
    desk.openScenario('sc.command')
    step(3)
    await layoutReady()
    const viaPlay = { frame: desk.playback.value!.frameId, walked: [...desk.run.overlay.value!.walked.keys()] }
    expect(viaSeek.frame).toBe(viaPlay.frame)
    expect(viaSeek.walked).toEqual(viaPlay.walked)
    // 面板：推断的关系
    expect(desk.run.frame.value!.relationInferred).toBe(true)
  })

  it('5. 选中一个模块时先显示它在本场景中参与的步骤；取消选中，或单步、指向某一步，选中回到进度所在的步骤', async () => {
    const { desk, step } = await open('h5p-arch-desk', '/p/h5p-arch-desk?level=state')
    desk.openScenario('sc.open-and-play')
    step(4)
    desk.select({ kind: 'module', id: 'state.desk' })
    expect(desk.selected.value).toEqual({ kind: 'module', id: 'state.desk' })
    expect(desk.run.participation.value!.frames.length).toBeGreaterThan(0)
    const at = desk.playback.value!.frameId
    desk.select(null)
    expect(desk.selected.value).toEqual({ kind: 'step', id: at })
    desk.select({ kind: 'module', id: 'state.desk' })
    desk.next()
    expect(desk.selected.value!.kind).toBe('step')
    desk.select({ kind: 'module', id: 'state.desk' })
    desk.seek(at!)
    expect(desk.selected.value).toEqual({ kind: 'step', id: at })
  })

  it('6. 与结构不一致的步骤：端点与引用关系不符、两端无任何关系 → 错误 / 提醒；引用不存在的关系（如已删去的 implements，M17）→ 按不存在的关系提醒；无关系的一步回放时画「结构中未建模」', async () => {
    const bad: RawFile = {
      path: 'scenarios/bad.yaml',
      text: `scenario:
  id: sc.bad
  name: 不一致的步骤
  steps:
    - call: {from: model.diff, to: access.lint, relation: rel.ad.list-fetch}
    - call: {from: model.pipeline.loader, to: model.pipeline.validator}
    - call: {from: access.lint, to: access.deps, relation: rel.bad.impl}
`,
    }
    const issues = loadModel([...payload('h5p-arch-desk').files, bad])
      .issues.filter(i => i.file === 'scenarios/bad.yaml')
      .map(i => [i.severity, i.code])
    expect(issues).toEqual([
      ['warning', 'unknown-relation'],
      ['error', 'step-relation-mismatch'],
      ['warning', 'step-unmodeled'],
    ])
    // 第十六轮：模型层改为分层总览（ADR-0052）后带间都有边，未建模的一步放在加载流水线的普通层次里看
    const { desk, step } = await open('h5p-arch-desk', '/p/h5p-arch-desk?level=model.pipeline', [bad])
    expect(desk.issues.value.filter(i => i.file === 'scenarios/bad.yaml')).toHaveLength(3)
    desk.openScenario('sc.bad')
    step(2)
    // 本层只看得到第 2 步（加载流水线内部）
    expect(desk.run.scenarioView.value!.messages.map(m => m.at.kind)).toEqual(['unmodeled'])
  })

  it('7. 复制运行视角下的地址到新标签打开：回到同一场景、同一步骤、同一分支选择', async () => {
    const a = await open('h5player', '/p/h5player?level=infra')
    a.desk.openScenario('sc.command')
    a.step(30)
    a.desk.chooseBranch(a.desk.run.branchPoint.value!.id, 0)
    a.step(4)
    await a.settle()
    const url = a.router.currentRoute.value.fullPath
    const b = await open('h5player', url)
    expect(b.desk.playback.value).toMatchObject({ scenarioId: 'sc.command', frameId: a.desk.playback.value!.frameId })
    expect([...b.desk.playback.value!.choices]).toEqual([...a.desk.playback.value!.choices])
    expect(b.desk.levelId.value).toBe('infra')
  })

  it('8. 退出场景：回到结构视角，层次与选中保留，分屏消失', async () => {
    const { desk } = await open('h5player', '/p/h5player?level=infra&sel=m:infra.framework')
    desk.openScenario('sc.command')
    desk.select({ kind: 'module', id: 'infra.framework' })
    desk.closeScenario()
    expect(desk.viewpoint.value).toBe('interaction')
    expect(desk.levelId.value).toBe('infra')
    expect(desk.selection.value).toEqual({ kind: 'module', id: 'infra.framework' })
    expect(desk.run.sequence.value).toBeNull()
  })
})
