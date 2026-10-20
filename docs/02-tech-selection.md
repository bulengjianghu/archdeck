# h5p-arch-desk 技术选型

> 状态：v1.1（2026-10-20）。v1.0 定档于 2026-10-19；v1.1 按二期设计定稿（[ADR-0003](./adr/0003-phase2-dynamic-view.md)）更新 §2 数据格式、§3.3、§3.5、§4、§5–§8
> 对应需求：[01-requirements.md](./01-requirements.md)

---

## 1. 选型原则

1. **与仓库现有栈一致**：h5player-demo 下各包统一为 Vue 3 + Vite + TypeScript + Vitest（见 `packages/auto_test/package.json`），新包沿用，降低维护成本。
2. **架构描述即代码**：架构数据是纯文本，进 git，可 diff、可评审、可由 AI 直接编辑；页面只是它的渲染器。
3. **一期无后端**：开发态由 Vite 插件读文件，构建态打成静态 JSON，不引入服务端。
4. **核心规则自己写，图形能力用库**：层次投影、聚合边、场景展开是本工具的核心逻辑，写成与 UI 无关的纯函数并充分单测；平移缩放、选中、布局交给成熟库。

## 2. 选型总表

| 关注点 | 选择 | 版本基线 | 备选 |
|---|---|---|---|
| 框架 | Vue 3（`<script setup>` + TS） | `vue@^3.5` | — |
| 构建 | Vite | `vite@^6` | — |
| 图画布 | **Vue Flow**（`@vue-flow/core`） | `^1.48` | AntV X6、AntV G6 v5、Cytoscape.js |
| 自动布局 | **elkjs**（layered 算法） | `^0.11` | dagre（`@dagrejs/dagre`） |
| 时序图（二期） | **自研 SVG 组件** | — | Mermaid（仅作导出） |
| 路由 / 深链接 | vue-router | `^4.6` | — |
| 状态管理 | Vue `reactive` + composables | — | Pinia（规模变大再引入） |
| 数据格式 | YAML 或 JSON（同一个解析器，JSON 是 YAML 的子集） | `yaml@^2` | — |
| 结构校验 | JSON Schema + ajv | `ajv@^8`、`ajv-formats@^3` | zod |
| 类型定义 | 手写 TS 类型，与 Schema 并排维护 | — | json-schema-to-typescript（模型字段少，生成步骤不划算） |
| Markdown | markdown-it | `^14` | marked |
| 代码高亮 | Shiki（按需加载 ts 语法） | `^3` | highlight.js |
| 分栏 / 分屏 | 自写 CSS Grid + 拖动条；二期分屏容器按可序列化的布局树排布 | — | splitpanes |
| 单元测试 | Vitest + @vue/test-utils + jsdom | 与 auto_test 一致 | — |
| E2E（后续） | Playwright | 与 auto_test 一致 | — |
| 包管理 | npm（与 auto_test 一致，独立 `package-lock.json`） | — | — |

版本号在初始化工程时以当时已发布两周以上的稳定版锁定。

## 3. 关键选型说明

### 3.1 图画布：Vue Flow

候选对比：

| | Vue Flow | AntV X6 | AntV G6 v5 | Cytoscape.js |
|---|---|---|---|---|
| 与 Vue 3 结合 | 原生，节点就是 Vue 组件 | 需 `@antv/x6-vue-shape` 桥接 | 无 Vue 绑定，命令式 | 无 Vue 绑定，命令式 |
| 渲染 | DOM + SVG | SVG | Canvas / WebGL | Canvas |
| 平移/缩放/选中/fit/minimap | 内置 | 内置 | 内置 | 内置 |
| 自定义节点（多行文字、徽标、状态框） | 写 Vue 组件即可，最简单 | 可以，较繁琐 | 需写图形代码 | 样式表达力有限 |
| 适合规模 | 数百节点 | 数百节点 | 上万节点 | 数千节点 |
| 编辑器能力（后续画布内编辑） | 有连线、拖拽等 | 最强 | 中 | 弱 |
| 许可 | MIT | MIT | MIT | MIT |

**选 Vue Flow 的理由**：本工具「一个层次只看该层次」，单屏节点数在几十量级，DOM 渲染完全够用；节点需要承载名称、类别、状态、可下钻标识、聚合计数等富内容，用 Vue 组件写最直接；平移、缩放、选中、fit、minimap 都是现成能力，后续画布内编辑也有基础。

**风险与对策**：若后续出现「全模型平铺」或「演化总览」这类上千节点的视图，Vue Flow 会吃力。对策是把画布封装在 `GraphCanvas` 组件后，对外只接收「节点列表 + 边列表 + 选中态」，届时可换 G6 实现该视图而不影响其余代码。

### 3.2 自动布局：elkjs

