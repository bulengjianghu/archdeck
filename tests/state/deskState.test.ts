import { NO_WRITER } from '../../src/state/sync/writer'
import { describe, expect, it, vi } from 'vitest'
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
    for (const s of [
      { kind: 'module', id: 'a.b' },
      { kind: 'relation', id: 'r1' },
      { kind: 'edge', id: 'a->b:calls' },
    ] as const) {
      expect(decodeSelection(encodeSelection(s))).toEqual(s)
    }
    expect(decodeSelection(encodeSelection({ kind: 'cycle', id: '2' }))).toEqual({ kind: 'cycle', id: '2' })
    expect(encodeSelection({ kind: 'cycle', id: '2' })).toBe('y:2')
    expect(decodeSelection('x:1')).toBeNull()
    expect(decodeSelection(undefined)).toBeNull()
  })
})

describe('DeskState', () => {
  it('DV-10：草图作为版本——versions.sketch 为真、没有轮次、带「交给 AI」的指令；草图不是轮次，不能记录评审意见', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { render: () => null } }] })
    await router.push('/')
    const files = sampleFiles()
    const desk = createDeskState(
      async () => ({
        dir: 'model/test/designs/d',
        files,
        designs: [{ id: 'd', name: 'D', status: 'reviewing', revisions: [{ id: 'r1' }], sketch: true, problems: [] }],
        version: { design: 'd', revision: 'sketch' },
        compare: { current: { label: '当前版本', dir: 'model/test', files } },
        sketchPrompt: '# 按草图扩展：设计「d」',
      }),
      { project: 'test', version: { design: 'd', revision: 'sketch' } },
    )
    desk.attachRouter(router)
    await desk.init()
    expect(desk.versions.sketch).toBe(true)
    expect(desk.versions.design.value?.id).toBe('d')
    expect(desk.versions.revision.value).toBeNull()
    expect(desk.versions.sketchPrompt.value).toBe('# 按草图扩展：设计「d」')
    expect(desk.versions.baseline.value?.label).toBe('当前版本')
    expect(desk.versions.diff.value?.counts).toEqual({ added: 0, changed: 0, removed: 0, merged: 0, split: 0, renamed: 0, moved: 0 })
    expect(desk.write.canFeedback).toBe(false)
  })

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
    // 浏览器后退经 popstate 异步回到上一条历史：等到层次变化为止
    await vi.waitFor(() => expect(desk.levelId.value).toBe('infra'), { timeout: 5_000, interval: 10 })
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
      f.path === 'modules/infra.yaml' ? { ...f, text: f.text.replace(/ {4}- id: infra\.framework\n[\s\S]*?(?= {4}- id: infra\.mus)/, '') } : f,
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
    desk.toggles.relationTypes = ['streams']
    expect(desk.view.value!.edges.map(e => e.type)).toEqual(['streams'])
  })

  it('视图变化后异步产出布局结果', async () => {
    const { desk } = await setup('/?level=infra')
    // 布局在 elkjs 中异步完成，耗时随机器负载变化：等到结果出现为止，不靠固定计时
    await vi.waitFor(() => expect(desk.positioned.value?.view.parentId).toBe('infra'), { timeout: 10_000, interval: 20 })
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

  async function open(initialUrl: string, baseline?: { label: string; dir: string; files: ReturnType<typeof withSource> }) {
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
          ...(baseline ? { baseline } : {}),
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
    expect(desk.versions.design.value?.name).toBe('下一期')
    expect(desk.versions.revision.value?.id).toBe('r2')
    expect(desk.versions.baseline.value?.label).toBe('当前版本')
    expect(desk.versions.diff.value?.module.get('infra.new')?.kind).toBe('added')
    expect(desk.versions.diff.value?.touched.get('infra')).toBe(1)
    desk.toggles.compareTo = 'previous'
    expect(desk.versions.baseline.value?.label).toBe('下一期 · r1')
    expect(desk.versions.diff.value?.changes).toEqual([])
  })

  it('E4、T2b 裁决 1：轮次载荷带基线时比两版描述的 source.commit——不一致提示漂移，一致不提示；没带基线时不判断（base.commit 是仓库提交，不和 source.commit 比）', async () => {
    expect((await open('/p/demo/d/next/r2', { label: '基线 old', dir: 'b', files: withSource('gen-old') })).desk.versions.drift.value).toBe(true)
    expect((await open('/p/demo/d/next/r2', { label: '基线 old', dir: 'b', files: withSource('new') })).desk.versions.drift.value).toBe(false)
    expect((await open('/p/demo/d/next/r2')).desk.versions.drift.value).toBe(false)
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

describe('DeskState · 提交版本（E5、E6）', () => {
  const commits = [
    { hash: 'b2'.repeat(20), short: 'b2b2b2b', date: '2026-10-22', subject: '加模块' },
    { hash: 'a1'.repeat(20), short: 'a1a1a1a', date: '2026-10-21', subject: '第一版' },
  ]
  const newer = sampleFiles({ 'extra.yaml': 'modules: [{ id: infra.new, name: New, parent: infra }]' })

  async function open(url: string, version: { commit: string; base?: string }) {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/p/:project', component: { render: () => null } },
        { path: '/p/:project/c/:commit/:base?', component: { render: () => null } },
      ],
    })
    await router.push(url)
    const desk = createDeskState(
      async () => ({
        project: 'demo',
        dir: 'model/demo@b2b2b2b',
        files: newer,
        commits,
        version: { commit: version.commit, base: version.base ?? commits[1].hash },
        compare: { current: { label: '提交 a1a1a1a', dir: 'model/demo@a1a1a1a', files: sampleFiles() } },
      }),
      { project: 'demo', version },
    )
    desk.attachRouter(router)
    await desk.init()
    return { desk, router }
  }

  it('打开的提交按短哈希前缀对上提交列表；相对基线提交算出差异；没有代码事实', async () => {
    const { desk } = await open('/p/demo/c/b2b2', { commit: 'b2b2' })
    expect(desk.versions.commit.value?.subject).toBe('加模块')
    expect(desk.versions.design.value).toBeNull()
    expect(desk.versions.baseline.value?.label).toBe('提交 a1a1a1a')
    expect(desk.versions.diff.value?.module.get('infra.new')?.kind).toBe('added')
    expect(desk.facts.status.value).toBe('design')
  })

  it('指定基线时给出基线提交；只响应同一提交与基线的路由', async () => {
    const { desk, router } = await open(`/p/demo/c/b2b2/${commits[1].hash}?level=infra`, { commit: 'b2b2', base: commits[1].hash })
    expect(desk.versions.baseCommit.value?.short).toBe('a1a1a1a')
    expect(desk.levelId.value).toBe('infra')
    await router.push('/p/demo/c/b2b2/worktree?level=app')
    await new Promise(r => setTimeout(r, 0))
    expect(desk.levelId.value).toBe('infra')
  })
})

