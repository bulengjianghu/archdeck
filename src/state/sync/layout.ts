/**
 * 布局同步：层次视图变化 → 调用 layoutView（异步，Worker 中运行）→ 回填定位结果。
 * 用序号丢弃过期结果：快速切换层次时，只有最后一次的结果会被采用。
 */
import { ref, shallowRef, watch, type Ref, type ShallowRef } from 'vue'
import type { LevelView } from '@/model'
import { layoutView, type LayoutOptions, type PositionedView } from '@/layout/layout'

/** opts：布局的外部输入（如按画布宽度得出的带内列数，O7），变化时重新布局 */
export function createLayoutSync(
  view: Readonly<Ref<LevelView | null>>,
  layout: (v: LevelView, opts?: LayoutOptions) => Promise<PositionedView> = layoutView,
  opts: Readonly<Ref<LayoutOptions>> = ref({}),
): ShallowRef<PositionedView | null> {
  const positioned = shallowRef<PositionedView | null>(null)
  let seq = 0
  watch([view, opts], async ([v, o]) => {
    const mine = ++seq
    if (!v) {
      positioned.value = null
      return
    }
    const result = await layout(v, o)
    if (mine === seq) positioned.value = result
  })
  return positioned
}
