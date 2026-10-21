/** 画布场景 canvasScene（ADR-0013）：聚焦变淡（结构视角）、舞台显隐（V5、V8）、选中突出的灰化（R15、R16）、文件高亮（G14）、设计版本标记 */
import { describe, expect, it } from 'vitest'
import { diffModels, loadModel, planScenario, projectLevel, projectScenario, stageEnds } from '../../src/model'
import { layoutView } from '../../src/layout/layout'
import { stageOverlay } from '../../src/layout/stage'
import { canvasScene, type CanvasInput } from '../../src/layout/canvas'
import { scenarioFiles } from '../fixtures/sample'

const { index } = loadModel(scenarioFiles())

async function structure(level: string): Promise<CanvasInput> {
  const view = projectLevel(index, level, { showBoundaries: true, mergeTypes: true })
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
  const view = projectLevel(index, 'infra', { showBoundaries: true, mergeTypes: true, scenarioEnds: stageEnds(plan) })
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
    expect(edge(canvasScene(input), 'infra.mus->boundary:domain')).toBeUndefined()
    expect(edge(canvasScene({ ...input, hover: 'infra.mus' }), 'infra.mus->boundary:domain')).toBeDefined()
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
    expect(edge(hidden, 'actor.biz->infra.player')!.data.play).toBe('walked')
    expect(hidden.nodes.some(n => n.type === 'step')).toBe(true)
  })

  it('R15、R16：只在选中步骤时把其余走过的边与步骤序号变灰；选中其他对象时不变灰', async () => {
    const input = await run()
    const current = input.stage!.current!.index
    const step = canvasScene({ ...input, emphasis: { selected: current, paired: new Set() } })
    expect(edge(step, 'actor.biz->infra.player')!.data.muted).toBe(true)
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
    const walked = [...input.stage!.walked.values()].find(m => m.edgeId === 'actor.biz->infra.player')!
    const paired = canvasScene({ ...input, emphasis: { selected: current, paired: new Set([walked.steps[0] - 1]) } })
    expect(edge(paired, 'actor.biz->infra.player')!.data.muted).toBe(false)
  })

  it('G14：选中文件的投影节点加文件高亮；设计版本标出新增的模块', async () => {
    const input = await structure('infra')
    expect(node(canvasScene({ ...input, fileHits: new Set(['infra.mus']) }), 'infra.mus')!.class).toContain('file-hit')
    const base = loadModel(scenarioFiles()).index
    const extra = { path: 'modules/extra.yaml', text: 'modules:\n  - { id: infra.extra, name: Extra, parent: infra, responsibility: x }\n' }
    const changed = loadModel([...scenarioFiles(), extra]).index
    const view = projectLevel(changed, 'infra', { showBoundaries: true, mergeTypes: true })
    const s = canvasScene({ ...input, index: changed, positioned: await layoutView(view), diff: diffModels(base, changed) })
    expect(node(s, 'infra.extra')!.data.change).toBe('added')
    expect(node(s, 'infra.mus')!.data.change).toBeUndefined()
  })
})
