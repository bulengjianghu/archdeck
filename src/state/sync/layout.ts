/**
 * 布局同步：层次视图变化 → 调用 layoutView（异步，Worker 中运行）→ 回填定位结果。
 * 用序号丢弃过期结果：快速切换层次时，只有最后一次的结果会被采用。
 */
import { shallowRef, watch, type Ref, type ShallowRef } from 'vue'
import type { LevelView } from '@/model'
import { layoutView, type PositionedView } from '@/layout/layout'

export function createLayoutSync(
  view: Readonly<Ref<LevelView | null>>,
  layout: (v: LevelView) => Promise<PositionedView> = layoutView,
): ShallowRef<PositionedView | null> {
  const positioned = shallowRef<PositionedView | null>(null)
  let seq = 0
  watch(view, async v => {
    const mine = ++seq
    if (!v) {
      positioned.value = null
      return
    }
    const result = await layout(v)
    if (mine === seq) positioned.value = result
  })
  return positioned
}
