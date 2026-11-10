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
  explainers/<模块 ID>.html 图解：讲「这个机制为什么这样设计」的一份自包含 HTML（可选的第二趟，§3.11）
  source-ignore.yaml       忽略清单 sourceIgnore：不属于任何模块的源码文件（§3.7）
  rules.yaml               架构规则 rules：架构师的意图，AI 重新生成时不改动（§3.8）
  reviewed.yaml            确认记录 reviewed：架构师确认过哪些模块、确认时的指纹与摘要，AI 重新生成时不改动（§3.9）
  designs/<设计>/          设计版本（§5）：sketches/<挂载点>.yaml（架构师的草图，每个挂载点一张）+ changes.json（改动项编号表，页面维护、不登记指纹）+ notes/（设计说明，AI 拥有）+ design.yaml + r<N>/（可选的展开快照，每轮的说明在 r<N>/revision.yaml），读取当前版本时跳过
  governance/              基线 baseline.json、拦截记录 ledger.jsonl、人拥有文件的指纹 owned.json，由命令行与 agent 接口写，不属于描述，读取时跳过（§4）
```

**谁拥有哪个文件**（B1、B6、X6，ADR-0019、ADR-0023）：

| 拥有者 | 文件 | 页面 | 指纹 |
|---|---|---|---|
| AI（按代码生成） | `system.yaml`、`modules/`（骨架之下）、`actors.yaml`、`scenarios/`、`explainers/`（图解，§3.11）；设计版本各轮快照 `designs/<设计>/r<N>/`，含该轮说明 `revision.yaml`（E8）；设计说明 `designs/<设计>/notes/`（第二十一轮波 2）与讲法要求 `explainers/<模块 ID>.notes.md`（第二十一轮波 1，ADR-0063） | 只读（notes / 讲法要求由架构台在对话里写入） | — |
| 人（架构师、负责人） | 草图：`intent/*.yaml`（骨架等持久草图）、`designs/<设计>/sketches/*.yaml`；`rules.yaml`（AI 重新生成时不改动，§3.8）；`source-ignore.yaml`（忽略项）；`designs/<设计>/design.yaml`（目标、状态、基线、ADR、认可偏差 `accepted`、评审意见 `revisions[].feedback`——不含每轮说明，E8）；`reviewed.yaml`（确认记录，§3.9） | 只追加：例外、忽略项、评审意见（该轮没有条目时新建，B2）、认可偏差；确认记录追加或按模块更新（Z1）；归档 / 晋升改设计状态、晋升时整份替换持久草图；草图在画布编辑后按设计整份覆盖、新建设计，级联改名与删除只限 `designs/<设计>/sketches/*`（B6、B7、X7）；其余由人编辑。`designs/<设计>/changes.json` 由页面随编辑会话维护（手改也可以，DL-3），**不登记指纹** | 记在 `governance/owned.json`：人改完后 `npm run arch -- own` 登记，页面写入自动更新，`lint:model` 不符即报错 `owned.changed`；`changes.json`、`estimate.json`、`notes/`、`*.notes.md` 不在指纹清单里 |
| 命令行与 agent 接口 | `governance/` | 只读 | — |

- 骨架只描述层、第二级模块与第二级之间的关系（自草图 v2 起，根草图带第二级关系，晋升后由骨架拥有；`modules/` 里同 ID 的关系只能补 `interface`、`payload`、`via` 等骨架没写的字段）；AI 只能用 `parent: <第二级 ID>` 往骨架之下挂子模块，对骨架里的模块只能补草图没写的字段，不得重定义已写的字段（X1，`lint:model` 报 `sketch-redefined`）。没有 `intent/skeleton.yaml` 的旧描述仍可把层写在 `modules/layers.yaml`（兼容期）。
- 一个区域文件对应一位生成者负责的范围，互不改写，便于并行生成和局部重新生成。

## 2. 文件格式

一个文件的顶层键都可选、可任意组合：`system`、`module`（单个模块，可带 `parent`）、`modules`、`relations`、`interfaces`、`dataStructures`、`actors`、`scenario` / `scenarios`、`sourceIgnore`、`sourceLimits`、`rules`、`reviewed`（确认记录，§3.9）、`sketch`（草图，只在 `intent/` 与 `designs/<设计>/sketches/` 里用，§3.10）。未知字段即格式错误，整份文件被跳过（M1）。

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
      summary: 以事务方式提交三段 MU 图的变更
      responsibility: 维护 Load / Process / Play 三段 MU 图，以事务方式提交图变更。
      provides: [if.framework.pipeline.updatePipeline]
      dataStructures: [ds.PipelineTransaction]

relations:
  - id: rel.infra.sm-hook
    from: infra.framework.state-machine
    to: app.solution
    type: commands
    interface: if.solution.hooks
    purpose: 让方案在命令前后插入处理
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
# intent/skeleton.yaml —— 骨架：根的子模块与第二级模块，根的分层（strata），人拥有的持久草图（§3.10）
sketch:
  id: skeleton
  mount: root
  lifetime: persistent
  closed: [domain, share]        # 这些模块的直接子模块集合必须与这里相等（X2）
  modules:
    - id: domain
      name: Domain
      kind: subsystem
      abstraction: 规则与事实；纯决策，无 DOM / 网络
      includes: [纯决策, 领域类型与模型, 协议算法, 规则表, 领域端口]
      excludes: [DOM, 网络, Framework / Player 实现, 装配时序]
      responsibility: …
      children:
        - { id: domain.services, name: Services, role: core, responsibility: … }
        - { id: domain.events, name: Events, responsibility: … }     # 普通，总览中折叠为 +N
        - { id: domain.rules, name: Rules, role: shared, responsibility: … }  # 共用件，收进带底的共用件架（O9）
  strata:                        # 层是父模块对子模块的分类，不是节点（ADR-0052）；根写 root
    root:
      - { id: domain, name: Domain, order: 3, asks: 规则是什么？, admits: 它是纯决策、不碰 DOM 与网络吗？, mayDependOn: [share], singular: 边界模块, members: [domain] }
```

```yaml
# actors.yaml
actors:
  - { id: actor.biz, name: 业务方, kind: system, description: 通过 SDK API 调用播放器 }
relations:
  - { id: rel.ctx.api, from: actor.biz, to: infra.player-index, type: commands, interface: if.player.api }

# scenarios/command.yaml
scenario:
  id: sc.command
  name: 命令执行（play / switch / reset）
  kind: main                     # main / exception / maintenance，缺省 main（M19、R17）
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

**系统简介**（`system.description`，ADR-0042）写两句：第一句**定位**——为谁解决什么、提供什么价值；第二句**核心原则**——按什么取舍、怎么分（层名、文档链接可放在第二句的括号里）。定位随产品演进而变，原则要稳定、能被检查。不是两句时 `lint:model` 提示 `system.description-sentences`（M23）。简介是系统的确认指纹（Z7）：只在定位或原则确实变了时改写。根层面板「简介」置顶。

```yaml
system:
  id: h5player
  name: H5Player
  description: |
    Web 端音视频播放器 SDK：让业务方用一套 API 在浏览器里播放 FLV / MP4 / HLS 直播与点播。
    按「决策内收、副作用外置、契约驱动装配」分为 Infrastructure / Application / Domain / Share 四层（见 docs/arch/blueprint.md）。
```

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

#### 分层（strata，ADR-0052）

层是父模块对子模块的**分类**，不是模块、不占级：写在草图的 `strata`（挂载点或草图里的模块，根写 `root`）或约定文件 `intent/strata.yaml`（人拥有；同一父模块草图写了的以草图为准），成员用层的 `members` 或子模块上的 `stratum: <层 ID>`。

- **什么时候分**（ST-1）：子模块 ≤ 5 不分层；6–7 有原则性的分类才分；**多于 7 个应当处理**——能归纳出 2–5 个有原则的层就声明，归纳不出（同类对等件）就保持平铺、记一条拆分信号。先读父模块的原则（`abstraction`）：原则里常常已经写了分类。
- **有原则**：每层写 `asks`（回答的问题）与 `admits`（归属判定问：新模块只看职责就能答是 / 否）、`order`（自上而下）、`mayDependOn`（同一父模块的层 ID，不写等于 `[]`）；单成员层写 `singular` 说明为什么单独成层（ST-4）。
- **全有或全无**（ST-6）：声明了分层的父模块，每个直接子模块恰好属于一层，共用件、总线也要归层。
- **新模块的归属**（ST-2）：在已分层的父模块下新增模块，按各层的 `admits` 逐个回答选层，`designNote` 写一句理由；可先跑 `npm run arch -- place <父模块> "<职责>"`。
- **出现层规则违规时**：先按 `admits` 判成员是否归错；归属无误就是依赖本身错了，改代码，不为消违规挪层、不改 `rules.yaml`。
- 算出的依赖深度（`arch tiers`）只是证据，不写成层。

### 3.2 模块

- **粒度**：模块是一组内聚的职责，通常对应 1~10 个文件。第二级之下一般再分 1~2 级，只有内部确实还有清晰子结构时才继续分；一个父模块的子模块以 3~9 个为宜。
- **ID**：`<父 ID>.<短名>`，短名用 kebab-case。
- **职责**：一两句话说清负责什么，有明显的「不负责什么」就写上；不要复述文件名。
- **一句话职责 `summary`**（M27，ADR-0053）：≤ 30 字（全角计 1、半角计 ½，M30），**动词开头**，写对外承诺——别人能指望它做成什么，不写内部构成、不列子模块、不写规则编号。**有 `responsibility` 的模块都写**；核心模块没写时 `lint:model` 提示 `module.missing-summary`，超长提示 `module.summary-long`。`responsibility` 照旧写全（负责什么、不负责什么），`summary` 是它的提炼，不是它的首句。模块在人拥有的草图里（骨架、挂载草图）时，`summary` 写在对应的 `modules/` 区域文件的补充条目里（只含 `id`、`name` 与要补的字段），同 `abstraction`。

  | | 写法 |
  |---|---|
  | ✅ | 「把描述文件变成校验过的索引」「串行施用宿主命令，发出事件与快照」 |
  | ❌ | 「门面、内核、规则与适配四部分」（内部构成）、「负责……的模块」（不是动词开头）、「按 M17 读入未分类」（规则编号） |
- **原则 `abstraction`**（对内的一面，ADR-0042；ADR-0053 收窄）：一句话说清「**内部怎么切分**」——按什么取舍、子模块之间守什么约束，不复述职责、不列子模块，**不兼任职责**（对外承诺写 `summary`）。**核心模块与第二级模块必须写**（没写时 `lint:model` 提示 `module.missing-abstraction`，M24），其余有子模块的模块建议写，叶子模块不写。第二级模块在骨架（人拥有）里，原则写在对应的 `modules/` 区域文件里，作为补充条目（只含 `id`、`name`、`abstraction`）；挂在它身上的草图写了原则时不写（X10：草图写了以草图为准，写了不同的值即 `sketch-redefined`）。原则进确认指纹（Z2），改写已确认模块的原则会让它需复核：只在原则确实变了时改。面板首段「说明」= 职责 + 原则。
- **不变式 `invariants`**（M28，ADR-0053）：回答「它靠什么一直是这个样子」，≤ 3 条，每条一句；有相关决策时写成 `{ text, adr }`（`adr` 为整数编号），否则写字符串。**核心模块与有内部分层（声明了 `strata`）的模块写**，其余有明确约束的可写。只写**代码里真成立**的约束（单通道、唯一属主、单向依赖、纯函数、不碰某类 API……），拿不准就读源码核对，核对不了的不写；不写愿望、不写「应当」。从 `abstraction`、`principle` 与相关 ADR 里提炼，提炼出来后 `abstraction` 不再重复它。超过 3 条提示 `module.invariants-many`。


- **否定边界 `excludes`**（M33，ADR-0060）：≤ 3 条，每条「短语」或「短语 → 模块 ID」（箭头可写 → 或 ->），回答「别人容易以为是它负责、其实不是」的事，并指出谁负责；不写显然无关的。理解卡「不负责」一行显示、去向是链接；核心模块没写时 `lint:model` 提示 `module.excludes-missing`；`arch place` 对未分层的父模块用它给出去向。层（单成员层的模块）的「不包含」是同一字段。

  | | 写法 |
  |---|---|
  | ✅ | `excludes: [算节点与边的位置 → state.layout, 持有选中与视图状态 → state.desk]` |
  | ❌ | 「不负责网络」（显然无关）、「不负责 X、Y、Z、W」（超过 3 条，说明边界没想清） |

  ```yaml
  - id: kit.kernel
    name: 会话内核
    summary: 串行施用宿主命令，维护唯一的会话状态
    abstraction: 按「施用 / 规则 / 调度」切分：规则是纯表，施用者只有一个
    invariants:
      - 命令单通道串行：同一时刻只施用一条命令
      - { text: 会话是资源的唯一属主，close 时全部释放, adr: 12 }
  ```
- **实现原理**：只给关键模块写，说清核心机制（长文，面板折叠在后）。
- **图解 `explainer`**（M32，ADR-0055）：通常不写——图解放在约定路径 `explainers/<模块 ID>.html` 就会被找到；只有文件名不能用模块 ID 时才写 `explainer: explainers/<文件>.html`。模块在骨架等人拥有的草图里时，写在 `modules/` 区域文件的补充条目里（同 `summary`）。图解本身怎么写见 §3.11。
- **接口 / 数据结构**：只列对外有意义的（被其他模块调用或交换的）。
- **角色 `role`**（ADR-0027；旧写法 `core: true` 加载时映射为 `role: core` 并提醒，M16）：任意层次都可写，属模块对外的一面，写在父草图（X10）——第二级写在骨架里，更深的写在挂在父模块上的草图里，或写在人拥有的 `intent/roles.yaml`（`roles:` 模块 ID → role；草图写了的以草图为准；治理面板「认可为共用件」追加到这里，U11）；AI 生成的 `modules/` 不写 `role`（分级是架构师的判断，AI 只能经治理面板建议，U11）。

  | `role` | 何时用 | 呈现 |
  |---|---|---|
  | `core` | 本层承载主要职责、架构师要一眼看到并确认的模块；每个父模块下 3~5 个，优先选被依赖最多、在场景路径上的 | 大块常显，进确认范围（Z4） |
  | （不写） | 普通模块 | 常显；本层普通模块超过 7 个时折叠为「+N」（O8） |
  | `shared` | 被多处使用、没有运行时出边的工具类模块：名称查询、标签常量、通用原语 | 收进本层的共用件架，使用者标「共用 ×N」（O9、O10）；时序图不开泳道（P18） |
  | `bus` | 事件总线 | 同 `shared`；不作 `notifies` 的端点（M14） |
  | `port` | 系统对外的端口模块：对外 API、SDK 门面（如 h5player 的 `infra.player-index.player-api`）（ADR-0030） | 贴父模块框的上边（用户一侧），常显不折叠（L14） |
  | `adapter` | 把外部技术接进来的模块：三方库封装、浏览器 API、外部媒体插件（ADR-0030） | 贴靠外部系统的一侧（左边，A7），常显不折叠（L14） |

  ```yaml
  # intent/roles.yaml —— 不为定角色单独写草图时，人在这里给更深的模块定角色（M16）
  roles:
    state.desk.projection: core
    present.shared: shared
  ```

  ```yaml
  # intent/state.desk.yaml —— 挂在 DeskState 上的持久草图：给子模块定角色
  sketch:
    id: state.desk
    mount: state.desk
    lifetime: persistent
    modules:
      - { id: state.desk.session, name: 编辑会话, role: core }
      - { id: state.desk.labels, name: 标签与名称, role: shared }
  ```
- **status**：已落地写 `current`（可省略）；蓝图中有、代码中未落地写 `target`；计划移除写 `deprecated`。
- **codeRefs / docRefs**：相对源码根目录（§3.7）的路径或 glob（`*`、`**`、`?`、`{a,b}`；不带通配符的路径匹配同名文件或整个目录）、设计文档路径。
- **adrs**（E9）：与这个模块相关的架构决策，写 ADR 编号的整数列表，如 `adrs: [25, 27]`（不要写 `0025`——YAML 会按八进制读）；只写确实针对这个模块（或它的直接子模块的划分）做出的决策，不为祖先的决策重复写；ADR 文件在源码根目录 `docs/adr/<四位编号>-*.md`，找不到时报 `module.adr-missing`。
- **entry**：模块对外入口不符合约定（模块目录下的 `index.ts`，或其 `package.json` 的 `exports` / `main`）时才写，相对源码根目录（G10）。

### 3.3 接口与数据结构

- 接口 ID：`if.<模块短路径>.<方法或接口名>`；`owner` 填提供方模块（端口的定义模块）。
- **端口与实现者**（ADR-0029，已实现）：一个接口若是端口——别的模块实现它（类 `implements` / `extends` 它、引用它的名字、或结构性满足），写 `implementedBy: [实现者模块 ID]`（M18）；实现者写在接口上，不写 `implements` 关系（已废除，M17）。代码事实是实现者的裁判（K5c）：没写的会作为「仅代码事实」列出，写了却证实不了的进返工清单。

  ```yaml
  interfaces:
    - id: if.domain.ports.media-source
      name: MediaSourcePort
      owner: domain.ports
      signature: |
        interface MediaSourcePort { open(url: string): Promise<void>; close(): void }
      implementedBy: [infra.mus.loader, app.plugins]
  ```
- **表面与接口的关系**（[ADR-0032](./adr/0032-module-surface-and-carrier-chain.md)，第八轮）：模块的**表面** = 入口（G10）导出的符号 + 这里声明的接口（K18）。**声明接口是主张，入口导出是事实**，工具按名称（去掉括号与泛型，G12）对应为三态——**已声明且导出**（主张与事实一致）/ **导出未声明**（事实上的把手没被描述承认；被 ≥ 3 个模块使用时提示「热表面未声明」，U19）/ **声明未导出**（主张找不到事实：核对名称，或它确实不在入口导出）。写法上：被多个模块使用的导出声明为接口，`name` 与导出名一致；别的模块绕过入口直接导入内部文件是「越过入口」（U18），应把符号提升到入口导出或改经入口导入，不为内部文件声明接口；表面只到入口导出与接口为止，类的内部、函数体、私有数据结构不写成接口。交互的 `interface` 与 `via: port:` 指向的就是这些表面元素，结构图上依赖也接到它们（ADR-0032「理由」3）。
- 数据结构 ID：`ds.<TS 类型名>`，由声明该 TS 类型的区域定义，其他区域直接引用同名 ID。
- `signature` / `definition` 用 TS 语法，可裁剪到关键成员（`// …` 表示省略），不超过约 25 行。
- `semantics` 写前置条件、副作用、错误、时序约束。

### 3.4 关系

关系表达**交互**，不表达知识：谁 import 谁、谁实现了哪个端口、谁继承谁、谁组装谁都是代码事实，由工具从源码算出，**不写成关系**（02 §1.1、ADR-0026、ADR-0029、ADR-0030）。箭头一律是**控制流方向**（谁发起），与场景消息同向（ADR-0022）。

> 状态：已实现（ADR-0029，第六轮）——两个项目与设计各轮已于第六轮 T2 迁移到四类：`implements` 读到即丢弃并提醒（M17，供读历史提交），实现者写在接口的 `implementedBy`；`calls` 仍读作「未分类」（M17，提示）、再保留一轮，新写的关系不用它——拿不准时运行 `npm run arch -- classify --project <项目>` 取查询 / 委托的建议与依据（`--write` 写回类型与交互口吻的说明，人拥有的草图只改类型）。`depends` 已于第五轮去掉（M15）。

| type | 何时用（三问） | `from` → `to` |
|---|---|---|
| `queries` | **查询**：要结果、无副作用，后果归调用方——取值、查表、计算、派生、读状态 | 发起方 → 接收方 |
| `commands` | **委托**：把一件事交出去，被调方拥有状态与副作用——改状态、写文件、发请求、启动流程；可要回执；异步（Promise、异步回调、postMessage、定时器回调）加 `mode: async` | 发起方 → 接收方 |
| `notifies` | **通知**：委托的一对多——不期待结果、发布者不知道谁在听（事件总线、emit、观察者回调）；一律异步，不写 `mode`；两端写真正的发布者与订阅者，不写总线（M14） | 发布者 → 订阅者 |
| `streams` | **流**：同一通道上连续的数据项，关注吞吐与背压（帧、分片、样本流）；两端通常只知道端口、由第三方接线。拉取型（接收方按需取下一项）加 `pull: true`，箭头仍指数据去向 | 推送方 → 接收方 |

只有这四类。导入了对方却没有交互（只引类型、只是知道）的**不写关系**——那是代码事实。

**目的与机制分开写**（M29，ADR-0053）：每条关系都写 `purpose`——≤ 20 字，**从调用方（`from`）的视角**写「为了什么」，如「取会话状态画控制条」「让选中的族拉流解码」；`description` 照旧写机制（怎么连、经什么、何时触发）。`purpose` 不复述类型与对端名（类型与对端已画在线上），不写函数名；通知写发布者为什么要让人知道（「宣告会话结束」），流写数据去哪做什么。超长提示 `relation.purpose-long`。关系在人拥有的草图里（骨架的第二级关系）时，`purpose` 写在对应 `modules/` 区域文件里的补充条目（同 `id`、`from`、`to`、`type`，只多 `purpose`，X1）。

**判别顺序（三问四修饰）**：先问「有没有交互」——没有 → 不写。有：

1. 被调方拥有后果吗？否 → `queries`。
2. 是：发起方知道接收方吗？知道 → `commands`；不知道、一对多 → `notifies`。
3. 传的是连续数据吗？是 → `streams`。
4. 再写修饰：经什么连（`via`）、异步（`mode: async`，只用于查询与委托）、拉取（`pull: true`，只用于流）。修饰不改类型。

混合的交互统一归**委托**：同一处既读又写算委托；经共用件打开预览、切换标签等（如 `useOpenPreview` / `useNavTab`）算委托；只构造错误值（`new XxxError`）算查询（T2 裁决 5）。只有继承（子类事实 K12）或只有组装（`new`、工厂、注册：组装事实 K13）而没有调用的，不写关系；创建后又调用其实例的（代码事实里只见 `new`），按调用写查询或委托。

拿不准是查询还是委托时的启发（AI 分类的依据，ADR-0029）：目标是共用件、调用有返回值、目标不持有状态 → 查询；返回 `Promise<void>`、目标持有 store 或类实例、调用之后链路上有通知 → 委托。**写进草图的类型是架构师确认的分类**，AI 不得改（X1、X23）；架构师只确认核心模块之间的线，其余是 AI 的主张。旧名 `event`（箭头为订阅方 → 发布方）与 `dataflow` 在加载时映射并提醒（M12）；`calls` 与 `implements` 按 M17 提示，按提示改写。

- ID：`rel.<区域>.<序号或短名>`，全局唯一。
- 端点写在能表达清楚的**最深模块**上，上层自动聚合；跨区域时对端只写对方的第二级模块 ID，不猜更深的 ID。
- 不连祖先与后代，不为「包含」建关系（M6）。
- 异步的委托（Promise、异步回调、Worker postMessage、定时器回调）标 `mode: async`，同步的不写；`await` 取回结果的只读请求可写成异步的查询（M13）。场景里绑定到查询的写 `call`，委托按 `mode`（同步 `call`、异步 `async`），通知一律 `async`（S19）。有明确接口填 `interface`，有明确载荷填 `payload`。**同一对模块之间多条同类交互应各写接口**，否则画布上同种类成束、展开接收方表面时按接口散开，没写接口的都落在模块本体上、束里分不开（提示「无法区分通路，建议写接口」，`relation.bundle-no-interface`，M22）。
- **事件总线**：总线模块标 `role: bus`（§3.2），它**不作** `notifies` 的端点（M14）。按事件名配对：同一事件的每个发布者 → 每个订阅者各写一条 `notifies`（多个订阅者就多条），`interface` 写事件名，写 `via: bus:<总线模块 ID>` 留痕（两端之间没有导入，不判定，K5b）；发布者、订阅者只与总线交互、看不出事件名的，不猜，写进 `questions` 或留给 `fact.unconfirmed` 提醒。

  ```yaml
  relations:
    - { id: rel.app.sm-state-ui, from: infra.framework.state-machine, to: app.plugins, type: notifies, interface: if.events.stateChanged, via: 'bus:infra.framework.kernel.event-bus' }
  ```
- `via`（机制，K5b）：两端之间不是直接导入时写，四种形态——

  | `via` | 何时写 | 证实 |
  |---|---|---|
  | 不写 | 发起方直接导入接收方 | 按导入（K5） |
  | `port:<接口 ID>` | 发起方只知道端口（接口），由组装者接上实现者；`to` 写实际接收方（实现者多个且发起方不区分时写端口的定义模块）；接口必须已声明（M11） | 发起方 → 定义模块的依赖 + 接收方是已证实的实现者 → 已证实（经端口），否则不判定；第八轮起按「依赖端口元素 + 实现 + 组装」三段判定承载（K20、K5d） |
  | `bus:<模块 ID>` | 经事件总线（`role: bus` 的模块，M11），只用于 `notifies` | 按承载模板判定——发布方依赖总线的发布操作、订阅方依赖订阅操作（K20、K5d）；缺段 / 无承载时为提示 `carrier.gap`（info），不报警告。发布方经框架注入的 emit、订阅方经门面的 on 时两端都不导入总线，判无承载（h5player 现状） |
  | `channel:<通道名>` | 跨进程、经框架注入或路由、经组装者注入的回调：两端之间**确实不可能有导入** | 不判定（第八轮标「外部承载」） |
  | `channel:<通道名>@<模块 ID>` | 同上，且通道的契约（消息类型、路由表、注入键等）声明在系统内某个模块里：`@` 之后写契约模块的 ID，必须是存在的模块（M21） | 两端各自依赖契约模块的元素 → 按承载模板判定（K20、K5d）；契约模块写错时提醒并按没写处理 |

  **通道名的归类**（L35，ADR-0041）：画布在线的标签位按通道名写机制词（中性色），不写 `via` 的不写。通道名**优先用下表左列的名字**；归不进固定表的一律显示为「通道」——不算错，但读者只知道「不是直接导入」。不分大小写，`@<契约模块>` 不影响归类。

  | `via` | 标签 |
  |---|---|
  | `port:<接口 ID>`、`port` | 端口（另画插座，L12） |
  | `bus:<模块 ID>`、`bus` | 总线 |
  | `channel:callback` | 回调（L24） |
  | `channel:inject` | 注入 |
  | `channel:router` | 路由 |
  | `channel:http`、`https`、`ws`、`websocket`、`sse`、`postMessage`、`worker`、`hmr`、`ipc` | 跨进程 |
  | `channel:event`、`dom`、`mediaSession`，以及以 `change` 结尾的浏览器事件名（如 `visibilitychange`） | 事件 |
  | 其余通道名 | 通道 |
  | 不写 `via` 的拉取型流（`pull: true`） | 拉取 |

  **回调**（ADR-0034）：A 调用的是 B（或组装者）交给它的函数——代码里 A 不导入 B，依赖方向与控制流相反。按回调的类型在代码里是否有名字选写法：

  - 回调的类型是契约模块入口里的**具名导出**（interface / type）→ 把它声明为接口（§3.3）、B 写进 `implementedBy`，关系写 `via: port:<接口 ID>`（画插座，L12）。
  - 回调是**匿名的函数参数**或类型没有导出 → 写 `via: channel:callback@<契约模块>`（标签「回调」，L24），`@` 后是定义「接受回调的那个操作」的模块（通常就是发起方自己）；`interface` **留空**——写发起方的操作会把这条算成接收方的把手（L23b），方向就反了。
  - 区分：回调只是传递方式、被调用的其实是接收方自己的操作（如协调者把 `query => dispatch(…)` 交给路由同步，被调的是 `dispatch`）时，`interface` 指向接收方的那个元素是对的，照写。

  旧的平铺写法（`http` / `hmr` / `inject` / `router` / `callback` / `port` / `bus`）按 M20 读入并提醒，改写为上表的形态。拿不准的不写，留给 `fact.unconfirmed` 提醒去核对。本项目的例子：

  | 关系 | `via` | 为什么导入证实不了 |
  |---|---|---|
  | `rel.ad.desk-fetch`、`rel.ad.list-fetch`、`rel.p7.desk-source-fetch`（页面 → ModelSource 插件） | `channel:http` | 浏览器经 HTTP 请求开发服务器，两端不在一个进程 |
  | `rel.ad.desk-changed`、`rel.ad.list-changed`（页面订阅描述变化） | `channel:hmr` | 开发服务器经 HMR 推送 `arch-model:changed` |
  | `rel.ad.version-shell`（版本切换 → 应用外壳） | `channel:router` | 经 vue-router 导航，路由表在外壳里 |
  | `rel.p7.file-preview`（文件面板 → 项目视图） | `channel:inject` | 经共用件的注入键 provide / inject |
  | `rel.ad.url-actions`（路由同步 → dispatch） | `channel:callback@state.desk.url-sync` | 协调者把 `query => dispatch(…)` 回调交给路由同步 |

#### import 与关系

import 是**证据**（代码事实），关系是**交互的主张**。按代码里看到的选：

| 代码里看到的 | 写 | 说明 |
|---|---|---|
| 只导入对方的数据类型（类型、枚举） | 不写 | 由代码事实承载；不算未解释的交互（K7） |
| 导入对方描述里声明的接口，或类 `implements` / `extends` 对方的接口 | 不写关系；在该接口的 `implementedBy` 写上自己（§3.3） | 端口的实现者事实，K5c 只认这两种证据（已证实）；没写进 `implementedBy` 也会作为「仅代码事实」的实现者列出 |
| 结构性满足对方的契约，代码只引了对方的数据类型（TS 不要求写 implements 子句） | 同上，写进 `implementedBy` | 标「结构性实现（代码未显式声明）」，只提示（info），建议在类上加 implements <接口>；描述不用改 |
| 类 `extends` 对方的类（不是端口） | 不写 | 子类事实（K12），面板「知识」行旁显示 |
| `new` 对方的类、调用对方的工厂、把对方注册进容器 | 不写 | 组装事实（K13，ADR-0030），可按「组装根」开关叠加 |
| 导入对方的函数、类、变量并调用 | 这次使用是什么交互就写什么（按三问：查询或委托为多）；借用工具函数、标签常量这类没有架构含义的可不写 | 不写时列为「未解释的交互」（K7，info，不报警告） |

一个声明了接口的模块在面板上有「端口」一节（K11，原端口三角）：定义 · 实现者 · 使用者，用来检查端口是否有人实现、有人使用（端口孤立，U14）。

### 3.5 外部参与者

- 只为**主动发起交互**的外部实体建参与者（A3）：人、主动调用或推送的外部系统、时间。被动依赖（浏览器 API、CDN、三方库）继续用模块或 `codeRefs`。事件由谁发出就算谁的异步消息，不是一类参与者（A5）。
- ID：`actor.<短名>`；`kind`：`user` / `system` / `time`。
- 为每个参与者写**入口关系**，说明它从哪个模块进入系统；方向按 §3.4，`from` 是主动方。

### 3.6 场景

- 一个场景一个文件，ID `sc.<短名>`；写 `name`、`description`，有明确触发原因时写 `cause`；`kind` 写场景的类别——`main` 主流程（缺省，可不写）、`exception` 异常与降级处理、`maintenance` 维护类流程（重置、清理、热更新、迁移）；运行视角默认只列主流程（M19、R17，ADR-0030）。不写默认层次与触发者（S9、A6），第一条消息通常从参与者发出。
- **只写一套最细步骤**（S3）：消息端点写能表达清楚的最深模块或参与者（S4），不为不同层次各写一套；跨区域时对端仍只写第二级模块 ID。
- `call` 用于同步调用；事件发布、postMessage、定时器回调等不等待的用 `async`；`return` 只在返回值本身值得展示时显式写。与关系类型对应（S19，ADR-0029）：查询写 `call`（可配 `return`），委托按 `mode`（同步 `call`、异步 `async`），通知一律 `async`。
- **接口与数据**：步骤没写 `interface` / `payload` 时取对应关系的（S14，`return` 只取接口），所以关系上写全即可；步骤交换的数据与关系不同、或对应关系没写时，在步骤上写。接口签名每个操作一行、带参数类型，面板按步骤标签开头的调用名找到对应的一行。
- **对应关系**：只对应交互关系 `queries` / `commands` / `notifies` / `streams`（S12；迁移期的 `calls` 读作未分类，同样可对应，M17），消息方向与关系箭头相同（`return` 相反）；两端之间只有一条同向的运行时关系时可不写 `relation`（S13），有多条时写明。关系写在消息端点的祖先上（如跨区域只写到第二级模块）也算对得上（S5a）。`lint:model` 提醒「交互图中没有对应关系」时，优先补交互关系。
- **组合步骤**：`alt` 每个分支写清 `when`；`loop` 写 `while`；`par` 只用于确实同时进行的流程；可复用的子流程拆成独立场景用 `ref` 引用，不得循环引用（S6）。
- **步骤 id**：分享链接会指向具体步骤，路径式 ID 在插入步骤后会变；关键步骤（`alt` 各分支的首步、常被讨论的步骤）写场景内唯一的 `id`（F2、S11）。
- **从 mermaid 迁移**（D-8）：参与者对照骨架的模块 ID；`alt` / `loop` / `par` 一一对应；系统外的 `participant` 改写为外部参与者。
- **证据**（S15）：验证这条链路的测试、E2E 等文件写在 `evidence`（路径相对源码根目录、以 `/` 分隔，与文件清单一致），如 `evidence: [tests/acceptance/run-perspective.test.ts, e2e/run-default.spec.ts]`；只写确实覆盖这条链路的文件，不写整个目录；`lint:model` 只检查文件存在（`scenario.evidence` 提醒），不解析内容，文件改名后同步。

### 3.7 源码归属

源码根目录 = 工作区根目录 + `system.source.repo`（G1），如 `repo: h5player` → `<工作区根目录>/h5player`；自项目 `repo: archdeck` 与仓库目录同名时（G22）就是本仓库根。`codeRefs` 与 `entry` 都相对这个目录书写。

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
  layers: true                  # 层按分层声明里的 mayDependOn 默认拒绝（U2，任意层级），缺省 true
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

- 层规则写在分层声明（`strata`）各层的 `mayDependOn` 上（§3.1），这里只能整体开关。
- 先写约束少而硬的规则（层、核心模块的白名单与访问面），再逐步收紧；存量违规用基线承接（§4），不用 `allow` 掩盖——`allow` 只给有理由、长期接受的例外。
- 设计版本可以修改 `rules`，随设计一起评审。

### 3.9 确认记录

`reviewed.yaml` 记架构师确认过的模块（Z1–Z6，ADR-0023），**不由代码生成、人不必手写**：页面上点「确认」或草图归档时写入。AI 按代码重新生成当前版本时不得改动它；被确认的内容变了由工具标「需复核」，不是去改记录。

```yaml
# reviewed.yaml
reviewed:
  - module: state.transition
    at: '2026-10-22'
    hash: 3f9a1c0e7b2d4a61           # 指纹：职责、原则、包含 / 不包含、可依赖的层、接口签名、直接子模块（Z2）
    source: manual                   # manual 或 sketch:<设计 ID>（Z6）
    note: 确认只有转移函数能改状态     # 可选，架构师自己的话
    summary:                         # 确认时的摘要，需复核时据此显示差异（Z3）
      responsibility: 会话规则的纯函数……
      provides: [{ id: if.transition, signature: 'transition(state, action, ctx): { state, history }' }]
      children: [state.transition.navigation, state.transition.playback]
```

- 一个模块一条；再次确认时更新那一条（页面与 `appendReviewed` 都这样做），人手工编辑时也不要写两条。
- 系统本身也可以确认：`module` 写系统 ID，指纹与摘要只覆盖简介 `description`（定位与核心原则两句，Z7）；在根层系统面板「简介」下确认。
- 记录引用的模块不存在时提醒「确认记录失效：模块 <ID> 已改名或删除，请在新模块上重新确认」并忽略；模块改了 ID 视同未确认，在新模块上重新确认即可。
- 确认只回答「AI 有没有动你看过的东西」；已确认的内容与代码是否一致由代码事实判断（K 组），面板「已确认」标记的提示也这样写。
- 设计版本的快照目录里不放 `reviewed.yaml`（只对当前版本，Z1）。
- 写入端点与 `appendReviewed` 只收 `hash` 等于当前描述指纹的记录（Z6）：页面停在旧描述上确认会被拒绝，刷新后重来。每次写入在 `governance/ledger.jsonl` 记一行（来源 `page` / `cli` / `archive`），`npm run arch -- report` 给出确认写入次数。

**诚实说明：确认不证明是人做的。** 本工具是本地单用户工具，写入端点只收同源请求（B5），但同一台机器上的进程（包括 agent）可以照页面的方式 POST，工具分不清人与 agent。防线是三件事：指纹门禁（`reviewed.yaml` 登记在 `owned.json`，绕过端点直接改文件即 `owned.changed`，X6）、拦截记录（每次确认写入可查来源与次数）、git 审计（`reviewed.yaml` 与 `ledger.jsonl` 都进提交，谁何时确认了什么看提交历史）。MCP 不提供确认写入；agent 不得调用确认端点。

### 3.10 草图

草图是架构师的意图载体，也是思考的介质（02 §1.10，X1–X5、X9–X20，ADR-0023、ADR-0025）：一份人拥有的**局部描述**，**一张草图挂在一个模块下、只画一个层次**——挂载点的直接子模块、它们之间的关系、跨边界的关系、父模块的原则，加上架构师摆放的位置。没写的字段不约束；AI 必须沿用它的 ID 与父子关系，只在它之下展开。

> 状态：已实现（ADR-0025）——格式 v2 的读取、校验、编辑操作、两个对比、按设计写回、草图画布与草图面板；本项目的设计 `sketch-v2` 已按此归档，根草图晋升为骨架。一期格式已迁移、不再读取（见本节末「迁移」）。

#### 文件与位置

| 草图 | 位置 | `mount` |
|---|---|---|
| 骨架 | `intent/skeleton.yaml` | `root` |
| 其他持久草图 | `intent/<ID>.yaml` | 它所设计的模块 ID |
| 设计的草图 | `designs/<设计>/sketches/<mount>.yaml`：文件名 = 挂载点 ID，根挂载为 `root.yaml`；一个设计可有多张，每个挂载点至多一张 | 与文件名一致 |

全部人拥有，纳入指纹门禁（§4）。

#### 改动项编号表（`changes.json`，DL-3、DL-24）

对话起草（ADR-0063）里**一处改动一个号，图上和清单里是同一个号**：相对设计基线的变更按血缘聚合为改动项（X11、X17、DL-23），编号记在 `designs/<设计>/changes.json`——设计目录下**页面维护**的小文件：

- **不登记指纹**：它由页面随编辑会话维护，不属于人拥有指纹门禁（X6 的清单不含它），`lint:model` 不校验它的内容；手改也可以，页面读入时丢掉形状不对的条目、`nextNumber` 不小于已用的最大号 + 1。
- **何时写**：保存草图时一并写（与草图同一次写入）；没保存就放弃改动的号不落盘（DL-24）。
- **字段**：`nextNumber`（下一个可用的号）与 `items`——每项 `n`（号）、`key`（改动项的稳定键 `<种类>:<实体>:<ID>`，页面按它认号，DL-23）、`kind`（`added` / `changed` / `merged` / `split` / `renamed` / `moved` / `removed`，与版本对比同一枚举；六类计数里改 ID 并入修改）、`summary`（一句话）、`round`（第几轮：AI 的轮序号，人的改动记当时已有几轮，0 = 第一轮之前）、`by`（`ai` / `human`）、`withdrawnAt?`（撤回时间；撤回的项留在表里，不清掉）。
- **编号按产生顺序给、撤回留空不复用**：一项改动不在了（撤回、撤销、放弃、手改掉）就标 `withdrawnAt`，它的 `n` 永不再分配；同一处改动撤回后再做出来得新号——图上的「#n」徽标、「改动」页签的行与 AI 上下文里的号是同一个号，复用会让历史对话里的「#3」指错东西。
- AI 的上下文包里带着带号的清单（DL-14），所以对话里可以直接说「撤回 #3」（改动块的 `withdraw`，DL-21）。

```json
{
  "nextNumber": 4,
  "items": [
    { "n": 1, "key": "merged:module:state.desk.session", "kind": "merged", "summary": "合并 编辑中的草图、版本 为 编辑会话", "round": 1, "by": "ai" },
    { "n": 2, "key": "added:module:state.desk.derived", "kind": "added", "summary": "新增 运行派生", "round": 2, "by": "ai" },
    { "n": 3, "key": "renamed:module:state.desk.persist", "kind": "renamed", "summary": "改 ID 写入 为 persist", "round": 2, "by": "human", "withdrawnAt": "2026-11-05T10:00:00.000Z" }
  ]
}
```

#### 设计说明（`notes/`，DL-10、DL-31、DL-43）

对话里好的回答可「存为设计说明」：`designs/<设计>/notes/<标题>.md`（AI 拥有、不登记指纹），第一行 `# 标题`，第二行引用行写状态与出处 `> 目标态 · 未实现 · 模块 <ID> · <时间>`，之后是正文（问答卡的段落，引用的原文以引用行附在段后，推断的段前标「（推断）」）；回答里通过检查的机制图按次序接在正文后，每张一个 ```` ```arch-diagram <说明> ```` 围栏块（§3.11 末「对话里的机制图块」）。辅助栏以预览标签打开、标「目标态 · 未实现」；实现后作为该模块题解的底稿；随设计归档原样保留。

#### 示例

```yaml
# designs/desk-session/sketches/state.desk.yaml —— 挂在 DeskState 下、只画 DeskState 的直接子模块
sketch:
  id: desk-session               # 设计的草图 ID 即设计 ID；持久草图有固定 ID（骨架为 skeleton）
  mount: state.desk              # 挂载点：模块 ID 或 root（X9）；不能是层
  lifetime: until-implemented    # persistent / until-implemented（设计的草图缺省）
  # supersedes: <持久草图 ID>    # 同挂载点已有持久草图时必须声明（X4、X10）；本例没有
  abstraction: |                 # 父模块（挂载点）的原则：对内的一面，属本草图（X10）；字段名与层的 abstraction 一致
    协调者只持有一个值；编辑会话与浏览会话分开，互不改写。
  closed: [state.desk]           # 可选：挂载点的直接子模块集合必须与本草图相等（X2）
  modules:                       # 必须是挂载点的直接子节点：ID 以 `state.desk.` 为前缀，不写 parent、不嵌套 children（X9）
    - id: state.desk.session     # 合并的结果：来自基线的 edit 与 versions
      name: 编辑会话
      kind: subsystem
      role: core                 # 角色属对外的一面（X10）：core / shared / bus，不写为普通
      responsibility: 一个设计的编辑会话：各张草图、设计级撤销栈、读取时的指纹
      from: [state.desk.edit, state.desk.versions]    # 血缘：一律指向基线 ID（X11）
    - id: state.desk.run
      name: 运行派生
      kind: subsystem
    - id: state.desk.view        # 改 ID：基线里叫 state.desk.files
      name: 视图派生
      kind: subsystem
      from: [state.desk.files]
  relations:                     # 显式写在本层：两端都在本层，或一端为外部模块（X9、X19）
    - { id: rel.desk-session-run, from: state.desk.session, to: state.desk.run, type: commands, description: 编辑中暂停运行派生 }
    - { id: rel.desk-session-writer, from: state.desk.session, to: access.writer.sketch, type: commands, mode: async, description: 保存整个设计 }   # access.writer.sketch 在范围外：画布上画成引用节点
  interfaces:                    # 对外接口属本层模块的对外一面（X10）
    - { id: if.desk.session.save, name: save, owner: state.desk.session }
  layout:                        # 人拥有的位置（X15）：本层模块（相对中心区的内容原点）与关系标签；引用节点不记（X22）
    modules:
      state.desk.session: { x: 120, y: 80 }
      state.desk.run: { x: 420, y: 80 }
      state.desk.view: { x: 120, y: 260 }
    relations:
      rel.desk-session-run: { label: { x: 270, y: 60 } }
```

```yaml
# intent/skeleton.yaml —— 骨架：根挂载的持久草图；层是带不是层次，范围 = 层 + 层的直接子模块
sketch:
  id: skeleton
  mount: root
  lifetime: persistent
  closed: [present, state, access, model]
  modules:
    - id: present
      kind: subsystem
      abstraction: …             # 根挂载时，根的子模块的 abstraction 是它对内的原则；层的原则写在 strata 上，草图顶层不写 abstraction
      children:                  # 根挂载是唯一允许嵌套的情形：根的子模块下嵌套第二级模块
        - { id: present.version, name: 版本切换与设计信息条, kind: subsystem }
  strata:                        # 根的层（单成员层：带即成员）；也可以为草图里的模块写它对子模块的层
    root:
      - { id: present, name: 呈现层, order: 1, asks: …, admits: …, mayDependOn: [state, model], singular: …, members: [present] }
  relations:                     # 自 v2 起骨架包含第二级之间的关系（显式写在本层，X18）
    - { id: rel.ad.desk-version, from: present.desk-view, to: present.version, type: commands }
```

#### 字段

| 字段 | 含义 | 规则 |
|---|---|---|
| `mount` | 挂载点：模块 ID 或 `root`；不能是层；必填 | X9 |
| `abstraction` | 父模块（挂载点）对内的原则，加载为挂载点模块的 `abstraction`（与层的抽象原则同一字段；描述也可写，草图写了以草图为准，ADR-0042）；根挂载时不用，改用各层的 `abstraction` 等字段（写了即格式错误） | X10 |
| `modules[]` | 挂载点的直接子模块（根挂载：层及层的直接子模块）；字段同普通模块，可带 `from`；不写 `parent`（由 `mount` 推出），不嵌套 `children`（根挂载的层除外） | X9 |
| `modules[].from` | 血缘：这个模块由哪些**基线**模块而来（合并、拆分、改 ID、移动）；全新模块不写 | X11 |
| `relations[]` | 显式写在本层的关系：两端都是本草图的模块，或一端是本草图的模块、另一端是范围外的模块（外部端点画成引用节点，不另存）；两端都在范围外的关系不写；`type` 取四类交互、可写 `via` / `mode` / `pull`——写进草图的类型即架构师确认的分类（ADR-0029） | X9、X19、X23 |
| `interfaces[]` | 本草图模块的对外接口（`owner` 必须是本草图的模块）；可写 `implementedBy` 声明端口的实现者（本层模块或引用节点），是待实现的主张（ADR-0029）；草图里本张写了的接口在画布上都画端口记号，供拖线声明实现者（T3 裁决 4） | X10、X24 |
| `layout` | `modules.<模块 ID>: { x, y }`、`relations.<关系 ID>: { label: { x, y } }`；只记本层模块——非根草图的坐标相对中心区（挂载点框）的内容原点，引用节点不记（位置按所属层排布，读到的旧坐标忽略、保存时去掉，X22）；根草图的层不记、带内第二级模块记 `{ x, y }`（`y` 相对所在层带的顶，带高随内容增长；只记 `x` 的旧写法取带内第一行，X21）；人拥有、随草图归档；没有 `layout` 时打开自动布局一次（非根草图按中心区的可用区域排网格），不写回；新建设计的底稿不写 `layout` | X15、X21、X22 |
| `id`、`lifetime`、`closed`、`supersedes` | 同一期（X1–X3）；`closed` 只能列挂载点或本草图的模块 | X2、X3 |

#### 画布布局（X22）

非根草图在草图画布上画成按规则排布的边界，坐标里只有本层模块是人摆的：

| 部分 | 怎么排 |
|---|---|
| 系统框 | 最外一层，标项目名；尺寸随草图画布的可用区域自适应（视口去掉面板与信息条；放不下引用列与最小中心区时按视口宽高比放大、整体缩小显示） |
| 引用列 | 外部引用按所属层在骨架里的 `order` 从左到右成列：比挂载点所在层靠前的在左、靠后的在右；与挂载点同层的紧贴中心区右侧单列一列，标「同层」；不属于任何层的在最右「外部」。每列单列不换列，放不下时整列按比例缩小；列内按相连的本层模块的平均高度排；颜色比本层淡 |
| 中心区 | 挂载点所在层的位置，带挂载点名的框；可用宽度 = 画布宽 − 两侧引用列宽，初始布局与「重新排列」按它排本层网格；`layout.modules` 的坐标相对它的内容原点；拖出它松手 = 升级（X7d） |
| 线 | 本层模块之间的线在模块之下（直线）；引用线在模块之上，从模块朝引用列的一侧端口进出，细、半透明、不接收指针 |

「隐藏外部引用」（工具条，只在会话里）关掉引用列与引用线，中心区占满画布宽；它不改草图。根草图仍是层带（X21），没有引用列。

#### 内外归属（X10）

一个模块**对外的一面**（名称、职责、对外接口、`role`、`closed`、`kind`）写在**父草图**（挂在它父模块上的那张）；**对内的一面**（原则、子模块、子模块之间的关系）写在**挂在它身上的草图**；原则例外地也可由 AI 在描述里起草（§3.2），挂在它身上的草图写了以草图为准（ADR-0042）。所以相邻两层草图字段不重叠，矛盾只需比「同挂载点」：同一挂载点已有持久草图时，设计草图必须 `supersedes` 它（X4）。

#### 血缘与前缀级联（X11、X12）

- `from` **一律指向基线**（设计 `base.commit` 那一版）里的 ID：编辑器合并、拆分、改 ID、移动时沿血缘求闭包写入，不记中间态的 ID；全新模块没有基线来源，不写 `from`。
- 读法（相对基线，变更清单、核验与交给 AI 的摘要都按它表述）：

| 形状 | 读作 |
|---|---|
| 模块不在基线，`from` ≥ 2 个基线 ID | **合并**：来源降为它的子模块 |
| 两个以上模块的 `from` 含同一个基线 ID，该 ID 已不在 | **拆分** |
| 模块不在基线，`from` 恰一个、与来源同父 | **改 ID** |
| 模块不在基线，`from` 恰一个、与来源不同父 | **移动**（降级 / 升级 / 移入）；父是合并结果的，计入合并、不另列 |
| 不在基线、没有 `from` | **新增** |
| 基线有（在本草图范围内）、草图没有、也没有 `from` 指向它 | **删除** |

- **前缀级联**：一个模块的 ID 变了（改 ID、被合并收进新模块、降级、升级、移入别的层），它与它的整棵子树换成新前缀——
  - 设计里已有的、挂在它或它后代上的草图，同一步改文件名、`mount` 与其中全部模块 ID，被改写的模块记 `from: [基线 ID]`（已有 `from` 的保持不变）；关系两端、接口 `owner`、`closed`、`layout` 的键随之改写；关系与接口自身的 ID 不变；
  - 没有草图覆盖的后代不写，由前缀映射（旧前缀 → 新前缀）推出，写进交给 AI 的摘要；
  - 变更清单里，这些级联的改 ID 被「合并 / 移动」吸收，不另列。
- 不存 `children` 记录：合并 / 降级只写 `from`；挂在合并结果上的下一层草图不存在时，它的底稿由「基线里的子树 + `from` 收进来的模块（换成新前缀）」推出（X18）。

#### 写什么

- **底稿**：新建草图一律从基线复制（X18）——挂载点的直接子模块的 ID、名称、`kind`、`closed`、`role`，与显式写在本层的关系及类型；不复制职责文字、接口、原则。复制后「相对基线」为 0；架构师在底稿上改。
- **基线**（05 裁决 3）：设计的 `base.commit` 是**新建设计时仓库的 HEAD**（该提交里须有本项目的描述），由页面新建设计时服务端写入；底稿与「相对基线」都从 `base.commit` 那一版描述读取（同一份，git 只读）。不在 git 仓库内、还没有提交或 HEAD 不含描述时省略 `base.commit`：底稿从当前版本复制，相对基线退化为相对当前版本，草图面板提示。基线漂移（E4）一律比基线那一版与当前版本的 `source.commit`（草图与各轮都读基线那一版；读不到时不判断）。
- **只写要钉住的**：职责一两句话即可，AI 展开时会补全；覆盖到哪一层由架构师决定（往下一层就在那个模块上再挂一张草图），其余留给 AI。
- **七个左右**：一张草图的模块超过 7 个时页面提示考虑归并，不拦（X13）；根草图按每条层带算（X21）。
- **代码落点（`codeRefs`）只写目录级**（议，外部评审 D1）：只写架构师想钉住的目录级 glob（如 `src/model/review/**`），或者不写；细到文件的落点由 AI 在 `modules/` 对应的区域文件里补充（X1：为草图模块补草图没写的字段，没有其他字段要补时写一个只含 `id`、`name`、`codeRefs` 的补充条目）。同一模块的 `codeRefs` 只能一处写：草图写了，区域文件再写不同的值即 `sketch-redefined`。

#### 加载、核验与写回

- **加载**：草图先于其他文件进入 Loader；其他文件对草图实体只能补充（往下挂子模块、补草图没写的字段），不能重定义（X1）。`mount` 推出模块的 `parent`；草图的 `abstraction` 即挂载点模块的 `abstraction` 字段（对内的一面，其他文件写了不同的值即 `sketch-redefined`；挂载点不在描述里时提醒 `sketch-mount-missing`）；`from`、`layout` 不进模型索引（它们是设计信息，不是被描述系统的事实）。
- **校验**（X14）：格式错误拦保存——schema、ID 格式与重复、模块不是挂载点的直接子节点、引用不存在、缺名称；语义提示拦「交给 AI」与定稿——任意父模块的层依赖（`strata` 的 `mayDependOn`）成环、声明了分层却有子模块没归层（`sketch.stratum`）、同挂载点与持久草图矛盾、待重连（X16）。超七（X13）与没写职责只提示（hint），不进两级。
- **核验**（X4、X17）：同一个函数做两个对比——相对基线（我改了什么）与相对当前版本（实现还差什么）；按挂载点取对象版本的同一范围比对，按血缘识别合并 / 拆分 / 改 ID / 移动；相对当前版本只比结构（模块、父子、`kind`、`role`、`closed`、关系两端与类型、接口与 `owner`），职责等文字只参与相对基线。`npm run arch -- sketch-check [--design <设计>]` 对设计逐张报告，与页面问题页签「草图偏差」同一份结果。持久草图（`intent/`）的偏差同样相对完整的当前版本（草图自身也已加载进去），页面「本张核验」与对比按钮与命令行一致，骨架与实现一致时为 0；它交给 AI 的指令另带「交给 AI 时的改动摘要」，对象是去掉这张草图后的当前版本（其余描述说的样子），不是偏差、不进计数（X17）。
- **写回**（B6、X20）：在草图画布上编辑，保存整个设计——改过的草图整份写回（含 `layout`；引用节点的键去掉，X22），会话里推出并改过的草图作为新文件写出；写回用 YAML 文档模型合并，**注释只在未改动的节点上保留**；保存时任一文件已被外部改动则整次拒绝（X7i）；没有关系的引用节点保存时丢弃（X19）。级联改名（X12）写到新文件名并删旧文件，删带下一层草图的模块（人确认后）删子草图文件——只限 `designs/<设计>/sketches/*`，永不动 `intent/*`，每个文件照记拦截记录（B7）。手写与画布编辑可以交替。

#### 迁移

- 一期格式（ADR-0023 / ADR-0024：没有 `mount`，`designs/<设计>/sketch.yaml`，可跨层次嵌套）**不再读取**：仓库里的一期草图已按挂载点机械拆成 v2（`designs/phase2-dynamic/`、`designs/sketch-editor/` 的 `sketches/`；`sketch-v2` 改为根挂载的 `root.yaml` 与 `present.panel.yaml`），骨架加了 `mount: root`。
- 唯一的读取例外：`intent/` 下没有 `mount`、顶层全是层的草图按根挂载读取，并提醒 `sketch-legacy-mount`——历史提交、设计基线（`base.commit`）与各轮快照里的骨架都是这个形状，改不了。其余没有 `mount` 的草图是格式错误，整份跳过。
- 旧写法 `kind: layer`（ADR-0052 之前的层）由 Loader 迁移（M26）：根下的层读作根的单成员层，非根层级的层溶解为父模块的 `strata`（提醒 `layer.nested`）。新写的描述一律用 `strata`。
- 草图版本（页面上把一个设计的草图当版本打开）载荷为 `system.yaml` + 持久草图 + 该设计的各张草图（`sketches/<mount>.yaml`）+ `references.yaml`（草图引用、草图里没有的外部模块，取自当前版本，只读，X19），自成一份可加载的描述。

### 3.11 图解（可选的第二趟）

图解是附在模块上的一份自包含 HTML（EX-1–EX-10，ADR-0055；LY-14，ADR-0064），回答「**这个机制为什么这样设计**」。它不是第二份描述：结构、行为与事实归架构台（视图区的「描述」标签），图解只讲原理与理由，**多图少文、不含事实**。先按 §3.1–§3.10 生成 YAML，再针对入选模块做这一趟。

**给谁做**：核心模块全量覆盖——每个核心模块（`role: core`，含深层）都要有一份原理图解（负责人裁决，2026-11-04）；机制跨多个子模块的，同时在最近共同父模块上挂一份讲配合（父讲配合、子讲内部，R5.3）；根模块（系统）的图解 `explainers/<系统 ID>.html` 即项目总览；非核心模块机制不显然时也可做。

**写什么、不写什么**（C1）：

| 写 | 不写（归架构台，写进图解就会过期） |
|---|---|
| 机制示意（内联 SVG）、关键流程的简化图、为什么这样切分、守住的约束为什么必要、常见误解 | 接口清单、关系清单、文件清单、调用链逐步、代码片段的大段摘抄 |

**父子分工**（R5.3）：父模块的图解只讲子模块之间怎么配合、为什么这样切分，把子模块当黑盒；子模块的图解只讲自己内部，父模块和兄弟模块只作为灰色背景出现。父模块的图解用 `data-arch` 指向孙模块即越级（`explainer.too-deep`）。

**自上而下生成**：先生成父模块的图解，定下切分与配合；再在父模块给的语境里生成子模块的图解。

**引用模块，不搬事实**（EX-2、LY-14）：

```html
<!-- 提到一个模块：单击即在画布上选中它，悬停时画布描边提示它（LY-15）；它有图解时架构台在它第一次出现在 HTML 正文的地方附「图解 ›」 -->
<span data-arch="kit.kernel">会话内核</span>
<!-- 图里的框也可以引用：用 <g data-arch="…"> 包住，单击即选中（「图解 ›」不附在 SVG 里） -->
<g data-arch="kit.kernel"><rect … /><text …>会话内核</text></g>
```

- 事实（summary、职责、不变式、接口、关系）不进图解：读者在「描述」标签看。正文里出现某个模块 `summary` 或一条不变式的原文（≥ 8 字）即 `explainer.copied-text`；用自己的话讲机制可以，原样抄不行。
- `data-field`（`summary` / `invariants` 填入原文，`<span data-arch="…" data-field="summary"></span>`）只留作兼容旧图解，**不推荐用于新图解**——它把事实搬回了图解（LY-14）。
- 模块第一次出现放在 HTML 正文（导语）里，「图解 ›」才看得见；只出现在 SVG 里的模块不附。
- 术语与架构台一致：查询 / 委托 / 通知 / 流，层、端口、核心、共用件；模块名与描述里的 `name` 一致。

**形态**：

- 一个文件、自包含：样式与 SVG 内联，不引用外部脚本、样式、字体、图片（架构台以 CSP 禁止一切网络请求，EX-3）；可以有少量自己的脚本，但不依赖它。
- 深浅色都可读：颜色写成 CSS 变量，在 `@media (prefers-color-scheme: dark)` 里重定义，`color-scheme: light dark`。
- 多图少文（LY-14）：标题一句点题，导语不超过 2 句；之后每节一张图，图下文字不超过 3 句。一份图解不超过三屏。
- 设计宽度：视图区缺省宽 0.36（按竖栏右边那块算，LY-10d；1440 宽时 iframe 约 503px，正文约 470px）——SVG 的 `viewBox` 宽约 **480**（约 1:1 显示），正文字号 ≥ **10.5px**（标题 12.5–14px，副标题 10.5–11px）；按 640 宽画会被缩到 0.74 倍。
- 同一项目的图解统一配色：同一层在所有图解里同色，亮暗两种主题都可读。
- 中文行文，短句；一张示意图胜过三段文字。

**写入依据**（EX-6、EX-9）：生成或改完一份图解后执行

```bash
npm run arch -- explainer <模块 ID> --project <项目> --write
```

它在图解的 head 里写入 `<meta name="arch-basis" content="v1 …">`：本模块的描述、子模块的 summary / invariants 与子模块之间的关系，按项各一个指纹。之后这些依据变了，架构台标「基于旧描述 · N 处改动」，`lint:model` 报 `explainer.stale`；按改动核对图解的讲法，讲法仍成立或改好后再执行一次上面的命令。不要手改 `arch-basis`。

**已知限制**：依据只覆盖描述（模块与关系）。讲到**界面规则**的图解（如视图区按情境排布 LY-11、打开场景即切交互 LY-6、主语回退 LY-7a）讲的是 docs/02 里的工具规则，不进指纹——这些规则以后改了，图解不会标「基于旧描述」，改规则时要顺手查一遍讲界面的图解（`present.*`、`state.transition`、根）。另外父模块的图解只能引用直接子模块（R5.3），根图解讲跨层流程时只能按层讲、点不到深处的子模块。

**讲法要求（DL-8、DL-16，第二十一轮）**：当前版本上「重讲」（ADR-0063，DA-4）的讲法要求存 `explainers/<模块 ID>.notes.md`——AI 拥有、**不登记指纹**（不在 X6 的人拥有清单里）；纯文本，一条意见一行，逐条可读；重讲走同一条题解流水线（同一模板、同一套检查、同一个依据指纹），讲法要求作为意见喂给它，并随上下文带上、**累积**——第二次重讲带第一次的要求，事实变了重写题解时意见仍生效。讲法要求不进 `arch-basis` 依据（它讲的是「怎么讲」，不是「讲什么」），改它不算改动图解依据。重讲由架构台辅助栏的对话发起：agent 一并产出这次的讲法要求与按要求重新生成的题解，架构台判别放行后代写题解、盖依据、追加讲法要求（文件以 `# 讲法要求 · <模块 ID>` 开头，每条一行 `- …`）。

**对话里的机制图块与图解的区别（DL-40–DL-43，第二十一轮）**：对话（「问」与草图里的「改」）的回答可以带一张机制图——`{"kind":"diagram","svg":"<svg …>…</svg>","caption":"一句说明"}`，用户要图、或讲拆分 / 合并之后怎么运作时画。它与图解**同一套检查**（只许内联 SVG、无脚本、无外部资源、必须写 `viewBox` 且宽 ≤ 640 适合资料区一列、`data-arch` 指向的模块必须在描述里——草图里在当前张上）、同一种显示（沙箱 iframe、单击 `data-arch` 在画布上选中），但**不是描述**：不盖依据指纹（没有 `arch-basis`）、不落 `explainers/`、不进 `lint:model`、过期不提示；不合格整块拒绝、文字照常。好的图随回答「存为设计说明」，写在 `designs/<设计>/notes/<标题>.md` 正文后，每张一个 ```` ```arch-diagram <说明> ```` 围栏块（中间是 SVG 原文）；实现后它可作为该模块图解的底稿，那时按本节重新生成图解并写入依据。

## 4. 校验与提交

```bash
npm run lint:model
npm run arch -- own            # 人改完 intent/、designs/*/sketches/、rules.yaml、source-ignore.yaml、design.yaml、reviewed.yaml 后登记指纹（X6）
```

- 必须 0 个错误；提醒逐条处理：缺职责要补；引用其他区域尚未定义的接口 / 数据结构时可暂留；源码归属警告按 §3.7 处理；场景证据文件不存在（`scenario.evidence`）按 §3.6 改正路径。
- 人拥有的文件由指纹门禁守住：`lint:model` 报 `owned.changed` 时说明有人拥有的文件在登记后被改动（多半是 AI 重新生成时碰了它）——由人核对后恢复，或确认改动后再 `arch own`；`owned.unregistered` 提醒有人拥有的文件还没登记。AI 不得运行 `arch own`。
- 描述契约（M27–M31，ADR-0053）：摘要行的「契约」一段要做到——有职责的模块全有 `summary`（核心缺 0）、关系全有 `purpose`、超长 0；核心模块与有内部分层的模块有 `invariants`。这些提示是 info、不作为门禁，明细在返工清单（`npm run arch -- issues`）里。
- 图解（§3.11）：`lint:model` 的 `explainer.*` 提醒逐条处理——指向不存在的模块是错误；`explainer.stale` 先核对讲法，再按 §3.11 写入依据。
- 按代码重新生成当前版本后，更新 `system.yaml` 的 `source.commit` 与 `source.generatedAt`；对活动草图跑 `sketch-check`，偏差按草图修正描述（X5）。
- `lint:model` 一并检查代码事实与架构规则（K、U、Y）：基线之外的新增违规（`rule.new`）、环度上升（`cycle.grew`）是错误，要么修代码，要么由架构师裁决后改规则；`fact.unconfirmed` 提醒说明描述里的端口实现者（`implementedBy`；现状为 `implements` 关系）在代码里找不到，或交互关系的两端之间在代码里没有任何依赖（K6），按代码修正描述（确实经端口、总线或通道传递的写 `via`，K5b）——运行时交互经由第三个模块转交时，关系写在实际调用的两端之间（如 `entry → validator`，而不是 `loader → validator`）；未解释的交互（K7，info）只计交互使用（调用、`new`、`extends`、渲染，或把函数、类、组件作为值交出）而没有交互关系覆盖的，只读常量、枚举、只读值的纯值读取不计；按「事实求全、描述求准、呈现求少」（Q12）**补交互，不补依赖**：这次使用是哪种交互就按三问补哪种（§3.4：要结果、无副作用的补 `queries`，交出一件事的补 `commands`，一对多的补 `notifies`，连续数据的补 `streams`；描述写「谁调谁做什么」），只引类型的、只读常量与标签的、借用名称查询这类没有架构含义的不补；实现端口的写进接口的 `implementedBy`，继承与组装是事实（K12、K13），都不补关系（ADR-0029、ADR-0030）。`relation.unclassified`（未分类，info）只提示：AI 按三问给出分类，核心之间的由架构师在草图里确认（M17、X23）；`query.side-effect`（U13）与 `port.no-implementer` / `port.no-user`（U14）按建议改描述或交给架构师。
- 基线由人生成并提交：

```bash
npm run arch -- baseline --project <项目>   # 写 model/<项目>/governance/baseline.json
```

## 5. 设计版本：对话起草，认可后出任务单（ADR-0063）

迭代前先出设计、认可后再开发（ADR-0002；ADR-0063 修订：**设计 = 草图 + 可选的展开轮**，对话起草为主路径）。架构师的草图是尺子（§3.10），AI 在对话里一轮一轮改图、每轮应用为编辑会话的一步（可按号撤回）；「交给 AI 展开一轮」的完整快照降为可选预览；认可后同一份改动清单原号变成任务单，代码真的变成草图那样才能归档。旧设计的「评审中」多轮评审循环停用——评审在草图画布上完成（旧设计里已有的各轮照旧读）。

```text
model/<项目>/designs/<设计 ID>/
  sketches/<挂载点>.yaml         架构师的草图（§3.10，人拥有），每个挂载点一张；版本切换中排在 r1 之前
  changes.json                   改动项编号表（§3.10「改动项编号表」，页面维护、不登记指纹）
  estimate.json                  认可时记下的估算（DL-49）：认可前总览读到的牵动模块、是否全是新框、当前版本各模块的描述指纹；页面「认可」时写，不登记指纹，归档预览拿它比「实际改了」
  notes/                         设计说明（§3.10「设计说明」，AI 拥有）
  dialogue/                      设计里的对话（DL-51）：transcript.jsonl 每轮一行（请求与结果，接入层写）、photos/<轮次>/ 发问时贴的照片；打开设计的草图时读回恢复，随设计归档
  design.yaml                    人拥有：目标、状态、认可（含各张草图指纹）、基线、ADR、认可偏差、各轮的评审意见
  r1/   system.yaml、intent/、modules/…、revision.yaml   第 1 轮（可选的展开快照）：AI 从当前版本完整复制后按草图扩展；revision.yaml 为本轮说明（AI 拥有）
  r2/   …                        第 2 轮：从上一轮完整复制后按评审意见修改
