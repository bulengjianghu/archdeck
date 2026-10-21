# h5p-arch-desk 描述格式与生成规范

> 本文回答**描述文件怎么组织、怎么写**，供人和 AI（按代码生成当前版本、起草设计版本）遵守。
> 格式以 `schema/arch-file.schema.json` 为准；字段与规则的含义以 [02-domain.md](./02-domain.md) 为准，本文只给写法与约定。

## 1. 目录与分工

模型根目录（默认 `model/`，可用 `ARCH_MODEL_ROOT` 覆盖）下每个含 `system.yaml` 的子目录是一个项目（ADR-0001）：

```text
model/<项目>/
  system.yaml              系统根 + 生成来源 source { repo, commit, generatedAt }；repo 也决定源码根目录（§3.7）
  modules/
    layers.yaml            骨架：全部层 + 第二级模块（ID 固定，见 §3.1）
    <区域>.yaml            各区域的子树：第二级模块之下的模块、本区域的关系、接口、数据结构
  actors.yaml              外部参与者及其入口关系
  scenarios/<场景>.yaml    一个场景一个文件，也可用 .json
  source-ignore.yaml       忽略清单 sourceIgnore：不属于任何模块的源码文件（§3.7）
  rules.yaml               架构规则 rules：架构师的意图，AI 重新生成时不改动（§3.8）
  designs/<设计>/          设计版本（§5），读取当前版本时跳过
  governance/              基线 baseline.json 与拦截记录 ledger.jsonl，由命令行与 agent 接口写，不属于描述，读取时跳过（§4）
```

- 骨架只描述层和第二级模块；区域文件**不得重复定义**它们，只能用 `parent: <第二级 ID>` 往下挂子模块。
- 一个区域文件对应一位生成者负责的范围，互不改写，便于并行生成和局部重新生成。

## 2. 文件格式

一个文件的顶层键都可选、可任意组合：`system`、`module`（单个模块，可带 `parent`）、`modules`、`relations`、`interfaces`、`dataStructures`、`actors`、`scenario` / `scenarios`、`sourceIgnore`、`sourceLimits`、`rules`。未知字段即格式错误，整份文件被跳过（M1）。

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
# modules/layers.yaml —— 层（根层的分层总览靠这些字段）
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

骨架由项目决定：先按项目已有的分层文档确定层与第二级模块，写进 `layers.yaml`，ID 一经确定不再改。以 h5player 为例（第二级模块 ID 固定）：

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

| type | 何时用 |
|---|---|
| `depends` | 编译期 import 依赖，且不是更具体的 calls / implements |
| `calls` | 运行时同步或异步调用，控制权转移 |
| `dataflow` | 数据面推送（帧、分片、样本） |
| `event` | 发布 / 订阅；`from` = 订阅方，`to` = 发布方 |
| `implements` | 实现某个端口或契约；`from` = 实现方，`to` = 契约所在模块 |

- ID：`rel.<区域>.<序号或短名>`，全局唯一。
- 端点写在能表达清楚的**最深模块**上，上层自动聚合；跨区域时对端只写对方的第二级模块 ID，不猜更深的 ID。
- 不连祖先与后代，不为「包含」建关系（M6）。
- 异步（Worker postMessage、事件、定时器回调）标 `mode: async`；有明确接口填 `interface`，有明确载荷填 `payload`。

### 3.5 外部参与者

- 只为**主动发起交互**的外部实体建参与者（A3）：人、主动调用或推送的外部系统、时间。被动依赖（浏览器 API、CDN、三方库）继续用模块或 `codeRefs`。事件由谁发出就算谁的异步消息，不是一类参与者（A5）。
- ID：`actor.<短名>`；`kind`：`user` / `system` / `time`。
- 为每个参与者写**入口关系**，说明它从哪个模块进入系统；方向按 §3.4，`from` 是主动方。

### 3.6 场景

- 一个场景一个文件，ID `sc.<短名>`；写 `name`、`description`，有明确触发原因时写 `cause`。不写默认层次与触发者（S9、A6），第一条消息通常从参与者发出。
- **只写一套最细步骤**（S3）：消息端点写能表达清楚的最深模块或参与者（S4），不为不同层次各写一套；跨区域时对端仍只写第二级模块 ID。
- `call` 用于同步调用；事件发布、postMessage、定时器回调等不等待的用 `async`；`return` 只在返回值本身值得展示时显式写。
- **接口与数据**：步骤没写 `interface` / `payload` 时取对应关系的（S14，`return` 只取接口），所以关系上写全即可；步骤交换的数据与关系不同、或对应关系没写时，在步骤上写。接口签名每个操作一行、带参数类型，面板按步骤标签开头的调用名找到对应的一行。
- **对应关系**：只对应 `calls` / `dataflow` / `event`（S12）；两端之间只有一条运行时关系时可不写 `relation`（S13），有多条时写明。引用 `event` 关系时消息方向与关系相反，属正常；关系写在消息端点的祖先上（如跨区域只写到第二级模块）也算对得上（S5a）。`lint:model` 提醒「结构图中没有对应关系」时，优先补结构关系。
- **组合步骤**：`alt` 每个分支写清 `when`；`loop` 写 `while`；`par` 只用于确实同时进行的流程；可复用的子流程拆成独立场景用 `ref` 引用，不得循环引用（S6）。
- **步骤 id**：分享链接会指向具体步骤，路径式 ID 在插入步骤后会变；关键步骤（`alt` 各分支的首步、常被讨论的步骤）写场景内唯一的 `id`（F2、S11）。
- **从 mermaid 迁移**（D-8）：参与者对照骨架的模块 ID；`alt` / `loop` / `par` 一一对应；系统外的 `participant` 改写为外部参与者。

