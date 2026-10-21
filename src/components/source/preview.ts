/** 副栏的预览（G15）由项目视图持有；面板等组件经注入请求「在副栏预览某个文件」 */
import { inject, type InjectionKey } from 'vue'

export const OPEN_PREVIEW: InjectionKey<(path: string) => void> = Symbol('h5p-arch-desk:open-preview')

export const useOpenPreview = () => inject(OPEN_PREVIEW, () => {})
