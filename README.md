# h5p-arch-desk

架构可视化：按层次浏览项目的模块与模块间关系。首页是项目列表（目前有 h5player、media-web 与本项目自身），进入项目后根层是分层总览（几层、各层抽象原则、层间依赖、核心模块），双击下钻到任意模块，单击查看职责、接口、数据结构与关系。

## 使用

```bash
npm install
npm run dev          # 本地查看：首页是项目列表，读取 model/ 下各项目，文件变化后自动刷新
npm run build        # 产出静态站点 dist/（含 projects.json、models/<项目>.json 与各设计版本），可部署到任意路径
npm run lint:model   # 校验架构描述，有错误时退出码为 1
npm test             # 单元测试
```

指向其他模型根目录：`ARCH_MODEL_ROOT=path/to/model npm run dev`；只校验某个项目目录：`npm run lint:model -- model/h5player`。

## 操作

| 操作 | 效果 |
|---|---|
| 拖动空白 / 滚轮 | 平移 / 缩放；左下角「适应」回到全貌 |
| 单击模块或边 | 右侧面板显示属性；单击空白取消选中 |
| 双击模块 | 下钻（有子模块时）；双击边界节点跳到该外部模块所在层次 |
| 悬停模块 | 高亮其关系；分层总览中显示核心模块的跨层关系 |
| 面包屑 / Esc / Backspace / 浏览器后退 | 返回上级；面包屑「项目」或在根层按 Backspace 回到项目列表 |
| 搜索框 | 按名称或 ID 跳到模块 |

当前层次与选中会写进 URL，复制链接即可分享同一视图。

## 架构描述从哪来

`model/` 下每个含 `system.yaml` 的子目录是一个项目（[ADR-0001](docs/adr/0001-model-location.md)）：

- `model/h5player/`：由 AI 读取 h5player 代码生成；
- `model/media-web/`：由 AI 读取 media-platform 仓库 media-web 工作区（浏览器侧 npm 包）的代码生成；
- `model/h5p-arch-desk/`：本项目自身的架构描述。

规范见 [docs/04-model-generation.md](docs/04-model-generation.md)。代码有变化时让 AI 按规范重新生成对应文件，并更新 `system.yaml` 中的 `source.commit`。新增项目只需新建一个子目录。

## 设计版本

迭代某个项目前，可以先让 AI 在当前架构上出一份**设计版本**评审，多轮沟通后定稿再开发（[ADR-0002](docs/adr/0002-design-versions.md)）。设计版本放在 `model/<项目>/designs/<设计>/`，每轮（r1、r2…）是一份完整描述；项目视图左上角切换版本，设计版本中图上标出相对当前版本（或上一轮）的新增 / 修改，「△N」表示其内部涉及 N 处变更，根层面板有设计目标、本轮说明、待确认问题和完整变更清单。起草方式见[描述生成规范 §7](docs/04-model-generation.md#7-设计版本adr-0002)。

## 文档

- [需求](docs/01-requirements.md) · [技术选型](docs/02-tech-selection.md) · [架构](docs/03-architecture.md) · [描述生成规范](docs/04-model-generation.md) · [ADR](docs/adr/README.md)