describe('DeskState · 写入人拥有的文件（B1–B4）', () => {
  it('当前版本可加例外与忽略项、不能记评审意见；设计版本只能记评审意见；都交给注入的写入来源', async () => {
    const calls: string[] = []
    const writer = {
      ...NO_WRITER,
      feedback: async (b: { design: string; revision: string; text: string }) => (
        calls.push(`f:${b.design}/${b.revision}:${b.text}`),
        { ok: true as const, file: 'd.yaml' }
      ),
      allow: async (b: { from: string; to: string; reason: string }) => (
        calls.push(`a:${b.from}->${b.to}:${b.reason}`),
        { ok: true as const, file: 'rules.yaml' }
      ),
      ignore: async (b: { pattern: string }) => (calls.push(`i:${b.pattern}`), { ok: true as const, file: 'source-ignore.yaml' }),
      reviewed: async () => ({ ok: true as const, file: 'reviewed.yaml' }),
      accept: async (b: { design: string; deviation: string; reason: string }) => (
        calls.push(`c:${b.design}:${b.deviation}:${b.reason}`),
        { ok: true as const, file: 'design.yaml' }
      ),
      archive: async (b: { design: string }) => (calls.push(`z:${b.design}`), { ok: true as const, file: 'design.yaml' }),
    }
    const cur = createDeskState(async () => ({ dir: 'x', files: sampleFiles() }), { writer })
    expect([cur.write.canEditRules, cur.write.canFeedback]).toEqual([true, false])
    expect(await cur.write.feedback('x')).toMatchObject({ ok: false })
    await cur.write.allow({ from: 'app', to: 'infra', reason: '过渡期' })
    await cur.write.ignore('docs/*')
    const design = createDeskState(async () => ({ dir: 'x', files: sampleFiles() }), { writer, version: { design: 'next', revision: 'r2' } })
    expect([design.write.canEditRules, design.write.canFeedback]).toEqual([false, true])
    expect(await design.write.ignore('a')).toMatchObject({ ok: false })
    await design.write.feedback('同意')
    // X3、X4：认可偏差与归档只对设计版本打开的那个设计
    expect(await cur.write.accept('missing-relation:r', 'x')).toMatchObject({ ok: false })
    expect(await cur.write.archive()).toMatchObject({ ok: false })
    await design.write.accept('missing-relation:r', '经注入')
    await design.write.archive()
    expect(calls.slice(-2)).toEqual(['c:next:missing-relation:r:经注入', 'z:next'])
    expect(calls).toEqual(['a:app->infra:过渡期', 'i:docs/*', 'f:next/r2:同意', 'c:next:missing-relation:r:经注入', 'z:next'])
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
    desk.setToggles({ relationTypes: ['streams'], showBoundaries: false })
    expect(desk.view.value!.nodes.some(n => n.role === 'boundary')).toBe(false)
    desk.openScenario('sc.play')
    await settle()
    expect(desk.playing.value).toBe(true)
    expect(desk.viewpoint.value).toBe('interaction')
    expect(desk.levelId.value).toBe('infra')
    expect(router.currentRoute.value.query).toMatchObject({ level: 'infra', sc: 'sc.play' })
    expect(desk.view.value!.nodes.some(n => n.id === 'boundary:app')).toBe(true)
    expect(desk.run.scenarioView.value!.messages.length).toBeGreaterThan(0)
    expect(desk.run.sequence.value!.participants[0].kind).toBe('actor')
    expect(desk.run.home.value).toBe('sys')
    expect(desk.run.frame.value).toBeNull()
    desk.next()
    await settle()
    expect(desk.run.frame.value?.id).toBe('sc.play#start')
    expect(router.currentRoute.value.query.step).toBe('sc.play#start')
  })

  it('复制地址到新页面：回到同一场景、同一步骤、同一分支选择', async () => {
    const { desk } = await openDesk('/?level=infra&sc=sc.play&step=sc.play%23update&alt=0')
    expect(desk.playback.value).toMatchObject({ scenarioId: 'sc.play', frameId: 'sc.play#update' })
    expect(desk.playback.value!.choices.get('sc.play#3')).toBe(0)
    expect(desk.run.currentIndex.value).not.toBeNull()
  })

  it('选中对象时派生其在本场景中的参与；退出场景回到结构视角，层次与选中保留', async () => {
    const { desk, router, settle } = await openDesk('/?level=infra&sc=sc.play&step=sc.play%23done&alt=1')
    desk.select({ kind: 'module', id: 'infra.framework' })
    expect(desk.selected.value).toEqual({ kind: 'module', id: 'infra.framework' })
    expect(desk.run.participation.value!.frames.length).toBeGreaterThan(0)
    desk.closeScenario()
    await settle()
    expect(desk.viewpoint.value).toBe('interaction')
    expect(desk.selection.value).toEqual({ kind: 'module', id: 'infra.framework' })
    expect(router.currentRoute.value.query.sc).toBeUndefined()
  })

  it('导航树的派生：步骤大纲（T6）与参与模块（T5）随场景出现，退出后清空', async () => {
    const { desk } = await openDesk('/?sc=sc.play')
    expect(desk.run.outline.value.some(n => n.kind === 'group' && n.tag.kind === 'ref')).toBe(true)
    expect(desk.run.participants.value.has('infra')).toBe(true)
    expect(desk.run.participants.value.has('infra.framework.sm')).toBe(true)
    desk.closeScenario()
    expect(desk.run.outline.value).toEqual([])
    expect(desk.run.participants.value.size).toBe(0)
  })
})

describe('ADR-0009：悬停与选中不引起重新投影', () => {
  it('悬停、选中、单步后层次视图与时序模型是同一个对象；切换开关才重算', async () => {
    const { desk } = await setup('/', scenarioFiles())
    desk.openScenario('sc.play')
    desk.next()
    const view = desk.view.value
    const seq = desk.run.sequence.value
    desk.setHover('infra')
    desk.select({ kind: 'module', id: 'infra' })
    expect(desk.view.value).toBe(view)
    expect(desk.run.sequence.value).toBe(seq)
    desk.setToggles({ showDiff: true })
    expect(desk.view.value).not.toBe(view)
  })
})
