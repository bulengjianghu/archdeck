# 架构描述生成规范（给 AI 用）

> 适用：由 AI 读取项目代码，生成或重新生成 `model/<项目>/` 下的 YAML（ADR-0001）。下文以 h5player 为例；其他项目（如本项目自身 `model/h5p-arch-desk/`）同样遵守 §3–§6，§2 的骨架换成该项目的分层。
> 文件格式以 `schema/arch-file.schema.json` 为准，字段含义见需求文档 §3。

## 1. 目录与分工

```text
model/h5player/
  system.yaml              系统根 + 生成来源 source{repo, commit, generatedAt}
  modules/
    layers.yaml            骨架：4 个层 + 全部第二级模块（ID 固定，见 §2）
    <area>.yaml            各区域的子树：第二级模块之下的模块、本区域关系、接口、数据结构
```

- 骨架 `layers.yaml` 只描述层和第二级模块，任何区域文件都**不得重复定义**它们，只能用 `parent: <第二级 ID>` 往下挂子模块。
- 一个区域文件 = 一位生成者负责的范围，互不改写，便于并行生成和局部重新生成。

## 2. 骨架（第二级模块 ID 固定）

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

## 3. 写模块

- **粒度**：模块是「一组内聚的职责」，通常对应 1~10 个文件，不是一个文件一个模块。第二级之下一般再分 1~2 级；只有内部确实还有清晰子结构时才继续分。一个父模块的子模块以 3~9 个为宜。
- **ID**：`<父 ID>.<短名>`，短名用 kebab-case，如 `infra.framework.pipeline`。
- **必填**：`id`、`name`、`responsibility`。
- **职责** `responsibility`：一两句话说清负责什么；有明显的「不负责什么」就写上。不要复述文件名。
- **实现原理** `principle`：只给关键模块写，说清核心机制（几句话或几条要点，Markdown）。
- **接口** `provides` / **数据结构** `dataStructures`：只列对外有意义的（被其他模块调用或交换的），不列内部辅助函数。
- **codeRefs**：h5player 仓库根相对路径或 glob；**docRefs**：h5player 内相关设计文档路径，如 `docs/design/0-kernel/state-machine.md`。
- **核心模块** `core: true`：仅用于第二级模块（层的直接子模块），由骨架维护，每层 3~5 个，优先被其他层依赖最多的。
- **status**：已落地写 `current`（可省略）；蓝图中有、代码中尚未落地的写 `target`；仍在但计划移除的写 `deprecated`。

## 4. 写接口与数据结构

- 接口 ID：`if.<模块短路径>.<方法或接口名>`，如 `if.framework.pipeline.updatePipeline`。`owner` 填提供方模块 ID。
- 数据结构 ID：`ds.<TS 类型名>`，如 `ds.PipelineTransaction`。**由声明该 TS 类型的区域定义**，其他区域直接引用同名 ID。
- `signature` / `definition` 用 TS 语法，可裁剪到只保留关键成员（加 `// …` 表示省略），不超过 ~25 行。
- `semantics` 写前置条件、副作用、错误、时序约束。

## 5. 写关系

| type | 何时用 |
|---|---|
| `depends` | 编译期 import 依赖，且不是更具体的 calls / implements |
| `calls` | 运行时同步或异步调用，控制权转移 |
| `dataflow` | 数据面推送（帧、分片、样本） |
| `event` | 发布 / 订阅事件；from = 订阅方，to = 发布方（与依赖方向一致） |
| `implements` | 实现某个端口或契约（from = 实现方，to = 端口 / 契约所在模块） |

- 关系 ID：`rel.<区域>.<序号或短名>`，全局唯一。
- 关系端点写在**能表达清楚的最深模块**上，上层会自动聚合。
- 跨区域关系：对端只能写对方的**第二级模块 ID**（§2 表），不要猜对方更深的 ID。
- 祖先与后代之间不能建关系；不要为「包含」建关系。
- 异步（Worker postMessage、事件、定时器回调）标 `mode: async`。
- 有明确接口时填 `interface`，有明确数据载荷时填 `payload`。

## 6. 校验与提交

```bash
npm run lint:model
```

- 必须 0 个错误。提醒（warning）要逐条看：缺职责要补；引用了其他区域尚未定义的接口 / 数据结构时可暂时保留提醒。
- 重新生成后更新 `system.yaml` 的 `source.commit` 与 `source.generatedAt`。
