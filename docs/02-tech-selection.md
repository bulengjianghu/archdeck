# h5p-arch-desk 技术选型

> 状态：v1.0 定档（2026-10-19）
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
| 数据格式 | YAML | `yaml@^2` | JSON |
| 结构校验 | JSON Schema + ajv | `ajv@^8`、`ajv-formats@^3` | zod |
| 类型定义 | 手写 TS 类型，与 Schema 并排维护 | — | json-schema-to-typescript（模型字段少，生成步骤不划算） |
| Markdown | markdown-it | `^14` | marked |
| 代码高亮 | Shiki（按需加载 ts 语法） | `^3` | highlight.js |
| 分栏 | 自写 CSS Grid + 拖动条 | — | splitpanes |
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

Mermaid 能画时序图，但输出是一整张 SVG 字符串，难以做到「选中某一步 → 面板联动 → 结构图同步高亮」，也无法按层次投影参与者。二期场景数据本身已是结构化的步骤树（call / alt / loop / par / async / ref），布局规则简单（泳道等距、步骤纵向累加、组合框包住子步骤），自研 Vue + SVG 组件成本可控且完全可交互。Mermaid 只用于「导出到文档」。

结构图上的回放直接复用 Vue Flow：按当前步骤给对应边加动画 class、给节点加高亮态。

### 3.4 数据格式：YAML + JSON Schema

- YAML 适合人和 AI 读写长文本（职责、原理用 `|` 多行块）；h5player 的 `scripts/coverage-modules.mjs` 已在用 `yaml` 包，ajv 也已在 h5player 依赖中，保持一致。
- 一份 JSON Schema 同时用于：编辑器提示（VS Code YAML 插件）、ajv 运行时校验、生成 TS 类型。
- Schema 只校验单文件结构；跨文件引用完整性（ID 存在、无重复、祖先-后代不连边）由自写的 `validateModel()` 完成。

### 3.5 状态管理：先不用 Pinia

全局状态只有：已加载的模型、当前层次路径、选中对象、视图开关、（二期）当前场景与步骤。用一个 `useDeskState()` composable 持有，层次与选中同步到 URL query（vue-router），足够。若后续加入编辑、撤销、多视图联动导致状态变复杂，再引入 Pinia。

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
  scenarios/*.yaml                 ← 二期
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

```yaml
# scenarios/command-flow.yaml
scenario:
  id: sc.command
  name: 命令执行（play / switch / reset）
  level: root            # 默认展示层次
  steps:
    - call: { from: ext.user, to: infra.player-index, label: play/switch/reset }
    - call: { from: infra.player-index, to: infra.framework.state-machine, interface: if.sm.sendCommand }
    - call: { from: infra.framework.state-machine, to: app.solution, label: pre/post hook }
    - call: { from: app.solution, to: domain.services, label: select / reconcile / policy }
    - alt:
        - when: 需要改图
          steps:
            - call: { from: app.solution, to: infra.framework.pipeline, interface: if.pipeline.updatePipeline }
            - loop:
                while: 每个新增 MU
                steps:
                  - call: { from: infra.framework.pipeline, to: infra.mus, label: lifecycle catch-up }
        - when: 无需改图
          steps: []
    - async: { from: infra.framework.state-machine, to: ext.user, label: command result / event }
```

## 5. 工程结构

```text
packages/h5p-arch-desk/
  docs/                       需求、选型、计划
  schema/
    arch-file.schema.json     JSON Schema 真源（单个 YAML 文件的结构）
  src/
    model/                    ← 与 UI 无关的纯逻辑，单测重点
      types.ts                手写，与 schema/arch-file.schema.json 对应
      load.ts                 读取并合并多个 YAML 文件
      validate.ts             跨文件引用与约束校验
      index.ts                建立 id → 模块/父链/子集 索引
      project.ts              层次投影：可见节点、聚合边、边界节点（需求 §3.5）
      scenario.ts             二期：场景步骤树展开与按层次投影
    layout/
      elkWorker.ts            elkjs 布局（Web Worker）
    components/
      GraphCanvas.vue         封装 Vue Flow
      nodes/ModuleNode.vue    BoundaryNode.vue
      edges/RelationEdge.vue  AggregateEdge.vue
      panel/                  ModulePanel / RelationPanel / AggregatePanel
      Breadcrumb.vue  SearchBox.vue  Legend.vue
      sequence/               二期：SequenceView 等
    state/useDeskState.ts
    components/ProjectList.vue   项目列表主页
    components/DeskView.vue      单个项目的视图（按项目创建 DeskState）
    App.vue  main.ts             路由：/ 项目列表，/p/<项目> 项目视图
  vite/
    archModelPlugin.ts        开发态提供 projects.json / models/<项目>.json、按项目推送变更；构建态输出同名静态文件
    readModelDir.ts           列项目、读项目、生成项目摘要
  scripts/
    lint-model.ts             命令行校验，供 CI
  model/<项目>/               各项目架构描述（h5player 由 AI 生成；h5p-arch-desk 为本项目自身）
  tests/fixtures/             测试用小模型
  tests/                      vitest 单测（model/ 全覆盖）
  package.json  vite.config.ts  tsconfig*.json
```

`package.json` 脚本：`dev` / `build` / `preview` / `test` / `type-check` / `lint:model`。

## 6. 数据流

```text
YAML 文件 ──(Vite 插件: yaml 解析)──> 原始对象
   └─(ajv + validateModel)──> 合法模型 / 错误列表(带文件与路径)
         └─(buildIndex)──> 模型索引
               └─(projectLevel(index, levelId, options))──> { nodes, edges, aggregates, boundaries }
                     └─(elk 布局)──> 带坐标的节点
                           └─ GraphCanvas 渲染；选中 → Panel 按 id 查索引
```

文件变更时 Vite 插件推送自定义 HMR 事件，前端重新走一遍上面的流程，保留 URL 中的层次与选中 ID。

## 7. 测试策略

| 层 | 内容 | 工具 |
|---|---|---|
| 纯逻辑 | 加载合并、引用校验、层次投影四条规则、聚合边计数、场景展开与投影 | Vitest，目标覆盖率 ≥ 90% |
| 组件 | 面板按选中类型渲染、面包屑跳转、双击下钻事件 | Vitest + @vue/test-utils |
| 端到端（一期末） | 需求 §8 的 6 条验收标准 | Playwright |

按仓库 AGENTS.md 的 TDD 分工推进：先在 `docs/plan/` 下写实施计划与任务 ID，测试与实现分角色提交。

## 8. 分期落地建议

| 阶段 | 内容 |
|---|---|
| P0 | 工程初始化、Schema、`model/` 纯逻辑与单测、示例数据 |
| P1 | 画布 + 面板 + 下钻 + 面包屑 + 自动布局（需求 C-1 ~ C-8） |
| P2 | 录入 h5player 初始架构内容（需求 §4.5）、热更新、`lint:model` |
| P3 | P1 级需求（悬停高亮、深链接、搜索） |
| P4 | 二期：场景数据模型、时序图视图、图上回放 |
