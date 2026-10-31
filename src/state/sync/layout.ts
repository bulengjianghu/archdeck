/**
 * 布局同步：层次视图或结构边（L15，与交互边并集布局）变化 → 调用 layoutView（异步，Worker 中运行）→ 回填定位结果。
 * 用序号丢弃过期结果：快速切换层次时，只有最后一次的结果会被采用。
 * pending：有布局请求还没回填（画布首次适应要等它为假，WS-3）。
 */
import { ref, shallowRef, watch, type Ref, type ShallowRef } from 'vue'
import type { LevelView } from '@/model'
import { layoutView, type LayoutOptions, type PositionedView, type StructureLinks } from '@/layout/layout'

/** opts：布局的外部输入（如按画布宽度得出的带内列数，O7）；links：本层的结构边（L15）；变化时重新布局 */
export function createLayoutSync(
  view: Readonly<Ref<LevelView | null>>,
  layout: (v: LevelView, opts?: LayoutOptions, links?: StructureLinks | null) => Promise<PositionedView> = layoutView,
  opts: Readonly<Ref<LayoutOptions>> = ref({}),
  links: Readonly<Ref<StructureLinks | null>> = ref(null),
): { positioned: ShallowRef<PositionedView | null>; pending: Readonly<Ref<boolean>> } {
  const positioned = shallowRef<PositionedView | null>(null)
  const pending = ref(false)
  let seq = 0
  watch([view, opts, links], async ([v, o, l]) => {
    const mine = ++seq
    if (!v) {
      positioned.value = null
      pending.value = false
      return
    }
    pending.value = true
    const result = await layout(v, o, l)
    if (mine !== seq) return
    positioned.value = result
    pending.value = false
  })
  return { positioned, pending }
}
