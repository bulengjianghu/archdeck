# 专题：视图状态与协调

> 回答：用户此刻在看什么；一次操作怎么改变它；它怎么与路由、计时器、描述文件、布局保持一致。
> 覆盖模块：视图状态层的 DeskState（协调者）与视图状态转移（会话规则）。原则见 [03-architecture.md](../03-architecture.md) 原则 6、7；规则见 [02-domain.md](../02-domain.md) 的 V、N、R、F6a、F6c、E3、E4。
> 现状：一期 DeskState 直接修改状态、导航规则写在其内部（N1–N11、N13 已实现）。本专题描述目标结构，重构时行为不变、一期测试作为回归（「待重构」）。

## 1. 视图状态

视图状态是**一个值**：层次、选中、开关、回放互相约束，不拆成多个 store。

```ts
interface ViewState {
  levelId: string
  selection: Selection | null        // { kind: 'module' | 'relation' | 'edge' | 'actor'; id }
  hover: string | null
  toggles: Toggles                   // showBoundaries · currentOnly · relationTypes · showDiff · compareTo
  playback: PlaybackState | null     // null = 结构视角
}

interface PlaybackState {
  scenarioId: string
  frameId: string | null             // 播放头；null = 尚未开始
  choices: Map<string, number>       // 分支点 → 已选选项
  playing: boolean
  speed: 0.5 | 1 | 2
}
```

视角与焦点由状态推出，不另存字段（V1、V2）：

```text
视角 = playback 为 null ? 结构 : 运行
焦点 = 结构视角：selection ?? 当前父模块
       运行视角：selection ≠ null ? 钉住(selection) : 跟随(frameId)
不变式：playback?.playing ⇒ selection = null      （每次转移后断言）
```

## 2. 协调者：DeskState

每个项目的每个版本一份，在项目视图组件中创建并注入，生命周期随组件。

| 职责 | 内容 |
|---|---|
| 持有 | `ViewState`（`shallowRef`）、加载后的模型索引与问题、设计信息与对比基线索引 |
| 唯一写入口 | `dispatch(action)`：`transition(state, action, ctx)` 得到新状态与历史标注，写入；对外的操作都是构造动作并 dispatch 的包装 |
| 派生（`computed`，调用纯函数） | 层次视图 `projectLevel`；打开场景时：回放计划 → 回放路径 → 本层帧投影与可见消息 → 时序模型 → 时序图坐标；钉住对象的参与信息；设计版本的差异 `diffModels` 与基线漂移 |
| 外界同步 | 交给四个同步适配器（§4） |

派生是一条 computed 链：层次或开关变化 → 层次视图 → 帧投影 → 时序模型 → 时序布局。结构图与时序图因此不会不同步。

## 3. 会话规则：视图状态转移

`transition(state, action, ctx) → { state, history: 'push' | 'replace' }`，纯函数，不依赖 Vue、路由、计时器；非法动作返回原状态；任何输出都满足焦点不变式。上下文 `ctx` 提供索引、本层视图、回放计划与本层帧投影。

| 子模块 | 规则 | 遇到关于被描述系统的问题时调用 |
|---|---|---|
| 视角与焦点 | V1–V4：进入 / 退出运行视角；指向即暂停并钉住；取消选中回到跟随；只有播放能恢复播放 | — |
| 导航 | N1–N13：下钻、跳转、返回上级、选中、定位、Esc / Backspace、重新加载与切换版本后的回退 | `nearestExisting`（N5、N11）、`nearestVisibleLevel`（N12）、`lowestCommonAncestor`（N3） |
| 回放 | R1、R5、R6、R10、R12、R13、F6a：打开场景、单步、指向、到分支点 / 末尾暂停、选分支、播放 / 暂停 / 速度 | `stepAfter` / `stepBefore`（R7）、`landing`、`choicesFor`（R13）、`chooseBranch`（F6b）、`resolvePath`（F6） |
| URL 编解码 | N6、N10、F6c、R10：状态 ↔ 查询参数；解码时丢弃无效值，恢复到最接近的合法状态 | — |

| 查询参数 | 含义 | 进历史 |
|---|---|---|
| `level` | 当前层次（根层省略） | 下钻、跳转：是 |
| `sel` | 选中，`m:` / `r:` / `e:` / `a:` 前缀 | 否 |
| `sc` | 场景（有即运行视角） | 打开场景：是 |
| `step` | 播放头帧 ID | 否 |
| `alt` | 已选分支，按分支点有序编码 | 否 |

## 4. 同步适配器

外界始终是状态的投影；外界的变化转成动作交给 `dispatch`。每个适配器都可用假对象单测。

| 适配器 | 状态 → 外界 | 外界 → 动作 |
|---|---|---|
| 路由同步 | 地址 = `encode(state)`，按历史标注 push / replace | 后退、前进、改地址、打开分享链接 → `decode` → `restore` |
| 时钟同步（待实现） | `playing` 为真时计时器按速度运行 | 到点 → `next` |
| 模型源同步 | — | 取描述文件 → `loaded`；本项目 `arch-model:changed` → 重新取 → `reloaded` |
| 布局同步 | 层次视图变化 → 调用 `layoutView` | 布局完成 → 回填定位结果（序号过期则丢弃） |

