/**
 * 资料种类的呈现表（DL-5）：每种资料（LY-8 的资料标签）的标签名、悬停说明、种类记号，以及（新种类的）正文组件。
 * 标签栏与分组逻辑只查这张表，不写种类分支；加一种资料 = workspace.ts 的联合加一种 + 这里加一行。
 * 源代码的正文由 DockGroup 的既有分支渲染；视图标签（图解、描述、核对、时序图）的正文是 ViewDoc。
 */
import { defineAsyncComponent, type Component } from 'vue'
import type { DocRef, ViewKind } from '@/state/useDeskState'
import IssuesDoc from '../tree/IssuesDoc.vue'

export interface DocKindContext {
  moduleName: (id: string) => string
  scenarioName: () => string | null
  /** DL-10：设计说明的标题 */
  noteTitle?: (file: string) => string
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

/** LY-8：视图标签的名字（按类型各一个，不带主语——主语在主语条） */
export const VIEW_LABELS: Record<ViewKind, string> = { explainer: '图解', description: '描述', check: '核对', sequence: '时序图' }

export const DOC_KIND_VIEWS: Record<string, DocKindView> = {
  source: {
    label: d => `源代码 · ${(d as { path: string }).path.split('/').pop()}`,
    tip: d => (d as { path: string }).path,
  },
  dialogue: {
    label: () => '对话',
    tip: () => '对话：问 · 重讲题解（当前版本）· 改（草图里）',
    icon: '◇',
    component: defineAsyncComponent(() => import('./DialogueDoc.vue')),
  },
  note: {
    label: (d, c) => c.noteTitle?.((d as { file: string }).file) ?? '设计说明',
    tip: (d, c) => `设计说明（目标态 · 未实现）· ${c.noteTitle?.((d as { file: string }).file) ?? (d as { file: string }).file}`,
    icon: '✎',
    component: defineAsyncComponent(() => import('./NoteDoc.vue')),
  },
  /** LY-4a：返工清单——画布左上 ⚠ 胶囊或「+」打开 */
  issues: {
    label: () => '问题',
    tip: () => '问题：返工清单（错误、提醒、提示）',
    icon: '⚠',
    component: IssuesDoc,
  },
}

export const docKindView = (doc: DocRef, views: Record<string, DocKindView> = DOC_KIND_VIEWS): DocKindView | undefined => views[doc.kind]

/** 表里没有的种类退回种类名，标签栏照常可用 */
export const docLabel = (doc: DocRef, ctx: DocKindContext, views = DOC_KIND_VIEWS) => docKindView(doc, views)?.label(doc, ctx) ?? doc.kind
export const docTip = (doc: DocRef, ctx: DocKindContext, views = DOC_KIND_VIEWS) => {
  const v = docKindView(doc, views)
  return v?.tip?.(doc, ctx) ?? docLabel(doc, ctx, views)
}
