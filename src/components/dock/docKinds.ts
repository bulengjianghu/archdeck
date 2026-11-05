/**
 * 资料种类的呈现表（DL-5）：每种资料的标签名、悬停说明、种类记号，以及（新种类的）正文组件。
 * 标签栏与分组逻辑只查这张表，不写种类分支；加一种资料 = workspace.ts 的联合加一种 + 这里加一行。
 * 时序图、源代码、理解页 / 图解的正文仍由 DockGroup 的既有分支渲染（它们带着运行视角的步骤节等版式）；新种类在这里给 component。
 */
import { defineAsyncComponent, type Component } from 'vue'
import type { DocRef } from '@/state/useDeskState'

export interface DocKindContext {
  moduleName: (id: string) => string
  scenarioName: () => string | null
}

export interface DocKindView {
  label: (doc: DocRef, ctx: DocKindContext) => string
  /** 悬停说明（不含过期与预览的尾注）；缺省同标签名 */
  tip?: (doc: DocRef, ctx: DocKindContext) => string
  /** 标签名前的种类记号 */
  icon?: string
  /** 正文组件（props: doc） */
  component?: Component
}

const mod = (d: DocRef) => (d as { module: string }).module

export const DOC_KIND_VIEWS: Record<string, DocKindView> = {
  sequence: { label: (_d, c) => `时序图${c.scenarioName() ? ` · ${c.scenarioName()}` : ''}` },
  source: {
    label: d => `源代码 · ${(d as { path: string }).path.split('/').pop()}`,
    tip: d => (d as { path: string }).path,
  },
  explainer: { label: (d, c) => c.moduleName(mod(d)), tip: (d, c) => `图解 · ${c.moduleName(mod(d))}`, icon: '▣' },
  facts: { label: (d, c) => c.moduleName(mod(d)), tip: (d, c) => `理解页 · ${c.moduleName(mod(d))}`, icon: '▣' },
  dialogue: { label: () => '对话', tip: () => '对话：问（当前版本）· 重讲题解', icon: '◇', component: defineAsyncComponent(() => import('./DialogueDoc.vue')) },
}

export const docKindView = (doc: DocRef, views: Record<string, DocKindView> = DOC_KIND_VIEWS): DocKindView | undefined => views[doc.kind]

/** 表里没有的种类退回种类名，标签栏照常可用 */
export const docLabel = (doc: DocRef, ctx: DocKindContext, views = DOC_KIND_VIEWS) => docKindView(doc, views)?.label(doc, ctx) ?? doc.kind
export const docTip = (doc: DocRef, ctx: DocKindContext, views = DOC_KIND_VIEWS) => {
  const v = docKindView(doc, views)
  return v?.tip?.(doc, ctx) ?? docLabel(doc, ctx, views)
}