- 按关系方向分层排布（layered），支持正交走线、端口、减少交叉，效果优于 dagre。
- 运行在 Web Worker 中，大图不卡主线程。
- 体积较大（约 1.5MB 未压缩），按需动态 `import()`，不进首屏包。
- 布局结果按「层次 ID + 节点集合哈希」缓存；描述文件里手工保存的坐标（需求 C-12）优先于自动布局。

### 3.3 时序图（二期）：自研 SVG 组件

Mermaid 能画时序图，但输出是一整张 SVG 字符串，难以做到「指向某一步 → 面板联动 → 结构图同步定位」，也无法按层次投影参与者。二期场景数据本身已是结构化的步骤树（call / alt / loop / par / async / ref），布局规则简单（泳道等距、步骤纵向累加、组合框包住子步骤），自研 Vue + SVG 组件成本可控且完全可交互。Mermaid 只用于「导出到文档」。

结构图上的回放直接复用 Vue Flow：按当前可见消息给对应边加流动动画 class（方向可与边箭头相反）、给节点加高亮态，不新增节点、不重新布局。唯一的例外是「结构中未建模」的临时虚线：它不参与布局，用两端节点的坐标直接画一条曲线。

### 3.4 数据格式：YAML + JSON Schema

- YAML 适合人和 AI 读写长文本（职责、原理用 `|` 多行块）；h5player 的 `scripts/coverage-modules.mjs` 已在用 `yaml` 包，ajv 也已在 h5player 依赖中，保持一致。
- 一份 JSON Schema 同时用于：编辑器提示（VS Code YAML 插件）、ajv 运行时校验、生成 TS 类型。
- Schema 只校验单文件结构；跨文件引用完整性（ID 存在、无重复、祖先-后代不连边）由自写的 `validateModel()` 完成。

### 3.5 状态管理：一个值 + 纯转移 + 一个协调者，仍不用 Pinia

二期定稿（ADR-0003）后的结构：

- **视图状态是一个值**（`ViewState`：层次、选中、悬停、开关、回放），互相约束，不拆成多个 store。
- **会话规则是纯函数**：`transition(state, action, ctx) → { state, history }`，不依赖 Vue、路由、计时器，按领域规则清单穷举单测。关于被描述系统的问题（最近祖先、本层下一步等）调用模型层的架构查询。
- **一个协调者**：`useDeskState()` 持有 `shallowRef<ViewState>`，唯一写入口 `dispatch(action)`，派生数据全部是 `computed`；与外界的交互交给四个同步适配器（路由、时钟、模型源、布局），每个都能用假对象单测。

这本质上是一个小型的 reducer 模式，用 Vue 的 `shallowRef` + `computed` 实现已足够；状态只有一个值、写入口只有一个，引入 Pinia 没有额外收益。若后续加入编辑、撤销，可在 `dispatch` 上直接做历史记录。

## 4. 数据模型与文件组织

### 4.1 存放位置

已定（见 [ADR-0001](./adr/0001-model-location.md)）：放在本项目内。模型根目录 `model/` 下每个含 `system.yaml` 的子目录是一个项目：

```text
h5p-arch-desk/model/
  h5player/                        ← h5player 的描述，由 AI 根据 h5player 代码生成
  h5p-arch-desk/                   ← 本项目自身的描述
```

单个项目目录的组织：

```text
model/<项目>/
  system.yaml                      ← 根：系统名、生成来源 source{repo,commit,generatedAt}
  modules/
    share.yaml
    domain.yaml
    application.yaml
    infrastructure/
      index.yaml
      framework.yaml               ← 一个文件描述一个模块子树，大小自定
  interfaces/*.yaml
  data-structures/*.yaml
  actors.yaml                      ← 二期：外部参与者（也可写在任意文件的顶层键 actors 下）
  scenarios/*.yaml|json            ← 二期：与 modules/ 同级，YAML / JSON 均可
  designs/<设计>/                   ← 设计版本（ADR-0002），读取当前版本时跳过
```

`ModelSource` 默认读取 `model/`，可用环境变量 `ARCH_MODEL_ROOT` 指向其他模型根目录。

### 4.2 模块文件示例

```yaml
# modules/infrastructure/framework.yaml
module:
  id: infra.framework
  name: Framework 机制内核
  kind: subsystem
  status: current
  responsibility: |
    提供状态机、Pipeline、插件生命周期、事件/错误路由、ModelRegistry 等通用机制；
    不包含方案选择规则和播放策略。
  codeRefs: [packages/framework/src/**]
  docRefs: [docs/design/0-kernel/state-machine.md]
  children:
    - id: infra.framework.state-machine
      name: StateMachine
      kind: component
      responsibility: Player 生命周期状态的唯一变更通道，按命令驱动状态迁移。
      provides: [if.sm.sendCommand]
      dataStructures: [ds.command, ds.player-status]
    - id: infra.framework.pipeline
      name: Pipeline
      kind: component
      responsibility: 维护 Load/Process/Play 三段 MU 图，以事务方式提交图变更。
      provides: [if.pipeline.updatePipeline]

relations:
  - id: rel.sm-hook-solution
    from: infra.framework.state-machine
    to: app.solution
    type: calls
    mode: sync
    interface: if.solution.hooks
    description: 命令执行前后回调 Solution 的 pre/post hook。
```

