/**
 * 名称行的动作槽（DL-17，ADR-0063 后果「名称行动作槽」）：身份卡与事实卡名称后的小链接是一张表，一行一个动作——
 * 「图解 ›」（有图解的模块，身份卡，CD-3 / V15a）、「讨论 ›」（当前版本上打开对话，DA-1）。加一个动作只加一行，卡片模板不动。
 */
export type NameRowPlace = 'id-card' | 'fact-card'

export interface NameActionContext {
  hasExplainer: (id: string) => boolean
  /** 当前版本（不是设计 / 提交版本）：「问」「重讲」只在当前版本上（DA-3、DA-4） */
  current: boolean
  /** 草图编辑中：对话由草图画布自动打开（DL-4），名称行不再给入口 */
  sketching: boolean
  openExplainer: (id: string) => void
  openDialogue: (id: string) => void
}

export interface NameAction {
  id: string
  label: string
  title: string
  places: readonly NameRowPlace[]
  when: (ctx: NameActionContext, module: string) => boolean
  run: (ctx: NameActionContext, module: string) => void
}

export const NAME_ACTIONS: readonly NameAction[] = [
  {
    id: 'explainer',
    label: '图解 ›',
    title: '在资料区打开它的图解',
    places: ['id-card'],
    when: (c, m) => c.hasExplainer(m),
    run: (c, m) => c.openExplainer(m),
  },
  {
    id: 'discuss',
    label: '讨论 ›',
    title: '在辅助栏打开对话，锚点是这个模块（只问，或重讲它的题解）',
    places: ['id-card', 'fact-card'],
    when: c => c.current && !c.sketching,
    run: (c, m) => c.openDialogue(m),
  },
]

/** 这个位置上、这个模块可用的动作，按表的次序 */
export const nameActions = (place: NameRowPlace, module: string, ctx: NameActionContext, table: readonly NameAction[] = NAME_ACTIONS) =>
  table.filter(a => a.places.includes(place) && a.when(ctx, module))
