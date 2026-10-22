# h5p-arch-desk 描述格式与生成规范

> 本文回答**描述文件怎么组织、怎么写**，供人和 AI（按代码生成当前版本、起草设计版本）遵守。
> 格式以 `schema/arch-file.schema.json` 为准；字段与规则的含义以 [02-domain.md](./02-domain.md) 为准，本文只给写法与约定。

## 1. 目录与分工

模型根目录（默认 `model/`，可用 `ARCH_MODEL_ROOT` 覆盖）下每个含 `system.yaml` 的子目录是一个项目（ADR-0001）：

```text
model/<项目>/
  system.yaml              系统根 + 生成来源 source { repo, commit, generatedAt, history }；repo 也决定源码根目录（§3.7），history 为 git 历史的窗口与缺陷匹配（§3.7）
  intent/
    skeleton.yaml          骨架：全部层 + 第二级模块（人拥有的持久草图，ID 固定，见 §3.1、§3.10）
    <ID>.yaml              其他持久草图：核心模块的持久设计（§3.10）
  modules/
    <区域>.yaml            各区域的子树：第二级模块之下的模块、本区域的关系、接口、数据结构（AI 按代码生成）
  actors.yaml              外部参与者及其入口关系
  scenarios/<场景>.yaml    一个场景一个文件，也可用 .json
  source-ignore.yaml       忽略清单 sourceIgnore：不属于任何模块的源码文件（§3.7）
  rules.yaml               架构规则 rules：架构师的意图，AI 重新生成时不改动（§3.8）
  reviewed.yaml            确认记录 reviewed：架构师确认过哪些模块、确认时的指纹与摘要，AI 重新生成时不改动（§3.9）
  designs/<设计>/          设计版本（§5）：sketch.yaml（架构师的草图）+ design.yaml + r<N>/（AI 展开的各轮，每轮的说明在 r<N>/revision.yaml），读取当前版本时跳过
  governance/              基线 baseline.json、拦截记录 ledger.jsonl、人拥有文件的指纹 owned.json，由命令行与 agent 接口写，不属于描述，读取时跳过（§4）
```

**谁拥有哪个文件**（B1、B6、X6，ADR-0019、ADR-0023）：

| 拥有者 | 文件 | 页面 | 指纹 |
|---|---|---|---|
| AI（按代码生成） | `system.yaml`、`modules/`（骨架之下）、`actors.yaml`、`scenarios/`；设计版本各轮快照 `designs/<设计>/r<N>/`，含该轮说明 `revision.yaml`（E8） | 只读 | — |
| 人（架构师、负责人） | 草图：`intent/*.yaml`（骨架等持久草图）、`designs/<设计>/sketch.yaml`；`rules.yaml`（AI 重新生成时不改动，§3.8）；`source-ignore.yaml`（忽略项）；`designs/<设计>/design.yaml`（目标、状态、基线、ADR、认可偏差 `accepted`、评审意见 `revisions[].feedback`——不含每轮说明，E8）；`reviewed.yaml`（确认记录，§3.9） | 只追加：例外、忽略项、评审意见（该轮没有条目时新建，B2）、认可偏差；确认记录追加或按模块更新（Z1）；归档 / 晋升改设计状态、晋升时整份替换持久草图；草图在画布编辑后整份覆盖、新建设计（B6、X7）；其余由人编辑 | 记在 `governance/owned.json`：人改完后 `npm run arch -- own` 登记，页面写入自动更新，`lint:model` 不符即报错 `owned.changed` |
| 命令行与 agent 接口 | `governance/` | 只读 | — |

- 骨架只描述层和第二级模块；AI 只能用 `parent: <第二级 ID>` 往骨架之下挂子模块，对骨架里的模块只能补草图没写的字段，不得重定义已写的字段（X1，`lint:model` 报 `sketch-redefined`）。没有 `intent/skeleton.yaml` 的旧描述仍可把层写在 `modules/layers.yaml`（兼容期）。
- 一个区域文件对应一位生成者负责的范围，互不改写，便于并行生成和局部重新生成。

## 2. 文件格式

一个文件的顶层键都可选、可任意组合：`system`、`module`（单个模块，可带 `parent`）、`modules`、`relations`、`interfaces`、`dataStructures`、`actors`、`scenario` / `scenarios`、`sourceIgnore`、`sourceLimits`、`rules`、`reviewed`（确认记录，§3.9）、`sketch`（草图，只在 `intent/` 与 `designs/<设计>/sketch.yaml` 里用，§3.10）。未知字段即格式错误，整份文件被跳过（M1）。

