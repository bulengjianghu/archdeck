# ADR-0001：架构描述 YAML 放在本项目内

- 状态：已采纳
- 日期：2026-10-19
- 决策人：项目负责人
- 关联：需求文档 §8 Q1、描述格式 §1

## 背景

h5player 的架构描述由 AI 根据 h5player 代码生成，以 YAML 文件存放。需要决定这些文件放在哪个仓库。

## 选项

| 选项 | 优点 | 缺点 |
|---|---|---|
| A. `h5player/docs/arch/model/` | 描述与代码同版本，后续看演化可直接用 h5player 的 git 历史 | 每次重新生成都要在 h5player 仓库提交，牵动其文档门禁与评审流程 |
| B. `h5p-arch-desk/model/h5player/` | 只改 h5player-demo 仓库，迭代快，不打扰 h5player | 描述版本与 h5player 代码版本没有天然对应 |

## 结论

采用 B：描述文件放在本项目 `model/h5player/` 下。

## 后果

1. `ModelSource` 默认读取 `model/h5player/`，仍保留环境变量 `ARCH_MODEL_DIR` 以便指向其他目录。
2. 为弥补版本对应关系，`system.yaml` 必须记录生成来源：`source: { repo, commit, generatedAt }`。AI 每次重新生成时更新它；面板在根层显示该信息，架构师能知道图对应的是哪个 h5player 版本。
3. 后续若做「演化」，以本仓库中 `model/h5player/` 的 git 历史为准，结合 `source.commit` 对应到 h5player 的代码版本。
4. 若以后迁回 h5player 仓库，只需移动目录并改模型根目录配置，代码无需改动。

## 补充（2026-10-19）

工具扩展为多项目后，约定推广为「模型根目录 `model/` 下每个含 `system.yaml` 的子目录是一个项目」：h5player 的描述仍在 `model/h5player/`，本项目自身的描述在 `model/h5p-arch-desk/`。环境变量由 `ARCH_MODEL_DIR`（单个目录）改为 `ARCH_MODEL_ROOT`（模型根目录）。本条结论不变。
