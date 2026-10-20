# 专题：结构投影与布局

> 回答：给定一个层次，要画哪些节点和边、摆在哪里。
> 覆盖模块：模型层的 Projector；视图状态层的 Layout（结构图部分，时序图排布见[场景投影与回放](./scenario.md)）。规则见 [02-domain.md](../02-domain.md) 的 L、O、A2 / A7、N12。

## 1. Projector：层次投影

`projectLevel(index, parentId, opts) → LevelView`。给定当前父模块 P：

1. **节点** = P 的可见直接子模块。
2. **端点映射** `mapEndpoint`：把关系两端各自映射到「P 下的直接子模块」——
   - `local`：落在 P 的子树内，记下对应的子模块，以及是否恰好是该子模块（`exact`）；
   - `external`：在 P 外，提升为「最近公共祖先下、它那一侧的子模块」作为边界节点；
   - `actor`：外部参与者，在任何层次都映射为它自己（待实现，L6）；
   - `skip`：端点就是 P 本身或其祖先。
3. **按映射结果归类**（L1–L4）：两端映射到不同子模块 → 两端都 `exact` 为直接边，否则并入聚合边；映射到同一子模块 → 不画；一端在外 → 边界边（受开关控制）；两端都在外 → 不画。
4. **合并**（L5）：分层总览按 `(from, to, type)` 分开；普通层次按 `(from, to)` 合并，记录各类型条数，颜色取条数最多的类型；同步 / 异步汇总为 `sync` / `async` / `mixed`。
5. **可见性**（L7、L8）：「只看现状」时 `status: target` 的模块及其后代不可见；关系类型筛选只过滤结构图的边。

**分层总览**（O1–O4）：P 的可见子模块全是层时 `mode = layered`：

- 按 `order` 生成带，带上该层 `core: true` 的子模块，其余计入 `hiddenCount`（显示为 `+N`）。
- 层与层之间的边按上面的规则算出，作为带间的聚合边。
- 再对每个核心模块算一次跨层关系，端点落到对方层内的核心模块；对方不是核心模块时落到对方所在的层；两端都没落到核心模块的与层间边重复，不记录。结果放在 `coreEdges`，默认不画。

**参与者**（待实现，L6 / A2）：某一层出现与本层子树有关系的参与者（根层为全部有关系的参与者），参与者与本层子模块之间的关系按上面的规则投影成边。

**架构查询**（待实现）：`nearestVisibleLevel(index, levelId, opts)` 返回在给定可见性下最近的可见层次（N12），供导航规则在「只看现状」隐藏当前层次时回退。

**边 ID** 由 `edgeId(from, to, type?)` 生成：`<from>-><to>:<type>`（按类型分开）或 `<from>-><to>`（合并类型）。同样的输入得到同样的 ID，重新加载后选中仍然有效；场景投影用同一规则把帧定位到视图边。

复杂度：一次投影遍历一遍关系，`O(关系数 × 层深)`，千级模块为毫秒级。

## 2. Layout：结构图排布

`layoutView(view) → Promise<PositionedView>`，按视图模式分派：

| 模式 | 排布 |
|---|---|
| `layered` | 不调用 elk。按层序自上而下分带，带内核心模块横向排开（含 `+N` 占位）；相邻层间的边画在带间空隙并横向错开；跨多层的边走右侧通道（O3）；核心跨层边画成曲线 |
| `graph` | elkjs layered 算法排内部模块与内部边（正交走线、标签内联）。先自上而下排，结果过于狭长时再试自左向右，取宽高比更接近画布者 |
| 边界节点 | 统一排在内部结构下方一行，按所连内部模块的平均横坐标排序以减少交叉；边界边画成曲线（L4） |
| 外部参与者（待实现） | 用户类排在内部结构上方一行，外部系统与时间类排在右侧一列；内部结构外画系统边界虚线框（A7） |

- elk 在 Web Worker 中运行，按需动态加载；无 Worker 环境（测试）用同步打包版兜底。
- 结果按视图内容（模式、父模块、节点 ID 列表、边 ID 与条数）缓存，上限 64 项；只改职责等文字时布局不变。
- 异步布局由视图状态层的「布局同步」适配器调用，用序号丢弃过期结果（见[视图状态与协调](./view-state.md)）。

## 3. 数据结构

```ts
interface ProjectOptions {
  showBoundaries: boolean
  relationTypes?: readonly RelationType[]   // 为空表示不过滤
  currentOnly?: boolean                     // 隐藏 status: target
  mergeTypes?: boolean                      // 普通层次按节点对合并
}

interface LevelView {
  mode: 'graph' | 'layered'
  parentId: string
  nodes: ViewNode[]          // role: module | boundary | layer | core | actor（actor 待实现）
  edges: ViewEdge[]
  bands?: Band[]             // 仅 layered
  coreEdges?: ViewEdge[]     // 仅 layered，聚焦时显示
}

interface ViewEdge {
  id: string                 // edgeId 规则，重新加载后不变
  kind: 'direct' | 'aggregate'
  from: string; to: string
  type: RelationType         // 合并类型时取条数最多者
  types: { type: RelationType; count: number }[]
  relationIds: string[]
  mode: 'sync' | 'async' | 'mixed'
}

interface Band { layerId: string; order: number; coreModuleIds: string[]; hiddenCount: number }

interface PositionedView {
  view: LevelView
  nodes: Map<string, Box>               // { x, y, w, h }
  edges: Map<string, EdgeRoute>         // { points, curve?, label? }
  coreEdges: Map<string, EdgeRoute>
}
```

## 4. 接口

```ts
projectLevel(index: ModelIndex, parentId: string, opts?: ProjectOptions): LevelView
  // 层次不存在或被「只看现状」隐藏时抛错；调用方先用 nearestVisibleLevel 取合法层次
mapEndpoint(index, parentId, id): { kind: 'local' | 'external' | 'actor' | 'skip'; node?: string; exact?: boolean }  // 待导出
nearestVisibleLevel(index, levelId, opts): string    // 待实现
edgeId(from: string, to: string, type?: string): string
layoutView(view: LevelView): Promise<PositionedView>
contentBounds(pv: PositionedView): Box | null        // 画布适应时取内容外框
```