```yaml
# modules/infra.yaml —— 模块子树 + 本区域的关系
module:
  id: infra.framework
  parent: infra
  name: Framework 机制内核
  kind: subsystem
  responsibility: |
    提供状态机、Pipeline、插件生命周期、事件 / 错误路由等通用机制；不包含方案选择规则和播放策略。
  codeRefs: [packages/framework/src/**]
  docRefs: [docs/design/0-kernel/state-machine.md]
  children:
    - id: infra.framework.pipeline
      name: Pipeline
      kind: component
      responsibility: 维护 Load / Process / Play 三段 MU 图，以事务方式提交图变更。
      provides: [if.framework.pipeline.updatePipeline]
      dataStructures: [ds.PipelineTransaction]

relations:
  - id: rel.infra.sm-hook
    from: infra.framework.state-machine
    to: app.solution
    type: calls
    interface: if.solution.hooks
    description: 命令执行前后回调 Solution 的 pre / post hook。

interfaces:
  - id: if.framework.pipeline.updatePipeline
    name: updatePipeline
    owner: infra.framework.pipeline
    signature: |
      updatePipeline(tx: PipelineTransaction): Promise<Result<void, ErrorBase>>
    semantics: |
      - 原子提交：失败时图保持提交前状态
      - 新增节点按当前播放状态补齐生命周期

dataStructures:
  - id: ds.PipelineTransaction
    name: PipelineTransaction
    definition: |
      interface PipelineTransaction { add: MuNodeSpec[]; remove: MuId[]; rewire: EdgeSpec[] }
```

```yaml
# intent/skeleton.yaml —— 骨架：层（根层的分层总览靠这些字段）与第二级模块，人拥有的持久草图（§3.10）
sketch:
  id: skeleton
  lifetime: persistent
  closed: [domain, share]        # 这些层的直接子模块集合必须与这里相等（X2）
  modules:
    - id: domain
      name: Domain
      kind: layer
      order: 3
      abstraction: 规则与事实；纯决策，无 DOM / 网络
      includes: [纯决策, 领域类型与模型, 协议算法, 规则表, 领域端口]
      excludes: [DOM, 网络, Framework / Player 实现, 装配时序]
      mayDependOn: [share]
      responsibility: …
      children:
        - { id: domain.services, name: Services, core: true, responsibility: … }
        - { id: domain.events, name: Events, responsibility: … }     # 非核心，总览中折叠为 +N
```

```yaml
# actors.yaml
actors:
  - { id: actor.biz, name: 业务方, kind: system, description: 通过 SDK API 调用播放器 }
relations:
  - { id: rel.ctx.api, from: actor.biz, to: infra.player-index, type: calls, interface: if.player.api }

# scenarios/command.yaml
scenario:
  id: sc.command
  name: 命令执行（play / switch / reset）
  cause: 业务方调用 play / switch / reset
  steps:
    - call: { id: cmd, from: actor.biz, to: infra.player-index, label: play / switch / reset }
    - call: { from: infra.player-index, to: infra.framework.state-machine, interface: if.sm.sendCommand }
    - call: { from: infra.framework.state-machine, to: app.solution, label: pre / post hook }
    - alt:
        - when: 需要改图
          steps:
            - call: { id: update, from: app.solution, to: infra.framework.pipeline, interface: if.framework.pipeline.updatePipeline }
            - loop:
                while: 每个新增 MU
                steps:
                  - call: { from: infra.framework.pipeline, to: infra.mus, label: lifecycle catch-up }
        - when: 无需改图
          steps: []
    - async: { from: infra.framework.state-machine, to: actor.biz, label: command result / event }
```

场景写成 JSON 时结构相同，两者解析成同一份数据（S8）。

## 3. 生成规范

### 3.1 骨架

骨架由架构师决定：先按项目已有的分层文档确定层与第二级模块，写进 `intent/skeleton.yaml`（持久草图，第二级封闭，§3.10），ID 一经确定不再改；AI 重新生成当前版本时不得改动它，只在它之下挂子模块（X1、X5）。以 h5player 为例（第二级模块 ID 固定）：

