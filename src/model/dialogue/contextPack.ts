/**
 * 上下文包（DL-14，ADR-0063 §7.1「上下文包」）：每一轮交给 agent 的一份 JSON——锚点、题解、骨架字段、代码事实摘要、可用查询说明、
 * 贴的图片；重讲另带题解模板要点与已有的讲法要求（DL-8）。锚点三种：模块 / 步骤 / 无选中。
 * 骨架字段只摘描述原文（AI 拿去理解，答案里要引用时写 {模块, 字段}，DL-13）；代码事实由接入层算好传进来（换一个前端照样要，所以在模型层）。
 */
import { invariantsOf, summaryOf } from '../contract'
import { explainerOf } from '../explainer/lookup'
import type { ModelIndex, SketchDef } from '../types'
import { DIAGRAM_LIMITS } from './diagram'
import { CITE_FIELDS } from './protocol'

/** 锚点（DA-2）：下一句话带着哪个模块 / 哪一步；没有选中时为 none */
export type Anchor =
  /** sheet：草图里的锚点所在的那张草图（挂载点）；没有选中框时锚在这张草图的挂载点上（DA-2：草图里总有锚点） */
  | { kind: 'module'; module: string; sheet?: string }
  | { kind: 'step'; scenario: string; frame: string; from: string; to: string; label?: string }
  | { kind: 'none' }

/** 当前版本上的两种请求（DA-3、DA-4）与草图里的「改」（DA-6） */
export type DialogueMode = 'ask' | 'renarrate' | 'edit'

/**
 * DL-14（波 2 补齐 07 §7.1）：草图里的上下文——设计、当前张（全文）、同设计的其他草图（挂载点与模块）、基线里同一层、带号的改动清单、
 * 父模块（挂载点）的原则。页面从编辑会话构造（AI 的改动停在未保存的会话里，07 §7.2），开发服务器原样放进包里。
 */
export interface SketchContext {
  design: string
  mount: string
  current: SketchDef
  others: { mount: string; modules: { id: string; name: string }[] }[]
  baseline: { modules: { id: string; name: string; kind?: string }[]; relations: { id: string; from: string; to: string; type: string }[] }
  changes: { n: number; kind: string; summary: string; round: number; by: string }[]
  principle: string | null
}

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
  /** 改：草图里的上下文 */
  sketch?: SketchContext | null
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
  sketch: SketchContext | null
  writing: string[]
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

/** DL-40：机制图块的约定（「问」与「改」都带；「重讲」不带——题解本身就是图） */
const DIAGRAM_OUTPUT = [
  `机制图块：用户要图，或讲拆分 / 合并之后怎么运作时，在问答卡之外再给一块 {"kind":"diagram","svg":"<svg …>…</svg>","caption":"一句说明"}——一张自包含的内联 SVG：必须写 viewBox，宽不超过 ${DIAGRAM_LIMITS.width}（资料区一列），宽高比在 1:${DIAGRAM_LIMITS.ratio} 到 ${DIAGRAM_LIMITS.ratio}:1，不超过 ${DIAGRAM_LIMITS.bytes / 1024} KB；不许 <script>、on… 事件属性、javascript:、外部链接与 <foreignObject>；颜色用 currentColor 或写死的中性色。`,
  '图里的模块用 data-arch="<模块 ID>" 标出（单击在画布上选中），ID 必须在描述里（草图里：在当前张 sketch.current 里或就是挂载点）；不合格的图整块被拒，文字照常显示。',
  '示例（一行）：{"type":"block","block":{"kind":"diagram","caption":"拆分后命令先进会话、再由施用者落盘","svg":"<svg xmlns=\\"http://www.w3.org/2000/svg\\" viewBox=\\"0 0 400 120\\"><g data-arch=\\"<模块 ID>\\"><rect x=\\"10\\" y=\\"30\\" width=\\"140\\" height=\\"60\\" rx=\\"8\\" fill=\\"none\\" stroke=\\"currentColor\\"/><text x=\\"80\\" y=\\"65\\" text-anchor=\\"middle\\" fill=\\"currentColor\\">会话</text></g></svg>"}}',
]