层的写法（根层的分层总览靠这些字段）：

```yaml
# modules/domain.yaml
module:
  id: domain
  name: Domain
  kind: layer
  order: 3
  abstraction: 规则与事实；纯决策，无 DOM / 网络
  includes: [纯决策, 领域类型与模型, 协议算法, 规则表, 领域端口]
  excludes: [DOM, 网络, Framework/Player 实现, 装配时序]
  mayDependOn: [share]
  children:
    - { id: domain.services, name: Services, core: true, responsibility: … }
    - { id: domain.models, name: Models, core: true, responsibility: … }
    - { id: domain.events, name: Events, responsibility: … }   # 非核心，总览中折叠为 +N
```

### 4.3 接口与数据结构示例

```yaml
# interfaces/pipeline.yaml
interfaces:
  - id: if.pipeline.updatePipeline
    name: updatePipeline
    owner: infra.framework.pipeline
    signature: |
      updatePipeline(tx: PipelineTransaction): Promise<Result<void, ErrorBase>>
    semantics: |
      - 原子提交：失败时图保持提交前状态
      - 新增节点按当前播放状态补齐生命周期

# data-structures/pipeline.yaml
dataStructures:
  - id: ds.pipeline-transaction
    name: PipelineTransaction
    definition: |
      interface PipelineTransaction {
        add: MuNodeSpec[]
        remove: MuId[]
        rewire: EdgeSpec[]
      }
```

### 4.4 场景文件示例（二期）

字段与规则见需求 §3.7、§5.1；规则编号见设计版本 r4 的领域规则清单。

```yaml
# actors.yaml
actors:
  - { id: actor.viewer, name: 观众, kind: user }
  - { id: actor.biz,    name: 业务方, kind: system, description: 通过 SDK API 调用播放器 }

# scenarios/command-flow.yaml
scenario:
  id: sc.command
  name: 命令执行（play / switch / reset）
  cause: 业务方调用 play / switch / reset
  # 不写默认层次（S9）；触发者 = 第一条消息的发送方 actor.biz（A6）
  steps:
    - call: { id: cmd, from: actor.biz, to: infra.player-index, label: play/switch/reset }
    - call: { from: infra.player-index, to: infra.framework.state-machine, interface: if.sm.sendCommand }
    - call: { from: infra.framework.state-machine, to: app.solution, label: pre/post hook }
    - call: { from: app.solution, to: domain.services, label: select / reconcile / policy }
    - alt:                                  # 回放到这里停下，由用户选择（F6）
        - when: 需要改图
          steps:
            - call: { id: update, from: app.solution, to: infra.framework.pipeline, interface: if.pipeline.updatePipeline }
            - loop:                         # 回放时展开一遍（F4）
                while: 每个新增 MU
                steps:
                  - call: { from: infra.framework.pipeline, to: infra.mus, label: lifecycle catch-up }
        - when: 无需改图
          steps: []
    - async: { from: infra.framework.state-machine, to: actor.biz, label: command result / event }
```

同样的内容写成 JSON 也可以；两者解析成同一份数据结构。

## 5. 工程结构

带「二期」标注的是按 ADR-0003 新增的目录，尚未实现。

