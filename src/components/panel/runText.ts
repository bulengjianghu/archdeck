/** 运行视角面板共用的显示文字 */
import { moduleName, type Frame, type FragmentTag, type ModelIndex, type VisibleLanding } from '@/model'

export const KIND_LABEL: Record<string, string> = { call: '同步调用', async: '异步', return: '返回', internal: '内部活动' }
export const FRAGMENT_LABEL: Record<FragmentTag['kind'], string> = { alt: '分支', loop: '循环', par: '并行', ref: '引用' }

/** 「A → B：标签」 */
export function frameText(index: ModelIndex, f: Frame): string {
  return `${moduleName(index, f.from)} → ${moduleName(index, f.to)}${f.label ? `：${f.label}` : ''}`
}

/** 视图节点 ID 的显示名（边界节点注明外部） */
export function nodeName(index: ModelIndex, nodeId: string): string {
  if (nodeId.startsWith('boundary:')) return `${moduleName(index, nodeId.slice('boundary:'.length))}（外部）`
  return moduleName(index, nodeId)
}

export function landingText(index: ModelIndex, at: VisibleLanding): string {
  if (at.kind === 'internal') return `${nodeName(index, at.node)} 内部`
  const text = `${nodeName(index, at.from)} → ${nodeName(index, at.to)}`
  return at.kind === 'unmodeled' ? `${text}（结构中未建模）` : at.reverse ? `${text}（与边的箭头相反）` : text
}

export function fragmentText(t: FragmentTag): string {
  if (t.kind === 'par') return `并行 · 分支 ${(t.branch ?? 0) + 1}`
  if (t.kind === 'ref') return `引用：${t.label}`
  return `${FRAGMENT_LABEL[t.kind]} [${t.label}]`
}
