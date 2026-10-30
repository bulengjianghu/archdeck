/** WS-3：属性栏悬浮时盖住画布右侧的宽度（px，并排或关闭时为 0）；项目视图提供，画布适应时避开它 */
import { inject, ref, type InjectionKey, type Ref } from 'vue'

export const CANVAS_INSET: InjectionKey<Readonly<Ref<number>>> = Symbol('h5p-arch-desk:canvas-inset')

export const useCanvasInset = () => inject(CANVAS_INSET, ref(0))