### 3.7 源码归属

源码根目录 = 工作区根目录（默认 `work4/`）+ `system.source.repo`（G1），如 `repo: h5player` → `work4/h5player`，`repo: h5player-demo/packages/h5p-arch-desk` → 本包。`codeRefs` 与 `entry` 都相对这个目录书写。

- **每个源码文件都应恰好归属一个模块**：子模块写自己的文件，父模块可以写覆盖整个目录的 glob，祖先与后代同时匹配时归最深的模块（G5）；两个互不包含的模块不要写同一个文件（G6）。
- **未归属的文件**：真正属于某个模块的，补到它的 `codeRefs`；不属于任何模块的（文档、测试、构建配置、示例），写进 `source-ignore.yaml`：

```yaml
# source-ignore.yaml —— 不属于任何模块的文件（G8），glob 写法同 codeRefs
sourceIgnore:
  - docs/**
  - tests/**
  - '*.md'
  - tsconfig*.json
```

- **超长阈值**（G20）：文件树把超过 `sourceLimits.maxLines` 行（缺省 500）的 TS / JS / Vue 文件标红；项目需要别的阈值时写在 `source-ignore.yaml`，只写一处：

```yaml
sourceLimits:
  maxLines: 400
```

- 页面只列出未归属文件，不提供忽略操作；按文件树与 `lint:model` 的列表逐条判断，能归纳成目录或通配符的合并成一条。
- `lint:model` 在源码在本地时报出 `source.unowned` / `source.conflict` / `source.entry` 警告，生成后逐条处理。

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

## 4. 校验与提交

```bash
npm run lint:model
```

- 必须 0 个错误；提醒逐条处理：缺职责要补；引用其他区域尚未定义的接口 / 数据结构时可暂留；源码归属警告按 §3.7 处理。
- 按代码重新生成当前版本后，更新 `system.yaml` 的 `source.commit` 与 `source.generatedAt`。
- 源码在本地时 `lint:model` 一并检查代码事实与架构规则（K、U、Y）：基线之外的新增违规（`rule.new`）、环度上升（`cycle.grew`）是错误，要么修代码，要么由架构师裁决后改规则；`fact.unconfirmed` 提醒说明描述里的编译期关系在代码里找不到，按代码修正描述。
- 基线由人生成并提交：

```bash
npm run arch -- baseline --project <项目>   # 写 model/<项目>/governance/baseline.json
```

## 5. 设计版本

迭代前先出设计、评审定稿后再开发（ADR-0002）。

```text
model/<项目>/designs/<设计 ID>/
  design.yaml
  r1/   system.yaml、modules/…   第 1 轮：从当前版本完整复制后修改
  r2/   …                        第 2 轮：从上一轮完整复制后按评审意见修改
```

```yaml
design:
  name: 二期 · 动态视角
  status: reviewing             # draft / reviewing / accepted / implemented / abandoned
  goal: |                       # 设计目标与范围
  base: { commit: <起草时当前版本的 source.commit>, generatedAt: … }
  revisions:
    - id: r1
      date: '2026-10-20'
      summary: |                # 本轮做了什么；定稿轮附领域规则清单
      questions: [ … ]          # 待评审确认的问题，每条给出推荐
      feedback: |               # 架构师对本轮的评审意见，原样记录
```

- **起草**：先确认当前版本与代码一致（不一致先重新生成并提交），再把当前版本整份复制为 `r1/`（不含 `designs/` 与 `governance/`），在副本上改；不改当前版本。
- **只改要改的**：新增实体按 §3 写；已有实体只在设计确实要调整时改，ID 保持不变（界面按 ID 对比）；删除就直接删。
- **设计说明**：每个新增或修改的实体写 `designNote`，说清为什么这样设计、取舍是什么。
- **新一轮**：先把评审意见原样记到上一轮的 `feedback`，再把上一轮整份复制为新一轮修改；旧轮次不再改动。
- **定稿**：`status: accepted`，结论记 ADR，并把新增的概念、规则、需求、架构同步进 01–04 文档；实现后按代码重新生成当前版本，状态改为 `implemented`。
- 设计版本同样要求 `lint:model` 0 个错误（逐轮校验）。
