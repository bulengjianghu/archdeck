import { describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createDeskState, decodeSelection, encodeSelection, type ModelPayload } from '../../src/state/useDeskState'
import { sampleFiles, scenarioFiles } from '../fixtures/sample'

async function setup(initialUrl = '/', files = sampleFiles()) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { render: () => null } }] })
  await router.push(initialUrl)
  let payload: ModelPayload = { dir: 'model/test', files }
  const desk = createDeskState(async () => payload)
  desk.attachRouter(router)
  await desk.init()
  const settle = async () => {
    await router.isReady()
    await new Promise(r => setTimeout(r, 0))
    await nextTick()
  }
  return { desk, router, settle, setPayload: (p: ModelPayload) => (payload = p) }
}

describe('选中编码', () => {
  it('模块 / 关系 / 边可往返编码', () => {
    for (const s of [{ kind: 'module', id: 'a.b' }, { kind: 'relation', id: 'r1' }, { kind: 'edge', id: 'a->b:calls' }] as const) {
      expect(decodeSelection(encodeSelection(s))).toEqual(s)
    }
    expect(decodeSelection('x:1')).toBeNull()
    expect(decodeSelection(undefined)).toBeNull()
  })
})

describe('DeskState', () => {
  it('初始在根层次，视图为分层总览', async () => {
    const { desk } = await setup()
    expect(desk.levelId.value).toBe('sys')
    expect(desk.view.value?.mode).toBe('layered')
    expect(desk.levelPath.value).toEqual(['sys'])
  })

  it('按 URL 打开指定层次与选中', async () => {
    const { desk } = await setup('/?level=infra.framework&sel=r:r6')
    expect(desk.levelId.value).toBe('infra.framework')
    expect(desk.selection.value).toEqual({ kind: 'relation', id: 'r6' })
  })

  it('URL 中不存在的层次或选中被忽略', async () => {
    const { desk } = await setup('/?level=nope&sel=m:nope')
    expect(desk.levelId.value).toBe('sys')
    expect(desk.selection.value).toBeNull()
  })

  it('下钻：有子模块才生效，并写入 URL 历史', async () => {
    const { desk, router, settle } = await setup()
    expect(desk.drillInto('infra.mus')).toBe(false)
    expect(desk.drillInto('infra')).toBe(true)
    await settle()
    expect(desk.levelId.value).toBe('infra')
    expect(router.currentRoute.value.query.level).toBe('infra')
  })

  it('紧接着的选中与下钻（双击）不会被路由回声覆盖', async () => {
    const { desk, settle } = await setup()
    desk.select({ kind: 'module', id: 'infra' })
    desk.select({ kind: 'module', id: 'infra' })
    desk.drillInto('infra')
    await settle()
    expect(desk.levelId.value).toBe('infra')
  })

  it('浏览器后退回到上一层次', async () => {
    const { desk, router, settle } = await setup()
    desk.drillInto('infra')
    await settle()
    desk.drillInto('infra.framework')
    await settle()
    router.back()
    await new Promise(r => setTimeout(r, 20))
    await settle()
    expect(desk.levelId.value).toBe('infra')
  })

  it('goUp 返回上级并选中刚离开的模块', async () => {
    const { desk } = await setup('/?level=infra.framework')
    desk.goUp()
    expect(desk.levelId.value).toBe('infra')
    expect(desk.selection.value).toEqual({ kind: 'module', id: 'infra.framework' })
  })

  it('revealRelation 跳到两端的最近公共祖先并选中', async () => {
    const { desk } = await setup()
    desk.revealRelation('r6')
    expect(desk.levelId.value).toBe('infra.framework')
    expect(desk.selection.value).toEqual({ kind: 'relation', id: 'r6' })
  })

  it('revealModule 跳到父模块并选中', async () => {
    const { desk } = await setup()
    desk.revealModule('infra.framework.sm')
    expect(desk.levelId.value).toBe('infra.framework')
    expect(desk.selection.value).toEqual({ kind: 'module', id: 'infra.framework.sm' })
  })

  it('重新加载保留层次与选中；层次被删除时退到最近的上级', async () => {
    const { desk, setPayload } = await setup('/?level=infra.framework&sel=m:infra.framework.sm')
    await desk.reload()
    expect(desk.levelId.value).toBe('infra.framework')
    expect(desk.selection.value).toEqual({ kind: 'module', id: 'infra.framework.sm' })

    const files = sampleFiles().map(f =>
      f.path === 'modules/infra.yaml' ? { ...f, text: f.text.replace(/    - id: infra\.framework\n[\s\S]*?(?=    - id: infra\.mus)/, '') } : f,
    )
    setPayload({ dir: 'model/test', files: files.map(f => (f.path === 'relations.yaml' ? { ...f, text: 'relations: []' } : f)) })
    await desk.reload()
    expect(desk.index.value!.modules.has('infra.framework')).toBe(false)
    expect(desk.levelId.value).toBe('infra')
    expect(desk.selection.value).toBeNull()
  })

  it('加载失败：首次为 error，已有模型时保持 ready 并记录错误', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { render: () => null } }] })
    let fail = true
    const desk = createDeskState(async () => {
      if (fail) throw new Error('boom')
      return { dir: 'x', files: sampleFiles() }
    })
    desk.attachRouter(router)
    await desk.init()
    expect(desk.status.value).toBe('error')
    expect(desk.loadError.value).toBe('boom')
    fail = false
    await desk.init()
    expect(desk.status.value).toBe('ready')
    fail = true
    await desk.reload()
    expect(desk.status.value).toBe('ready')
    expect(desk.loadError.value).toBe('boom')
  })

  it('开关变化后视图重新投影', async () => {
    const { desk } = await setup('/?level=infra')
    expect(desk.view.value!.nodes.some(n => n.role === 'boundary')).toBe(true)
    desk.toggles.showBoundaries = false
    expect(desk.view.value!.nodes.some(n => n.role === 'boundary')).toBe(false)
    desk.toggles.relationTypes = ['dataflow']
    expect(desk.view.value!.edges.map(e => e.type)).toEqual(['dataflow'])
  })

  it('视图变化后异步产出布局结果', async () => {
    const { desk } = await setup('/?level=infra')
    await new Promise(r => setTimeout(r, 200))
    expect(desk.positioned.value?.view.parentId).toBe('infra')
  })
})

