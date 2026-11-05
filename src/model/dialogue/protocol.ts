/**
 * agent 的薄协议（DL-11，ADR-0063 §7.1）：子进程的输出只认三种事件，一行一个 JSON——
 * `{ type: 'text', text }` 文本片段（流式显示，不落）、`{ type: 'block', block }` 结构化块（一轮说完时一次性落）、`{ type: 'done' }` 结束。
 * 结构化块有五种：问答卡 answer（DA-3）、梳理卡 digest（DA-7）、重讲 renarrate（DA-4、DL-8）、草图里的改动 edit（DA-6、DA-9）、机制图 diagram（DA-6、DL-40）。
 * 不合法的行或块 = 整轮拒绝（DA-11）。真实 claude 的流式 JSON 由接入层的适配器翻译成本协议，假 agent 直接说本协议。
 * 换一个前端（命令行、导出脚本）这层协议照样成立，所以在模型层。
 */


/** 问答卡引用的字段（DL-13）：职责、一句话、不变式、原则、接口、关系；`explainer` 指向题解（单击打开题解） */
export const CITE_FIELDS = ['summary', 'responsibility', 'invariants', 'principle', 'interfaces', 'relations', 'explainer'] as const
export type CiteField = (typeof CITE_FIELDS)[number]

export interface Citation {
  module: string
  field: CiteField
}

/** 问答卡的一段：推断的段标「推断」（DA-3） */
export interface AnswerPart {
  text: string
  inferred?: boolean
  cites?: Citation[]
}

export interface AnswerBlock {
  kind: 'answer'
  parts: AnswerPart[]
}

/** 梳理卡四组（DA-7）：对上 / 对不上 / 多（画了、代码里没有）/ 少（系统有、没画） */
export const DIGEST_GROUPS = ['matched', 'mismatched', 'extra', 'missing'] as const
export type DigestGroup = (typeof DIGEST_GROUPS)[number]

export interface DigestItem {
  /** 照片上读到的框或线 */
  label: string
  /** 对到的模块 */
  modules?: string[]
  note?: string
  /** 读得不确定（DA-7） */
  uncertain?: boolean
}

export interface DigestBlock {
  kind: 'digest'
  groups: Record<DigestGroup, DigestItem[]>
}

/**
 * 草图里「改」的产出（DA-6、DA-9、DL-21）：一串设计级编辑操作（与编辑器同一族，T2.1）、要撤回的号（「撤回 #3」由架构台做，DL-2）、一句话说明。
 * 协议这里只看块的形状（ops 是带 op 的对象）；每条操作的形状与「AI 不许出的操作」由改动项的模型（changes/ops.ts validateEditBlock）判，
 * 接入层收块时一起调——对话的模型挂在确认层下、只许依赖类型契约，不直接依赖编辑操作族（rules.yaml）。
 */
export interface EditBlock {
  kind: 'edit'
  /** 设计级编辑操作（DesignEditOp）；validateEditBlock 通过后才可按 DesignEditOp 用 */
  ops: { op: string; [k: string]: unknown }[]
  withdraw?: number[]
  summary?: string
}

/** 重讲的产出（DL-8）：讲法要求（一条一行）与按要求重新生成的题解 HTML；其他任何键都不许出现 */
export interface RenarrateBlock {
  kind: 'renarrate'
  module: string
  notes: string[]
  html: string
}

/**
 * 机制图（DA-6、DL-40）：一张自包含的内联 SVG 加一句说明，与问答卡同在一条回答里。
 * 协议只看形状；内容（脚本、外部资源、尺寸、data-arch 指向的模块）由 checkDiagram 判（DL-41），不合格只拒这一块、文字照常。
 */
export interface DiagramBlock {
  kind: 'diagram'
  svg: string
  caption: string
}

export type AgentBlock = AnswerBlock | DigestBlock | RenarrateBlock | EditBlock | DiagramBlock

export type AgentEvent = { type: 'text'; text: string } | { type: 'block'; block: AgentBlock } | { type: 'done' }

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string }

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)
const isStr = (x: unknown): x is string => typeof x === 'string'

/** DL-11：一行 → 事件；空行返回 null（跳过） */
export function parseEventLine(line: string): Parsed<AgentEvent> | null {
  const t = line.trim()
  if (!t) return null
  let raw: unknown
  try {
    raw = JSON.parse(t)
  } catch {
    return { ok: false, error: `不是 JSON：${t.slice(0, 60)}` }
  }
  if (!isObj(raw)) return { ok: false, error: '事件不是对象' }
  if (raw.type === 'text') return isStr(raw.text) ? { ok: true, value: { type: 'text', text: raw.text } } : { ok: false, error: 'text 事件缺 text' }
  if (raw.type === 'done') return { ok: true, value: { type: 'done' } }
  if (raw.type === 'block') {
    const b = parseBlock(raw.block)
    return b.ok ? { ok: true, value: { type: 'block', block: b.value } } : b
  }
  return { ok: false, error: `不认识的事件类型：${String(raw.type)}` }
}

