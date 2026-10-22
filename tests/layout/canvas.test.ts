/** 画布场景 canvasScene（ADR-0013）：聚焦变淡（结构视角）、舞台显隐（V5、V8）、选中突出的灰化（R15、R16）、文件高亮（G14）、设计版本标记 */
import { describe, expect, it } from 'vitest'
import { diffModels, loadModel, planScenario, projectLevel, projectScenario, stageEnds } from '../../src/model'
import { layoutView } from '../../src/layout/layout'
import { stageOverlay } from '../../src/layout/stage'
import { canvasScene, type CanvasInput } from '../../src/layout/canvas'
import { scenarioFiles } from '../fixtures/sample'

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
    expect(edge(canvasScene(input), 'infra.mus->boundary:domain:depends')).toBeUndefined()
    expect(edge(canvasScene({ ...input, hover: 'infra.mus' }), 'infra.mus->boundary:domain:depends')).toBeDefined()
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
        'upper.yaml': 'relations: [{ id: r9, from: app.solution, to: infra.framework, type: dataflow }]',
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
    expect(upper.data.edge).toMatchObject({ type: 'dataflow', relationIds: ['r9'] })
    expect(upper.data).toMatchObject({ arrow: 'closed', weight: 1, compile: false, factState: 'confirmed' })
    expect(edge(s, 'unmodeled:infra.framework.pipeline|boundary:app')!.data).toMatchObject({ temp: 'unmodeled', label: '未建模', play: 'current' })
    expect(edge(canvasScene({ ...input, selection: { kind: 'relation', id: 'r9' } }), upper.id)!.data.selected).toBe(true)
  })

  it('L10、K9：线型只表事实状态、箭头表同步 / 异步 / 实现、线宽档按条数、编译期降权；只标异常；选中不改线宽', async () => {
    const input = await structure('infra')
    const plain = canvasScene(input)
    const calls = edge(plain, 'infra.player->infra.framework:calls')!.data
    expect(calls).toMatchObject({ label: '', factState: 'confirmed', arrow: 'closed', weight: 1, compile: false })
    expect(edge(plain, 'infra.player->infra.framework:event')!.data.arrow).toBe('open')
    expect(edge(canvasScene({ ...input, hover: 'infra.player' }), 'infra.player->boundary:app:depends')!.data.compile).toBe(true)
    const selected = edge(
      canvasScene({ ...input, selection: { kind: 'edge', id: 'infra.player->infra.framework:calls' } }),
      'infra.player->infra.framework:calls',
    )!.data
    expect(selected).toMatchObject({ selected: true, weight: 1 })
    // 代码事实：已证实不标；未证实为虚线 + ?；叠加线为点线
    const facts = {
      edgeFacts: new Map([
        ['infra.player->infra.framework:calls', 'confirmed' as const],
        ['infra.player->infra.framework:event', 'partial' as const],
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
    expect(edge(s, 'infra.player->infra.framework:event')!.data).toMatchObject({ label: '?', warn: true, factState: 'unconfirmed' })
    expect(edge(s, 'dep:infra.mus->infra.player')!.data).toMatchObject({ temp: 'code', label: '未描述 2', factState: 'undescribed' })
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
})
