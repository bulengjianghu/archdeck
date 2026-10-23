/**
 * 草图画布给节点的动作（present.sketch）：层带头（X21）上的「＋ 模块」「删层」由画布处理（打开就地新建、级联确认），
 * 节点经 inject 取到；名称与 abstraction 的提交直接发编辑分组的操作。
 */
import type { InjectionKey } from 'vue'

export interface SketchActions {
  /** 在一条层带里新建模块（屏幕坐标给出就地输入框的位置） */
  addIn: (layer: string, screen: { x: number; y: number }) => void
  /** 删层（有级联时二次确认） */
  removeLayer: (layer: string) => void
  /** 操作的结果提示 */
  notify: (text: string) => void
}

export const SKETCH_ACTIONS: InjectionKey<SketchActions> = Symbol('sketch-actions')
