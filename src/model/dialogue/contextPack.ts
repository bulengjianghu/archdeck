/**
 * 上下文包（DL-14，ADR-0063 §7.1「上下文包」）：每一轮交给 agent 的一份 JSON——锚点、题解、骨架字段、代码事实摘要、可用查询说明、
 * 贴的图片；重讲另带题解模板要点与已有的讲法要求（DL-8）。锚点三种：模块 / 步骤 / 无选中。
 * 骨架字段只摘描述原文（AI 拿去理解，答案里要引用时写 {模块, 字段}，DL-13）；代码事实由接入层算好传进来（换一个前端照样要，所以在模型层）。
 */
import { invariantsOf, summaryOf } from '../contract'
import { explainerOf } from '../explainer/lookup'
import type { ModelIndex } from '../types'
import { CITE_FIELDS } from './protocol'

/** 锚点（DA-2）：下一句话带着哪个模块 / 哪一步；没有选中时为 none */
export type Anchor =
  | { kind: 'module'; module: string }
  | { kind: 'step'; scenario: string; frame: string; from: string; to: string; label?: string }
  | { kind: 'none' }

/** 当前版本上的两种请求（DA-3、DA-4）；草图里的「改」随波 2 */
export type DialogueMode = 'ask' | 'renarrate'

export interface PackImage {
  name: string
  /** 接入层落到磁盘的位置（agent 用只读工具读它） */
  path: string
  mediaType: string
}

/** 代码事实摘要（接入层从架构治理算好） */
export interface CodeFactsSummary {
  /** 扇入、扇出、不稳定度（K16） */
  ca?: number
  ce?: number
  instability?: number
  /** 传入闭包大小（改它牵动几个，K15） */
  impactIn?: number
  /** 涉及它的违规条数与所在环（U、K） */
  violations?: number
  cycles?: number
  files?: number
}

export interface ContextPackInput {
  project: string
  anchor: Anchor
  mode: DialogueMode
  text: string
  images?: PackImage[]
  facts?: CodeFactsSummary | null
  /** 重讲：已有的讲法要求（DL-8，累积） */
  notes?: string[]
}

interface ModuleSketch {
  id: string
  name: string
  kind?: string
  role?: string
  summary?: string
  responsibility?: string
  principle?: string
  invariants?: string[]
  parent?: string
  children?: { id: string; name: string; summary?: string }[]
  relations?: { id: string; from: string; to: string; type: string; description?: string }[]
  interfaces?: { id: string; name: string; signature?: string }[]
}

export interface ContextPack {
  protocol: 'arch-agent/1'
  project: { id: string; name: string }
  anchor: Anchor & { name?: string; fromName?: string; toName?: string; scenarioName?: string }
  request: { mode: DialogueMode; text: string }
  skeleton: ModuleSketch[]
  explainer: { module: string; path: string; html: string } | null
  facts: CodeFactsSummary | null
  notes: string[]
  images: PackImage[]
  queries: string[]
  output: string[]
  boundaries: string[]
}

/**
 * 「可用查询说明」：agent 能用的只读查询 = 架构台 MCP 服务器（npm run arch:mcp，Q6）里不写任何记录的那些工具
 * （rescan、check_dependency 写拦截记录，sketch_archive 归档，都不给）；接入层按同一张表放行。
 */
export const AGENT_QUERY_TOOLS = [
  'overview',
  'locate',
  'list_violations',
  'list_cycles',
  'issues',
  'hotspots',
  'coupling',
  'surface',
  'impact',
  'metrics',
  'tiers',
  'strata',
  'place',
  'sketch_check',
] as const

export const AGENT_QUERIES = [
  `MCP 服务器 arch 的只读工具：${AGENT_QUERY_TOOLS.join('、')}（参数 project 取上下文包的 project.id）`,
  'impact：改它牵动谁（传入闭包）/ 它要谁（传出闭包）；metrics：扇入、扇出、不稳定度；surface：模块表面；locate：文件归哪个模块',
  '源码与描述用 Read / Grep / Glob 读（工作目录限定在被描述项目与架构台目录）',
]

const OUTPUT = {
  ask: [
    '一行一个 JSON：{"type":"text","text":…} 文本片段、{"type":"block","block":…} 结构化块、{"type":"done"} 结束。',
    `问答卡：{"kind":"answer","parts":[{"text":…,"cites":[{"module":…,"field":…}],"inferred":true?}]}；field 取 ${CITE_FIELDS.join(' / ')}，原文由架构台填，不要抄写；推断出来的段写 inferred: true。`,
    '收到图片时回梳理卡：{"kind":"digest","groups":{"matched":[],"mismatched":[],"extra":[],"missing":[]}}，条目 {"label":…,"modules":[…]?,"note":…?,"uncertain":true?}——对上的 / 一个框对应代码里多个模块的 / 画了但代码里没有依赖的 / 系统有而没画的。',
  ],
  renarrate: [
    '一行一个 JSON：{"type":"text"…}、{"type":"block"…}、{"type":"done"}。',
    '重讲块：{"kind":"renarrate","module":…,"notes":["这次的讲法要求，一条一行"],"html":"按要求重新生成的完整题解 HTML"}；不许出现其他键。',
    '只动讲法不动事实：职责、一句话、不变式、关系、接口都不改；summary 与不变式用 data-field 引用，不抄写（04 §3.11）。',
    '题解形态：一个自包含 HTML、内联 SVG、深浅色 CSS 变量、结论先行、不超过三屏；不要手写 arch-basis，架构台会盖。',
  ],
} as const

