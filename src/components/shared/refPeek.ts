/** LY-15：视图里悬停的模块引用在画布上的节点（呈现层的瞬时值，项目视图提供；画布给它加 peek 描边，视图区写入） */
import { inject, ref, type InjectionKey, type Ref } from 'vue'

export const REF_PEEK: InjectionKey<Ref<string | null>> = Symbol('h5p-arch-desk:ref-peek')
export const useRefPeekNode = () => inject(REF_PEEK, () => ref<string | null>(null), true)
