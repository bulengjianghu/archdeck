/** DL-20：草图编辑态里按需展开选中面板（项目视图提供；画布的「编辑字段…」与改动页签调用）。没有提供时什么都不做 */
import { inject, type InjectionKey } from 'vue'

export const OPEN_PROPS: InjectionKey<() => void> = Symbol('h5p-arch-desk:open-props')

export const useOpenProps = (): (() => void) => inject(OPEN_PROPS, () => () => {}, true)