```

```yaml
design:
  name: DeskState 的编辑会话
  status: draft                 # draft（起草中）/ accepted（已认可，草图锁定）/ implemented / abandoned；迁移只经页面的动作（DL-32）；reviewing 停用，旧设计照旧读、按起草中迁移
  goal: |                       # 设计目标与范围
  adr: docs/adr/0003-phase2-dynamic-view.md   # 定稿后记录结论的 ADR（一个或列表，相对源码根目录，E7）
  base: { commit: <新建设计时仓库的 HEAD（草图 v2，05 裁决 3）；旧设计为起草时当前版本的 source.commit>, generatedAt: … }
  accepted:                     # 认可的偏差（X4）：由面板「认可偏差（写理由）」追加；只能认可提醒级偏差
    - { deviation: 'missing-relation:rel.sk.desk-plan', reason: 调用经 DeskState 的派生，不单独建关系, at: '2026-10-22' }
  approval:                     # 认可记录（DL-33）：页面「认可」写入，人不手写；回到起草时去掉 sketches、记 withdrawnAt；归档三关之一是指纹比对（DL-35）
    at: '2026-11-05'
    sketches: { sketches/state.desk.yaml: <内容指纹 SHA-1，与 owned.json 同一算法> }
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

流程（07 §3）：

1. **开始设计**：在一个模块上「在此设计」进入草图画布——底稿从基线复制该模块的一层（§3.10），辅助栏自动打开「对话」（DL-4）；也可以手写 `sketches/<挂载点>.yaml`；往下一层就在那个模块上再挂一张（SK-14）；`lint:model` 校验格式与 ID；同挂载点已有持久草图时声明 `supersedes`，要改骨架就画根挂载的草图并 `supersedes: skeleton`。
2. **说想法，看图，再说**：对话里说想法、贴照片，AI 一轮一轮改图——每轮改动立刻画上、标色打号，一次性应用为设计级撤销的一步（DL-1）；改动项按血缘聚合、稳定编号不复用（§3.10「改动项编号表」），哪一项不要撤回哪一项，整轮不要点「撤回本轮」（DL-2）；也可以直接在画布上拖、在表单里改，与 AI 的改动进同一条记录。**「交给 AI 展开一轮」是可选预览**（信息条「认可 ▾」的下拉）：仍按下面的「写法约定」整份复制出一轮完整快照，供对比与留痕；AI 起草后自己先跑一遍 `lint:model` 与核验，零 error 才交。
3. **认可**：点信息条「认可」，架构台弹出这张设计从头到尾的改动清单和影响面（影响面按当前描述估，DL-7），最后看一眼后果；确认后 `status: accepted`、草图锁定（对话只能问、手势禁用、撤回变灰）、记下各张草图的指纹（DL-9）；「回到起草」回「起草中」、指纹作废、任务单标「认可已撤回」。
4. **任务单**：「改动」页签原号不变地变成任务单——每一项就是「代码现在是这样、草图要它变成那样」的一条差别，附一句怎样算做到（对应核验条目）；复制给写代码的 AI（Markdown）或导出给外部系统，命令行 `npm run arch -- tasks --design <设计> [--json]` 与 MCP 工具 `tasks` 给同一份；状态由核验推出（✓ / 待做 / 不核验），不让人勾（TK-3、DL-36）；写代码的 agent 照「待做」改代码、重新生成当前描述，不碰草图、规则与确认记录。
5. **执行后归档**：代码改完、重新生成当前描述，架构台自动重算任务单——做到的项打 ✓ 留在清单，没做到的标「待做」；核验一致（X4）、规则没有新违反（棘轮 U8）、草图自认可未改动（指纹比对）**三关全绿才能归档**；归档写确认记录（指纹取归档当时的当前版本，X3）、状态改 `implemented`，晋升时草图替换对应的持久草图；归档预览列「认可时估牵动 N · 实际改了 N′」并列差；草图、对话、改动清单原样保留，是这次设计的证据。归档由人显式发起（面板或 `arch sketch archive`）。

