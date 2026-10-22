# 专题：场景投影与回放

> 回答：一个场景在某一层怎么走；单步、跳转、分支选择怎么算；时序图的内容与坐标从哪来。
> 覆盖模块：模型层的场景投影（`src/model/scenario/`：plan · path · level · participation · outline · sequence，另有 bind · steps；这些阶段的数据类型声明在 `types.ts`，属于契约「类型与 Schema」，U10）；视图状态层 Layout 的时序图排布（`src/layout/sequence.ts`）。概念见 [02-domain.md §1.3](../02-domain.md#13-场景与回放)，规则见 S、F、P（含 P15、P16）、R7、R13、R16、V6、T5、T6；回放的会话规则（选中、历史）见[视图状态与协调](./view-state.md)，画法见[工作台界面](./workbench.md)。

## 1. 流水线

```text
场景描述（步骤树）
  │ planScenario：展开 + 绑定关系                         与层次无关，打开场景时算一次
  ▼
回放计划（帧树，alt 处分叉）
  │ resolvePath(计划, 已选分支)                           已选分支变化时重算
  ▼
回放路径（线性帧序列，可能截止于未选分支的分支点）
  │ projectScenario(索引, 舞台视图, 计划, 已选分支)       层次或已选分支变化时重算
  ▼
本层帧投影：每帧的落点 + 合并出的可见消息
  ├─ buildSequence ──▶ 时序模型（计划全貌）──layoutSequence──▶ 时序图坐标
  └─ participation(对象) ──▶ 运行信息

回放计划 + 已选分支
  ├─ outlineScenario ──▶ 步骤大纲（导航树的步骤树）
  ├─ routeOf ──▶ 路线（回放控制条的路线总览）
  └─ scenarioModules ──▶ 参与模块（导航树的模块树标记）

回放计划
  └─ pairReturns ──▶ 调用与显式返回的配对（步骤的输出、选中步骤时的「配对」标记）
```

全部是纯函数，结果交给视图状态层派生（见[视图状态与协调 §2](./view-state.md#2-协调者deskstate)）。

## 2. 回放计划（`planScenario`）

- **展开**：消息步骤成为帧（F1）；`ref` 内联子场景并记为 ref 组合框（F3）；`loop` 展开一遍并标注条件（F4）；`par` 各分支按书写顺序串行并标注并行（F5）；`alt` 成为分支点，每个选项一棵子树（F6）。每帧记录外到内的组合框路径。
- **帧 ID**（F2）：场景 ID + 步骤 `id`，没写时用步骤在树中的路径（如 `sc.open#4.alt0.1`）；`ref` 内联时加上引用处前缀，同一子场景被引用两次也不冲突。校验已保证 `ref` 无环（S6），展开必然终止。
- **绑定关系** `bindRelation`（S5a、S12、S13，`bind.ts`）：关系两端分别是消息两端自身或其祖先即「对得上」；方向按 `event` 反向、`return` 再反向比对。显式引用优先；否则两端之间恰好一条运行时关系即认定并标为推断，恰好连在两端上的优先于连在祖先上的；同时给出消息方向是否与关系箭头相反。Validator 调用同一个函数做 S5a 检查，校验与回放结果一致。
- **继承接口与数据**（S14）：消息步骤没写 `interface` / `payload` 时，取绑定关系（显式或推断）的值；`return` 只继承 `interface`；帧上记下哪些是继承来的（`inherited`），面板据此标「取自关系」。
- **分支点 ID** 与组合框实例 ID 同帧 ID 的规则（场景 ID + `#` + 前缀 + 步骤路径）。
- **调用与返回配对** `pairReturns`（F7）：按书写顺序遍历计划，`call` 入栈；显式 `return`（X → Y）在栈中自顶向下找最近的 Y → X 调用，找到即配对，并弹出它及其上的调用（它们没有显式返回）；`alt` 的每个选项从进入分支点时的栈副本开始，选项内未配对的调用在选项结束时丢弃，分支点之后继续用进入时的栈；`async` 不入栈。结果是帧 ID ↔ 帧 ID 的双向映射，与层次和已选分支无关，打开场景时随计划算一次。

## 3. 回放路径（`resolvePath` 等）

| 函数 | 做什么 | 规则 |
|---|---|---|
| `resolvePath(plan, choices)` | 按已选分支走出线性帧序列；遇到未选分支的分支点即截止，并报告该分支点（`pending`）；无效的选择被忽略 | F6 |
| `chooseBranch(plan, choices, point, option)` | 在某个分支点选择或改选；改选会丢弃该分支点之后的选择 | F6b |
| `choicesFor(plan, choices, frameId)` | 到达某一帧需要的分支选择：已在路径上时原样返回；否则包住它的分支点选它所在的选项，它之前尚未选择的分支点保留已有选择、没有时取第一个选项 | R13 |
| `choicesForBranch(plan, choices, point, option)` | 直选任意分支点的某一支：分支点不在路径上时，像 `choicesFor` 一样补齐到达它所需的选择（包住它的分支点选它所在的选项，其余保留已有选择或取第一个），再在它上面 `chooseBranch` | F6e |
| `pointPrefix(plan, choices, point)` | 路径上分支点之前的帧（不含分支点内的帧）；回放规则据此在改走另一支后把进度停在分支点之前 | F6e |
| `routeOf(plan, choices)` | 路线：路径上依次经过的分支点（带所选选项）与截止处待选的分支点（无选项） | F6f |
| `choiceList` / `choicesFromList` | 已选分支 ↔ 路径上分支点先后的选项序号（URL 有序编码） | F6c |

## 4. 帧的层次投影（`projectScenario` 等）

**舞台视图**：运行视角下的层次视图由 `projectLevel(…, { scenarioEnds: stageEnds(计划) })` 得出，补齐场景帧端点（含全部分支）在本层对应的边界节点与参与者（P12），因此落点的节点一定在视图中，切换分支也不改变布局。

对路径上的每一帧（`landFrame`），用 Projector 的 `mapEndpoint` 把两端映射到当前层次（P1），得出落点：

| 映射结果 | 落点 | 规则 |
|---|---|---|
| 两个不同节点，且本层有对应的视图边（P17：含帧绑定关系的边，其次同类型的边；帧未绑定关系时同方向的运行时关系边优先） | `edge`：该视图边的 ID（`edgeId` 规则），并标记方向是否与边相反；分层总览中一端落在核心模块的子树内且有对应的核心跨层边时落在核心跨层边上（`core`） | P1、P2、P7、P10、P17 |
| 两个不同节点，本层没有对应的视图边，帧已绑定关系（`frame.relation`，显式或推断） | `upper`：经由上层关系——关系一端是当前层次本身或其祖先；带 `relationId`，回放期间画关系类型色的临时虚线 | P15 |
| 两个不同节点，本层没有视图边，帧没有绑定关系 | `unmodeled`：结构中未建模，回放期间画临时虚线 | P11 |
| 同一个子模块 | `internal`：内部活动 | P3 |
| 两端都在本层外 | 不可见 | P4 |
| 分层总览：两端在同一核心模块 | `internal`：该核心模块的内部活动 | P3 |
| 分层总览：两端在同一层的不同泳道（核心模块之间、核心模块与层内其他模块之间） | `internal`：结构图上是该层（带）的内部活动，另带 `lanes`（两条泳道，消息方向），时序图据此画成泳道之间的消息 | P7、P14 |
| 一端是当前父模块自身或其祖先 | 按另一端的内部活动 | — |

然后把连续落在同一对节点之间的视图边上且方向相同（不论边的关系类型，消息落在第一帧的边上）、或同一节点内部，并在同一组合框分支中的帧合并为**可见消息**（P5），它是本层的单步单位。`upper` 与 `unmodeled` 按两端节点（含方向）合并为同一类；合并出的消息只要有一帧是 `unmodeled` 就整条为 `unmodeled`，全部是 `upper` 时为 `upper`、`relationId` 取第一帧的（P16）。合并前先把计划**线性化**（`linearize`）：回放用「路径」模式（截止于未选分支的分支点），时序图用「全貌」模式（未选分支标 `unchosen`，截止之后标 `unreached`）；两者共用同一套落点与合并规则，分支点与空分支都会断开合并，所以路径上的消息在两边一一对应。

同一模块回答的查询：

| 函数 | 做什么 | 规则 |
|---|---|---|
| `stepAfter` / `stepBefore` | 本层下一条 / 上一条可见消息覆盖的第一帧；进度在本层不可见时按路径顺序找前后 | R7 |
| `landing` | 指向某帧时进度的落点：该帧所在可见消息的第一帧；本层不可见时就是它自己 | R13 |
| `currentMessage` / `walkedCount` | 进度所在的可见消息；从头播放到进度为止走过的消息数 | R11、R13 |
| `scenarioHome` | 场景所在层次：所有帧端点的最近公共祖先；公共祖先本身是端点时取其父模块 | S9 |
| `stageEnds` | 舞台需要的端点对（计划中的全部帧） | P12 |

## 5. 参与查询（`participation`、`scenarioModules`）

回答「某个模块 / 关系 / 视图边 / 参与者在本场景中做了什么」（V6）：按路径顺序列出它参与的帧（模块含其子树，视图边含其聚合的关系，关系含推断绑定的帧）、在本层投影下收发的可见消息、用到的接口与数据结构，以及离进度最近的一帧。脱离工作台同样成立，例如问 AI「Layout 在打开场景这个流程里做了什么」用的是同一个查询。

`scenarioModules` 回答「哪些模块参与了这个场景」：计划中全部帧（含所有分支）的模块端点及其祖先（T5）。与层次、进度无关。

## 6. 步骤大纲（`outlineScenario`）

把回放计划按组合结构还原成一棵树（T6），供导航树的步骤树逐行画出；与层次无关，只随计划与已选分支变化。

- 帧按外到内的组合框标签分组：连续带同一个 `loop` / `ref` 实例、同一个 `par` 分支的帧归入同一个分组节点。
- 分支点成为 `alt` 节点，下挂全部选项；每个选项带条件、选项序号和状态，空选项没有子节点。
- 状态与时序图全貌一致（`linearize` 的「全貌」模式）：路径上为 `path`，未选的选项为 `unchosen`，截止处之后为 `unreached`。
- 「已走过 / 当前 / 本层序号」依赖进度与层次，不在大纲里，由导航树用 `ScenarioLevelView`（`messageOf`、`currentMessage`、`walkedCount`）现算。

## 7. 时序模型与时序图排布

**时序模型**（`buildSequence`）：由计划全貌在本层的投影产出参与者（泳道互不包含，P14；分层总览中有核心模块的层，其层泳道名为「<层名> · 其他」，归入该层分组、排在核心模块之后，P13；带名称、父模块、模块路径、所属层与层次排序键 `hierarchyKey`；本层子模块标为可按横坐标排，P9、P13）、消息（同步 / 异步 / 显式返回 / 内部活动 / 空分支占位；隐含的返回不画，S10a；路径上的消息带 `pathIndex`，其余带 `unchosen` / `unreached` 状态）、组合框（类型、条件、包住的消息区间；`alt` 列出全部分支及其选项序号，并标明已选 / 未选 / 未到达，界面据此直选分支，F6e）。框内消息全部是内部活动时，框标记为折叠（P6）。

**对象所在的泳道**（`lanesOf(index, sequence, levelId, id)`，R15、R16）：模块、参与者在本张时序图中对应哪些泳道——参与者为它自己的泳道；模块是当前层次本身或其祖先时没有；否则为它包含的泳道（泳道模块是它自身或其后代），没有时为包含它的最深泳道。视图状态层的选中突出据此突出泳道；同一查询也能回答「这个模块在这一层的时序图里是哪一列」。

**时序图排布**（`layoutSequence`，视图状态层 Layout，同步计算、不调用 elk）：

- 外部参与者泳道在最左，与系统内泳道之间画分隔线（A7）。
- 其余泳道按层次顺序（P9）：逐项比较参与者的排序键；两者只在最后一级不同且都是本层的非层子模块时，改按结构图中对应节点的横坐标比较，同一父模块内两张图左右一致；没有结构图坐标时按排序键。
- 分组（P13）：排序后父模块相同的连续泳道成一组，分组框画在泳道头上方，标父模块名；参与者不分组。
- 泳道宽度按名称自适应；消息纵向累加；组合框包住其子消息，按嵌套深度内缩。
- 结果按「层次 + 场景 + 路径」缓存。

## 8. 数据结构

```ts
interface ScenarioPlan { scenarioId: string; nodes: PlanNode[]; frames: Map<string, Frame>; points: Map<string, BranchPoint> }
type PlanNode =
  | { kind: 'frame'; frame: Frame }
  | { kind: 'branch'; point: BranchPoint; options: PlanNode[][] }
interface BranchPoint { id: string; fragments: FragmentTag[]; options: { when: string; first?: Frame }[] }
interface FragmentTag { kind: 'alt' | 'loop' | 'par' | 'ref'; id: string; label: string; branch?: number }  // id：组合框实例

interface Frame {
  id: string
  kind: 'call' | 'async' | 'return'
  from: string; to: string                 // 真实端点：最深模块或参与者
  label?: string; interface?: string; payload: string[]; note?: string
  inherited?: { interface?: boolean; payload?: boolean }   // S14：取自对应关系
  relation?: string; relationInferred: boolean; reverse: boolean
  scenarioId: string; stepPath: string; src: SourceLoc   // 步骤写在哪个场景（ref 内联时为被引用者）
  fragments: FragmentTag[]                 // 外到内
}

type Lanes = { from: string; to: string }   // 分层总览中时序图上的两条泳道（P7、P14）
type Landing =
  | { kind: 'edge'; edgeId: string; from: string; to: string; reverse: boolean; core?: boolean; lanes?: Lanes }
  | { kind: 'upper'; from: string; to: string; relationId: string; lanes?: Lanes }   // P15：经由上层关系
  | { kind: 'unmodeled'; from: string; to: string; lanes?: Lanes }                       // P11：结构中未建模
  | { kind: 'internal'; node: string; lanes?: Lanes }   // lanes：分层总览中同一层不同泳道之间（P7）
  | { kind: 'hidden' }

interface ScenarioLevelView {
  levelId: string
  messages: { index: number; frameIds: string[]; at: Exclude<Landing, { kind: 'hidden' }>; kind: 'call' | 'async' | 'return' | 'internal' }[]
  hidden: string[]                         // 本层不可见的帧
  order: Map<string, number>               // 路径上帧的先后
  messageOf: Map<string, number>           // 帧 → 可见消息序号
}

interface Participation {
  frames: { frameId: string; seq: number; role: 'from' | 'to' | 'internal' | 'traverse' }[]
  messages: number[]                       // 本层可见消息序号
  interfaces: string[]; dataStructures: string[]
  nearest?: string
}

type OutlineNode =
  | { kind: 'frame'; frame: Frame; status: 'path' | 'unchosen' | 'unreached' }
  | { kind: 'group'; tag: FragmentTag; children: OutlineNode[] }                 // loop · par 的一个分支 · ref
  | { kind: 'alt'; pointId: string; options: { option: number; when: string; status: 'path' | 'unchosen' | 'unreached'; children: OutlineNode[] }[] }

type ReturnPairs = Map<string, string>   // 帧 ID ↔ 配对帧 ID（双向）

interface RouteItem { pointId: string; when: string[]; chosen: number | null }   // chosen 为 null：截止处待选

interface SequenceModel {
  participants: { nodeId: string; id: string; name: string; kind: 'module' | 'boundary' | 'actor';
                  parentId?: string; path: string[]; layer?: string; key: number[]; byX: boolean }[]   // path：根下到自身的模块 ID
  messages: { index: number; from: string; to: string; kind: 'call' | 'async' | 'return' | 'internal' | 'empty'; label: string;
              frameIds: string[]; status: 'path' | 'unchosen' | 'unreached'; pathIndex?: number;
              temp?: 'upper' | 'unmodeled'; relationId?: string }[]   // 本层没有视图边：经由上层关系（P15）/ 结构中未建模（P11）
  fragments: { id: string; kind: 'alt' | 'loop' | 'par' | 'ref'; label: string; depth: number; first: number; last: number;
               collapsed: boolean; branches?: { option: number; label: string; chosen: boolean | null; first: number; last: number }[] }[]
}

interface PositionedSequence {
  model: SequenceModel
  lanes: Map<string, { x: number; w: number }>   // 按从左到右的顺序
  groups: { parentId: string; x: number; w: number }[]  // P13
  boundaryX?: number
  messages: { y: number }[]
  fragments: { x: number; y: number; w: number; h: number; branchY: number[] }[]
  size: { w: number; h: number }
}
```

## 9. 接口

```ts
planScenario(index: ModelIndex, scenarioId: string): ScenarioPlan
bindRelation(index: ModelIndex, msg: { kind; from; to; relation? }): { relation?: string; inferred: boolean; reverse: boolean; issue?: 'mismatch' | 'not-runtime' | 'unrelated' }
resolvePath(plan, choices): { frames: Frame[]; pending?: BranchPoint; points: BranchPoint[] }
chooseBranch(plan, choices, pointId: string, option: number): Map<string, number>
choicesForBranch(plan, choices, pointId: string, option: number): Map<string, number> | null
pointPrefix(plan, choices, pointId: string): Frame[]
routeOf(plan, choices): RouteItem[]
pairReturns(plan: ScenarioPlan): ReturnPairs
choicesFor(plan, choices, frameId: string): Map<string, number> | null
choiceList(plan, choices): number[]            choicesFromList(plan, list: number[]): Map<string, number>
landFrame(index, view: LevelView, frame: Frame): Landing
projectScenario(index: ModelIndex, view: LevelView, plan: ScenarioPlan, choices): ScenarioLevelView
stepAfter(view: ScenarioLevelView, frameId: string | null): string | null
stepBefore(view: ScenarioLevelView, frameId: string | null): string | null
landing(view: ScenarioLevelView, frameId: string): string
currentMessage(view, frameId): number | null      walkedCount(view, frameId): number
scenarioHome(index: ModelIndex, plan: ScenarioPlan): string
stageEnds(plan: ScenarioPlan): { from: string; to: string }[]
participation(index, frames: Frame[], view: ScenarioLevelView, target: { kind: 'module' | 'relation' | 'edge' | 'actor'; id: string }, playhead?): Participation
scenarioModules(index: ModelIndex, plan: ScenarioPlan): Set<string>
outlineScenario(plan: ScenarioPlan, choices): OutlineNode[]
buildSequence(index, view: LevelView, plan: ScenarioPlan, choices, pathView: ScenarioLevelView): SequenceModel
layoutSequence(model: SequenceModel, structure?: PositionedView): PositionedSequence
```
