/** 界面文案：领域枚举的中文显示名。只是呈现关注点，不进模型层（模型层只给枚举与类型）。 */
import type { ActorKind, DesignStatus, EvidenceLevel, RelationType, ViaKind } from '@/model'

/** 关系类型（02 §1.1、ADR-0029）：图例、面板、边的类型标签共用；calls 为迁移期的未分类（M17） */
export const RELATION_TYPE_LABELS: Record<RelationType, string> = {
  queries: '查询',
  commands: '委托',
  notifies: '通知',
  streams: '流',
  calls: '未分类',
}

/** 草图连线时的短名（X23）：查 / 托 / 通知 / 流 */
export const RELATION_TYPE_SHORT: Record<RelationType, string> = { queries: '查', commands: '托', notifies: '通知', streams: '流', calls: '待分类' }

/** 每类关系一句话读法（三问四修饰）：箭头一律指控制流方向 */
export const RELATION_TYPE_HINTS: Record<RelationType, string> = {
  queries: '要结果、无副作用，后果归调用方',
  commands: '交出控制权，被调方拥有状态与副作用；可同步或异步',
  notifies: '不要结果、一对多，一律异步，箭头指向被通知方',
  streams: '连续数据，箭头指向数据去向',
  calls: '按三问定为查询或委托（迁移期）',
}

/**
 * 三问四修饰（ADR-0029 §3）：三个判断题定类型，第四步读修饰。图例（RelationLegend）与「怎么读这张图」（GuideDialog）共用。
 * answer 为答案指向的类型。
 */
export const THREE_QUESTIONS: readonly { q: string; answers: readonly { a: string; type: RelationType }[] }[] = [
  { q: '被调方拥有后果吗？', answers: [{ a: '否', type: 'queries' }] },
  {
    q: '是：发起方知道接收方吗？',
    answers: [
      { a: '知道', type: 'commands' },
      { a: '不知道、一对多', type: 'notifies' },
    ],
  },
  { q: '传的是连续数据吗？', answers: [{ a: '是', type: 'streams' }] },
]

/** 机制（via 的四形态，ADR-0029 §2）：不写为直接 */
export const VIA_KIND_LABELS: Record<'direct' | ViaKind, string> = { direct: '直接', port: '端口', bus: '总线', channel: '通道' }
export const VIA_KIND_HINTS: Record<'direct' | ViaKind, string> = {
  direct: '发起方导入接收方',
  port: '发起方只知道端口，接收方是它的实现者（可替换）',
  bus: '两端只认识事件总线',
  channel: '跨进程、框架注入、路由、回调等，静态导入证实不了',
}

/** 步骤的证据等级（S16）：步骤面板、场景面板共用 */
export const EVIDENCE_LEVEL_LABELS: Record<EvidenceLevel, string> = { name: '按名字匹配', module: '按模块依赖', none: '无证据', skipped: '不判定' }

export const ACTOR_KIND_LABELS: Record<ActorKind, string> = { user: '用户', system: '外部系统', time: '时间' }

export const DESIGN_STATUS_LABELS: Record<DesignStatus, string> = {
  draft: '起草中',
  reviewing: '评审中',
  accepted: '已认可',
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
  via: '机制',
  pull: '拉取',
  implementedBy: '实现者',
  payload: '交换数据',
  description: '说明',
  signature: '签名',
  semantics: '语义',
  definition: '定义',
  invariants: '不变量',
}

/** 持久草图的显示名：骨架有中文名，其余按 ID 显示 */
export const intentName = (id: string): string => (id === 'skeleton' ? '骨架' : id)