| 层 | 第二级模块 | 代码落点（h5player 仓库根相对路径） |
|---|---|---|
| `infra` Infrastructure | `infra.player-index` 对外 API 与状态投影 | `packages/player/src/index.ts`、`externalStatusProjector.ts`、`modelAccess.ts`、`stats*.ts`、`types*` |
| | `infra.bootstrap` 组合根 | `packages/player/src/bootstrap/**` |
| | `infra.framework` 机制内核 | `packages/framework/src/**` |
| | `infra.mus` 媒体单元 | `packages/player/src/mus/{loader,demuxer,corrector,remuxer,decoder,buffer,render}/**`、`mus/muFactory.ts`、`mus/muPluginWrapper.ts` |
| | `infra.workers` Worker 基础设施 | `packages/player/src/mus/{workerTask,serviceWorker}/**` |
| | `infra.third-party` 三方库与外部媒体插件 | `packages/player/src/{thirdParty,mediaPlugins}/**` |
| `app` Application | `app.solution` 方案编排 | `packages/player/src/solution/**` |
| | `app.registry` 方案注册表与 Fragment 契约 | `packages/player/src/plugins/solution/{registry,fragments}/**` |
| | `app.factories` 三段工厂 | `packages/player/src/plugins/solution/factory/**` |
| | `app.strategies` 运行时驾驶策略 | `packages/player/src/plugins/solution/{strategy,vod}/**` |
| | `app.plugins` 横向用例插件 | `packages/player/src/plugins/*.ts`、`record/**`、`tracker/**` |
| | `app.timeshift` 时移 | `packages/player/src/plugins/timeshift/**` |
| `domain` Domain | `domain.types` 类型与事件 | `packages/domain/src/{types/**,events.ts,index.ts}` |
| | `domain.ports` 领域端口 | `packages/domain/src/ports.ts` |
| | `domain.models` 领域模型 | `packages/domain/src/models/**` |
| | `domain.services` 决策服务 | `packages/domain/src/services/**` |
| | `domain.algorithms` 协议算法 | `packages/domain/src/algorithms/**` |
| | `domain.rules` 规则表 | `packages/domain/src/rules/**` |
| `share` Share | `share.contracts` 跨层契约 | `packages/share/src/contracts/**` |
| | `share.errors` 错误原语 | `packages/share/src/errors/**` |
| | `share.utils` 通用原语 | `packages/share/src/utils/**` |

### 3.2 模块

- **粒度**：模块是一组内聚的职责，通常对应 1~10 个文件。第二级之下一般再分 1~2 级，只有内部确实还有清晰子结构时才继续分；一个父模块的子模块以 3~9 个为宜。
- **ID**：`<父 ID>.<短名>`，短名用 kebab-case。
- **职责**：一两句话说清负责什么，有明显的「不负责什么」就写上；不要复述文件名。
- **实现原理**：只给关键模块写，说清核心机制。
- **接口 / 数据结构**：只列对外有意义的（被其他模块调用或交换的）。
- **核心模块**：仅用于第二级模块，由骨架维护，每层 3~5 个，优先选被其他层依赖最多的。
- **status**：已落地写 `current`（可省略）；蓝图中有、代码中未落地写 `target`；计划移除写 `deprecated`。
- **codeRefs / docRefs**：相对源码根目录（§3.7）的路径或 glob（`*`、`**`、`?`、`{a,b}`；不带通配符的路径匹配同名文件或整个目录）、设计文档路径。
- **entry**：模块对外入口不符合约定（模块目录下的 `index.ts`，或其 `package.json` 的 `exports` / `main`）时才写，相对源码根目录（G10）。

### 3.3 接口与数据结构

- 接口 ID：`if.<模块短路径>.<方法或接口名>`；`owner` 填提供方模块。
- 数据结构 ID：`ds.<TS 类型名>`，由声明该 TS 类型的区域定义，其他区域直接引用同名 ID。
- `signature` / `definition` 用 TS 语法，可裁剪到关键成员（`// …` 表示省略），不超过约 25 行。
- `semantics` 写前置条件、副作用、错误、时序约束。

### 3.4 关系

运行时关系的箭头一律是**控制流方向**（谁发起），与场景消息同向；谁 import 谁是代码事实，不用箭头表达（02 §1.1、ADR-0022）。

| type | 何时用 | `from` → `to` |
|---|---|---|
| `depends` | 编译期知道对方：只引数据类型，或导入对方的函数、类来使用 | 依赖方 → 被依赖方 |
| `implements` | 实现对方声明的契约：导入它的接口，或类 `implements` / `extends` 它的类型；`to` 必须声明接口（M11） | 实现方 → 契约所在模块 |
| `calls` | **命令**：请求并期待结果（同步返回值、Promise、异步回调） | 发起方 → 接收方 |
| `notifies` | **通知**：不期待结果、可能一对多、发布者不知道谁在听（事件总线、emit、观察者回调） | 发布者 → 订阅者 |
| `streams` | **流**：同一通道上连续的数据项，关注吞吐与背压（帧、分片、样本流）；两端通常只知道端口、由第三方接线。拉取型（接收方按需取下一项）加 `pull: true`，箭头仍指数据去向 | 推送方 → 接收方 |

判别顺序：先问「要不要结果」——要 → `calls`；不要、且是零散的一次次发生 → `notifies`；不要、且是同一通道上连续的数据 → `streams`。旧名 `event`（箭头为订阅方 → 发布方）与 `dataflow` 已改名：旧名在加载时自动映射并提醒（M12），按提醒手工改；别名一轮后删除（`event` 改成 `notifies` 时同时对调 `from` / `to`，并核对说明里的方向字样）。

