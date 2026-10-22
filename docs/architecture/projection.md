# 专题：结构投影与布局

> 回答：给定一个层次，要画哪些节点和边、摆在哪里。
> 覆盖模块：模型层的 Projector；视图状态层的 Layout（结构图部分，时序图排布见[场景投影与回放](./scenario.md)，舞台显示见[工作台界面 §4](./workbench.md#4-画布结构图)）。规则见 [02-domain.md](../02-domain.md) 的 L、O、A2 / A7、N12、P9。

## 1. Projector：层次投影

`projectLevel(index, parentId, opts) → LevelView`。给定当前父模块 P：

1. **节点** = P 的可见直接子模块。
2. **端点映射** `mapEndpoint`：把关系两端各自映射到「P 下的直接子模块」——
   - `local`：落在 P 的子树内，记下对应的子模块，以及是否恰好是该子模块（`exact`）；
   - `external`：在 P 外，提升为「最近公共祖先下、它那一侧的子模块」作为边界节点；
   - `actor`：外部参与者，在任何层次都映射为它自己（L6）；
   - `skip`：端点就是 P 本身或其祖先。
3. **按映射结果归类**（L1–L4）：两端映射到不同子模块 → 两端都 `exact` 为直接边，否则并入聚合边；映射到同一子模块 → 不画；一端在外 → 边界边（受开关控制）；两端都在外 → 不画。
4. **合并**（L5）：普通层次与分层总览都按 `(from, to, type)` 分边，同一对节点之间不同类型的关系各成一条；同类型内聚合，条数即 `relationIds.length`，同步 / 异步汇总为 `sync` / `async` / `mixed`。
5. **可见性**（L7、L8）：「只看现状」时 `status: target` 的模块及其后代不可见；关系类型筛选只过滤结构图的边。

**分层总览**（O1–O4）：P 的可见子模块全是层时 `mode = layered`：

- 按 `order` 生成带，带上该层 `core: true` 的子模块，其余计入 `hiddenCount`（显示为 `+N`）；`expandedBands` 中的层（O6，临时展开）全部子模块都按核心模块露出，`hiddenCount` 为 0、`expanded` 记展开数。
- 布局（`layoutLayered(view, { bandColumns })`）：带内每行的模块块数由画布宽度换算（`bandColumnsFor`，3–8，O7），带宽按列数撑满；缓存键含列数。
- 层与层之间的边按上面的规则算出，作为带间的聚合边。
- 再对每个核心模块算一次跨层关系，端点落到对方层内的核心模块；对方不是核心模块时落到对方所在的层；两端都没落到核心模块的与层间边重复，不记录。结果放在 `coreEdges`，默认不画。

**参与者**（L6 / A2）：某一层出现与本层子树有关系的参与者（根层为全部有关系的参与者），参与者与本层子模块之间的关系按上面的规则投影成边（不受边界节点开关影响，受关系类型筛选）；分层总览中入口落在核心模块上时另记一条核心跨层边。

**架构查询**：

- `nearestVisibleLevel(index, levelId, opts)` 返回在给定可见性下最近的可见层次（N12），供导航规则在「只看现状」隐藏当前层次时回退。
- `hierarchyKey(index, id)` 返回模块在层次顺序中的排序键（P9、L4）：从根到该模块的路径上每一级一项，层为 `[0, order]`，其他模块为 `[1, 描述顺序]`；按键逐项比较即得层次顺序，前缀相同的较短者在前（祖先在后代之前）。参与者没有排序键。
- `lowestCommonAncestor(index, a, b)` 返回两个模块路径的最近公共祖先（不存在的模块按根算）：定位关系跳到它（N3），场景所在层次由全部帧端点逐个求得（S9）。与端点映射、层次顺序同为树上的纯查询，放在 Projector，场景投影因此只依赖 Projector、不依赖加载流水线。
- 边界节点在 `LevelView.nodes` 中按 `hierarchyKey` 排序输出，Layout 按此顺序排边界节点行，时序图泳道用同一个键，两张图的外部模块顺序因此一致。

**边 ID** 由 `edgeId(from, to, type)` 生成：`<from>-><to>:<type>`。同样的输入得到同样的 ID，重新加载后选中仍然有效；场景投影用同一规则把帧定位到视图边（按帧绑定关系的类型选边，P17）。

复杂度：一次投影遍历一遍关系，`O(关系数 × 层深)`，千级模块为毫秒级。

## 2. Layout：结构图排布

`layoutView(view) → Promise<PositionedView>`，按视图模式分派：

| 模式 | 排布 |
|---|---|
| `layered` | 不调用 elk。按层序自上而下分带，带内核心模块横向排开（含 `+N` 占位）；相邻层间的边画在带间空隙并横向错开；跨多层的边走右侧通道（O3）；核心跨层边画成曲线 |
| `graph` | elkjs layered 算法排全部节点（内部模块、边界节点、参与者）与内部边、参与者的边（正交走线、标签内联）；边界边不交给 elk。每条边两端各有自己的端口，端口所在的边固定（`FIXED_SIDE`）：内部节点进边在上、出边在下（RIGHT 时左进右出），用户只朝下、边界节点与外部系统只朝上，同一侧端口的先后由 elk 排（L11）；用户层约束 `FIRST_SEPARATE`，边界节点与外部系统 `LAST_SEPARATE`（自成一行），最后一行的先后用 `semiInteractive` 的位置提示按视图顺序固定；关掉 `separateConnectedComponents`，没有边的边界节点才受层约束。先自上而下排，结果过于狭长时再试自左向右，取宽高比更接近画布者 |
| 边界节点 | 由 elk 排在内部结构下方同一行，按视图给出的层次顺序从左到右排列（与时序图泳道一致）。边界边不参与布局，要画时才由 `edgeRoute` 按需走线（`routing.ts` 的 `detour`）：出端口 → 短桩 → 横到一条竖直通道 → 竖直 → 横到目标短桩 → 自上而下进入目标；通道取起终点、节点间空隙中线与外框两侧中三段都不穿节点（含两端自身）、总长最短的；同一节点上的多条边界边沿该边错开 10 px、短桩逐条加长 6 px（L4、L11） |
| 平行边 | elk 排的边各有端口、由 elk 错开，终点仍重合的按 `spreadEnds` 错开；分层总览中参与者的边、核心跨层边的曲线：同一对节点之间的多条边（不论方向）按序号横向（侧边出发的曲线为纵向）错开 10px（`parallelOffsets`，L10） |
| 外部参与者 | 普通层次：进 elk，用户在第一行、外部系统与时间随边界节点在最后一行，边正交绕行；有参与者时画父模块虚线框，包住内部节点（留 28）与已布局的走线（留 12，参与者那一端的点除外），框线不压线、参与者与框之间留有间距。分层总览：用户类排在带的上方一行，外部系统与时间类排在右侧通道之外，按所连节点的位置排序，边画成曲线。两种都内部结构外画边界虚线框（根层为系统边界，其他层次为当前父模块），四周留白（层次图见上，分层总览 28，包住全部带与右侧通道；带内上下留白 24），不与带或节点的外沿重合；参与者的边常驻显示（A7） |

- 缓存两级：`cacheKey`（节点布局，普通层次不含边界边，带 `LAYOUT_VERSION`）；边界边的走线按布局的节点表记忆（`edgeRoute`，再按当前视图的边界边集合区分）。
- 跳线（L11，`layout/routing.ts` 的 `jumpsOf`）：画布场景对画出来的折线关系边求交叉——水平段跳过竖直段，同一对节点之间的边、曲线、隐藏的边不参与，离线段端点 16 px 内的不跳；`routePath.roundedPolyline` 在跳点处插半径 4 px 的半圆。
- 文件分工（`src/layout/`）：`layout.ts` 入口与缓存（外部只经它引用，state.layout 的访问面）、`geometry.ts` 几何类型与外框、`layered.ts` 分层总览、`graph.ts` elk 图构造与普通层次排布、`routes.ts` 手工走线与边界（参与者、曲线、标签与线宽档、平行边）、`routing.ts` 跳线。
- elk 在 Web Worker 中运行，按需动态加载；无 Worker 环境（测试）用同步打包版兜底。
- 结果按视图内容（模式、父模块、节点 ID 列表、边 ID 与条数）缓存，上限 64 项；只改职责等文字时布局不变。
- 异步布局由视图状态层的「布局同步」适配器调用，用序号丢弃过期结果（见[视图状态与协调](./view-state.md)）。

## 3. 数据结构

```ts
interface ProjectOptions {
  showBoundaries: boolean
  relationTypes?: readonly RelationType[]   // 为空表示不过滤
  currentOnly?: boolean                     // 隐藏 status: target
}

interface LevelView {
  mode: 'graph' | 'layered'
  parentId: string
  nodes: ViewNode[]          // role: module | boundary | layer | core | actor（actor 带 actorKind）
  edges: ViewEdge[]
  bands?: Band[]             // 仅 layered
  coreEdges?: ViewEdge[]     // 仅 layered，聚焦时显示
}

interface ViewEdge {
  id: string                 // edgeId 规则，重新加载后不变
  kind: 'direct' | 'aggregate'
  from: string; to: string
  type: RelationType
  relationIds: string[]      // 条数 = relationIds.length
  mode: 'sync' | 'async' | 'mixed'
}

interface Band { layerId: string; order: number; coreModuleIds: string[]; hiddenCount: number; expanded?: number }

interface PositionedView {
  view: LevelView
  nodes: Map<string, Box>               // { x, y, w, h }
  edges: Map<string, EdgeRoute>         // { points, curve?, label? }
  coreEdges: Map<string, EdgeRoute>
  frame?: Box                           // 有参与者时内部结构的边界框
}
```

## 4. 接口

```ts
projectLevel(index: ModelIndex, parentId: string, opts?: ProjectOptions): LevelView
  // 层次不存在或被「只看现状」隐藏时抛错；调用方先用 nearestVisibleLevel 取合法层次
mapEndpoint(index, parentId, id): { kind: 'local' | 'external' | 'actor' | 'skip'; node?: string; exact?: boolean }
nearestVisibleLevel(index, levelId, opts): string
hierarchyKey(index: ModelIndex, id: string): number[]   // 每级两项：[是否非层, order 或描述顺序]
compareKeys(a: number[], b: number[]): number
lowestCommonAncestor(index: ModelIndex, a: string, b: string): string   // 最近公共祖先：定位关系（N3）与场景所在层次（S9）共用
edgeId(from: string, to: string, type: string): string
layoutView(view: LevelView): Promise<PositionedView>
contentBounds(pv: PositionedView): Box | null        // 画布适应时取内容外框
```
