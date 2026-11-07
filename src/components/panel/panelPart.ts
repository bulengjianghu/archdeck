/**
 * 第二十二轮波 2 的过渡（波 3 按 LY-13 拆内容后删）：原选中面板（抽屉已删）的内容放进视图标签——
 * 「描述」渲染原面板的全部内容（含核对卡，原样搬入），「核对」只渲染核对卡。面板与卡片经注入知道自己在哪一部分。
 */
import type { InjectionKey } from 'vue'

export type PanelPart = 'all' | 'description' | 'check'
export const PANEL_PART: InjectionKey<PanelPart> = Symbol('h5p-arch-desk:panel-part')

/** 这张卡在这一部分里显示吗 */
export const cardShown = (part: PanelPart, kind: string) => part !== 'check' || kind === 'check'