- ID：`rel.<区域>.<序号或短名>`，全局唯一。
- 端点写在能表达清楚的**最深模块**上，上层自动聚合；跨区域时对端只写对方的第二级模块 ID，不猜更深的 ID。
- 不连祖先与后代，不为「包含」建关系（M6）。
- 异步（Worker postMessage、通知、定时器回调）标 `mode: async`；有明确接口填 `interface`，有明确载荷填 `payload`。
- `via`（K5b）：只在两端之间**确实不可能有导入**时写——跨进程、经框架注入或路由、经组装者注入的回调；写了即不判定证实，`lint:model` 不再为它报 `fact.unconfirmed`。取值 `http` / `hmr` / `inject` / `router` / `callback` / `port`（经端口接线：两端只知道端口契约，由组装者接上，常见于 `streams`）。拿不准的不写，留给 `fact.unconfirmed` 提醒去核对。本项目的例子：

  | 关系 | `via` | 为什么导入证实不了 |
  |---|---|---|
  | `rel.ad.desk-fetch`、`rel.ad.list-fetch`、`rel.p7.desk-source-fetch`（页面 → ModelSource 插件） | `http` | 浏览器经 HTTP 请求开发服务器，两端不在一个进程 |
  | `rel.ad.desk-changed`、`rel.ad.list-changed`（页面订阅描述变化） | `hmr` | 开发服务器经 HMR 推送 `arch-model:changed` |
  | `rel.ad.version-shell`（版本切换 → 应用外壳） | `router` | 经 vue-router 导航，路由表在外壳里 |
  | `rel.p7.file-preview`（文件面板 → 项目视图） | `inject` | 经共用件的注入键 provide / inject |
  | `rel.ad.url-actions`（路由同步 → dispatch） | `callback` | 协调者把 `query => dispatch(…)` 回调交给路由同步 |

#### import 与 depends / implements

import 是**证据**，`depends` / `implements` 是**主张**。按代码里看到的选：

| 代码里看到的 | 写 | 说明 |
|---|---|---|
| 只导入对方的数据类型 | `depends` | 只引类型不算未描述（K7），写不写都可以；有接口语义时写 |
| 导入对方描述里声明的接口，或类 `implements` / `extends` 对方的类型 | `implements` | K5 只认这两种证据（已证实）；对方的接口要在描述里声明（`interfaces[].owner` 或 `provides`） |
| 结构性满足对方的契约，代码只引了对方的数据类型（TS 不要求写 implements 子句） | `implements` | 标「结构性实现（代码未显式声明）」，只提示（info），建议在类上加 implements <接口>；描述不用改 |
| 导入对方的函数、类并调用 | `depends`（编译期），运行时另写 `calls` 等 | 写成 `implements` 会报「证据像 depends」（`fact.like-depends`，warning） |

一个声明了接口的模块在面板上有「端口三角」（K11）：定义 · 实现者 · 使用者，用来检查契约是否有人实现、有人使用。

### 3.5 外部参与者

- 只为**主动发起交互**的外部实体建参与者（A3）：人、主动调用或推送的外部系统、时间。被动依赖（浏览器 API、CDN、三方库）继续用模块或 `codeRefs`。事件由谁发出就算谁的异步消息，不是一类参与者（A5）。
- ID：`actor.<短名>`；`kind`：`user` / `system` / `time`。
- 为每个参与者写**入口关系**，说明它从哪个模块进入系统；方向按 §3.4，`from` 是主动方。

### 3.6 场景

- 一个场景一个文件，ID `sc.<短名>`；写 `name`、`description`，有明确触发原因时写 `cause`。不写默认层次与触发者（S9、A6），第一条消息通常从参与者发出。
- **只写一套最细步骤**（S3）：消息端点写能表达清楚的最深模块或参与者（S4），不为不同层次各写一套；跨区域时对端仍只写第二级模块 ID。
- `call` 用于同步调用；事件发布、postMessage、定时器回调等不等待的用 `async`；`return` 只在返回值本身值得展示时显式写。
- **接口与数据**：步骤没写 `interface` / `payload` 时取对应关系的（S14，`return` 只取接口），所以关系上写全即可；步骤交换的数据与关系不同、或对应关系没写时，在步骤上写。接口签名每个操作一行、带参数类型，面板按步骤标签开头的调用名找到对应的一行。
- **对应关系**：只对应 `calls` / `notifies` / `streams`（S12），消息方向与关系箭头相同（`return` 相反）；两端之间只有一条同向的运行时关系时可不写 `relation`（S13），有多条时写明。关系写在消息端点的祖先上（如跨区域只写到第二级模块）也算对得上（S5a）。`lint:model` 提醒「结构图中没有对应关系」时，优先补结构关系。
- **组合步骤**：`alt` 每个分支写清 `when`；`loop` 写 `while`；`par` 只用于确实同时进行的流程；可复用的子流程拆成独立场景用 `ref` 引用，不得循环引用（S6）。
- **步骤 id**：分享链接会指向具体步骤，路径式 ID 在插入步骤后会变；关键步骤（`alt` 各分支的首步、常被讨论的步骤）写场景内唯一的 `id`（F2、S11）。
- **从 mermaid 迁移**（D-8）：参与者对照骨架的模块 ID；`alt` / `loop` / `par` 一一对应；系统外的 `participant` 改写为外部参与者。
- **证据**（S15）：验证这条链路的测试、E2E 等文件写在 `evidence`（路径相对源码根目录、以 `/` 分隔，与文件清单一致），如 `evidence: [tests/acceptance/run-perspective.test.ts, e2e/run-default.spec.ts]`；只写确实覆盖这条链路的文件，不写整个目录；`lint:model` 只检查文件存在（`scenario.evidence` 提醒），不解析内容，文件改名后同步。

