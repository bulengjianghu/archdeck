/** 界面文案：领域枚举的中文显示名。只是呈现关注点，不进模型层（模型层只给枚举与类型）。 */
import type { ActorKind, DesignStatus } from '@/model'

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
