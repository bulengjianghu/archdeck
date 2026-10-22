/**
 * 画布场景（ADR-0013）：把带坐标的层次视图换成画布要画的节点与边——位置、类型、数据（选中、变淡、设计版本标记、回放态、
 * 选中突出的灰化）、类名、层级，以及运行视角下适应画布用的可见节点。纯函数，与 stageOverlay、stageDisplay 同属 Layout；
 * 画布组件只把结果写入 Vue Flow、把交互转成操作。规则见 docs/architecture/workbench.md §4。
 *   结构视角：聚焦对象（悬停优先、其次选中）不相邻的节点与边变淡；核心跨层边只在聚焦核心模块时出现（O4）；边界边只在聚焦其一端或被选中时出现（L4）。
 *   运行视角：舞台显示决定显隐与淡化（V5、V8、V9、V10）；回放叠加（P7、P10、P11、P15、F6）；选中步骤时其余走过的边与步骤序号变灰（R15、R16）。
 *   选中文件：归属模块在本层的投影节点加文件高亮（G14）。
 *   跳线（L11）：画出来的折线关系边之间的交叉处，水平段起一个半圆小桥；曲线与临时线不参与。
 *   代码事实（结构视角、开关开启，K9、Y4）：关系边标证实、含违规的边红色描边、未描述依赖与违规画成不参与布局的叠加线、本层环的节点标编号。
 * 本文件是入口，只组合各部分：共用派生 canvas/context.ts、节点 canvas/nodes.ts、边 canvas/edges.ts、对外类型 canvas/types.ts。
 */
import { sceneContext, visibleIdsOf } from './canvas/context'
import { factEdges, replayEdges, structureEdges } from './canvas/edges'
import { moduleNodes, replayNodes } from './canvas/nodes'
import { jumpsOf } from './routing'
import type { CanvasEdge, CanvasInput, CanvasScene } from './canvas/types'

export type { CanvasEdge, CanvasInput, CanvasNode, CanvasNodeType, CanvasScene, EdgeArrow, FactState, NodeData, RouteEdgeData } from './canvas/types'
export { EDGE_Z, routeMidpoint } from './canvas/edges'
export { JUMP_RADIUS } from './routing'

export function canvasScene(input: CanvasInput): CanvasScene {
  if (!input.positioned) return { nodes: [], edges: [], visibleIds: null }
  const ctx = sceneContext(input, input.positioned)
  const nodes = input.index ? [...moduleNodes(ctx, input.index), ...replayNodes(ctx)] : []
  // 回放叠加只在运行视角、代码事实叠加只在结构视角，两者不同时出现
  const edges = [...structureEdges(ctx), ...replayEdges(ctx), ...factEdges(ctx)].filter((e): e is CanvasEdge => e !== null)
  return { nodes, edges: withJumps(edges), visibleIds: visibleIdsOf(ctx.display) }
}

/** L11：只在画出来的折线关系边之间算交叉（隐藏的边界边、舞台隐藏的边本就不在这里） */
function withJumps(edges: CanvasEdge[]): CanvasEdge[] {
  const lines = edges
    .filter(e => !e.data.route.curve && !e.data.temp)
    .map(e => ({ id: e.id, points: e.data.route.points, pair: [e.source, e.target].sort().join('|') }))
  const jumps = jumpsOf(lines)
  return jumps.size ? edges.map(e => (jumps.has(e.id) ? { ...e, data: { ...e.data, jumps: jumps.get(e.id) } } : e)) : edges
}