### 3.7 源码归属

源码根目录 = 工作区根目录（默认 `work4/`）+ `system.source.repo`（G1），如 `repo: h5player` → `work4/h5player`，`repo: h5player-demo/packages/h5p-arch-desk` → 本包。`codeRefs` 与 `entry` 都相对这个目录书写。

- **每个源码文件都应恰好归属一个模块**：子模块写自己的文件，父模块可以写覆盖整个目录的 glob，祖先与后代同时匹配时归最深的模块（G5）；两个互不包含的模块不要写同一个文件（G6）。
- **概念子模块**：一个文件内有清晰的子结构、值得在图上分开讲时（如 Projector 文件内的分层总览、端点映射与边收集），子模块不写 `codeRefs`，挂在拥有该文件的模块下面；它与同一宿主内其他部分的关系照常写，`lint:model` 标「概念拆分，同文件」、不判定（K5a），不要为了能被证实而改写端点。
- **未归属的文件**：真正属于某个模块的，补到它的 `codeRefs`；不属于任何模块的（文档、测试、构建配置、示例），写进 `source-ignore.yaml`：

```yaml
# source-ignore.yaml —— 不属于任何模块的文件（G8），glob 写法同 codeRefs
sourceIgnore:
  - docs/**
  - tests/**
  - '*.md'
  - tsconfig*.json
```

- **git 历史**（J1、J4）：演化事实（热度与时间耦合）缺省统计近 180 天、缺陷修复按标题 `^(fix|hotfix|bugfix)\b` 或含「修复」判定、时间耦合阈值为同提交 ≥ 5 次且占两端 ≥ 30%。项目要改时写在 `system.yaml` 的 `source.history`，都可选：

```yaml
system:
  source:
    repo: h5player
    history:
      days: 365                              # 窗口天数，缺省 180
      fixPatterns: ['^(bug|hotfix)[:(]', '缺陷']   # 补充的缺陷匹配正则（不分大小写），与缺省规则取并集
      coupling: { min: 5, ratio: 0.3 }       # 时间耦合阈值：同提交次数、占两端修改次数的比例
```

- **超长阈值**（G20）：文件树把超过 `sourceLimits.maxLines` 行（缺省 500）的 TS / JS / Vue 文件标红；项目需要别的阈值时写在 `source-ignore.yaml`，只写一处：

```yaml
sourceLimits:
  maxLines: 400
```

- 页面只列出未归属文件，不提供忽略操作；按文件树与 `lint:model` 的列表逐条判断，能归纳成目录或通配符的合并成一条。
- `lint:model` 报出 `source.unowned` / `source.conflict` / `source.entry` 警告，生成后逐条处理。

### 3.8 架构规则

`rules.yaml` 写架构师的意图（U1–U5、Y3），**不由代码生成**：人直接写，或经设计版本评审定稿后写入。AI 按代码重新生成当前版本时不得改动它；代码与规则冲突时由门禁报出，不是去改规则（ADR-0015）。

```yaml
# rules.yaml
rules:
  layers: true                  # 层按骨架里的 mayDependOn 默认拒绝（U2），缺省 true
  modules:
    - module: infra.framework
      mayDependOn: [share, domain]                  # 子树之外只许依赖这些模块的子树（U3）
      exposes: [entry, packages/framework/src/common/**]   # 子树之外只许经这些文件访问；entry = 模块入口（U4）
      reason: Framework 是机制内核，只认契约，不认具体方案
  allow:                        # 例外（U5），reason 必填
    - { from: app.solution, to: infra.framework.pipeline, rule: exposes, reason: 事务提交暂走内部 API，见 issue #123 }
  cycles:
    tolerated: [domain.types]  # 环的全部成员都在这些子树内时容忍（Y3）
```

- 层规则写在骨架的 `mayDependOn` 上（§3.1），这里只能整体开关。
- 先写约束少而硬的规则（层、核心模块的白名单与访问面），再逐步收紧；存量违规用基线承接（§4），不用 `allow` 掩盖——`allow` 只给有理由、长期接受的例外。
- 设计版本可以修改 `rules`，随设计一起评审。

### 3.9 确认记录

`reviewed.yaml` 记架构师确认过的模块（Z1–Z6，ADR-0023），**不由代码生成、人不必手写**：页面上点「确认」或草图归档时写入。AI 按代码重新生成当前版本时不得改动它；被确认的内容变了由工具标「需复核」，不是去改记录。

