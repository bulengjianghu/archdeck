/**
 * 对话里的机制图块（DL-40–DL-43，07 §4.1「AI 的回答可以带图」）：一张自包含的内联 SVG 加一句说明。
 * 检查与题解同一套（DL-41）：沙箱口径（无脚本、无外部资源）+ 未知模块（EX-8，复用图解的 archRefs / unknownArchRefs）+ 适合资料区一列的尺寸。
 * 图块不是描述：不盖依据指纹、不落 explainers/、不进 lint:model。存为设计说明时写成围栏块（DL-43），读回时切成文字段与图段。
 */
import { archRefs } from '../explainer/html'
import { knownModule, unknownArchRefs } from '../explainer/lint'
import { htmlRefs } from '../explainer/lookup'
import type { ExplainerRef } from '../explainer/types'
import type { ModelIndex } from '../types'
import type { DiagramBlock } from './protocol'

/** DL-41 的三个阈值（议）：宽 ≤ 640（资料区一列约 600px）、viewBox 宽高比在 1:4 到 4:1、整块 ≤ 64 KB */
export const DIAGRAM_LIMITS = { width: 640, ratio: 4, bytes: 64 * 1024 } as const

export type DiagramCheck = { ok: true; modules: string[] } | { ok: false; reasons: string[] }

const FORBIDDEN_TAGS = ['script', 'foreignObject', 'iframe', 'object', 'embed'] as const
/** 资源引用只许页内片段或内联图片 */
const localRef = (v: string) => {
  const t = v.trim()
  return t.startsWith('#') || /^data:image\//i.test(t)
}
const num = (v: string | null | undefined): number | null => {
  if (v === null || v === undefined) return null
  const m = /^\s*([\d.]+)\s*(px)?\s*$/i.exec(v)
  return m ? Number(m[1]) : null
}
const attrOf = (tag: string, name: string): string | null => {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(tag)
  return m ? (m[1] ?? m[2] ?? '') : null
}

