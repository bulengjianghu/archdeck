/** 画布场景 canvasScene（ADR-0013）：聚焦变淡（结构视角）、舞台显隐（V5、V8）、选中突出的灰化（R15、R16）、文件高亮（G14）、设计版本标记 */
import { describe, expect, it } from 'vitest'
import { callbackPairs, callbackText, diffModels, loadModel, planScenario, projectLevel, projectScenario, stageEnds } from '../../src/model'
import { layoutView } from '../../src/layout/layout'
import { stageOverlay } from '../../src/layout/stage'
import { EDGE_HOVER_Z, EDGE_Z, canvasScene, routeMidpoint, withEdgeHover, type CanvasInput } from '../../src/layout/canvas'
import { sampleFiles, scenarioFiles } from '../fixtures/sample'

const { index } = loadModel(scenarioFiles())

async function structure(level: string): Promise<CanvasInput> {
  const view = projectLevel(index, level, { showBoundaries: true })
  return {
    positioned: await layoutView(view),
    index,
    selection: null,
    hover: null,
    stage: null,
    scenarioView: null,
    emphasis: null,
    participants: new Map(),
    mode: 'hide',
    reveal: [],
    diff: null,
    fileHits: null,
    branchPointId: null,
  }
}

/** 运行视角：infra 层，走到 sc.play#done（第 6 条可见消息） */
async function run(): Promise<CanvasInput> {
  const plan = planScenario(index, 'sc.play')
  const choices = new Map([['sc.play#3', 0]])
  const view = projectLevel(index, 'infra', { showBoundaries: true, scenarioEnds: stageEnds(plan) })
  const sv = projectScenario(index, view, plan, choices)
  const positioned = await layoutView(view)
  const participants = new Map([...stageOverlay(sv, positioned, 'sc.play#done').active].map(id => [id, 'path' as const]))
  return { ...(await structure('infra')), positioned, scenarioView: sv, stage: stageOverlay(sv, positioned, 'sc.play#done'), participants }
}

const node = (s: ReturnType<typeof canvasScene>, id: string) => s.nodes.find(n => n.id === id)
const edge = (s: ReturnType<typeof canvasScene>, id: string) => s.edges.find(e => e.id === id)

