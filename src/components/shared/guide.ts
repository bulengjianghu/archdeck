/** L51：打开「帮助 · 怎么读这张图」并定位到某一节的注入键（项目视图提供，图例关系组的「?」用） */
import type { InjectionKey } from 'vue'

/** 帮助里可定位的节：读一条线（三问四修饰） */
export type GuideSection = 'read-line'

export const OPEN_GUIDE: InjectionKey<(section?: GuideSection) => void> = Symbol('open-guide')