describe('DeskState · 多项目', () => {
  it('只响应本项目路由上的变化，离开项目时不回写', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', component: { render: () => null } },
        { path: '/p/:project', component: { render: () => null } },
      ],
    })
    await router.push('/p/demo?level=infra')
    const desk = createDeskState(async () => ({ project: 'demo', dir: 'x', files: sampleFiles() }), { project: 'demo' })
    desk.attachRouter(router)
    await desk.init()
    expect(desk.project).toBe('demo')
    expect(desk.levelId.value).toBe('infra')
    await router.push('/')
    await new Promise(r => setTimeout(r, 0))
    expect(desk.levelId.value).toBe('infra')
    await router.push('/p/other?level=app')
    await new Promise(r => setTimeout(r, 0))
    expect(desk.levelId.value).toBe('infra')
  })
})

describe('DeskState · 设计版本', () => {
  const design = {
    id: 'next',
    name: '下一期',
    status: 'reviewing' as const,
    base: { commit: 'old' },
    revisions: [{ id: 'r1' }, { id: 'r2' }],
    problems: [],
  }
  const withSource = (commit: string) => sampleFiles({ 'system.yaml': `system: { id: sys, name: Sys, source: { commit: ${commit} } }` })
  const r2Files = sampleFiles({ 'system.yaml': 'system: { id: sys, name: Sys }', 'extra.yaml': 'modules: [{ id: infra.new, name: New, parent: infra }]' })

  async function open(initialUrl: string) {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/p/:project', component: { render: () => null } },
        { path: '/p/:project/d/:design/:revision', component: { render: () => null } },
      ],
    })
    await router.push(initialUrl)
    const desk = createDeskState(
      async () => ({
        project: 'demo',
        dir: 'model/demo/designs/next/r2',
        files: r2Files,
        designs: [design],
        version: { design: 'next', revision: 'r2' },
        compare: {
          current: { label: '当前版本', dir: 'model/demo', files: withSource('new') },
          previous: { label: '下一期 · r1', dir: 'x', files: r2Files },
        },
      }),
      { project: 'demo', version: { design: 'next', revision: 'r2' } },
    )
    desk.attachRouter(router)
    await desk.init()
    return { desk, router }
  }

  it('载入设计与对比基线，算出差异；可切换对比上一轮', async () => {
    const { desk } = await open('/p/demo/d/next/r2')
    expect(desk.design.value?.name).toBe('下一期')
    expect(desk.revision.value?.id).toBe('r2')
    expect(desk.baseline.value?.label).toBe('当前版本')
    expect(desk.diff.value?.module.get('infra.new')?.kind).toBe('added')
    expect(desk.diff.value?.touched.get('infra')).toBe(1)
    desk.toggles.compareTo = 'previous'
    expect(desk.baseline.value?.label).toBe('下一期 · r1')
    expect(desk.diff.value?.changes).toEqual([])
  })

  it('基线提交与当前版本不一致时提示漂移', async () => {
    const { desk } = await open('/p/demo/d/next/r2')
    expect(desk.baseDrift.value).toBe(true)
  })

  it('只响应同一版本路由上的变化', async () => {
    const { desk, router } = await open('/p/demo/d/next/r2?level=infra')
    expect(desk.levelId.value).toBe('infra')
    await router.push('/p/demo?level=app')
    await new Promise(r => setTimeout(r, 0))
    expect(desk.levelId.value).toBe('infra')
    await router.push('/p/demo/d/next/r1?level=app')
    await new Promise(r => setTimeout(r, 0))
    expect(desk.levelId.value).toBe('infra')
  })
})

