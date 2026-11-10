# archdeck

AI 开发复杂系统的顶层视角驾驶舱：本地架构工作台 **h5p-arch-desk** 的开源仓库。2026-11 从 h5player-demo 的 `packages/h5p-arch-desk` 迁出并独立开源（保留全部提交历史，见文末「与上游同步」）。

**在线 demo**：<https://bulengjianghu.github.io/archdeck/>（GitHub Pages，每次 push 到 release/0.0.1 自动部署）。demo 是纯静态只读版：只展示本项目自身的架构描述（自举），源码预览、代码事实、设计版本均可交互；写入与 agent 对话仅在本地形态提供。

---

**本地架构工作台：看见 · 对照 · 守住。**

- **看见**：AI 把项目代码压缩成模块级的架构描述（`model/<项目>/`），本工具按层次画成可下钻、可点选的结构图，叠加场景回放执行链路，用「设计版本」先在图上评审、再开发。
- **对照**：描述与本地源码互相印证——文件归属、入口导出、关系是否被代码证实、有没有未描述的依赖；发现的问题汇总成按根因聚合的返工清单，交给人或 AI 修正。
- **守住**：架构规则、环与棘轮门禁让结构只许变好，coding agent 写代码前先问能不能依赖。

它是本地开发工具：被描述项目的源码必须在本地，开发服务器读源码、跑 TypeScript 语法解析、读 git，不做构建部署。

首页是项目列表（目前有 h5player、media-web-player、gix-next 与本项目自身），每张卡片先给健康度（描述问题、违规相对基线的变化、环、未证实、未归属），再给规模。进入项目后根层是分层总览（几层、各层抽象原则、层间依赖、核心模块），双击下钻到任意模块，单击查看职责、接口、数据结构与关系；顶部「运行」选一个场景即进入运行视角，逐步回放执行链路。

## 快速开始

```bash
npm install
npm run dev          # 本地查看：首页是项目列表，读取 model/ 下各项目，描述文件变化后自动刷新
```

打开终端里提示的地址，点一个项目卡片即可。本项目自身（`model/h5p-arch-desk`）的源码就是本仓库，开箱即用；克隆后首页会列出 `model/` 下全部描述项目，h5player 等外部项目的源码不在你机器上时，对应卡片会显示「源码根目录不存在」——属预期，本地开发工具的前提是被描述项目在本地（G1）。外部项目的描述要读它们的本地源码，`repo` 相对作者的工作区 `work4/` 书写，需先指定工作区根目录（否则单测、E2E 里涉及外部项目的用例也会失败）：

```bash
export ARCH_WORKSPACE_ROOT=/path/to/work4   # 含 h5player/、media-platform/ 的目录；单测、E2E 与 lint:model 同样需要
```

## 命令

| 命令 | 用途 |
|---|---|
| `npm run dev` | 启动本地架构工作台（读 `model/` 与被描述项目的本地源码） |
| `npm run build` | 类型检查与打包验证；产物不部署（本工具只在本地开发服务器上运行） |
| `npm run lint:model` | 校验全部架构描述（含设计版本每一轮），有错误时退出码为 1；`npm run lint:model -- model/h5player` 只校验一个项目 |
| `npm test` | 单元测试与验收（jsdom，读取真实的 `model/`） |
| `npm run test:e2e` | 浏览器端 E2E（Playwright，使用本机 Chrome，自动启动开发服务器） |
| `npm run arch -- <命令>` | 架构治理的命令行：`locate`、`check <from> <to>`（写前判定）、`violations`、`cycles`、`rescan`、`issues`（返工清单）、`report`、`baseline`（生成基线），`--project <项目>`、`--json` |
| `npm run arch:mcp` | 架构治理的 MCP 服务器（stdio），供 coding agent 写代码前判定依赖 |
| `npm run type-check` | 类型检查 |
| `npm run lint` / `npm run format` | ESLint + Prettier 检查 / 自动格式化 |

环境变量：`ARCH_MODEL_ROOT` 指向其他模型根目录；`ARCH_WORKSPACE_ROOT` 指定源码所在的工作区根目录，`ARCH_SOURCE_ROOT_<项目 ID>` 单独指定某个项目的源码目录（规则 G1）。

## 界面

```text
顶部：版本切换 · 结构 ｜ 运行：<场景> · 面包屑 · 搜索 · 显示开关 · 专注
左：导航树（模块 / 文件 / 步骤）  中：结构图 ｜ 副栏（时序图 / 源代码）  右：属性面板
底部（运行视角）：上一步 / 下一步、进度条、路线总览
```

- **结构视角**：看系统由什么组成、怎么连接。
- **运行视角**：看某个场景这一次怎么走。结构图作为舞台，默认只显示参与本场景的节点与走过的边；副栏是时序图，泳道按模块层次排列。回放只由你逐步驱动，没有自动播放。
- **选中是唯一的主语**：模块、关系、边、参与者、文件、步骤、场景都可以选中，一次只选一个，属性面板显示选中的对象。运行视角下：
  - 选中步骤：时序图上只有这条消息高亮，配对的调用 / 返回带浅色「配对」标记，结构图上其余走过的边变灰；
  - 选中模块等其他对象：时序图突出相关泳道，不突出消息；进度位置只在步骤序号旁留一个小标记 ◂；
  - 刚打开场景时选中的是场景本身（面板显示场景概览），按「下一步」选中第 1 步。

## 操作