/** DL-11：结构化块的形状校验（只看形状；引用的模块存不存在由 resolveCitation 判，DL-13） */
export function parseBlock(raw: unknown): Parsed<AgentBlock> {
  if (!isObj(raw)) return { ok: false, error: '结构化块不是对象' }
  if (raw.kind === 'answer') {
    if (!Array.isArray(raw.parts) || !raw.parts.length) return { ok: false, error: '问答卡缺 parts' }
    const parts: AnswerPart[] = []
    for (const p of raw.parts) {
      if (!isObj(p) || !isStr(p.text)) return { ok: false, error: '问答卡的段缺 text' }
      const cites: Citation[] = []
      if (p.cites !== undefined) {
        if (!Array.isArray(p.cites)) return { ok: false, error: 'cites 不是数组' }
        for (const c of p.cites) {
          if (!isObj(c) || !isStr(c.module) || !(CITE_FIELDS as readonly unknown[]).includes(c.field))
            return { ok: false, error: `引用要写成 {module, field}，field 取 ${CITE_FIELDS.join(' / ')}` }
          cites.push({ module: c.module, field: c.field as CiteField })
        }
      }
      parts.push({ text: p.text, ...(p.inferred === true ? { inferred: true } : {}), ...(cites.length ? { cites } : {}) })
    }
    return { ok: true, value: { kind: 'answer', parts } }
  }
  if (raw.kind === 'digest') {
    if (!isObj(raw.groups)) return { ok: false, error: '梳理卡缺 groups' }
    const groups = {} as Record<DigestGroup, DigestItem[]>
    for (const g of DIGEST_GROUPS) {
      const list = raw.groups[g] ?? []
      if (!Array.isArray(list)) return { ok: false, error: `梳理卡的 ${g} 不是数组` }
      groups[g] = []
      for (const it of list) {
        if (!isObj(it) || !isStr(it.label)) return { ok: false, error: `梳理卡 ${g} 的条目缺 label` }
        if (it.modules !== undefined && !(Array.isArray(it.modules) && it.modules.every(isStr))) return { ok: false, error: 'modules 要是字符串数组' }
        groups[g].push({
          label: it.label,
          ...(it.modules ? { modules: it.modules as string[] } : {}),
          ...(isStr(it.note) ? { note: it.note } : {}),
          ...(it.uncertain === true ? { uncertain: true } : {}),
        })
      }
    }
    const extra = Object.keys(raw.groups).filter(k => !(DIGEST_GROUPS as readonly string[]).includes(k))
    if (extra.length) return { ok: false, error: `梳理卡只有四组，多出 ${extra.join('、')}` }
    return { ok: true, value: { kind: 'digest', groups } }
  }
  if (raw.kind === 'edit') {
    const list = raw.ops ?? []
    if (!Array.isArray(list) || !list.every(o => isObj(o) && isStr(o.op))) return { ok: false, error: '改动块：ops 要是带 op 的对象数组' }
    const ops = { value: list as EditBlock['ops'] }
    if (raw.withdraw !== undefined && !(Array.isArray(raw.withdraw) && raw.withdraw.every(n => Number.isInteger(n) && n > 0)))
      return { ok: false, error: '改动块的 withdraw 要是号的数组' }
    if (raw.summary !== undefined && !isStr(raw.summary)) return { ok: false, error: '改动块的 summary 要是文字' }
    const extra = Object.keys(raw).filter(k => !['kind', 'ops', 'withdraw', 'summary'].includes(k))
    if (extra.length) return { ok: false, error: `改动块多出 ${extra.join('、')}` }
    const withdraw = (raw.withdraw as number[] | undefined) ?? []
    if (!ops.value.length && !withdraw.length) return { ok: false, error: '改动块既没有操作也没有要撤回的号' }
    return { ok: true, value: { kind: 'edit', ops: ops.value, ...(withdraw.length ? { withdraw } : {}), ...(isStr(raw.summary) ? { summary: raw.summary } : {}) } }
  }
  if (raw.kind === 'diagram') {
    // DL-40：形状不合按 DL-11 整轮拒绝；内容的检查（DL-41）只拒这一块，留给页面在回答到达时做
    if (!isStr(raw.svg) || !raw.svg.trim() || !isStr(raw.caption) || !raw.caption.trim()) return { ok: false, error: '机制图块要有 svg（内联 SVG 文字）与 caption（一句说明）' }
    const extra = Object.keys(raw).filter(k => !['kind', 'svg', 'caption'].includes(k))
    if (extra.length) return { ok: false, error: `机制图块多出 ${extra.join('、')}` }
    return { ok: true, value: { kind: 'diagram', svg: raw.svg, caption: raw.caption.trim() } }
  }
  if (raw.kind === 'renarrate') {
    // 形状校验只认三个字段；多出的键（可能是事实字段）留给 DL-8 的判别说清原因，这里不吞
    if (!isStr(raw.module) || !isStr(raw.html) || !Array.isArray(raw.notes) || !raw.notes.every(isStr))
      return { ok: false, error: '重讲块要有 module、notes（字符串数组）、html' }
    return { ok: true, value: raw as unknown as RenarrateBlock }
  }
  return { ok: false, error: `不认识的结构化块：${String(raw.kind)}` }
}