写法约定：

- **起草**：先确认当前版本与代码一致（不一致先重新生成并提交），再把当前版本整份复制为 `r1/`，在副本上按草图扩展；不改当前版本。复制的是描述本身（`system.yaml`、`intent/`、`modules/`、`actors.yaml`、`scenarios/` 等）；**不含** `designs/`（设计不嵌套）、`governance/`（基线、拦截记录与指纹只对当前版本）、`reviewed.yaml`（确认只对当前版本，Z1）。`intent/` 要复制：每一轮只读自己目录里的文件，持久草图（含骨架）不会自动带进各轮，不复制则该轮没有层与骨架约束。
- **只改要改的**：新增实体按 §3 写；已有实体只在设计确实要调整时改，ID 保持不变（界面按 ID 对比）；删除就直接删。
- **设计说明**：每个新增或修改的实体写 `designNote`，说清为什么这样设计、取舍是什么。
- **本轮说明**：写在该轮的 `revision.yaml`（`date`、`summary`、`questions`）；AI 起草或修改任何一轮都**不碰 `design.yaml`**——它是人拥有的文件，改了即 `owned.changed`（X6）。
- **新一轮**：评审意见由人记到上一轮（页面「记录评审意见」或直接写 `design.yaml` 后 `arch own`），再由 AI 把上一轮整份复制为新一轮修改（复制后改写新一轮的 `revision.yaml`）；旧轮次不再改动。
- 设计版本同样要求 `lint:model` 0 个错误（逐轮校验）。