**路由回声**：路由导航是异步的。自己发起的导航完成前，路由变化一律视为回声、不回写状态；否则双击（两次选中 + 一次下钻）时旧地址会覆盖新层次。离开本项目或本版本的路由时也不回写。

## 5. 关键时序

### 5.1 打开项目或版本

```mermaid
sequenceDiagram
    participant U as 架构师
    participant DS as DeskState
    participant MS as 模型源同步
    participant M as 模型层
    participant RS as 路由同步
    participant LS as 布局同步

    U->>DS: 打开 /p/<项目>[/d/<设计>/<轮次>]?level=&sel=
    DS->>MS: 取描述
    MS->>M: loadModel（设计版本另加载对比基线）
    MS->>DS: dispatch(loaded)
    RS->>DS: dispatch(restore(URL))
    DS->>DS: 派生层次视图（设计版本另派生差异）
    LS->>DS: 布局完成，回填
    DS-->>U: 画出本层；面板显示焦点
```

### 5.2 下钻、选中、定位

- **双击下钻**：`dispatch(drill X)` → N1 判定可下钻 → 层次 = X、清空选中（N2）→ 进历史（N10）→ 派生、布局（命中缓存则立即返回）→ 画布适应。
- **单击选中**：`dispatch(select)`，不重新投影、不重新布局，只替换地址。
- **定位关系**（聚合边面板中点原始关系）：`dispatch(revealRelation r)` → 层次 = 两端的最近公共祖先 → 选中 r（N3）。

### 5.3 描述变化或切换版本

AI 改写描述 → ModelSource 推送 → 模型源同步重新取并 `dispatch(reloaded)` → 导航规则保留层次与选中，失效时退到最近仍存在的祖先（N5）→ 重新派生；有错误时问题提示列出。切换版本时路由带上当前 `level` / `sel`，新版本按同样规则恢复（N11）。

### 5.4 运行视角（待实现）

**指向某一步（R13）**——时序图消息、结构图步骤序号、步骤目录、运行信息里的步骤都走这一条：

```mermaid
sequenceDiagram
    participant U as 架构师
    participant UI as 时序图 / 画布 / 面板
    participant DS as DeskState
    participant T as 视图状态转移
    participant M as 场景投影（模型层）
    participant RS as 路由同步

    U->>UI: 单击第 7 步
    UI->>DS: dispatch(seek 7)
    DS->>T: transition(state, seek, ctx)
    T->>M: choicesFor(计划, 已选分支, 7) · landing(本层投影, 7)
    M-->>T: 所需分支选择 · 落点帧
    T-->>DS: frameId、choices；playing = false；selection = null
    DS->>DS: 派生：回放路径 → 本层可见消息 → 时序模型
    DS-->>UI: 两图定位到第 7 步，已走过的边 = 从头播放到第 7 步
    RS->>RS: 地址 = encode(新状态)，替换
```

- **播放中双击下钻**（V3、R6、R7）：`drill` 在运行视角下同时暂停并钉住；层次视图变化 → 帧重新投影，本层可见消息变细；`frameId` 不变，两图停在同一帧。
- **到达分支点**（F6、F6a）：时钟到点 `dispatch(next)` → `stepAfter` 无下一条且 `resolvePath` 报告未选分支 → `playing = false` → 回放控制条展开全部选项 → `dispatch(chooseBranch)` → 路径延长，用户点播放继续。
- **取消选中**（V4）：Esc 或单击空白 → `selection = null`，焦点回到跟随，保持暂停。

## 6. 动作与接口

```ts
type ViewAction =
  | { type: 'loaded' | 'reloaded' } | { type: 'restore'; query: Record<string, string> }
  | { type: 'drill'; id } | { type: 'goTo'; id; select? } | { type: 'goUp' }
  | { type: 'select'; selection } | { type: 'revealRelation'; id } | { type: 'revealModule'; id }
  | { type: 'hover'; id } | { type: 'toggle'; patch: Partial<Toggles> }
  | { type: 'openScenario'; id } | { type: 'closeScenario' }
  | { type: 'next' } | { type: 'prev' } | { type: 'seek'; frameId }
  | { type: 'play' } | { type: 'pause' } | { type: 'speed'; value }
  | { type: 'chooseBranch'; pointId; option }

createDeskState(fetchModel: () => Promise<ModelPayload>, options?: { project?: string; version?: VersionRef }): DeskState
// DeskState：state（只读）、index、issues、派生数据、dispatch、init()、attachRouter(router)，以及操作：
//   drillInto · goTo · goUp · select · revealRelation · revealModule · setHover
//   openScenario · closeScenario · next · prev · seek · play · pause · setSpeed · chooseBranch   （待实现）

transition(state: ViewState, action: ViewAction, ctx: TransitionContext): { state: ViewState; history: 'push' | 'replace' }
encodeView(state: ViewState, index: ModelIndex): Record<string, string>
decodeView(query: Record<string, string>, index: ModelIndex): ViewAction
```