describe('canvasScene', () => {
  it('结构视角：选中的节点标为选中；悬停的节点与相邻节点照常，其余变淡；边界边只在聚焦其一端时出现', async () => {
    const input = await structure('infra')
    const s = canvasScene({ ...input, selection: { kind: 'module', id: 'infra.mus' } })
    expect(node(s, 'infra.mus')!.data.selected).toBe(true)
    expect(node(s, 'infra.player')!.data.selected).toBe(false)
    const hover = canvasScene({ ...input, hover: 'infra.player' })
    expect(node(hover, 'infra.player')!.data.dim).toBe(false)
    expect(node(hover, 'infra.framework')!.data.dim).toBe(false)
    expect(node(hover, 'infra.mus')!.data.dim).toBe(true)
    expect(edge(canvasScene(input), 'infra.mus->boundary:domain:queries')).toBeUndefined()
    expect(edge(canvasScene({ ...input, hover: 'infra.mus' }), 'infra.mus->boundary:domain:queries')).toBeDefined()
    expect(s.visibleIds).toBeNull()
  })

  it('分层总览：带不参与变淡；核心跨层边只在聚焦核心模块时出现', async () => {
    const input = await structure('sys')
    expect(input.positioned!.view.mode).toBe('layered')
    const core = input.positioned!.view.nodes.find(n => n.role === 'core')!
    const quiet = canvasScene(input)
    expect(quiet.edges.some(e => e.data.core)).toBe(false)
    const focused = canvasScene({ ...input, hover: core.id })
    expect(focused.nodes.filter(n => n.type === 'band').every(n => !n.data.dim)).toBe(true)
    const coreEdges = input.positioned!.view.coreEdges!.filter(e => e.from === core.id || e.to === core.id)
    expect(focused.edges.filter(e => e.data.core)).toHaveLength(coreEdges.length)
  })

  it('V5、V8：运行视角「隐藏」时不参与的节点不画，适应画布只取可见节点；「全显」时都画', async () => {
    const input = await run()
    const hidden = canvasScene(input)
    expect(hidden.visibleIds).not.toBeNull()
    for (const n of hidden.nodes.filter(n => n.type === 'module' || n.type === 'boundary' || n.type === 'actor'))
      expect(hidden.visibleIds!.has(n.id)).toBe(true)
    const all = canvasScene({ ...input, mode: 'show' })
    expect(all.visibleIds).toBeNull()
    expect(all.nodes.length).toBeGreaterThanOrEqual(hidden.nodes.length)
    // 走过的边由步骤序号标注，当前消息的边带方向
    expect(edge(hidden, 'actor.biz->infra.player:calls')!.data.play).toBe('walked')
    expect(hidden.nodes.some(n => n.type === 'step')).toBe(true)
  })

  it('R15、R16：只在选中步骤时把其余走过的边与步骤序号变灰；选中其他对象时不变灰', async () => {
    const input = await run()
    const current = input.stage!.current!.index
    const step = canvasScene({ ...input, emphasis: { selected: current, paired: new Set() } })
    expect(edge(step, 'actor.biz->infra.player:calls')!.data.muted).toBe(true)
    expect(
      step.nodes
        .filter(n => n.type === 'step')
        .flatMap(n => n.data.steps!)
        .some(x => x.muted),
    ).toBe(true)
    const other = canvasScene({ ...input, emphasis: { selected: null, paired: new Set() } })
    expect(other.edges.some(e => e.data.muted)).toBe(false)
    expect(
      other.nodes
        .filter(n => n.type === 'step')
        .flatMap(n => n.data.steps!)
        .some(x => x.muted),
    ).toBe(false)
    // 配对消息所在的边也不变灰
    const walked = [...input.stage!.walked.values()].find(m => m.edgeId === 'actor.biz->infra.player:calls')!
    const paired = canvasScene({ ...input, emphasis: { selected: current, paired: new Set([walked.steps[0] - 1]) } })
    expect(edge(paired, 'actor.biz->infra.player:calls')!.data.muted).toBe(false)
  })

  it('P11、P15：经由上层关系的临时线取关系的类型、标「经由上层」，随关系选中；未建模的临时线标「未建模」', async () => {
    const { index: idx } = loadModel(
      scenarioFiles({
        'upper.yaml': 'relations: [{ id: r9, from: app.solution, to: infra.framework, type: streams }]',
        'scenarios/x.yaml':
          'scenario: { id: sc.v, name: V, steps: [{ call: { id: a, from: app.solution, to: infra.framework.pipeline } }, { call: { id: c, from: infra.framework.pipeline, to: app.fragments } }] }',
      }),
    )
    const plan = planScenario(idx, 'sc.v')
    const view = projectLevel(idx, 'infra.framework', { showBoundaries: true, scenarioEnds: stageEnds(plan) })
    const sv = projectScenario(idx, view, plan, new Map())
    const positioned = await layoutView(view)
    const stage = stageOverlay(sv, positioned, 'sc.v#c')
    const input: CanvasInput = { ...(await structure('infra')), index: idx, positioned, scenarioView: sv, stage }
    const s = canvasScene(input)
    const upper = edge(s, 'upper:boundary:app|infra.framework.pipeline')!
    expect(upper.data).toMatchObject({ temp: 'upper', label: '经由上层', play: 'walked', selected: false })
    expect(upper.data.edge).toMatchObject({ type: 'streams', relationIds: ['r9'] })
    expect(upper.data).toMatchObject({ arrow: 'closed', weight: 1, factState: 'confirmed' })
    expect(upper.data.port).toBeUndefined()
    expect(edge(s, 'unmodeled:infra.framework.pipeline|boundary:app')!.data).toMatchObject({ temp: 'unmodeled', label: '未建模', play: 'current' })
    expect(edge(canvasScene({ ...input, selection: { kind: 'relation', id: 'r9' } }), upper.id)!.data.selected).toBe(true)
  })

  it('L10、K9：线型只表事实状态、箭头表同步 / 异步、线宽档按条数；只标异常；选中不改线宽', async () => {
    const input = await structure('infra')
    const plain = canvasScene(input)
    const calls = edge(plain, 'infra.player->infra.framework:calls')!.data
    expect(calls).toMatchObject({ label: '', factState: 'confirmed', arrow: 'closed', weight: 1 })
    expect(edge(plain, 'infra.framework->infra.player:notifies')!.data.arrow).toBe('open')
    // ADR-0029 起关系全是交互：没有编译期降权，也没有 implements 的空心三角
    expect(plain.edges.every(e => e.data.arrow === 'closed' || e.data.arrow === 'open')).toBe(true)
    const selected = edge(
      canvasScene({ ...input, selection: { kind: 'edge', id: 'infra.player->infra.framework:calls' } }),
      'infra.player->infra.framework:calls',
    )!.data
    expect(selected).toMatchObject({ selected: true, weight: 1 })
    // 代码事实：已证实不标；未证实为虚线 + ?；叠加线为点线
    const facts = {
      edgeFacts: new Map([
        ['infra.player->infra.framework:calls', 'confirmed' as const],
        ['infra.framework->infra.player:notifies', 'partial' as const],
      ]),
      violatedEdges: new Set<string>(),
      overlays: [
        {
          id: 'dep:infra.mus->infra.player',
          from: 'infra.mus',
          to: 'infra.player',
          fromModule: 'infra.mus',
          toModule: 'infra.player',
          undescribed: 2,
          violations: 0,
        },
      ],
      cycles: new Map(),
      levelCycles: [],
    }
    const s = canvasScene({ ...input, facts })
    expect(edge(s, 'infra.player->infra.framework:calls')!.data).toMatchObject({ label: '', factState: 'confirmed' })
    expect(edge(s, 'infra.framework->infra.player:notifies')!.data).toMatchObject({ label: '?', warn: true, factState: 'unconfirmed' })
    expect(edge(s, 'dep:infra.mus->infra.player')!.data).toMatchObject({ temp: 'code', label: '未解释 2', factState: 'undescribed' })
  })

  it('L10：含多条关系的边标 ×N 并画成 pill，异常标记跟在后面；运行视角走过的边不标条数', async () => {
    const { index: idx } = loadModel(scenarioFiles({ 'z.yaml': 'relations: [{ id: x1, from: infra.player, to: infra.framework.pipeline, type: calls }]' }))
    const view = projectLevel(idx, 'infra', { showBoundaries: true })
    const input = { ...(await structure('infra')), index: idx, positioned: await layoutView(view) }
    const id = 'infra.player->infra.framework:calls'
    expect(edge(canvasScene(input), id)!.data).toMatchObject({ label: '×2', pill: true, weight: 2 })
    const facts = { edgeFacts: new Map([[id, 'partial' as const]]), violatedEdges: new Set<string>(), overlays: [], cycles: new Map(), levelCycles: [] }
    expect(edge(canvasScene({ ...input, facts }), id)!.data).toMatchObject({ label: '×2 ?', pill: true, warn: true })
  })

  it('标签没有坐标（elk 没给）而要标 ? 或 ×N 时，落在走线中点，不退到画布原点', async () => {
    const input = await structure('infra')
    const pv = input.positioned!
    const [id, route] = [...pv.edges].find(([, r]) => r.points.length >= 2)!
    const edges = new Map(pv.edges)
    edges.set(id, { points: route.points })
    const facts = { edgeFacts: new Map([[id, 'unconfirmed' as const]]), violatedEdges: new Set<string>(), overlays: [], cycles: new Map(), levelCycles: [] }
    const e = edge(canvasScene({ ...input, positioned: { ...pv, edges }, facts }), id)!
    expect(e.data.label).toContain('?')
    expect(e.data.route.label).toEqual(routeMidpoint({ points: route.points }))
    expect(e.data.route.label).not.toEqual({ x: 0, y: 0 })
  })

  it('激活的边浮在节点之上（高于 Vue Flow 选中节点的 1000）：与悬停节点相邻的边；其余边在模块节点之下', async () => {
    const input = await structure('infra')
    const e0 = [...input.positioned!.view.edges].find(e => !e.from.startsWith('boundary:') && !e.to.startsWith('boundary:'))!
    const s = canvasScene({ ...input, hover: e0.from })
    const mod = node(s, e0.from)!
    for (const e of s.edges) {
      const adj = e.source === e0.from || e.target === e0.from
      expect(e.zIndex).toBe(adj ? EDGE_Z.active : EDGE_Z.idle)
    }
    expect(EDGE_Z.active).toBeGreaterThan(1000)
    expect(EDGE_Z.idle).toBeLessThan(mod.zIndex)
    // 回放当前步骤的边再高一档，步骤徽标仍在它之上
    const r = canvasScene(await run())
    const cur = r.edges.find(e => e.data.play === 'current')!
    expect(cur.zIndex).toBe(EDGE_Z.current)
    expect(r.nodes.filter(n => n.type === 'step').every(n => n.zIndex > EDGE_Z.current)).toBe(true)
  })

  it('L11：画出来的折线关系边之间的交叉标跳点；隐藏的边界边不参与', async () => {
    const input = await structure('infra')
    const s = canvasScene(input)
    const shown = new Set(s.edges.map(e => e.id))
    for (const e of s.edges) for (const j of e.data.jumps ?? []) expect(e.data.route.points.some(p => p.y === j.y)).toBe(true)
    const hiddenBoundary = input.positioned!.view.edges.filter(e => e.to.startsWith('boundary:') && !shown.has(e.id))
    expect(hiddenBoundary.length).toBeGreaterThan(0)
  })

  it('A7、L4：框表示边界——下钻后外框为系统、内框为当前父模块，边界节点在两框之间；根层只有系统框', async () => {
    const input = await structure('infra')
    const s = canvasScene(input)
    const frames = s.nodes.filter(n => n.type === 'frame')
    expect(frames.map(f => [f.id, f.data.name])).toEqual([
      ['frame', index.model.system.name],
      ['frame:parent', index.modules.get('infra')!.name],
    ])
    const root = canvasScene({ ...input, positioned: await layoutView(projectLevel(index, index.rootId)) })
    expect(root.nodes.filter(n => n.type === 'frame').map(f => f.data.name)).toEqual([index.model.system.name])
  })

  it('routeMidpoint：折线按长度取一半处，曲线取两端点中点', () => {
    const poly = [
      { x: 0, y: 0 },
      { x: 0, y: 10 },
      { x: 30, y: 10 },
    ]
    expect(routeMidpoint({ points: poly })).toEqual({ x: 10, y: 10 })
    expect(routeMidpoint({ points: [poly[0], poly[2]], curve: true })).toEqual({ x: 15, y: 5 })
  })

  it('G14：选中文件的投影节点加文件高亮；设计版本标出新增的模块', async () => {
    const input = await structure('infra')
    expect(node(canvasScene({ ...input, fileHits: new Set(['infra.mus']) }), 'infra.mus')!.class).toContain('file-hit')
    const base = loadModel(scenarioFiles()).index
    const extra = { path: 'modules/extra.yaml', text: 'modules:\n  - { id: infra.extra, name: Extra, parent: infra, responsibility: x }\n' }
    const changed = loadModel([...scenarioFiles(), extra]).index
    const view = projectLevel(changed, 'infra', { showBoundaries: true })
    const s = canvasScene({ ...input, index: changed, positioned: await layoutView(view), diff: diffModels(base, changed) })
    expect(node(s, 'infra.extra')!.data.change).toBe('added')
    expect(node(s, 'infra.mus')!.data.change).toBeUndefined()
  })

  it('L12：经端口（via: port:<P>）的关系所在的视图边带插座；聚合边里有一条经端口即画；其余机制不画', async () => {
    const { index: idx } = loadModel(
      sampleFiles({
        'z.yaml':
          "relations:\n  - { id: rp, from: infra.player, to: infra.framework, type: commands, via: 'port:if.sm' }\n  - { id: rq, from: infra.player, to: infra.framework, type: commands }\n  - { id: rc, from: infra.mus, to: infra.framework, type: commands, via: 'channel:http' }\n",
      }),
    )
    const view = projectLevel(idx, 'infra', { showBoundaries: true })
    const s = canvasScene({ ...(await structure('infra')), index: idx, positioned: await layoutView(view) })
    const agg = edge(s, 'infra.player->infra.framework:commands')!
    expect(agg.data.edge.relationIds.sort()).toEqual(['rp', 'rq'])
    expect(agg.data.port).toBe(true)
    // 插座不改色相与线型（一个通道一个维度）
    expect(agg.data.edge.type).toBe('commands')
    expect(edge(s, 'infra.mus->infra.framework:commands')!.data.port).toBeUndefined()
  })

  it('L24：经回调（via: channel:callback，含 @ 与旧别名）的视图边带回程钩，悬停写明谁把执行器交给谁、契约在哪；聚合边逐条列出；其余通道不画', async () => {
    const { index: idx } = loadModel(
      sampleFiles({
        'z.yaml':
          "relations:\n  - { id: rcb, from: infra.player, to: infra.framework, type: commands, via: 'channel:callback@infra.player' }\n  - { id: rq, from: infra.player, to: infra.framework, type: commands }\n  - { id: rold, from: infra.framework, to: infra.player, type: commands, via: callback }\n  - { id: rc, from: infra.mus, to: infra.framework, type: commands, via: 'channel:http' }\n",
      }),
    )
    const view = projectLevel(idx, 'infra', { showBoundaries: true })
    const s = canvasScene({ ...(await structure('infra')), index: idx, positioned: await layoutView(view) })
    const agg = edge(s, 'infra.player->infra.framework:commands')!
    expect(agg.data.callback).toBe(true)
    // 第十一轮：标签位写字——聚合边部分经回调为「×N · 回调 M」
    expect(agg.data.label).toBe('×2 · 回调 1')
    // 回程钩不改色相、线型与箭头（一个通道一个维度）
    expect(agg.data.edge.type).toBe('commands')
    expect(agg.data.arrow).toBe('closed')
    expect(agg.data.title).toContain('rcb：经回调：')
    expect(agg.data.title).toContain('契约在')
    expect(agg.data.title).not.toContain('rq：')
    // M20 旧别名 callback 读作 channel:callback，契约未指明
    const old = edge(s, 'infra.framework->infra.player:commands')!
    expect(old.data.callback).toBe(true)
    expect(old.data.title).toContain('契约未指明')
    // 单条为「回调」；配对的正向关系 rcb（方向相反、写了接口的才算，这里 rcb 没写接口 → 无配对）
    expect(old.data.label).toBe('回调')
    expect(old.data.callbackPairs).toBeUndefined()
    expect(edge(s, 'infra.mus->infra.framework:commands')!.data.callback).toBeUndefined()
  })
})

