/**
 * 图解 HTML 的读取与改写（EX-2、EX-6、EX-8）：模型层不依赖 DOM，按标签做有限的文本解析——
 * 只读 meta、带 data-arch / data-field 的开始标签与去标签后的正文，只改写 arch-basis 那一个 meta。
 */
import { BASIS_META } from './types'

export interface ArchRef {
  module: string
  field: string | null
  /** 开始标签在原文里的位置 */
  offset: number
}

const attr = (tag: string, name: string): string | null => {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(tag)
  return m ? (m[1] ?? m[2] ?? '') : null
}

const META = new RegExp(`<meta\\b[^>]*\\bname\\s*=\\s*["']${BASIS_META}["'][^>]*>`, 'i')

/** EX-6：arch-basis 的内容；没有为 null */
export function readBasisMeta(html: string): string | null {
  const m = META.exec(html)
  return m ? attr(m[0], 'content') : null
}

/** EX-9：写入 arch-basis：有则只换这个 meta，没有则插在 <head> 之后（没有 head 就放在最前） */
export function writeBasisMeta(html: string, content: string): string {
  const tag = `<meta name="${BASIS_META}" content="${content}">`
  if (META.test(html)) return html.replace(META, tag)
  const head = /<head\b[^>]*>/i.exec(html)
  if (!head) return `${tag}\n${html}`
  const at = head.index + head[0].length
  return `${html.slice(0, at)}\n    ${tag}${html.slice(at)}`
}

/** EX-2、EX-8：所有带 data-arch 的开始标签（不含 script / style 里的） */
export function archRefs(html: string): ArchRef[] {
  const text = blankScripts(html)
  const out: ArchRef[] = []
  for (const m of text.matchAll(/<[a-zA-Z][\w-]*\b[^>]*\sdata-arch\s*=[^>]*>/g)) {
    const module = attr(m[0], 'data-arch')
    if (module === null) continue
    out.push({ module: module.trim(), field: attr(m[0], 'data-field'), offset: m.index })
  }
  return out
}

/** 原文位置所在的行（从 1 起） */
export const lineAt = (html: string, offset: number): number => html.slice(0, offset).split('\n').length

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

/**
 * EX-8：正文——去掉 script、style、带 data-field 的元素（由架构台填入的引用不算抄写）与全部标签，解开常见实体，
 * 去掉一切空白（中文正文按字比对，空白与换行不影响）
 */
export function plainText(html: string): string {
  let s = html.replace(/<(script|style|title)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ')
  s = s.replace(/<([a-zA-Z][\w-]*)\b[^>]*\sdata-field\s*=[^>]*>[\s\S]*?<\/\1>/g, ' ')
  s = s.replace(/<[^>]+>/g, ' ')
  s = s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (all, e: string) =>
    e.startsWith('#') ? String.fromCodePoint(parseInt(e.slice(e[1] === 'x' || e[1] === 'X' ? 2 : 1), e[1] === 'x' || e[1] === 'X' ? 16 : 10)) : (ENTITIES[e.toLowerCase()] ?? all),
  )
  return s.replace(/\s+/g, '')
}

/** script / style 的内容换成等长空白（位置不变，行号仍对） */
function blankScripts(html: string): string {
  return html.replace(/(<(script|style)\b[^>]*>)([\s\S]*?)(<\/\2>)/gi, (_, open: string, __: string, body: string, close: string) => open + body.replace(/[^\n]/g, ' ') + close)
}
