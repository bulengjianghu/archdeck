# 专题：场景投影与回放（待实现）

> 回答：一个场景在某一层怎么走；单步、跳转、分支选择怎么算；时序图的内容与坐标从哪来。
> 覆盖模块：模型层的场景投影（回放计划、回放路径、帧的层次投影、参与查询、时序模型）；视图状态层 Layout 的时序图排布。概念见 [02-domain.md §1.3](../02-domain.md#13-场景与回放待实现)，规则见 S、F、P、R7、R13、V6；回放的会话规则（何时暂停、焦点）见[视图状态与协调](./view-state.md)，画法见[工作台界面](./workbench.md)。

## 1. 流水线

```text
场景描述（步骤树）
  │ planScenario：展开 + 绑定关系                         与层次无关，打开场景时算一次
  ▼
回放计划（帧树，alt 处分叉）
  │ resolvePath(计划, 已选分支)                           已选分支变化时重算
  ▼
回放路径（线性帧序列，可能截止于未选分支的分支点）
  │ projectScenario(索引, 本层视图, 路径)                 层次或路径变化时重算
  ▼
本层帧投影：每帧的落点 + 合并出的可见消息 + 场景所在层次
  ├─ buildSequence ──▶ 时序模型 ──layoutSequence──▶ 时序图坐标
  └─ participation(对象) ──▶ 运行信息
```

全部是纯函数，结果交给视图状态层派生（见[视图状态与协调 §2](./view-state.md#2-协调者deskstate)）。

## 2. 回放计划（`planScenario`）

- **展开**：消息步骤成为帧（F1）；`ref` 内联子场景并记为 ref 组合框（F3）；`loop` 展开一遍并标注条件（F4）；`par` 各分支按书写顺序串行并标注并行（F5）；`alt` 成为分支点，每个选项一棵子树（F6）。每帧记录外到内的组合框路径。
- **帧 ID**（F2）：场景 ID + 步骤 `id`，没写时用步骤在树中的路径（如 `sc.open#4.alt0.1`）；`ref` 内联时加上引用处前缀，同一子场景被引用两次也不冲突。校验已保证 `ref` 无环（S6），展开必然终止。
- **绑定关系** `bindRelation`（S12、S13）：显式引用优先；否则两端之间恰好一条运行时关系即认定，并标为推断；`event` 关系按反向比对；同时给出消息方向是否与关系方向相反。Validator 调用同一个函数做 S5a 检查，校验与回放结果一致。

## 3. 回放路径（`resolvePath` 等）

| 函数 | 做什么 | 规则 |
|---|---|---|
| `resolvePath(plan, choices)` | 按已选分支走出线性帧序列；遇到未选分支的分支点即截止，并报告该分支点（`pending`）；无效的选择被忽略 | F6 |
| `chooseBranch(plan, choices, point, option)` | 在某个分支点选择或改选；改选会丢弃该分支点之后的选择 | F6b |
| `choicesFor(plan, choices, frameId)` | 到达某一帧需要的分支选择，尽量保留现有选择 | R13 |

## 4. 帧的层次投影（`projectScenario` 等）

对路径上的每一帧，用 Projector 的 `mapEndpoint` 把两端映射到当前层次（P1），得出落点：

| 映射结果 | 落点 | 规则 |
|---|---|---|
| 两个不同节点，且本层有连接它们的视图边 | `edge`：该视图边的 ID（`edgeId` 规则），并标记方向是否与边相反 | P1、P2、P7、P10 |
| 两个不同节点，但本层没有视图边 | `unmodeled`：回放期间画临时虚线 | P11 |
| 同一个子模块 | `internal`：内部活动 | P3 |
| 两端都在本层外 | 不可见 | P4 |

然后把连续落在同一条视图边、或同一节点内部的帧合并为**可见消息**（P5），它是本层的单步单位。依赖 `projectLevel` 的输出，保证落点的视图边一定存在于本层视图中。

同一模块回答的查询：

| 函数 | 做什么 | 规则 |
|---|---|---|
| `stepAfter` / `stepBefore` | 本层下一条 / 上一条可见消息覆盖的第一帧 | R7 |
| `landing` | 指向某帧时播放头的落点：该帧所在可见消息的第一帧 | R13 |
| `scenarioHome` | 场景所在层次：所有帧端点的最近公共祖先 | S9 |

## 5. 参与查询（`participation`）

回答「某个模块 / 关系 / 视图边 / 参与者在本场景中做了什么」（V6）：按路径顺序列出它参与的帧（模块含其子树，视图边含其聚合的关系，关系含推断绑定的帧）、在本层投影下收发的可见消息、用到的接口与数据结构，以及离播放头最近的一帧。脱离工作台同样成立，例如问 AI「Layout 在打开场景这个流程里做了什么」用的是同一个查询。

## 6. 时序模型与时序图排布

**时序模型**（`buildSequence`）：由本层可见消息产出参与者、消息（同步 / 异步 / 显式返回 / 内部活动；隐含的返回不画，S10a）、组合框（类型、条件、包住的消息区间；`alt` 列出全部分支，并标明已选 / 未选 / 未到达）。框内消息全部合并为内部活动时，框标记为折叠（P6）。

**时序图排布**（`layoutSequence`，视图状态层 Layout，同步计算、不调用 elk）：

- 外部参与者泳道在最左，与系统内泳道之间画分隔线（A7）；其余泳道按结构图中对应节点的横坐标排序，使两张图左右关系一致（P9）。
- 泳道宽度按名称自适应；消息纵向累加；组合框包住其子消息，按嵌套深度内缩。
- 结果按「层次 + 场景 + 路径」缓存。

## 7. 数据结构

```ts
interface ScenarioPlan { scenarioId: string; nodes: PlanNode[] }
type PlanNode =
  | { kind: 'frame'; frame: Frame }
  | { kind: 'branch'; point: BranchPoint; options: PlanNode[][] }
interface BranchPoint { id: string; options: { when: string; first?: Frame }[] }

interface Frame {
  id: string
  kind: 'call' | 'async' | 'return'
  from: string; to: string                 // 真实端点：最深模块或参与者
  label?: string; interface?: string; payload: string[]
  relation?: string; relationInferred: boolean
  fragments: { kind: 'alt' | 'loop' | 'par' | 'ref'; label: string; branch?: number }[]  // 外到内
}

interface ScenarioLevelView {
  levelId: string
  messages: {                              // 本层可见消息
    frameIds: string[]
    at:
      | { kind: 'edge'; edgeId: string; from: string; to: string; reverse: boolean }
      | { kind: 'unmodeled'; from: string; to: string }
      | { kind: 'internal'; node: string }
  }[]
  hidden: string[]                         // 本层不可见的帧
  home: string                             // 场景所在层次
}

interface Participation {
  frames: { frameId: string; role: 'from' | 'to' | 'internal' | 'traverse' }[]
  messages: number[]                       // 本层可见消息序号
  interfaces: string[]; dataStructures: string[]
  nearest?: string
}

interface SequenceModel {
  participants: { nodeId: string; id: string; kind: 'module' | 'boundary' | 'actor' }[]
  messages: { index: number; from: string; to: string; kind: 'call' | 'async' | 'return' | 'internal'; label: string }[]
  fragments: { kind: 'alt' | 'loop' | 'par' | 'ref'; label: string; depth: number; first: number; last: number;
               collapsed: boolean; branches?: { when: string; chosen: boolean | null }[] }[]
}

interface PositionedSequence {
  model: SequenceModel
  lanes: Map<string, { x: number; w: number }>
  boundaryX?: number
  messages: { y: number }[]
  fragments: { x: number; y: number; w: number; h: number }[]
  size: { w: number; h: number }
}
```

## 8. 接口

```ts
planScenario(index: ModelIndex, scenarioId: string): ScenarioPlan
bindRelation(index: ModelIndex, msg: Message): { relation?: string; inferred: boolean; reverse: boolean }
resolvePath(plan, choices): { frames: Frame[]; pending?: BranchPoint }
chooseBranch(plan, choices, pointId: string, option: number): Map<string, number>
choicesFor(plan, choices, frameId: string): Map<string, number> | null
projectScenario(index: ModelIndex, view: LevelView, frames: Frame[]): ScenarioLevelView
stepAfter(view: ScenarioLevelView, frameId: string | null): string | null
stepBefore(view: ScenarioLevelView, frameId: string): string | null
landing(view: ScenarioLevelView, frameId: string): string
scenarioHome(index: ModelIndex, plan: ScenarioPlan): string
participation(index, frames, view, target: { kind: 'module' | 'relation' | 'edge' | 'actor'; id: string }): Participation
buildSequence(view: ScenarioLevelView, frames: Frame[], levelView: LevelView): SequenceModel
layoutSequence(model: SequenceModel, structure?: PositionedView): PositionedSequence
```
