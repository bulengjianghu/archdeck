/**
 * DeskState 的图解派生（desk.explainers，EX-1–EX-7，ADR-0055）：哪些模块有图解、图解原文与要填入的引用、↑ ↓ 导航、依据是否过期。
 * 都是模型层纯函数的投影，随索引变化重算；呈现层只读这里，不直接调模型层（U10）。
 */
import { computed, type ShallowRef } from 'vue'
import {
  explainerHtml,
  explainerModules,
  explainerNav,
  explainerRefs,
  explainerStatus,
  type ExplainerNav,
  type ExplainerRef,
  type ExplainerStatus,
  type ModelIndex,
} from '@/model'

export interface ExplainersInputs {
  index: ShallowRef<ModelIndex | null>
}

const NO_NAV: ExplainerNav = { up: null, down: [] }

export function createExplainers({ index }: ExplainersInputs) {
  /** EX-1：有图解的模块 → 路径 */
  const modules = computed(() => (index.value ? explainerModules(index.value) : new Map<string, string>()))
  /** EX-7：各图解的依据状态（只算有图解的模块） */
  const statuses = computed(() => {
    const idx = index.value
    const out = new Map<string, ExplainerStatus>()
    if (idx) for (const id of modules.value.keys()) out.set(id, explainerStatus(idx, id)!)
    return out
  })
  const has = (id: string) => modules.value.has(id)
  const status = (id: string): ExplainerStatus | null => statuses.value.get(id) ?? null
  const html = (id: string): string | null => (index.value ? explainerHtml(index.value, id) : null)
  const refs = (id: string): Record<string, ExplainerRef> => (index.value ? explainerRefs(index.value, id) : {})
  const nav = (id: string): ExplainerNav => (index.value ? explainerNav(index.value, id) : NO_NAV)
  return { modules, has, status, html, refs, nav }
}

export type DeskExplainers = ReturnType<typeof createExplainers>

/** 呈现层用的形状（由派生推出，呈现层不直接引用模型层的类型，U10） */
export type ExplainerRefView = ReturnType<DeskExplainers['refs']>[string]
export type BasisChangeKind = NonNullable<ReturnType<DeskExplainers['status']>>['changes'][number]['kind']