```yaml
# reviewed.yaml
reviewed:
  - module: state.transition
    at: '2026-10-22'
    hash: 3f9a1c0e7b2d4a61           # 指纹：职责、包含 / 不包含、可依赖的层、接口签名、直接子模块（Z2）
    source: manual                   # manual 或 sketch:<设计 ID>（Z6）
    note: 确认只有转移函数能改状态     # 可选，架构师自己的话
    summary:                         # 确认时的摘要，需复核时据此显示差异（Z3）
      responsibility: 会话规则的纯函数……
      provides: [{ id: if.transition, signature: 'transition(state, action, ctx): { state, history }' }]
      children: [state.transition.navigation, state.transition.playback]
```

- 一个模块一条；再次确认时更新那一条（页面与 `appendReviewed` 都这样做），人手工编辑时也不要写两条。
- 记录引用的模块不存在时提醒「确认记录失效：模块 <ID> 已改名或删除，请在新模块上重新确认」并忽略；模块改了 ID 视同未确认，在新模块上重新确认即可。
- 确认只回答「AI 有没有动你看过的东西」；已确认的内容与代码是否一致由代码事实判断（K 组），面板「已确认」标记的提示也这样写。
- 设计版本的快照目录里不放 `reviewed.yaml`（只对当前版本，Z1）。
- 写入端点与 `appendReviewed` 只收 `hash` 等于当前描述指纹的记录（Z6）：页面停在旧描述上确认会被拒绝，刷新后重来。每次写入在 `governance/ledger.jsonl` 记一行（来源 `page` / `cli` / `archive`），`npm run arch -- report` 给出确认写入次数。

**诚实说明：确认不证明是人做的。** 本工具是本地单用户工具，写入端点只收同源请求（B5），但同一台机器上的进程（包括 agent）可以照页面的方式 POST，工具分不清人与 agent。防线是三件事：指纹门禁（`reviewed.yaml` 登记在 `owned.json`，绕过端点直接改文件即 `owned.changed`，X6）、拦截记录（每次确认写入可查来源与次数）、git 审计（`reviewed.yaml` 与 `ledger.jsonl` 都进提交，谁何时确认了什么看提交历史）。MCP 不提供确认写入；agent 不得调用确认端点。

### 3.10 草图

草图是架构师的意图载体（02 §1.10，X1–X5）：一份人拥有的**局部描述**，范围与深度由架构师自选，没写的字段不约束；AI 必须沿用它的 ID 与父子关系，只在它之下展开。写法与普通描述同形，外面包一层 `sketch`：

```yaml
# designs/<设计>/sketch.yaml（设计的草图）；持久草图在 intent/<ID>.yaml
sketch:
  id: phase2-dynamic             # 持久草图有固定 ID；设计的草图 ID 即设计 ID
  lifetime: until-implemented    # persistent（持久，不归档）/ until-implemented（实现一致后归档，设计的草图缺省）
  closed: [model.scenario]       # 这些子树的直接子模块集合必须与草图相等（X2）；没列的子树开放——版本至少包含草图写的
  supersedes: skeleton           # 可选：定稿实现后替换这个持久草图（晋升，X3）；没有它时与持久草图矛盾即 error
  modules:
    - id: model.scenario          # 挂在骨架之下：写 parent，或在 modules 里嵌套
      parent: model
      name: 场景投影
      kind: subsystem
      core: true
      responsibility: 把场景展开成回放计划、按层次投影成可见消息与时序模型
      children:
        - { id: model.scenario.plan, name: 回放计划, responsibility: 步骤树 → 帧树 }
  relations:
    - { id: rel.sk.desk-plan, from: state.desk, to: model.scenario, type: calls, description: 只读派生数据 }
  interfaces:
    - { id: if.model.planScenario, name: planScenario, owner: model.scenario }
```