```text
packages/h5p-arch-desk/
  docs/                       需求、选型、架构、生成规范、ADR
  schema/
    arch-file.schema.json     JSON Schema 真源（单个描述文件的结构）
  src/
    model/                    ← 关于被描述系统的知识，纯函数，单测重点
      types.ts  design.ts  project-summary.ts
      load.ts                 解析并合并多个描述文件
      validate.ts             跨文件引用与约束校验
      indexer.ts              索引与查询（最近公共祖先、最近仍存在的祖先）
      project.ts              层次投影（需求 §3.5、§3.6）、端点映射、最近可见层次
      diff.ts                 版本对比（ADR-0002）
      scenario/               二期：plan（回放计划 + 关系绑定）· path（回放路径与分支选择）·
                              level（帧的层次投影、下一步、落点）· participation（参与查询）· sequence（时序模型）
    state/
      useDeskState.ts         协调者：持有视图状态、dispatch、派生
      inject.ts
      transition/             二期：会话规则（focus · navigation · playback · url），纯函数
      sync/                   二期：同步适配器（router · clock · modelSource · layout）
    layout/
      layout.ts               结构图排布（分层总览 / elkjs，Worker 中运行）
      sequence.ts             二期：时序图排布
    components/
      ProjectList.vue  DeskView.vue  GraphCanvas.vue  Breadcrumb.vue  Toolbar.vue  Legend.vue  IssueBanner.vue
      VersionSwitcher.vue  DesignBar.vue
      nodes/  edges/  panel/
      PerspectiveSwitch.vue  ScenarioList.vue  PlayerBar.vue  BranchChooser.vue   二期
      split/  sequence/                                                          二期
    App.vue  main.ts          路由：/ 项目列表，/p/<项目>[/d/<设计>/<轮次>] 项目视图
  vite/
    archModelPlugin.ts        开发态端点与变更推送；构建态输出静态文件
    readModelDir.ts           列项目、读项目与设计版本、生成项目摘要
  scripts/
    lint-model.ts             命令行校验（含设计版本），供 CI
  model/<项目>/               各项目架构描述（ADR-0001），designs/ 下为设计版本（ADR-0002）
  tests/                      vitest 单测；tests/fixtures/ 为测试用小模型
  package.json  vite.config.ts  tsconfig*.json
```

`package.json` 脚本：`dev` / `build` / `preview` / `test` / `type-check` / `lint:model`。

## 6. 数据流

```text
描述文件（YAML / JSON）──(Vite 插件)──> 原文
   └─(load + validate)──> 合法模型 / 问题列表(带文件与行号)
         └─(buildIndex)──> 模型索引
               ├─(projectLevel(index, levelId, options))──> 层次视图 ──(布局同步：elk / 分层)──> 带坐标的结构图
               └─ 二期，打开场景时：
                  planScenario ──> 回放计划 ──(resolvePath + 已选分支)──> 回放路径
                     └─(projectScenario(index, 层次视图, 路径))──> 本层可见消息 ──> 时序模型 ──(layoutSequence)──> 时序图
用户意图 / 外界变化 ──> 动作 ──(dispatch → transition)──> 新视图状态 ──> 以上派生重新计算；路由与时钟由同步适配器跟随状态
```

文件变更时 Vite 插件推送自定义 HMR 事件，模型源同步适配器重新加载并 dispatch，层次与选中按导航规则保留或回退。

## 7. 测试策略

| 层 | 内容 | 工具 |
|---|---|---|
| 纯逻辑：模型层 | 加载合并、引用校验、层次投影规则、聚合边计数、版本对比；二期的架构查询与场景展开 / 投影，按领域规则清单逐条穷举 | Vitest，目标覆盖率 ≥ 90% |
| 纯逻辑：会话规则 | 二期视图状态转移（视角与焦点、导航、回放、URL 编解码），按领域规则清单逐条穷举，并断言每次转移后焦点不变式成立 | Vitest |
| 同步适配器 | 路由（含回声处理）、时钟、模型源、布局 | Vitest + 假路由 / 假时钟 |
| 组件 | 面板按选中类型渲染、面包屑跳转、双击下钻事件 | Vitest + @vue/test-utils |
| 端到端 | 需求 §8.1、§8.2 的验收标准 | Playwright（后续） |

实施计划不写进仓库（项目负责人决定）：由开发者按本文与领域规则清单自行推进，重要决策记 ADR。

## 8. 分期落地建议

| 阶段 | 内容 |
|---|---|
| P0 | 工程初始化、Schema、`model/` 纯逻辑与单测、示例数据 |
| P1 | 画布 + 面板 + 下钻 + 面包屑 + 自动布局（需求 C-1 ~ C-8） |
| P2 | 录入 h5player 初始架构内容（需求 §4.5）、热更新、`lint:model` |
| P3 | P1 级需求（悬停高亮、深链接、搜索） |
| P4 | 二期（ADR-0003），按依赖从内到外：|
| P4a | 重构一期：视图状态转移（导航规则）与同步适配器抽出，定位类知识下沉为架构查询；行为不变，一期测试全绿 |
| P4b | 数据模型：Schema 与类型（actors、scenario / scenarios、.json）、Loader、Validator（S5–S13）、Indexer（scenariosOf、triggeredBy）；参与者进入静态视图（投影、布局、节点、面板） |
| P4c | 场景投影：回放计划、回放路径、帧的层次投影、参与查询、时序模型，按规则清单穷举单测 |
| P4d | 会话规则与适配器：视角与焦点、回放、URL；时钟同步 |
| P4e | 界面：视角切换、场景列表、分屏容器、时序图、回放控制条、舞台与回放叠加、运行信息与步骤 / 场景 / 参与者面板 |
| P4f | 内容与验收：h5p-arch-desk 自身场景、h5player 两个迁移场景（D-8）；需求 §8.2 验收；按代码重新生成当前版本，设计版本状态改为 implemented |