/** DL-41：形状、安全与尺寸（不看模块是否存在；设计说明的图段也只过这一半，DL-43） */
export function diagramSvgReasons(svg: string): string[] {
  const reasons: string[] = []
  const t = svg.trim()
  if (!/^<svg\b/i.test(t) || !/<\/svg>$/i.test(t)) reasons.push('不是一张自包含的内联 SVG：要以 <svg 开头、</svg> 结尾，前后不许有别的内容')
  const bytes = new TextEncoder().encode(t).length
  if (bytes > DIAGRAM_LIMITS.bytes) reasons.push(`太大：${Math.ceil(bytes / 1024)} KB，上限 ${DIAGRAM_LIMITS.bytes / 1024} KB`)
  for (const tag of FORBIDDEN_TAGS) if (new RegExp(`<${tag}\\b`, 'i').test(t)) reasons.push(`含 <${tag}>：机制图只许纯 SVG，不许脚本与嵌入内容`)
  if (/<[^>]*\son[a-z]+\s*=/i.test(t)) reasons.push('含 on… 事件属性：不许脚本')
  if (/javascript:/i.test(t)) reasons.push('含 javascript: 链接：不许脚本')
  for (const m of t.matchAll(/\s(?:xlink:)?(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    const v = m[1] ?? m[2] ?? ''
    if (!localRef(v)) reasons.push(`引用外部资源 ${v.slice(0, 60)}：只许 #片段 或 data:image/`)
  }
  if (/@import/i.test(t)) reasons.push('样式里有 @import：不许外部资源')
  for (const m of t.matchAll(/url\(\s*(['"]?)([^'")]*)\1\s*\)/gi)) if (!localRef(m[2])) reasons.push(`样式里 url(${m[2].slice(0, 60)}) 指向外部资源：只许 #片段 或 data:image/`)
  // 尺寸：看根 <svg> 的开始标签
  const root = /^<svg\b[^>]*>/i.exec(t)?.[0]
  if (root) {
    const vb = attrOf(root, 'viewBox')
      ?.trim()
      .split(/[\s,]+/)
      .map(Number)
    if (!vb || vb.length !== 4 || vb.some(n => !Number.isFinite(n)) || vb[2] <= 0 || vb[3] <= 0) reasons.push('没有写 viewBox（要能按资料区一列的宽度缩放）')
    else {
      const width = num(attrOf(root, 'width')) ?? vb[2]
      if (width > DIAGRAM_LIMITS.width) reasons.push(`太宽：${width}，资料区一列上限 ${DIAGRAM_LIMITS.width}`)
      const r = vb[2] / vb[3]
      if (r > DIAGRAM_LIMITS.ratio || r < 1 / DIAGRAM_LIMITS.ratio) reasons.push(`宽高比 ${vb[2]}:${vb[3]} 超出 1:${DIAGRAM_LIMITS.ratio} 到 ${DIAGRAM_LIMITS.ratio}:1`)
    }
  }
  return reasons
}

/**
 * DL-41：一张图块的全部检查。known 判断 data-arch 指向的模块在不在——当前版本上是描述（含系统根，knownModule），草图里是当前张（挂载点与它画着的框）。
 * 通过时给出图里引用的模块（去重、按出现顺序）。
 */
export function checkDiagram(block: Pick<DiagramBlock, 'svg'>, known: (id: string) => boolean): DiagramCheck {
  const reasons = diagramSvgReasons(block.svg)
  const missing = [...new Set(unknownArchRefs(block.svg, known).map(r => r.module))]
  if (missing.length) reasons.push(`data-arch 指向的模块不存在：${missing.join('、')}`)
  return reasons.length ? { ok: false, reasons } : { ok: true, modules: diagramModules(block.svg) }
}

/** DL-42：高宽比（viewBox 高 / 宽），显示时按它定高；读不出为 null */
export function diagramAspect(svg: string): number | null {
  const root = /^\s*<svg\b[^>]*>/i.exec(svg)?.[0]
  const vb = root
    ? attrOf(root, 'viewBox')
        ?.trim()
        .split(/[\s,]+/)
        .map(Number)
    : undefined
  return vb && vb.length === 4 && vb[2] > 0 && vb[3] > 0 ? vb[3] / vb[2] : null
}

/** DL-41：当前版本上 data-arch 能指向的模块——描述里的模块与系统根（与图解 EX-8 同口径） */
export const describedModule = (index: ModelIndex): ((id: string) => boolean) => knownModule(index)

/** DL-42：图里引用的、描述里有的模块要填入的原文（与图解 EX-2 同口径；SVG 里插不进链接，不附「图解 ›」） */
export const diagramDescribedRefs = (index: ModelIndex, svg: string): Record<string, ExplainerRef> =>
  Object.fromEntries(Object.entries(htmlRefs(index, svg)).map(([id, r]) => [id, { ...r, explainer: false }]))

/** DL-42：图里 data-arch 引用的模块（去重、按出现顺序） */
export const diagramModules = (svg: string): string[] => [...new Set(archRefs(svg).map(r => r.module))]

/** DL-43：设计说明里的一张图——首行 ```arch-diagram <说明>，中间 SVG 原文，末行 ``` */
export const DIAGRAM_FENCE = 'arch-diagram'
export function diagramFence(block: Pick<DiagramBlock, 'svg' | 'caption'>): string {
  const caption = block.caption.replace(/\s*\n\s*/g, ' ').trim()
  return `\`\`\`${DIAGRAM_FENCE}${caption ? ` ${caption}` : ''}\n${block.svg.trim()}\n\`\`\``
}

export type NoteSegment = { kind: 'text'; text: string } | { kind: 'diagram'; svg: string; caption: string }

/** DL-43：设计说明正文切成文字段与图段（与 diagramFence 往返不变；空白的文字段不出） */
export function splitNoteDiagrams(text: string): NoteSegment[] {
  const out: NoteSegment[] = []
  const re = new RegExp(`^\`\`\`${DIAGRAM_FENCE}(?:[ \\t]+([^\\n]*))?\\n([\\s\\S]*?)\\n\`\`\`[ \\t]*$`, 'gm')
  let last = 0
  const pushText = (s: string) => {
    if (s.trim()) out.push({ kind: 'text', text: s.trim() })
  }
  for (const m of text.matchAll(re)) {
    pushText(text.slice(last, m.index))
    out.push({ kind: 'diagram', svg: m[2], caption: (m[1] ?? '').trim() })
    last = m.index + m[0].length
  }
  pushText(text.slice(last))
  return out
}