- **位置**：骨架 `intent/skeleton.yaml`；其他持久草图 `intent/<ID>.yaml`；设计的草图 `designs/<设计>/sketch.yaml`，与 `design.yaml` 并列。全部人拥有，纳入指纹门禁（§4）。
- **加载**：草图先于其他文件进入 Loader；其他文件对草图实体只能补充（往下挂子模块、补草图没写的字段），不能重定义（X1）。打开设计的草图时按普通描述加载：`system.yaml` + 持久草图 + 该草图，对比基线为当前版本（DV-10）。
- **核验**（X4）：对设计各轮与当前版本（`lint:model` 只对最新一轮与当前版本把关），只比草图写了的——缺模块、封闭子树多出子模块、父模块 / `kind` / `core` / `mayDependOn` 不一致为错误；关系没有对应（两端 + 类型，深层提升也算）、接口不存在或 `owner` 不同为提醒；职责等文字由 AI 展开，不判。`npm run arch -- sketch-check [--design <设计>]` 与页面问题页签「草图偏差」同一份结果。
- **写什么**：只写架构师要钉住的——层与核心模块、它们之间的关系、必须存在的接口；覆盖到哪一层由架构师决定，其余留给 AI。职责一两句话即可，AI 展开时会补全。
- **在画布上画**（X7、ADR-0024）：草图版本（设计的草图、持久草图 `/i/<ID>`）上点「编辑」，增删改层、模块、关系、接口，标核心（只第二级）与封闭；保存为整份写回（B6）。写回用 YAML 文档模型合并：**注释只在未改动的节点上保留**——改过的标量保留行尾注释，删掉的条目注释随之消失，新条目没有注释；条目的嵌套或平铺写法与顺序保持不变，新模块跟随父模块的写法。手写与画布编辑可以交替，保存时文件已被外部改动会被拒绝（X7i）。
- **代码落点（`codeRefs`）只写目录级**（议，外部评审 D1）：草图里的 `codeRefs` 只写架构师想钉住的目录级 glob（如 `src/model/review/**`），或者不写；细到文件的落点由 AI 在 `modules/` 对应的区域文件里补充（X1：为草图模块补草图没写的字段，没有其他字段要补时写一个只含 `id`、`name`、`codeRefs` 的补充条目）。代码在目录内挪文件不必改人拥有的文件、不必重新登记指纹。同一模块的 `codeRefs` 只能一处写：草图写了，区域文件再写不同的值即 `sketch-redefined`。

## 4. 校验与提交

```bash
npm run lint:model
npm run arch -- own            # 人改完 intent/、sketch.yaml、rules.yaml、source-ignore.yaml、design.yaml、reviewed.yaml 后登记指纹（X6）
```

- 必须 0 个错误；提醒逐条处理：缺职责要补；引用其他区域尚未定义的接口 / 数据结构时可暂留；源码归属警告按 §3.7 处理；场景证据文件不存在（`scenario.evidence`）按 §3.6 改正路径。
- 人拥有的文件由指纹门禁守住：`lint:model` 报 `owned.changed` 时说明有人拥有的文件在登记后被改动（多半是 AI 重新生成时碰了它）——由人核对后恢复，或确认改动后再 `arch own`；`owned.unregistered` 提醒有人拥有的文件还没登记。AI 不得运行 `arch own`。
- 按代码重新生成当前版本后，更新 `system.yaml` 的 `source.commit` 与 `source.generatedAt`；对活动草图跑 `sketch-check`，偏差按草图修正描述（X5）。
- `lint:model` 一并检查代码事实与架构规则（K、U、Y）：基线之外的新增违规（`rule.new`）、环度上升（`cycle.grew`）是错误，要么修代码，要么由架构师裁决后改规则；`fact.unconfirmed` 提醒说明描述里的编译期关系在代码里找不到，或运行时关系的两端之间在代码里没有任何依赖（K6），按代码修正描述（确实经 HTTP、注入、路由或回调传递的写 `via`，K5b）——运行时交互经由第三个模块转交时，关系写在实际调用的两端之间（如 `entry → validator`，而不是 `loader → validator`）；未描述依赖只计有值导入的（K7），只引类型的不必补关系，名称查询、标签常量这类到处用的值依赖写在能表达清楚的最高层（如 `present → model.pipeline.indexer`）。
- 基线由人生成并提交：

```bash
npm run arch -- baseline --project <项目>   # 写 model/<项目>/governance/baseline.json
```

## 5. 设计版本：草图 + 轮次

迭代前先出设计、评审定稿后再开发（ADR-0002）。设计 = 架构师的草图（尺子）+ AI 按草图展开的各轮完整快照（被量的东西）+ 评审意见 + ADR（ADR-0023）。

```text
model/<项目>/designs/<设计 ID>/
  sketch.yaml                    架构师的草图（§3.10，人拥有）；版本切换中排在 r1 之前
  design.yaml                    人拥有：目标、状态、基线、ADR、认可偏差、各轮的评审意见
  r1/   system.yaml、intent/、modules/…、revision.yaml   第 1 轮：AI 从当前版本完整复制后按草图扩展；revision.yaml 为本轮说明（AI 拥有）
  r2/   …                        第 2 轮：从上一轮完整复制后按评审意见修改
```

```yaml
design:
  name: 二期 · 动态视角
  status: reviewing             # draft / reviewing / accepted / implemented / abandoned
  goal: |                       # 设计目标与范围
  adr: docs/adr/0003-phase2-dynamic-view.md   # 定稿后记录结论的 ADR（一个或列表，相对源码根目录，E7）
  base: { commit: <起草时当前版本的 source.commit>, generatedAt: … }
  accepted:                     # 认可的偏差（X4）：由面板「认可偏差（写理由）」追加；只能认可提醒级偏差
    - { deviation: 'missing-relation:rel.sk.desk-plan', reason: 调用经 DeskState 的派生，不单独建关系, at: '2026-10-22' }
  revisions:                    # 只承载评审意见，按 id 对上轮次；条目由「记录评审意见」按需建立（B2、E8）
    - id: r1
      feedback: |               # 架构师对本轮的评审意见，原样记录
```

