/**
 * 画布场景（ADR-0013）：把带坐标的层次视图换成画布要画的节点与边——位置、类型、数据（选中、变淡、设计版本标记、回放态、
 * 选中突出的灰化）、类名、层级，以及运行视角下适应画布用的可见节点。纯函数，与 stageOverlay、stageDisplay 同属 Layout；
 * 画布组件只把结果写入 Vue Flow、把交互转成操作。规则见 docs/architecture/workbench.md §4。
 *   结构视角：聚焦对象（悬停优先、其次选中）不相邻的节点与边变淡；核心跨层边只在聚焦核心模块时出现（O4）；边界边只在聚焦其一端或被选中时出现（L4）。
 *   运行视角：舞台显示决定显隐与淡化（V5、V8、V9、V10）；回放叠加（P7、P10、P11、P15、F6）；选中步骤时其余走过的边与步骤序号变灰（R15、R16）。
 *   选中文件：归属模块在本层的投影节点加文件高亮（G14）。
 *   跳线（L11）：画出来的折线关系边之间的交叉处，水平段起一个半圆小桥；曲线与临时线不参与。
 *   代码事实（结构视角、开关开启，K9、Y4）：关系边标证实、含违规的边红色描边、未解释的交互与违规画成不参与布局的叠加线、本层环的节点标编号。
 *   演化（交互与结构视角、热度或耦合开启，J5）：节点的热度角标、时间耦合的波浪线（不参与布局）。
 *   结构视角（ADR-0031）：交互边换成结构边（L15、L16，canvas/structure.ts），节点不动（V12），角标换成指标、影响面与常显的环（L17、K15、Y4）。
 *   第八轮（ADR-0032）：结构边即束（L21），表面展开时散开为元素级边、元素记号排在节点入边一侧（C6、L20）；选中束时反向高亮它承载的交互（L22）；
 *   交互视角选中交互时承载段叠加（L22），交互束按接收方表面散开、束内修饰不一致标「混合」（L23）。
 * 本文件是入口，只组合各部分：共用派生 canvas/context.ts、节点 canvas/nodes.ts、边 canvas/edges.ts、对外类型 canvas/types.ts。
 */
import { sceneContext, visibleIdsOf } from './canvas/context'
import { assemblyEdges, carriedEdges, carrierEdges, depEdges, evolutionEdges, factEdges, interactionEdges, replayEdges, shownEdges } from './canvas/edges'
import { outsideRoutes } from './layout'
import { moduleNodes, replayNodes } from './canvas/nodes'
import { jumpsOf } from './routing'
import type { CanvasEdge, CanvasInput, CanvasScene } from './canvas/types'

export type {
  CanvasEdge,
  CanvasInput,
  CanvasNode,
  CanvasNodeType,
  CanvasScene,
  DepEdgeKind,
  DepEdgeLook,
  NodeSurface,
  StructureDisplayInput,
  SurfaceMark,
  DepViolation,
  EdgeArrow,
  FactState,
  NodeData,
  NodePorts,
  PortMark,
  RouteEdgeData,
  StructureInput,
} from './canvas/types'
export { DEP_KIND_LABELS, DEP_TIER_LABELS, ELEMENT_KIND_LABELS, depWeight, violationLook } from './canvas/structure'
export { PORT_MERGE } from './canvas/nodes'
export { EDGE_Z, routeMidpoint } from './canvas/edges'
export { JUMP_RADIUS } from './routing'

export function canvasScene(input: CanvasInput): CanvasScene {
  if (!input.positioned) return { nodes: [], edges: [], visibleIds: null }
  const ctx = sceneContext(input, input.positioned)
  // L11：画出来的框外边一起走线、分配轨道；边与步骤序号都用分配后的走线
  ctx.routes = ctx.structure ? ctx.structure.routes : outsideRoutes(input.positioned, shownEdges(ctx))
  const nodes = input.index ? [...moduleNodes(ctx, input.index), ...replayNodes(ctx)] : []
  // 回放叠加只在运行视角；代码事实与组装叠加只在交互视角；结构边只在结构视角；演化叠加在交互与结构视角（共享通道）
  const edges = [
    ...interactionEdges(ctx),
    ...depEdges(ctx),
    ...carriedEdges(ctx),
    ...carrierEdges(ctx),
    ...replayEdges(ctx),
    ...factEdges(ctx),
    ...assemblyEdges(ctx),
    ...evolutionEdges(ctx),
  ].filter((e): e is CanvasEdge => e !== null)
  const sc = ctx.structure
  return {
    nodes,
    edges: withJumps(edges),
    visibleIds: visibleIdsOf(ctx.display),
    ...(sc ? { structure: { typeOnlyHidden: sc.typeOnlyHidden, valueHidden: sc.valueHidden, coveredHidden: sc.coveredHidden, note: sc.note } } : {}),
  }
}

/** L11：只在画出来的折线关系边之间算交叉（隐藏的边界边、舞台隐藏的边本就不在这里） */
function withJumps(edges: CanvasEdge[]): CanvasEdge[] {
  const lines = edges
    .filter(e => !e.data.route.curve && !e.data.temp)
    .map(e => ({ id: e.id, points: e.data.route.points, pair: [e.source, e.target].sort().join('|') }))
  const jumps = jumpsOf(lines)
  return jumps.size ? edges.map(e => (jumps.has(e.id) ? { ...e, data: { ...e.data, jumps: jumps.get(e.id) } } : e)) : edges
}