const OUTPUT = {
  ask: [
    '一行一个 JSON：{"type":"text","text":…} 文本片段、{"type":"block","block":…} 结构化块、{"type":"done"} 结束。',
    `问答卡：{"kind":"answer","parts":[{"text":…,"cites":[{"module":…,"field":…}],"inferred":true?}]}；field 取 ${CITE_FIELDS.join(' / ')}，原文由架构台填，不要抄写；推断出来的段写 inferred: true。`,
    '收到图片时回梳理卡：{"kind":"digest","groups":{"matched":[],"mismatched":[],"extra":[],"missing":[]}}，条目 {"label":…,"modules":[…]?,"note":…?,"uncertain":true?}——对上的 / 一个框对应代码里多个模块的 / 画了但代码里没有依赖的 / 系统有而没画的。',
    ...DIAGRAM_OUTPUT,
  ],
  renarrate: [
    '一行一个 JSON：{"type":"text"…}、{"type":"block"…}、{"type":"done"}。',
    '重讲块：{"kind":"renarrate","module":…,"notes":["这次的讲法要求，一条一行"],"html":"按要求重新生成的完整题解 HTML"}；不许出现其他键。',
    '只动讲法不动事实：职责、一句话、不变式、关系、接口都不改；summary 与不变式用 data-field 引用，不抄写（04 §3.11）。',
    '题解形态：一个自包含 HTML、内联 SVG、深浅色 CSS 变量、结论先行、不超过三屏；不要手写 arch-basis，架构台会盖。',
  ],
  edit: [
    '一行一个 JSON：{"type":"text","text":…} 文本片段、{"type":"block","block":…} 结构化块、{"type":"done"} 结束；结构化块必须包在 block 里，一个块一行。',
    '示例（一行）：{"type":"block","block":{"kind":"edit","summary":"合并 A 与 B 为编辑会话","ops":[{"op":"merge","sketch":"<sketch.mount>","ids":["<模块 ID>","<模块 ID>"],"name":"编辑会话","id":"session"}]}}',
    '改动块：{"kind":"edit","summary":"这一轮改了什么（一句话）","ops":[…],"withdraw":[号]?}；ops 是设计级编辑操作（与架构台编辑器同一族），一轮的全部操作在你说完时一次性应用为一步，任一条做不成整轮不落。',
    '可用操作：merge {sketch, ids, name, id}、split {sketch, id, parts:[{name,id}]}、demote {sketch, id, target}、promote {sketch, id}、rename {sketch, id, newId}、remove {sketch, id}、edit {sketch, edit}；edit 里：addModule {parent, name, id?, kind?}、updateModule {id, patch}、connect {from, to, type, description?}、updateRelation {id, patch}、removeRelation {id}、addInterface {owner, name, signature?}、setAbstraction {text}。sketch 是挂载点（sketch.mount）。',
    '单张操作也要写 op，包在 edit 里：例 {"op":"edit","sketch":"<挂载点>","edit":{"op":"addModule","parent":"<挂载点>","name":"认可","id":"approval"}}；连线 {"op":"edit","sketch":"<挂载点>","edit":{"op":"connect","from":"<挂载点>.approval","to":"<挂载点>.session","type":"queries"}}（新框的完整 ID = 父 ID + . + id）。',
    '不许出位置类操作（moveNode、relabel、autoArrange）：已有的框只有人能动，新框由架构台按规则安放。撤回某一项写在 withdraw 里（号见 sketch.changes），不要自己拼逆向操作。',
    '只回答不改图时照常回问答卡（answer）；收到图片时先回梳理卡（digest）。',
    ...DIAGRAM_OUTPUT,
  ],
} as const

/** 04 §5「按草图扩展」的写法要点（改的时候带上） */
const SKETCH_WRITING = [
  '一张草图只画一个模块的一层（挂载点的直接子模块与它们之间的关系），七个左右；往下再设计一层就在那个模块上再挂一张。',
  'ID = 父 ID + 短名（kebab-case）；合并、拆分、改 ID、移动时架构台自动记血缘（from 指向基线），不要自己写 from。',
  '关系四类：queries / commands / notifies / streams；关系只写本层，一端可以是本层之外的模块。',
  '职责写「它负责什么、不负责什么」；不写实现细节。',
]

const BOUNDARIES = [
  '只读：不写任何文件，不改规则、确认记录、当前版本、草图文件（ADR-0063 §7.1）；草图里的改动只能以改动块交给架构台。',
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
    sketch: input.mode === 'edit' ? (input.sketch ?? null) : null,
    writing: input.mode === 'edit' ? [...SKETCH_WRITING] : [],
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

