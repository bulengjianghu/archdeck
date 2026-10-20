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
  /** 时钟到点（不等真实计时器） */
  const tick = (n = 1) => {
    for (let i = 0; i < n; i++) desk.dispatch({ type: 'tick' })
  }
  return { desk, router, settle, tick }
}

describe('§6.2 运行视角验收', () => {
  it('1. 在根层通过「运行」选一个场景：进入运行视角、层次不变、自动播放；只突出参与者与走过的边；出现时序图；参与者泳道在最左', async () => {
    for (const [project, sc] of [['h5player', 'sc.command'], ['h5p-arch-desk', 'sc.open-and-play']]) {
      const { desk, tick } = await open(project)
      const root = desk.levelId.value
      desk.openScenario(sc)
      expect(desk.perspective.value).toBe('run')
      expect(desk.levelId.value).toBe(root)
      expect(desk.playback.value).toMatchObject({ scenarioId: sc, playing: true })
      tick(2)
      const sv = desk.scenarioView.value!
      const active = new Set(sv.messages.flatMap(m => (m.at.kind === 'internal' ? [m.at.node] : [m.at.from, m.at.to])))
      expect(active.size).toBeGreaterThan(0)
      expect(active.size).toBeLessThan(desk.view.value!.nodes.length)
      expect(desk.sequence.value!.participants[0].kind).toBe('actor')
      expect(desk.walked.value).toBe(2)
    }
  })

  it('2. 播放中双击下钻：暂停并钉住，播放头仍是同一帧；泳道变细、可见消息变多、单步粒度变细', async () => {
    const { desk, tick } = await open('h5player')
    desk.openScenario('sc.command')
    // 先走过两个分支点（需要改图 → 事务成功），再从头播放到一半
    tick(20)
    desk.chooseBranch(desk.branchPoint.value!.id, 0)
    desk.play()
    tick(20)
    desk.chooseBranch(desk.branchPoint.value!.id, 0)
    desk.seek(desk.scenarioView.value!.messages[0].frameIds[0])
    desk.play()
    tick(3)
    expect(desk.playback.value!.playing).toBe(true)
    const frame = desk.playback.value!.frameId
    // 两端都在 Infrastructure 内的帧：根层合并为该层的内部活动，下钻后拆成更细的可见消息
    const idx = desk.index.value!
    const inInfra = desk.path.value!.frames.filter(f => [f.from, f.to].every(id => idx.pathOf.get(id)?.includes('infra'))).map(f => f.id)
    const messagesOf = () => new Set(inInfra.map(id => desk.scenarioView.value!.messageOf.get(id)).filter(m => m !== undefined))
    const rootMessages = messagesOf().size
    const rootLanes = desk.sequence.value!.participants.map(p => p.nodeId)
    desk.drillInto('infra')
    expect(desk.playback.value).toMatchObject({ playing: false, frameId: frame })
    expect(desk.focus.value).toEqual({ kind: 'pinned', selection: { kind: 'module', id: 'infra' } })
    expect(messagesOf().size).toBeGreaterThan(rootMessages)
    // 泳道变细：根层把 Infrastructure 内部的活动画在「Infrastructure」一条泳道上，下钻后换成它的子模块
    const lanes = desk.sequence.value!.participants.map(p => p.nodeId)
    expect(rootLanes).toContain('infra')
    expect(lanes).not.toContain('infra')
    expect(lanes).toEqual(expect.arrayContaining(['infra.player-index', 'infra.framework']))
  })

  it('3. 播放到 alt：自动暂停并展开全部选项；选一支后继续；退回分支点之前再前进沿用已选分支；在分支点改选后其后的选择被丢弃', async () => {
    const { desk, tick } = await open('h5player')
    desk.openScenario('sc.command')
    tick(20)
    expect(desk.playback.value!.playing).toBe(false)
    const point = desk.branchPoint.value!
    expect(point.options.map(o => o.when)).toEqual(['需要改图（方案或三元组变化）', '无需改图'])
    desk.chooseBranch(point.id, 0)
    desk.play()
    tick(20)
    // ref 内联的「方案切换事务」里还有一个分支点
    const inner = desk.branchPoint.value!
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

  it('4. 在时序图上点一条之前的消息：后退到这一步并暂停，已走过的边与「从头播放到这一步」完全一致；推断的关系有「推断」标记', async () => {
    const { desk, tick } = await open('h5player', '/p/h5player?level=infra')
    desk.openScenario('sc.command')
    tick(30)
    desk.chooseBranch(desk.branchPoint.value!.id, 1)
    desk.play()
    tick(30)
    await new Promise(r => setTimeout(r, 300))
    const target = desk.sequence.value!.messages.find(m => m.pathIndex === 2)!
    desk.seek(target.frameIds[0])
    const viaSeek = { frame: desk.playback.value!.frameId, walked: [...desk.overlay.value!.walked.keys()], playing: desk.playback.value!.playing }
    // 从头播放到这一步
    desk.closeScenario()
    desk.openScenario('sc.command')
    tick(3)
    const viaPlay = { frame: desk.playback.value!.frameId, walked: [...desk.overlay.value!.walked.keys()] }
    expect(viaSeek.playing).toBe(false)
    expect(viaSeek.frame).toBe(viaPlay.frame)
    expect(viaSeek.walked).toEqual(viaPlay.walked)
    // 面板：推断的关系
    expect(desk.frame.value!.relationInferred).toBe(true)
  })

  it('5. 钉住一个模块时先显示它在本场景中参与的步骤；取消选中回到当前步骤但不恢复播放；点播放后恢复跟随', async () => {
    const { desk, tick } = await open('h5p-arch-desk', '/p/h5p-arch-desk?level=state')
    desk.openScenario('sc.open-and-play')
    tick(4)
    desk.select({ kind: 'module', id: 'state.desk' })
    expect(desk.focus.value.kind).toBe('pinned')
    expect(desk.playback.value!.playing).toBe(false)
    expect(desk.pinnedParticipation.value!.frames.length).toBeGreaterThan(0)
    desk.select(null)
    expect(desk.focus.value).toMatchObject({ kind: 'follow' })
    expect(desk.playback.value!.playing).toBe(false)
    desk.play()
    expect(desk.playback.value!.playing).toBe(true)
    expect(desk.focus.value.kind).toBe('follow')
  })

  it('6. 与结构不一致的步骤：端点与引用关系不符、两端无任何关系 → 错误 / 提醒；引用 depends → 错误；无关系的一步回放时画「结构中未建模」', async () => {
    const bad: RawFile = {
      path: 'scenarios/bad.yaml',
      text: `scenario:
  id: sc.bad
  name: 不一致的步骤
  steps:
    - call: {from: model.diff, to: access.lint, relation: rel.ad.list-fetch}
    - call: {from: state.desk.clock, to: access.lint}
    - call: {from: present.shell, to: present.project-list, relation: rel.ad.shell-list}
`,
    }
    const issues = loadModel([...payload('h5p-arch-desk').files, bad]).issues.map(i => [i.severity, i.code])
    expect(issues).toEqual([
      ['error', 'step-relation-mismatch'],
      ['warning', 'step-unmodeled'],
      ['error', 'step-relation-not-runtime'],
    ])
    const { desk, tick } = await open('h5p-arch-desk', '/p/h5p-arch-desk', [bad])
    expect(desk.issues.value.filter(i => i.file === 'scenarios/bad.yaml')).toHaveLength(3)
    desk.openScenario('sc.bad')
    tick(2)
    expect(desk.scenarioView.value!.messages[1].at.kind).toBe('unmodeled')
  })

  it('7. 复制运行视角下的地址到新标签打开：回到同一场景、同一步骤、同一分支选择，处于暂停', async () => {
    const a = await open('h5player', '/p/h5player?level=infra')
    a.desk.openScenario('sc.command')
    a.tick(30)
    a.desk.chooseBranch(a.desk.branchPoint.value!.id, 0)
    a.desk.play()
    a.tick(4)
    a.desk.pause()
    await a.settle()
    const url = a.router.currentRoute.value.fullPath
    const b = await open('h5player', url)
    expect(b.desk.playback.value).toMatchObject({ scenarioId: 'sc.command', frameId: a.desk.playback.value!.frameId, playing: false })
    expect([...b.desk.playback.value!.choices]).toEqual([...a.desk.playback.value!.choices])
    expect(b.desk.levelId.value).toBe('infra')
  })

  it('8. 退出场景：回到结构视角，层次与选中保留，分屏消失', async () => {
    const { desk } = await open('h5player', '/p/h5player?level=infra&sel=m:infra.framework')
    desk.openScenario('sc.command')
    desk.select({ kind: 'module', id: 'infra.framework' })
    desk.closeScenario()
    expect(desk.perspective.value).toBe('structure')
    expect(desk.levelId.value).toBe('infra')
    expect(desk.selection.value).toEqual({ kind: 'module', id: 'infra.framework' })
    expect(desk.sequence.value).toBeNull()
  })
})
