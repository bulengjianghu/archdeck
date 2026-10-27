# 专题：结构投影与布局

> 回答：给定一个层次，要画哪些节点和边、摆在哪里。
> 覆盖模块：模型层的 Projector；视图状态层的 Layout（画布部分，时序图排布见[场景投影与回放](./scenario.md)，舞台显示见[工作台界面 §4](./workbench.md#4-画布)）。规则见 [02-domain.md](../02-domain.md) 的 L、O、A2 / A7、N12、P9。

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
5. **可见性**（L7、L8）：「只看现状」时 `status: target` 的模块及其后代不可见；关系类型筛选只过滤交互图的边。

**分层总览**（O1–O4）：P 的可见子模块全是层时 `mode = layered`：

- 按 `order` 生成带，带上该层 `role: core`（旧写法 `core: true`，M16）的子模块，共用件（`role: shared` / `bus`）作 `shared` 节点（带 `layerId`）进该层 `Band.shelf`（O9），其余计入 `hiddenCount`（显示为 `+N`）；`expandedBands` 中的层（O6，临时展开）全部非共用件子模块都按核心模块露出，`hiddenCount` 为 0、`expanded` 记展开数。
- 布局（`layoutLayered(view, { bandColumns })`）：带内每行的模块块数由画布宽度换算（`bandColumnsFor`，3–8，O7），带宽按列数撑满；缓存键含列数。
- 层与层之间的边按上面的规则算出，作为带间的聚合边。
- 再对每个核心模块算一次跨层关系，端点落到对方层内的核心模块；对方不是核心模块时落到对方所在的层；两端都没落到核心模块的与层间边重复，不记录。结果放在 `coreEdges`，默认不画。

**分级**（O8–O11，ADR-0027）：普通层次（`mode` 不是 `layered`）同样按 `role` 分三类——核心（`ViewNode.core`，大块）与普通作为 `module` 节点参与布局；普通模块超过 7 个（`FOLD_LIMIT`）且本层有核心模块时全部并入一个 `more:<父模块>` 占位节点（`role: more`，带 `hiddenCount` / `expanded`；与它们相连的边按 L5 聚合到占位上，两端都折叠的不画；`expandedBands` 以父模块 ID 记临时展开；`LevelView.fold` 记占位与成员，`alias` 记成员 → 占位，端点映射之后经 `viewNodeOf` 落到占位——场景落点、代码事实、演化、文件高亮共用）；没有核心模块时不折叠，给 `foldHint`（普通模块数）。共用件作 `shared` 节点、ID 列入 `LevelView.shelf`（父模块框底部一行，不参与 elk 布局）；一端是共用件的边（任一方向、任一类型，含边界边与参与者的边）列入 `shelfEdges`、不进 `edges`，非共用件节点带 `sharedCount`（「共用 ×N」，连到的共用件个数）。分层总览的 `shelfEdges` 由核心跨层边同一遍算出：端点落到共用件时代表为共用件，核心与共用件之间（跨层或同层）的进 `shelfEdges`，共用件与自己所在的带之间不画。`shelfOf(view)` 给出本层全部共用件节点（普通层次的 `shelf` 与各带的 `shelf`），场景投影（P18）与画布共用。

**参与者**（L6 / A2）：某一层出现与本层子树有关系的参与者（根层为全部有关系的参与者），参与者与本层子模块之间的关系按上面的规则投影成边（不受边界节点开关影响，受关系类型筛选）；分层总览中入口落在核心模块上时另记一条核心跨层边。

**架构查询**：

- `nearestVisibleLevel(index, levelId, opts)` 返回在给定可见性下最近的可见层次（N12），供导航规则在「只看现状」隐藏当前层次时回退。
- `hierarchyKey(index, id)` 返回模块在层次顺序中的排序键（P9、L4）：从根到该模块的路径上每一级一项，层为 `[0, order]`，其他模块为 `[1, 描述顺序]`；按键逐项比较即得层次顺序，前缀相同的较短者在前（祖先在后代之前）。参与者没有排序键。
- `lowestCommonAncestor(index, a, b)` 返回两个模块路径的最近公共祖先（不存在的模块按根算）：定位关系跳到它（N3），场景所在层次由全部帧端点逐个求得（S9）。与端点映射、层次顺序同为树上的纯查询，放在 Projector，场景投影因此只依赖 Projector、不依赖加载流水线。
- 边界节点在 `LevelView.nodes` 中按 `hierarchyKey` 排序输出，Layout 按此顺序排边界节点行，时序图泳道用同一个键，两张图的外部模块顺序因此一致。

**边 ID** 由 `edgeId(from, to, type)` 生成：`<from>-><to>:<type>`。同样的输入得到同样的 ID，重新加载后选中仍然有效；场景投影用同一规则把帧定位到视图边（按帧绑定关系的类型选边，P17）。

复杂度：一次投影遍历一遍关系，`O(关系数 × 层深)`，千级模块为毫秒级。

- **四类交互与边界**（ADR-0029、ADR-0030）：视图边按 (from, to, type) 分（L5），类型为四类交互（迁移期的未分类单成一类）；视图节点带边界角色 `rim`（`port` / `adapter`，L14），它们同核心常显、不折叠进「+N」；插座（L12）由画布场景按视图边的原始关系判定，端口记号（L13）的数据来自 `desk.facts.portMarks`，都不进 `LevelView`；组装叠加（O12）由架构治理的 `levelAssembly` 按 `mapEndpoint` 投影，与代码依赖叠加线同一路径。

**结构视角复用本节的层次投影**（ADR-0031）：模块依赖（K4）按 `mapEndpoint` 投影到本层，一对节点同方向一条束、束内为元素级边（L15、K14、L21；第七轮为按事实种类分边），一端是边界节点的束跨界折叠（L21③），展开被依赖方表面时束散开到元素（L20）；普通模块折叠时依赖边并到「+N」占位块，共用件的依赖折叠进使用者的「共用 ×N」角标，结构视角下按依赖计数（含只引类型），反向依赖、违规、在环中的照常画（O13）。依赖边的投影由架构治理的子模块「结构视图」（`levelDeps`，分层总览核心模块的跨层依赖 `chipDeps`）给出，不进 `LevelView`；结构边与交互边并集布局（§2），两个视角共用同一份布局与走线（V12、L15），UML 端点记号与指标角标由画布场景（`layout/canvas/structure.ts`）按 L16、L17 画。

## 2. Layout：画布排布

`layoutView(view, opts, links?) → Promise<PositionedView>`，按视图模式分派。

**并集布局**（L15，第七轮 T6；第八轮：`links` 为本层的束，一对节点一条；表面展开不重排：节点位置与尺寸取收起态的布局，展开只排端口点并给接到点的边重新走线，L20、ADR-0036）：`links`（`StructureLinks`）是本层的束与元素级边（`levelDeps`，含只引类型、聚焦才画的；没有代码事实时为 U16 的允许边），有表面展开时另带展开的节点与元素端口（`expand`，含按子模块的分组 `groups` 与封顶前的优先次序 `ranked`）、交互束的散开（`interactions`）——`layoutView` 先按去掉这两项的 `links` 取收起态布局（同一缓存），再由纯函数 `expandSurface` 在固定的节点上排点阵（`surfaceDots`）、把接到点的边沿束的收起态走线经扇出线接到点上（`fanRoutes`），不再调 elk（L20a②），分层总览另有全部核心块的跨层依赖（`chipDeps`）。`unionView` 把它们并入视图——普通层次与架上共用件相连的并入共用件的边（不参与 elk，画成曲线），其余并入视图边（内部边由 elk 正交走线，框外边在内部节点上占端口、按需走线）；分层总览并入带间排布与核心跨层边。同一对节点同方向的交互边与结构边各保留自己的边 ID。结果的 `view` 仍是传入的视图（只有交互边），结构边的走线按 ID 在 `edges` / `coreEdges` 里取；两个视角各自只画自己那组边，隐藏的边的通道保留。结构边由 DeskState 的 `facts.layoutLinks` 给出（表面展开的集合 `facts.expansion` 并在其中，L20a），不论视角都给，代码事实读取中为 null（只按交互边布局）；布局由同步适配器（`createLayoutSync`）负责，画布只读结果。

| 模式 | 排布 |
|---|---|
| `layered` | 不调用 elk。按层序自上而下分带，带内核心模块横向排开（含 `+N` 占位），共用件在带底一行（共用件架，带随之加高）；相邻层间的边画在带间空隙并横向错开（112 px，条数多时按空隙收窄，不超出带的中间区域）；跨多层的边走右侧通道（O3）；带右边的端口（通道边与带到右侧参与者的边）统一分配，上半进、下半出（O3a）；核心跨层边朝对端取顶边或底边、左半进右半出、半边内按对端横向位置排，相邻两层之间画曲线，跨多层的走右侧通道外的核心车道（正交，有共同端点的边不同车道），不穿过中间的带（O3b） |
| `graph` | elkjs layered 算法只排父模块框内的子模块（不含共用件）与它们之间的边（正交走线、标签内联）。每条边两端各有自己的端口：进边在入口侧、出边在出口侧（自上而下为上进下出，RIGHT 时左进右出）；同一侧左动右静（RIGHT 时上动下静），用 `FIXED_ORDER` 按 elk 的顺时针端口序给序号（L11）。框外边在内部节点那一端也给一个不连线的占位端口，与内部边一起排序，按需走线时取 elk 排出的位置（`PositionedView.ports`）；缓存键因此含框外边。先自上而下排，结果过于狭长时再试自左向右，取宽高比更接近画布者。布局后：父模块框 `parentFrame` 包住内部节点（留 28）与内部走线（留 12）；有共用件时 `placeShelf` 在框底部排一行共用件架（`SHELF`，左侧留「共用件」字样，放不下换行，至少 4 个一行、框随之撑开，`PositionedView.shelf`），框外的元素再由 `placeOutside` 按方位摆放（A7、L4） |
| 边界节点 | 在父模块框下方一行（间隔 72，放得下进边界节点的终点短桩），按视图给出的层次顺序从左到右排列（与时序图泳道一致）；系统框 `frame` 包住父模块框与边界节点行并留 44（L4）。边界边不参与布局，要画时才由 `edgeRoute` 按需走线（`routing.ts` 的 `detour`） |
| 平行边 | elk 排的边各有端口、由 elk 错开，终点仍重合的按 `spreadEnds` 错开；分层总览中参与者的边、核心跨层边的曲线：同一对节点之间的多条边（不论方向）按序号横向（侧边出发的曲线为纵向）错开 10px（`parallelOffsets`，L10） |
| 外部参与者 | 方位固定、所有层次一致（A7）：用户在系统框上方一行、外部系统与时间在系统框右侧一列（分层总览在右侧通道之外），按所连节点的位置排序（`placeActors`）；没有边界节点时系统框与父模块框重合。参与者的边常驻显示、正交走线：普通层次按需走线（`edgeRoute`），分层总览在排布时走线（`outsideRouter`：带按对端方位取顶边 / 右边 / 底边，核心模块上进下出、短桩一直走到带间空隙的中线）。画布按是否根层画框：根层只画系统框，下钻后外框为系统、内框为当前父模块（`canvas/nodes.ts`；两框重合时外框再外扩 16） |

- 轨道分配（`outsideRoutes`，画布场景每次按当前画出来的框外边调用）：这一组一起走线（端口错开只在组内算），再由 `routing.ts` 的 `allocateTracks` 把走廊里重合的中间横段、竖段按边 ID 依次错开 10 px（紧接首段的横段继续远离起点、紧接末段的横段远离终点，箭头前的直段不被压缩），`placeLabels` 沿各自的线挑不相碰的标签位置；按布局与可见集记忆。运行视角的步骤序号与分支预览也取分配后的走线中点。
- 框外元素的走线（`detour`）：出端口（用户底边、外部系统左边、边界节点顶边、内部节点按入口 / 出口侧）→ 短桩（14）→ 横到一条竖直通道 → 竖直 → 横到目标短桩 → 进入目标；目标短桩加长到 38（`ARRIVE`：箭头约 14 + 拐角圆角 8 + 余量），箭头前留出直段、拐弯不贴着箭头，进内部节点的横线落在两框之间、只在靠近目标处竖直穿过父模块框；通道取起终点、节点间空隙中线与外侧（离节点 50，落在两框之间）中三段都不穿节点（含两端自身）、总长最短的；同一节点同一侧的多条边沿该边错开 10 px、短桩逐条加长 6 px，终点短桩再按起点上的序号加长，同一起点的几条边各走一条横线。
- 缓存两级：`cacheKey`（节点布局，含结构边 ID——代码事实增删结构边即重算，带 `LAYOUT_VERSION`）；框外元素的边按布局的节点表记忆（`edgeRoute`，再按当前视图的这类边集合区分）。
- 跳线（L11，`layout/routing.ts` 的 `jumpsOf`）：画布场景对画出来的折线关系边求交叉——水平段跳过竖直段，同一对节点之间的边、曲线、隐藏的边不参与，离线段端点 16 px 内的不跳；`routePath.roundedPolyline` 在跳点处插半径 4 px 的半圆。
- 文件分工（`src/layout/`）：`layout.ts` 入口与缓存（外部只经它引用，state.layout 的访问面）、`geometry.ts` 几何类型与外框、`layered.ts` 分层总览、`graph.ts` elk 图构造与普通层次排布、`routes.ts` 手工走线与边界（参与者、曲线、标签与线宽档、平行边）、`routing.ts` 跳线。
- elk 在 Web Worker 中运行，按需动态加载；无 Worker 环境（测试）用同步打包版兜底。
- 结果按视图内容（模式、父模块、节点 ID 列表、边 ID 与条数、结构边 ID）缓存，上限 64 项；只改职责等文字时布局不变。
- 异步布局由视图状态层的「布局同步」适配器调用，用序号丢弃过期结果（见[视图状态与协调](./view-state.md)）。

- **边界角色与端口记号**：Layout 对 `role: port` / `adapter` 的节点加方位约束（L14）——普通层次不交给 elk，布局后压在父模块框的上边 / 右边（placeRims），边按框外边按需走线；分层总览里 port 压在带的上边、adapter 在带内最右一列；端口记号贴在节点进边一侧的后半、不参与布局（L11、L13）；插座与组装叠加线由 canvasScene 生成，不参与布局（L12、O12）。

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
  nodes: ViewNode[]          // role: module | boundary | layer | core | actor | shared | more（actor 带 actorKind；module 可带 core；sharedCount）
  edges: ViewEdge[]
  bands?: Band[]             // 仅 layered
  coreEdges?: ViewEdge[]     // 仅 layered，聚焦时显示
  shelf?: string[]           // 仅 graph：共用件架（O9）
  shelfEdges?: ViewEdge[]    // 共用件的边，悬停 / 选中一端时显示（O10）
  fold?: { id: string; members: string[]; expanded: boolean }  // 仅 graph：「+N」占位（O8）
  foldHint?: number          // 仅 graph：没有核心、普通超过 7 个时的提示数
  alias?: Record<string, string>  // 折叠成员 → 占位（viewNodeOf）
}

interface ViewEdge {
  id: string                 // edgeId 规则，重新加载后不变
  kind: 'direct' | 'aggregate'
  from: string; to: string
  type: RelationType
  relationIds: string[]      // 条数 = relationIds.length
  mode: 'sync' | 'async' | 'mixed'
}

interface Band { layerId: string; order: number; coreModuleIds: string[]; hiddenCount: number; expanded?: number; shelf: string[] }

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