### 按草图扩展

给 AI 的规范（「保存并交给 AI」的指令由各张草图全文、相对基线的变更摘要与这一节组成）：

1. 草图是约束，不是建议：草图里的每个实体都必须出现在你的版本里，ID、父子关系、`kind`、`role`、分层（`strata` 的层、层序、可依赖的层与成员归属）与草图一致；草图写的关系（两端与类型）与接口（ID 与 `owner`）必须有对应——草图写的关系类型是架构师确认的分类，不得改写（X23）；草图声明的端口实现者要在接口的 `implementedBy` 里出现（X24）。
2. 声明 `closed` 的子树下，直接子模块的集合必须与草图相等——不多不少；没声明的子树可以加子模块。
3. 没写的字段由你展开：职责、实现原理、接口签名、数据结构、更深层的子模块与关系，都按 §3 的生成规范写全。
4. ID 纪律（X5）：草图里的 ID 由架构师起，你只能沿用；你新增的实体只能挂在草图实体之下，ID 以其为前缀（如草图有 `model.scenario`，你可以加 `model.scenario.plan`，不能加 `model.playback`）；不得重命名、移动草图里出现过的实体，要改就把问题写进 `design.yaml` 的 `questions` 交给架构师改草图。
5. 从当前版本整份复制为新一轮，只改要改的；每个新增或修改的实体写 `designNote`；本轮说明与待确认问题写在新一轮的 `revision.yaml`，不改 `design.yaml`。
6. 按血缘执行变更摘要（X11、X12）：合并——来源模块降为合并结果的子模块，它们的整棵子树、关系两端、接口 `owner`、代码落点换成新前缀；拆分——原模块的子模块、接口与代码落点按新模块的职责分配，分配不了的写进 `questions`；改 ID 与移动——同样换前缀。草图的 `abstraction` 是挂载点模块对内的原则，展开它的子模块时遵守。
7. 起草后运行 `npm run lint:model` 与 `npm run arch -- sketch-check --design <设计>`：零 error 才算完成；提醒级偏差如确有理由，写进 `questions` 由架构师认可，不要自己改草图。
