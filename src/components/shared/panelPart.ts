/**
 * 原选中面板（抽屉已删，LY-16）的内容分进视图标签（LY-13，第二十二轮波 3）：
 * 「描述」渲染核对卡以外的部分（理解 / 事实 / 关系等面板），「核对」只渲染核对卡。面板与卡片经注入知道自己在哪一部分。
 */
import { inject, type InjectionKey } from 'vue'

export type PanelPart = 'all' | 'description' | 'check'
export const PANEL_PART: InjectionKey<PanelPart> = Symbol('h5p-arch-desk:panel-part')

/** 这张卡在这一部分里显示吗 */
/** 核对一类的卡：核对卡与系统 / 层的汇总卡 */
const CHECK_KINDS = new Set(['check', 'summary'])
export const cardShown = (part: PanelPart, kind: string) => part === 'all' || (part === 'check') === CHECK_KINDS.has(kind)

/**
 * 面板头（原身份卡）在各部分里的样子（LY-13、LY-7；第二十二轮波 3）：
 * 「描述」里它是一行操作（动作与徽标），名称与 ID 不再出现——只在主语条（LY-13b）；「核对」里整行不出现；单独挂面板（单测、旧入口）时照旧。
 */
export function usePanelPart() {
  const part = inject(PANEL_PART, 'all')
  return { part, card: part !== 'check', name: part === 'all' }
}