```yaml
# designs/<设计>/r1/revision.yaml —— 本轮说明（AI 拥有，不登记指纹；读这一轮的描述时跳过，E8）
revision:
  date: '2026-10-20'
  summary: |                    # 本轮做了什么；定稿轮附领域规则清单
  questions: [ … ]              # 待评审确认的问题，每条给出推荐
```

轮次从目录发现：含 `system.yaml` 的 `r<N>/` 即一轮，按 N 的数字排序（E8）。早先的设计把 `date`、`summary`、`questions` 写在 `design.yaml` 的 `revisions[]` 里，照常读取；新的轮次一律写 `revision.yaml`。

流程：

1. **画草图**：架构师写 `sketch.yaml`（§3.10；可在画布上画，「新建设计」创建 `design.yaml` 与草图，底稿缺省为空，SK-10），`lint:model` 校验格式与 ID；草图不得与持久草图矛盾，要改骨架就声明 `supersedes`。
2. **交给 AI**：设计信息条「交给 AI」生成指令——草图全文 + 下面的「按草图扩展」一节；AI 据此在当前版本上起草 r1。
3. **评审循环**：每一轮都跑核验（`sketch-check`），偏差进返工清单；AI 起草后自己先跑一遍，零 error 才交评审。架构师在架构台上对比、下钻、记评审意见；提醒级偏差确属合理时「认可偏差（写理由）」。
4. **定稿与实现**：`status: accepted`，结论记 ADR，同步 01–04；实现、重新生成当前版本后，核验对象变为当前版本；一致即「归档」（`until-implemented`：状态 `implemented`，草图覆盖的模块写入确认记录）或「晋升」（`supersedes`：草图替换对应的持久草图）。归档由人显式发起（面板或 `arch sketch archive`）。

写法约定：

- **起草**：先确认当前版本与代码一致（不一致先重新生成并提交），再把当前版本整份复制为 `r1/`，在副本上按草图扩展；不改当前版本。复制的是描述本身（`system.yaml`、`intent/`、`modules/`、`actors.yaml`、`scenarios/` 等）；**不含** `designs/`（设计不嵌套）、`governance/`（基线、拦截记录与指纹只对当前版本）、`reviewed.yaml`（确认只对当前版本，Z1）。`intent/` 要复制：每一轮只读自己目录里的文件，持久草图（含骨架）不会自动带进各轮，不复制则该轮没有层与骨架约束。
- **只改要改的**：新增实体按 §3 写；已有实体只在设计确实要调整时改，ID 保持不变（界面按 ID 对比）；删除就直接删。
- **设计说明**：每个新增或修改的实体写 `designNote`，说清为什么这样设计、取舍是什么。
- **本轮说明**：写在该轮的 `revision.yaml`（`date`、`summary`、`questions`）；AI 起草或修改任何一轮都**不碰 `design.yaml`**——它是人拥有的文件，改了即 `owned.changed`（X6）。
- **新一轮**：评审意见由人记到上一轮（页面「记录评审意见」或直接写 `design.yaml` 后 `arch own`），再由 AI 把上一轮整份复制为新一轮修改（复制后改写新一轮的 `revision.yaml`）；旧轮次不再改动。
- 设计版本同样要求 `lint:model` 0 个错误（逐轮校验）。

### 按草图扩展

给 AI 的规范（「交给 AI」的指令由草图全文与这一节组成）：

1. 草图是约束，不是建议：草图里的每个实体都必须出现在你的版本里，ID、父子关系、`kind`、`core`、`mayDependOn` 与草图一致；草图写的关系（两端与类型）与接口（ID 与 `owner`）必须有对应。
2. 声明 `closed` 的子树下，直接子模块的集合必须与草图相等——不多不少；没声明的子树可以加子模块。
3. 没写的字段由你展开：职责、实现原理、接口签名、数据结构、更深层的子模块与关系，都按 §3 的生成规范写全。
4. ID 纪律（X5）：草图里的 ID 由架构师起，你只能沿用；你新增的实体只能挂在草图实体之下，ID 以其为前缀（如草图有 `model.scenario`，你可以加 `model.scenario.plan`，不能加 `model.playback`）；不得重命名、移动草图里出现过的实体，要改就把问题写进 `design.yaml` 的 `questions` 交给架构师改草图。
5. 从当前版本整份复制为新一轮，只改要改的；每个新增或修改的实体写 `designNote`；本轮说明与待确认问题写在新一轮的 `revision.yaml`，不改 `design.yaml`。
6. 起草后运行 `npm run lint:model` 与 `npm run arch -- sketch-check --design <设计>`：零 error 才算完成；提醒级偏差如确有理由，写进 `questions` 由架构师认可，不要自己改草图。