describe('L25 悬停边看两端', () => {
  it('悬停的边加 hovered、提到最上层且不变淡，两端节点加 edge-end；其余节点与边原样（同一对象）；没有悬停或边已不在时不变', async () => {
    const s = canvasScene({ ...(await structure('infra')) })
    const target = s.edges[0]
    const other = s.edges.find(e => e.source !== target.source && e.target !== target.target && e.source !== target.target && e.target !== target.source)
    const h = withEdgeHover(
      s.nodes,
      s.edges.map(e => (e === target ? { ...e, data: { ...e.data, dim: true } } : e)),
      target.id,
    )
    const hit = h.edges.find(e => e.id === target.id)!
    expect(hit.data.hovered).toBe(true)
    expect(hit.data.dim).toBe(false)
    expect(hit.zIndex).toBe(EDGE_HOVER_Z)
    expect(EDGE_HOVER_Z).toBeGreaterThan(EDGE_Z.current)
    const ends = h.nodes
      .filter(n => n.class?.split(' ').includes('edge-end'))
      .map(n => n.id)
      .sort()
    expect(ends).toEqual([target.source, target.target].sort())
    if (other) expect(h.edges.find(e => e.id === other.id)).toBe(other)
    // 选中不变：只加悬停标记，selected 原样
    expect(hit.data.selected).toBe(target.data.selected)
    expect(withEdgeHover(s.nodes, s.edges, null).edges).toEqual(s.edges)
    expect(withEdgeHover(s.nodes, s.edges, 'nope').nodes.every(n => !n.class?.includes('edge-end'))).toBe(true)
  })
})

