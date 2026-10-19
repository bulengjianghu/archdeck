# h5p-arch-desk

h5player 架构可视化：按层次浏览模块与模块间关系。根层是分层总览（几层、各层抽象原则、层间依赖、核心模块），双击下钻到任意模块，单击查看职责、接口、数据结构与关系。

## 使用

```bash
npm install
npm run dev          # 本地查看，读取 model/h5player/，文件变化后自动刷新
npm run build        # 产出静态站点 dist/（含 model.json），可部署到任意路径
npm run lint:model   # 校验架构描述，有错误时退出码为 1
npm test             # 单元测试
```

指向其他描述目录：`ARCH_MODEL_DIR=path/to/model npm run dev`，或 `npm run lint:model -- path/to/model`。

## 操作

| 操作 | 效果 |
|---|---|
| 拖动空白 / 滚轮 | 平移 / 缩放；左下角「适应」回到全貌 |
| 单击模块或边 | 右侧面板显示属性；单击空白取消选中 |
| 双击模块 | 下钻（有子模块时）；双击边界节点跳到该外部模块所在层次 |
| 悬停模块 | 高亮其关系；分层总览中显示核心模块的跨层关系 |
| 面包屑 / Esc / Backspace / 浏览器后退 | 返回上级 |
| 搜索框 | 按名称或 ID 跳到模块 |

当前层次与选中会写进 URL，复制链接即可分享同一视图。

## 架构描述从哪来

`model/h5player/` 由 AI 读取 h5player 代码生成（[ADR-0001](docs/adr/0001-model-location.md)），规范见 [docs/04-model-generation.md](docs/04-model-generation.md)。代码有变化时让 AI 按规范重新生成对应区域文件，并更新 `system.yaml` 中的 `source.commit`。

## 文档

- [需求](docs/01-requirements.md) · [技术选型](docs/02-tech-selection.md) · [架构](docs/03-architecture.md) · [描述生成规范](docs/04-model-generation.md) · [ADR](docs/adr/README.md)
