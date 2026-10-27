/**
 * 标签位（L26，ADR-0035）：线的中点 pill 是画布上唯一写字的地方，三个视图同义（L18）。
 * 词表固定、次序固定；一条边只有一个 pill：`[×N[ · M 把手]] · <标签>[ M]`，聚合边上标签后的 M 为束内带该标签的条数，全部都带时省略。
 */

/** ①词表，按②的合并次序排列 */
export const EDGE_TAGS = ['违规', '未证实', '未解释', '缺段', '回调', '混合', '经上层', '未建模'] as const
export type EdgeTag = (typeof EDGE_TAGS)[number]

/** 异常（画成警示色的 pill）；回调、混合是修饰，经上层是回放的说明 */
const WARN_TAGS: ReadonlySet<EdgeTag> = new Set(['违规', '未证实', '未解释', '缺段', '未建模'])

/**
 * 一个标签：`count` 为带该标签的条数，`total` 为这条边合了几条——count 等于 total（全部都带）时省略条数；
 * 没有 total 的（代码依赖叠加线，K9）有 count 就照写。
 */
export interface TagPart {
  tag: EdgeTag
  count?: number
  total?: number
}

const tagText = ({ tag, count, total }: TagPart): string => (count === undefined || (total !== undefined && count >= total) ? tag : `${tag} ${count}`)

/** 按 L26② 组装标签：head 为 ×N 与把手角标（L23b），其后按词表次序接各标签，同一标签只写一次 */
export function composeLabel(head: string, parts: readonly (TagPart | null | false | undefined)[]): string {
  const seen = new Set<EdgeTag>()
  const tags = parts
    .filter((p): p is TagPart => !!p)
    .filter(p => !seen.has(p.tag) && !!seen.add(p.tag))
    .sort((a, b) => EDGE_TAGS.indexOf(a.tag) - EDGE_TAGS.indexOf(b.tag))
    .map(tagText)
  return [head, ...tags].filter(Boolean).join(' · ')
}

/** 标签里有异常：pill 画成警示色 */
export const hasWarnTag = (parts: readonly (TagPart | null | false | undefined)[]): boolean => parts.some(p => !!p && WARN_TAGS.has(p.tag))