describe('L24 配对高亮（第十一轮）', () => {
  it('回调关系的配对正向关系 = 方向相反、端点相同、写了接口；悬停回调边时配对边减一档（hoverPair）高亮，说明接「随 <接口> 交来」', async () => {
    const { index: idx } = loadModel(
      sampleFiles({
        'z.yaml':
          "relations:\n  - { id: rfw, from: infra.player, to: infra.framework, type: commands, interface: if.sm }\n  - { id: rback, from: infra.framework, to: infra.player, type: commands, via: 'channel:callback@infra.framework' }\n",
      }),
    )
    expect(callbackPairs(idx, 'rback')).toEqual(['rfw'])
    expect(callbackText(idx, 'rback')).toContain('随 sendCommand 交来')
    const view = projectLevel(idx, 'infra', { showBoundaries: true })
    const s = canvasScene({ ...(await structure('infra')), index: idx, positioned: await layoutView(view) })
    const back = s.edges.find(e => e.id === 'infra.framework->infra.player:commands')!
    expect(back.data.callbackPairs).toEqual(['rfw'])
    const h = withEdgeHover(s.nodes, s.edges, back.id)
    const fw = h.edges.find(e => e.data.edge.relationIds.includes('rfw'))!
    expect(fw.data.hoverPair).toBe(true)
    expect(fw.data.hovered).toBeUndefined()
    expect(fw.zIndex).toBe(EDGE_HOVER_Z - 1)
    // 端点不是正好相反的边（如层间聚合边）即使含配对关系也不亮
    const fake = { ...s.edges.find(e => e.id === fw.id)!, id: 'band', source: 'x', target: 'y' }
    expect(withEdgeHover(s.nodes, [...s.edges, fake], back.id).edges.find(e => e.id === 'band')!.data.hoverPair).toBeUndefined()
    // 悬停正向边不反过来高亮回调边
    expect(withEdgeHover(s.nodes, s.edges, fw.id).edges.some(e => e.data.hoverPair)).toBe(false)
  })
})