| 操作 | 效果 |
|---|---|
| 拖动空白 / 滚轮 | 平移 / 缩放；左下角「适应」回到全貌 |
| 单击模块或边 | 选中，右侧面板显示属性；单击空白取消选中 |
| 双击模块 | 下钻（有子模块时）；双击边界节点跳到该外部模块所在层次 |
| 悬停模块 | 高亮其关系；分层总览中显示核心模块的跨层关系 |
| 面包屑 / Backspace / 浏览器后退 | 返回上级（并选中刚离开的模块）；根层按 Backspace 回到项目列表 |
| Esc | 先取消选中，没有选中时返回上级；运行视角下取消选中即回到进度所在的步骤 |
| 搜索框 | 按名称或 ID 跳到模块所在层次并选中 |
| 顶部「运行」 | 选一个场景进入运行视角；「结构」或 × 退出，层次与选中保留 |
| ← → / 「上一步」「下一步」 | 运行视角下单步，选中那一步 |
| 单击时序图消息、步骤树中的帧、结构图上的步骤序号 | 选中该步，进度跳到那里 |
| 单击 `alt` 的分支条件 / 数字键 | 改走该分支；回放控制条的路线总览可逐个改选 |
| 左下角「静态关系」 | 运行视角下不参与场景的节点与边：隐藏（默认）/ 淡显 / 全显 |
| 副栏标题栏 | 切换时序图 / 源代码页签、「定位」到当前步骤、切换左右 / 上下排列、收起 |
| 「专注」 | 一键收起导航树与属性面板，再按一次恢复 |
| 导航树「文件」页签 | 源码文件树（行数、超长标红、未归属标记）；单击文件在副栏只读预览 |
| 顶部「代码事实」 | 结构视角下在图上叠加代码事实：关系 ✓ 已证实 / ? 未证实，灰色虚线为未描述的依赖、红色为违规，↻ 为本层的环；单击叠加线看文件证据；根层面板「架构治理」有统计、违规与环 |

当前层次、选中、场景、步骤与已选分支都写进 URL，复制链接即可分享同一画面。分屏方向、比例、面板宽度等界面偏好记在本地。

## 架构描述从哪来

`model/` 下每个含 `system.yaml` 的子目录是一个项目（[ADR-0001](docs/adr/0001-model-location.md)）：

- `model/h5player/`：由 AI 读取 h5player 代码生成，含场景「命令执行」「方案切换事务」；
- `model/h5p-arch-desk/`：本项目自身的架构描述，含场景「打开场景并回放」。

写法见 [docs/04-description-format.md](docs/04-description-format.md)。代码变化后让 AI 按规范重新生成受影响的文件，并更新 `system.yaml` 中的 `source.commit`；用 `npm run lint:model` 自检（附带文件归属警告与治理门禁）。新增项目只需新建一个子目录。

## 架构治理

把 AI 生成的描述、架构师的规则与代码事实放在一起对照（[ADR-0015](docs/adr/0015-architecture-governance.md)，机制见[专题](docs/architecture/governance.md)）：

- **代码事实**：从源码提取文件依赖（TS 语法解析，穿透 barrel 再导出），按 `codeRefs` 提升为模块依赖，与描述比对：关系已证实 / 未证实，代码里有而描述里没有的依赖。
- **架构规则**：层的 `mayDependOn`（默认拒绝），加上 `model/<项目>/rules.yaml`（模块白名单、访问面、带理由的例外、容忍的环）。规则是架构师的意图，AI 重新生成描述时不改它。
- **棘轮门禁**：`npm run arch -- baseline --project <项目>` 生成基线，评审后提交；此后 `lint:model` 对基线之外的新增违规、环度上升报错。
- **agent 接口**：`npm run arch -- check <from> <to>` 与 MCP 服务器在写代码前判定一条依赖，并给出目标模块的职责、访问面与接口；判定与重新扫描写进 `governance/ledger.jsonl`，可统计拦截效果。

在被开发的仓库里把 MCP 服务器接给 coding agent（以 Claude Code 的 `.mcp.json` 为例；本仓库根目录的 `.mcp.json` 是本项目自举用的）：

```json
{ "mcpServers": { "arch": { "command": "npm", "args": ["--prefix", "<本仓库路径>", "run", "-s", "arch:mcp"], "env": { "ARCH_PROJECT": "h5player" } } } }
```

## 设计版本

迭代某个项目前，先让 AI 在当前架构上出一份**设计版本**，多轮评审定稿后再开发（[ADR-0002](docs/adr/0002-design-versions.md)）。设计版本放在 `model/<项目>/designs/<设计>/`，每轮（r1、r2…）是一份完整描述。左上角切换版本；设计版本中图上标出相对当前版本（或上一轮）的新增 / 修改，「△N」表示其内部涉及 N 处变更，根层面板有设计目标、本轮说明、待确认问题和完整变更清单。起草方式见[描述格式 §5](docs/04-description-format.md#5-设计版本)，完整的迭代方法见 [CLAUDE.md §3](CLAUDE.md)。

## 文档

[文档地图](docs/README.md)：[需求](docs/01-requirements.md) · [领域模型与规则](docs/02-domain.md) · [架构总览](docs/03-architecture.md)（[专题](docs/architecture/)）· [描述格式](docs/04-description-format.md) · [ADR](docs/adr/README.md)

## 与上游同步

本仓库源自 [h5player-demo](https://gitlab.iptco.me/lsst/lss/frontend/h5player-demo) 的 `packages/h5p-arch-desk`，上游在该包里的新提交通过 `git subtree split` 持续迁入（保留提交记录）：

```bash
docs/archdeck/sync-from-h5player-demo.sh [上游分支]   # 缺省 gix-next/model；split + fetch + merge + 描述对齐，一条龙
```

上游与本地各改了同一批文件时的约定：路径适配类修改（`model/h5p-arch-desk/system.yaml` 的 `source.repo`、CLAUDE.md/README 的路径说明）以本地为准，其余以上游为准；同步后脚本会把 `source.commit` / `generatedAt` 对齐到迁入的代码顶点。