describe('DeskState · 运行视角', () => {
  async function openDesk(url = '/') {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { render: () => null } }] })
    await router.push(url)
    const desk = createDeskState(async () => ({ dir: 'x', files: scenarioFiles() }))
    desk.attachRouter(router)
    await desk.init()
    const settle = async () => {
      await new Promise(r => setTimeout(r, 0))
      await nextTick()
    }
    return { desk, router, settle }
  }

  it('打开场景：进入运行视角、层次不变、舞台不受筛选影响；派生出本层投影与时序模型', async () => {
    const { desk, router, settle } = await openDesk('/?level=infra')
    desk.setToggles({ relationTypes: ['depends'], showBoundaries: false })
    expect(desk.view.value!.nodes.some(n => n.role === 'boundary')).toBe(false)
    desk.openScenario('sc.play')
    await settle()
    expect(desk.perspective.value).toBe('run')
    expect(desk.levelId.value).toBe('infra')
    expect(router.currentRoute.value.query).toMatchObject({ level: 'infra', sc: 'sc.play' })
    expect(desk.view.value!.nodes.some(n => n.id === 'boundary:app')).toBe(true)
    expect(desk.scenarioView.value!.messages.length).toBeGreaterThan(0)
    expect(desk.sequence.value!.participants[0].kind).toBe('actor')
    expect(desk.home.value).toBe('sys')
    expect(desk.frame.value).toBeNull()
    desk.next()
    await settle()
    expect(desk.frame.value?.id).toBe('sc.play#start')
    expect(router.currentRoute.value.query.step).toBe('sc.play#start')
  })

  it('复制地址到新页面：回到同一场景、同一步骤、同一分支选择', async () => {
    const { desk } = await openDesk('/?level=infra&sc=sc.play&step=sc.play%23update&alt=0')
    expect(desk.playback.value).toMatchObject({ scenarioId: 'sc.play', frameId: 'sc.play#update' })
    expect(desk.playback.value!.choices.get('sc.play#3')).toBe(0)
    expect(desk.currentIndex.value).not.toBeNull()
  })

  it('钉住对象时派生其在本场景中的参与；退出场景回到结构视角，层次与选中保留', async () => {
    const { desk, router, settle } = await openDesk('/?level=infra&sc=sc.play&step=sc.play%23done&alt=1')
    desk.select({ kind: 'module', id: 'infra.framework' })
    expect(desk.focus.value.kind).toBe('pinned')
    expect(desk.pinnedParticipation.value!.frames.length).toBeGreaterThan(0)
    desk.closeScenario()
    await settle()
    expect(desk.perspective.value).toBe('structure')
    expect(desk.selection.value).toEqual({ kind: 'module', id: 'infra.framework' })
    expect(router.currentRoute.value.query.sc).toBeUndefined()
  })

  it('导航树的派生：步骤大纲（T6）与参与模块（T5）随场景出现，退出后清空', async () => {
    const { desk } = await openDesk('/?sc=sc.play')
    expect(desk.outline.value.some(n => n.kind === 'group' && n.tag.kind === 'ref')).toBe(true)
    expect(desk.participants.value.has('infra')).toBe(true)
    expect(desk.participants.value.has('infra.framework.sm')).toBe(true)
    desk.closeScenario()
    expect(desk.outline.value).toEqual([])
    expect(desk.participants.value.size).toBe(0)
  })
})
