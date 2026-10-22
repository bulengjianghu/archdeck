/** 界面文案：领域枚举的中文显示名。只是呈现关注点，不进模型层（模型层只给枚举与类型）。 */
import type { ActorKind, DesignStatus, RelationType } from '@/model'

/** 关系类型（02 §1.1、ADR-0022）：图例、面板、边的类型标签共用 */
export const RELATION_TYPE_LABELS: Record<RelationType, string> = {
  calls: '命令',
  notifies: '通知',
  streams: '流',
  depends: '依赖',
  implements: '实现契约',
}

/** 每类关系一句话读法：运行时三类是图例的三句话，箭头一律指控制流方向 */
export const RELATION_TYPE_HINTS: Record<RelationType, string> = {
  calls: '要结果',
  notifies: '不要结果、一对多，箭头指向被通知方',
  streams: '连续数据，箭头指向数据去向',
  depends: '编译期知道对方',
  implements: '实现对方声明的接口',
}

export const ACTOR_KIND_LABELS: Record<ActorKind, string> = { user: '用户', system: '外部系统', time: '时间' }

export const DESIGN_STATUS_LABELS: Record<DesignStatus, string> = {
  draft: '起草中',
  reviewing: '评审中',
  accepted: '已定稿',
  implemented: '已实现',
  abandoned: '已放弃',
}

/** 设计版本变更角标：字段名的显示名，没有的按字段名显示 */
export const FIELD_LABELS: Record<string, string> = {
  name: '名称',
  parentId: '位置',
  kind: '类别',
  status: '状态',
  core: '核心',
  responsibility: '职责',
  principle: '实现原理',
  dataStructures: '数据结构',
  provides: '对外接口',
  codeRefs: '代码引用',
  docRefs: '文档引用',
  owner: '负责人 / 提供方',
  tags: '标签',
  order: '层序',
  abstraction: '抽象原则',
  includes: '应包含',
  excludes: '不应包含',
  mayDependOn: '可依赖的层',
  from: '起点',
  to: '终点',
  type: '类型',
  mode: '同步 / 异步',
  interface: '经由接口',
  payload: '交换数据',
  description: '说明',
  signature: '签名',
  semantics: '语义',
  definition: '定义',
  invariants: '不变量',
}
