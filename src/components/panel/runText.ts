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

/** Markdown 文本的第一句（信息卡用的摘要） */
export function firstSentence(text?: string): string {
  if (!text) return ''
  const plain = text.replace(/[`*_#>]/g, '').replace(/\s+/g, ' ').trim()
  const m = plain.match(/^.+?[。；.;!?！？](?=\s|$)|^.+?[。；！？]/)
  const s = m ? m[0] : plain
  return s.length > 80 ? `${s.slice(0, 80)}…` : s
}

/** 数据结构 ID 的显示名 */
export function dataNames(index: ModelIndex, ids: readonly string[]): string {
  return ids.map(id => index.dataStructures.get(id)?.name ?? id).join('、')
}

/**
 * 步骤的「输出」（D-5、F7）：
 * - pair：调用有配对的显式返回；reply：本步就是返回，回应配对的调用；
 * - async：异步，不等待返回；implicit：同步调用没写显式返回（见接口签名）；none：返回没有配对的调用。
 */
export type StepOutput =
  | { kind: 'pair'; frame: Frame }
  | { kind: 'reply'; frame: Frame }
  | { kind: 'async' }
  | { kind: 'implicit' }
  | { kind: 'none' }

export function stepOutput(f: Frame, pairs: ReadonlyMap<string, string> | null, frames: ReadonlyMap<string, Frame>): StepOutput {
  const other = pairs?.get(f.id)
  const pf = other ? frames.get(other) : undefined
  if (f.kind === 'async') return { kind: 'async' }
  if (f.kind === 'return') return pf ? { kind: 'reply', frame: pf } : { kind: 'none' }
  return pf ? { kind: 'pair', frame: pf } : { kind: 'implicit' }
}

/** 模块的完整路径（不含自身）与所属层（自身或最近的层祖先） */
export function placeOf(index: ModelIndex, moduleId: string): { path: string; layer?: string } {
  const ids = index.pathOf.get(moduleId) ?? []
  const layer = [...ids].reverse().find(id => index.modules.get(id)?.kind === 'layer')
  const layerName = layer ? `${moduleName(index, layer)}${index.modules.get(layer)?.order !== undefined ? `（第 ${index.modules.get(layer)!.order} 层）` : ''}` : undefined
  return { path: ids.slice(0, -1).map(id => moduleName(index, id)).join(' › '), ...(layerName ? { layer: layerName } : {}) }
}