const BOUNDARIES = [
  '只读：不写任何文件，不改规则、确认记录、当前版本、草图（ADR-0063 §7.1）。',
  '答案引用描述原文时只写 {模块, 字段}；说不准的标推断。',
]

function sketchOf(index: ModelIndex, id: string, deep: boolean): ModuleSketch | null {
  const m = index.modules.get(id)
  const isRoot = id === index.rootId
  if (!m && !isRoot) return null
  const base: ModuleSketch = { id, name: m?.name ?? index.model.system.name }
  if (!m) return { ...base, summary: index.model.system.description, children: kids(index, id) }
  const s = summaryOf(m)?.text
  const inv = invariantsOf(m).map(i => i.text)
  const out: ModuleSketch = {
    ...base,
    ...(m.kind ? { kind: m.kind } : {}),
    ...(m.role ? { role: m.role } : {}),
    ...(s ? { summary: s } : {}),
  }
  if (!deep) return out
  const path = index.pathOf.get(id) ?? []
  const rels = [...(index.outRelations.get(id) ?? []), ...(index.inRelations.get(id) ?? [])]
    .map(r => index.relations.get(r))
    .filter(r => !!r)
    .map(r => ({ id: r.id, from: r.from, to: r.to, type: r.type, ...(r.description ? { description: r.description } : {}) }))
  const ifs = [...index.interfaces.values()].filter(i => i.owner === id).map(i => ({ id: i.id, name: i.name, ...(i.signature ? { signature: i.signature } : {}) }))
  return {
    ...out,
    ...(m.responsibility ? { responsibility: m.responsibility } : {}),
    ...(m.principle || m.abstraction ? { principle: m.principle ?? m.abstraction } : {}),
    ...(inv.length ? { invariants: inv } : {}),
    ...(path.length > 1 ? { parent: path[path.length - 2] } : {}),
    ...(kids(index, id).length ? { children: kids(index, id) } : {}),
    ...(rels.length ? { relations: rels } : {}),
    ...(ifs.length ? { interfaces: ifs } : {}),
  }
}

function kids(index: ModelIndex, id: string) {
  return (index.childrenOf.get(id) ?? []).map(c => {
    const m = index.modules.get(c)!
    const s = summaryOf(m)?.text
    return { id: c, name: m.name, ...(s ? { summary: s } : {}) }
  })
}

/** DL-14：构造一轮的上下文包（纯函数；同一输入同一包，可快照） */
export function buildContextPack(index: ModelIndex, input: ContextPackInput): ContextPack {
  const name = (id: string) => index.modules.get(id)?.name ?? index.actors.get(id)?.name ?? (id === index.rootId ? index.model.system.name : id)
  const a = input.anchor
  let anchor: ContextPack['anchor'] = a
  let skeleton: ModuleSketch[] = []
  let explainerModule: string | null = null
  if (a.kind === 'module') {
    anchor = { ...a, name: name(a.module) }
    skeleton = [sketchOf(index, a.module, true)].filter(x => !!x)
    explainerModule = a.module
  } else if (a.kind === 'step') {
    anchor = { ...a, fromName: name(a.from), toName: name(a.to), scenarioName: index.scenarios.get(a.scenario)?.name ?? a.scenario }
    skeleton = [a.from, a.to].map(id => sketchOf(index, id, true)).filter(x => !!x)
  } else {
    skeleton = [sketchOf(index, index.rootId, false)].filter(x => !!x)
  }
  const path = explainerModule ? explainerOf(index, explainerModule) : null
  const html = path ? index.model.explainers?.[path] : undefined
  return {
    protocol: 'arch-agent/1',
    project: { id: input.project, name: index.model.system.name },
    anchor,
    request: { mode: input.mode, text: input.text },
    skeleton,
    explainer: path && html !== undefined && explainerModule ? { module: explainerModule, path, html } : null,
    facts: input.facts ?? null,
    notes: input.mode === 'renarrate' ? [...(input.notes ?? [])] : [],
    images: [...(input.images ?? [])],
    queries: [...AGENT_QUERIES],
    output: [...OUTPUT[input.mode]],
    boundaries: [...BOUNDARIES],
  }
}

/** 给真实 claude 的提示文本：上下文包原样附在一段说明之后（假 agent 直接收 JSON） */
export function packPrompt(pack: ContextPack): string {
  return [
    '你是架构台（h5p-arch-desk）里的对话助手。下面是这一轮的上下文包（JSON）。',
    '按 output 里的薄协议作答：只输出 JSON 行，不要输出别的文字。可以用只读工具读源码与运行 queries 里的查询。',
    '',
    JSON.stringify(pack, null, 2),
  ].join('\n')
}
