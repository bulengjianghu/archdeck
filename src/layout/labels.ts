/**
 * 标签位（L26，ADR-0035、ADR-0041）：线的中点 pill 是画布上唯一写字的地方，三个视图同义（L18）。
 * 词表固定、次序固定，分异常与修饰两级；一条边只有一个标签位，画成至多两段——异常段（×N、把手与异常，警示色）在前，修饰段（机制、混合、经上层，中性色）在后；
 * 标签至多显示两个，其余写「+k」接在最后一段末尾。聚合边上标签后的 M 为束内带该标签的条数，全部都带时省略。
 */
import { MECHANISMS } from '@/model'

/** ①词表，按②的合并次序排列：异常在前、修饰在后 */
export const EDGE_TAGS = ['违规', '向上', '未证实', '未解释', '缺段', '未建模', ...MECHANISMS, '混合', '经上层'] as const
export type EdgeTag = (typeof EDGE_TAGS)[number]

/** ①异常（警示色的段）；其余是修饰（机制 L35、混合、经上层，中性色） */
const WARN_TAGS: ReadonlySet<EdgeTag> = new Set(['违规', '向上', '未证实', '未解释', '缺段', '未建模'])
export const isWarnTag = (tag: EdgeTag): boolean => WARN_TAGS.has(tag)

/** ②上限：标签（不含 ×N 与把手）至多显示几个 */
export const MAX_TAGS = 2

/**
 * 一个标签：`count` 为带该标签的条数，`total` 为这条边合了几条——count 等于 total（全部都带）时省略条数；
 * 没有 total 的（代码依赖叠加线，K9）有 count 就照写。
 */
export interface TagPart {
  tag: EdgeTag
  count?: number
  total?: number
}

export const tagText = ({ tag, count, total }: TagPart): string => (count === undefined || (total !== undefined && count >= total) ? tag : `${tag} ${count}`)

type MaybePart = TagPart | null | false | undefined

/** 去重（同一标签只写一次）并按词表次序排 */
function ordered(parts: readonly MaybePart[]): TagPart[] {
  const seen = new Set<EdgeTag>()
  return parts
    .filter((p): p is TagPart => !!p)
    .filter(p => !seen.has(p.tag) && !!seen.add(p.tag))
    .sort((a, b) => EDGE_TAGS.indexOf(a.tag) - EDGE_TAGS.indexOf(b.tag))
}

/** 不分段、不设上限的整串：head 为 ×N 与把手角标（L23b），其后按词表次序接各标签（结构边、草图之外的说明用） */
export function composeLabel(head: string, parts: readonly MaybePart[]): string {
  return [head, ...ordered(parts).map(tagText)].filter(Boolean).join(' · ')
}

/** 标签位的一段：文字与是否警示色 */
export interface PillSegment {
  text: string
  warn: boolean
}

/** L26② 组装的结果：段（至多两段）、被「+k」收起的标签、整串文字（各段以 ` · ` 相接） */
export interface Pill {
  segments: PillSegment[]
  hidden: TagPart[]
  text: string
}

/**
 * L26②：两段与上限——标签按词表次序取前 max 个；有异常时 head 与异常进警示色段、修饰进其后的中性段，没有异常时只有一段中性；
 * 其余写「+k」接在最后一段末尾
 */
export function composePill(head: string, parts: readonly MaybePart[], max = MAX_TAGS): Pill {
  const tags = ordered(parts)
  const shown = tags.slice(0, max)
  const hidden = tags.slice(max)
  const warn = shown.filter(p => isWarnTag(p.tag))
  const plain = shown.filter(p => !isWarnTag(p.tag))
  const join = (xs: readonly string[]) => xs.filter(Boolean).join(' · ')
  const segments: PillSegment[] = (
    warn.length
      ? [
          { text: join([head, ...warn.map(tagText)]), warn: true },
          { text: join(plain.map(tagText)), warn: false },
        ]
      : [{ text: join([head, ...plain.map(tagText)]), warn: false }]
  ).filter(s => s.text)
  if (hidden.length) {
    const more = `+${hidden.length}`
    if (segments.length) segments[segments.length - 1] = { ...segments[segments.length - 1], text: join([segments[segments.length - 1].text, more]) }
    else segments.push({ text: more, warn: false })
  }
  return { segments, hidden, text: join(segments.map(s => s.text)) }
}

/** 标签里有异常：pill 带警示色（有异常段） */
export const hasWarnTag = (parts: readonly MaybePart[]): boolean => parts.some(p => !!p && isWarnTag(p.tag))

/** 标签 pill 一段的估宽：字号 11，中文按 11 px、其余按 6.5 px，左右内边距共 12 */
export function labelWidth(text: string): number {
  return [...text].reduce((n, c) => n + (/[\u3000-\u9fff\uff00-\uffef]/.test(c) ? 11 : 6.5), 0) + 12
}

/** 两段之间的间距（画布 EdgePill 与估宽共用） */
export const PILL_GAP = 3

/** L33：整个标签位的估宽——各段各加内边距，段间加间距 */
export const pillWidth = (segments: readonly PillSegment[]): number =>
  segments.reduce((n, s) => n + labelWidth(s.text), 0) + PILL_GAP * Math.max(0, segments.length - 1)
