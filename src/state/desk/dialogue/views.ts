/**
 * 卡片派生（DL-13、DL-15、DL-41–DL-43；设计 dialogue-layers 的「卡片派生」）：从描述与回答块派生给呈现层的数据——引用原文、机制图检查、
 * 梳理卡，以及图与设计说明图段的显示数据。规则本身在对话的模型（model.review.dialogue）里，这里只调用。
 */
import {
  checkDiagram,
  digestView,
  resolveCitation,
  type DiagramCheck,
  type ExplainerRef,
  type AgentBlock,
  type Citation,
  type DigestBlock,
  type ModelIndex,
} from '@/model'

/** DL-13：问答卡的引用——原文由架构台从描述填，解析不了的标「引用无效」 */
export type CiteView = { ok: true; cite: Citation; module: string; name: string; text: string } | { ok: false; cite: Citation; reason: string }
export function citeViews(index: ModelIndex | null, list: readonly Citation[] | undefined): CiteView[] {
  return (list ?? []).map(c => {
    const r = index ? resolveCitation(index, c) : ({ ok: false, reason: '描述未加载' } as const)
    return r.ok ? { ok: true, cite: c, module: r.module, name: r.name, text: r.text } : { ok: false, cite: c, reason: r.reason }
  })
}

/**
 * DL-41：一轮说完时检查其中的机制图块（只拒那一块，文字照常）；known 当前版本上是描述（含系统根），草图里是当前张。
 * 没有图块时为空对象。
 */
export function checkDiagrams(blocks: readonly AgentBlock[], known: (id: string) => boolean): Record<number, DiagramCheck> {
  const out: Record<number, DiagramCheck> = {}
  blocks.forEach((b, k) => {
    if (b.kind === 'diagram') out[k] = checkDiagram(b, known)
  })
  return out
}

/** DL-42：一张图的显示数据（aspect = 高 / 宽）——通过检查的给 SVG、说明与要填入的引用；被拒的给原因 */
export type DiagramView =
  { ok: true; svg: string; caption: string; refs: Record<string, ExplainerRef>; aspect: number } | { ok: false; caption: string; reasons: string[] }

/** DL-43：设计说明正文的一段——文字，或一张图（只过形状、安全与尺寸检查） */
export type NoteSegmentView = { kind: 'text'; text: string } | ({ kind: 'diagram' } & DiagramView)

/** DL-15：梳理卡的渲染数据 */
export const digestOf = (index: ModelIndex | null, block: AgentBlock) => (block.kind === 'digest' && index ? digestView(index, block as DigestBlock) : null)
