/**
 * 查询 / 委托的分类建议（ADR-0029 §5「分类是主张」、04 §3.4 的启发）：给未分类（calls）的关系按三问的第一问打分——
 * 被调方拥有后果吗？否 → 查询（queries），是 → 委托（commands）。只在两者之间建议，通知与流不从 calls 推出。
 *
 * 证据分三组，各给分数与一句依据：
 * - 代码事实（有源码时）：文件依赖的交互种类（K1 的 invokeKinds）、调用点（结果是否被 await / 赋值使用）、被调函数的签名（返回 void / Promise<void> 还是有值）、
 *   目标文件的状态持有（store、类实例字段、文件或网络 IO）；
 * - 描述：目标的角色（共用件）、链路上的通知（目标会发出 notifies）、接口签名的返回类型、目标模块名；
 * - 名字：被调的函数名、成员名、接口名与说明里的标识符像查询（get / is / find / resolve …）还是像命令（set / start / save / dispatch …），说明里的中文动词。
 * 分高者为建议类型；平分时按委托（交出去更保守）。证据不足时给低置信度，仍给建议类型。
 * 纯函数：源码相关的事实由接入层提取后传入（ClassifyCode），模型层不碰文件系统。
 */
import { moduleName } from '../names'
import { isSharedRole, isUnclassified, type ModelIndex, type RelationEntity } from '../types'
import { plainInteraction, related } from './facts'
import { ASSEMBLY_KINDS, type FileDep, type GovernanceReport } from './types'

/** 被调函数的返回形态（按签名；没写返回类型时按函数体推断） */
export type ReturnShape = 'void' | 'promise-void' | 'value' | 'promise-value' | 'unknown'

/** 依赖方文件里对一个导入名（或经它取得的成员）的一处使用 */
export interface CallSiteFact {
  /** 导入名（目标文件导出的名字；默认导入为 default，命名空间导入为 *） */
  name: string
  /** 经导入名取得的成员（`X.m()`、`const { m } = X()`、`const v = X(); v.m()`）；没有时是导入名本身 */
  member?: string
  called: boolean
  /** 调用结果被使用（赋值、作为参数、返回、取成员）；undefined 为看不出 */
  used?: boolean
  awaited?: boolean
  /** 依赖方文件的行号 */
  line?: number
  /** 经调用结果存下的句柄取得的成员（`const v = useX(); v.m()`）：句柄常是统一入口，成员归哪个子模块看不出，只按名字看 */
  handle?: true
}

/** 目标文件里一个导出声明的事实 */
export interface DeclFact {
  kind: 'function' | 'class' | 'variable' | 'component'
  returns?: ReturnShape
  /** 签名文本（截断），作为依据给人看 */
  signature?: string
  line?: number
}

/** 目标文件的状态持有：命中的写法片段（作为依据） */
export interface FileStateFact {
  /** 模块级的响应式状态或可变状态（reactive / ref / defineStore / 模块级 let …） */
  store?: string
  /** 有实例字段的类（this.x = …、属性声明） */
  instance?: string
  /** 文件或网络 IO（fetch、fs、WebSocket、postMessage …） */
  io?: string
}

/** 接入层提取的、分类用的源码事实 */
export interface ClassifyCode {
  /** `${依赖方文件}\0${目标文件}` → 调用点 */
  sites: ReadonlyMap<string, readonly CallSiteFact[]>
  /** `${文件}\0${导出名}` → 声明；类的方法为 `${文件}\0${类名}.${方法名}` */
  decls: ReadonlyMap<string, DeclFact>
  /** 文件 → 状态持有；没有任何状态持有的文件不在表里 */
  state: ReadonlyMap<string, FileStateFact>
  /** 模块 → 直接归属它的文件（SourceOwnership.direct）；关系没有文件依赖时按目标模块的文件看状态持有 */
  direct: ReadonlyMap<string, readonly string[]>
}

export type ClassifiedType = 'queries' | 'commands'
export type ClassifyConfidence = 'high' | 'medium' | 'low'

export interface Classification {
  relation: string
  type: ClassifiedType
  confidence: ClassifyConfidence
  /** 两边的得分 */
  score: { queries: number; commands: number }
  /** 依据，按分量从大到小；每条注明倾向 */
  reasons: string[]
  /** 支撑这条关系的交互使用只有继承（子类事实，K12）或只有组装（组装事实，K13）：关系多半可以删掉、由事实承载 */
  factOnly?: 'extends' | 'assembly'
  /** 没有说明时补写说明用的一句话：渲染的子组件，或调到的函数名 */
  summary?: string
}

// ── 名字的倾向 ──

/** 像命令的动词（委托）：改状态、写、启动、交出 */
const COMMAND_VERBS = [
  'set', 'start', 'stop', 'save', 'write', 'dispatch', 'emit', 'apply', 'reset', 'load', 'reload', 'init', 'initialize', 'register', 'unregister',
  'update', 'remove', 'delete', 'add', 'open', 'close', 'play', 'pause', 'resume', 'seek', 'destroy', 'dispose', 'mount', 'unmount', 'attach',
  'detach', 'send', 'post', 'push', 'enqueue', 'flush', 'clear', 'commit', 'run', 'execute', 'exec', 'handle', 'trigger', 'toggle', 'switch',
  'enter', 'exit', 'leave', 'persist', 'record', 'report', 'append', 'insert', 'put', 'replace', 'move', 'rename', 'install', 'enable',
  'disable', 'schedule', 'cancel', 'abort', 'retry', 'restart', 'refresh', 'sync', 'notify', 'publish', 'subscribe', 'connect', 'disconnect',
  'upload', 'render', 'draw', 'feed', 'process', 'begin', 'finish', 'complete', 'undo', 'redo', 'discard', 'archive', 'promote', 'release',
  'acquire', 'lock', 'unlock', 'terminate', 'spawn', 'fire', 'change', 'modify', 'patch', 'mark', 'confirm', 'accept', 'reject', 'navigate',
  'go', 'jump', 'scroll', 'focus', 'show', 'hide', 'expand', 'collapse', 'pin', 'unpin', 'drag', 'drop', 'resize', 'prepare', 'setup',
  'teardown', 'configure', 'log', 'warn', 'track', 'select', 'stash', 'restore', 'recover', 'reconnect', 'swap', 'drive', 'kick', 'tick',
  'step', 'end', 'hand', 'on', 'off', 'once', 'listen', 'watch', 'invalidate', 'evict', 'cache', 'buffer',
] as const
/** 像查询的动词（查询）：取值、判断、计算、派生 */
const QUERY_VERBS = [
  'get', 'is', 'has', 'can', 'should', 'find', 'resolve', 'compute', 'calc', 'calculate', 'derive', 'parse', 'format', 'to', 'read', 'list',
  'query', 'lookup', 'match', 'collect', 'count', 'measure', 'check', 'validate', 'verify', 'compare', 'diff', 'detect', 'probe', 'pick',
  'map', 'filter', 'sort', 'group', 'normalize', 'serialize', 'stringify', 'extract', 'build', 'make', 'project', 'layout', 'summarize',
  'describe', 'locate', 'explain', 'evaluate', 'judge', 'plan', 'infer', 'highlight', 'fetch', 'peek', 'search', 'scan', 'estimate', 'guess',
  'classify', 'split', 'join', 'merge', 'clone', 'copy', 'encode', 'decode', 'hash', 'sum', 'min', 'max', 'clamp', 'round', 'wrap', 'index',
  'tokenize', 'convert', 'translate', 'route', 'bind', 'lift', 'assign', 'name', 'label', 'title', 'key', 'id', 'use',
] as const
/** 名字结尾像查询（`selectedOf`、`moduleName`、`edgeLabel`） */
const QUERY_SUFFIX = /(Of|Name|Names|Label|Labels|Text|Key|Keys|Id|Ids|Count|Size|Info|Summary|Map|List|Set|Path|Url|Type|Kind|Status|State)$/

const verbOf = (name: string): string => {
  const m = /^_*([a-z]+)/.exec(name)
  return m ? m[1] : name.toLowerCase()
}

/** 名字的倾向：命令 / 查询 / 看不出 */
export function nameLean(name: string): 'commands' | 'queries' | undefined {
  if (!/^[A-Za-z_$][\w$]*$/.test(name) || /^[A-Z]/.test(name)) return undefined
  const verb = verbOf(name)
  // select 后接大写（selectFile）是命令；selected / selection 是取值
  if (verb === 'select') return /^select[A-Z]/.test(name) ? 'commands' : undefined
  // on 后接大写（onChange）是注册回调；use 是组合函数，看不出
  if (verb === 'on') return /^on[A-Z]/.test(name) ? 'commands' : undefined
  if (verb === 'use') return undefined
  if ((COMMAND_VERBS as readonly string[]).includes(verb)) return 'commands'
  if ((QUERY_VERBS as readonly string[]).includes(verb)) return 'queries'
  if (QUERY_SUFFIX.test(name)) return 'queries'
  return undefined
}

/** 目标模块 ID 最后一段的倾向（`state.desk.actions` → 委托；`state.desk.projection` → 查询） */
const COMMAND_SEGMENT = /(^|[-_.])(actions?|commands?|dispatch|writer|write|store|sync|controller|coordinator|scheduler|manager|lifecycle|driver|engine|runner|bootstrap|recorder|reporter|tracker|player|session|edit|editor|save|persist|loader|starter|switch|swap|recovery|reconnect)($|[-_.])/
const QUERY_SEGMENT = /(^|[-_.])(projection|selectors?|query|queries|types|names|utils?|helpers?|format|formatter|parse|parser|reader|read|layout|index|indexer|facts|evidence|diff|compare|names|labels|rules|grading|outline|route|path|plan|planner|probe|env-probe|math|calc|constants?|contracts|schema|validate|validator|check|summary|level|cycles)($|[-_.])/

/** 中文说明里的动词 */
const ZH_QUERY = /取|读|查|计算|算出|派生|解析|判定|判断|校验|比较|匹配|格式化|求|列出|得到|推出|投影|定位|返回|获取|询问|探测|估算/
const ZH_COMMAND = /写|保存|启动|停止|派发|提交|注册|设置|切换|重置|创建|销毁|上报|发送|推送|交给|让|触发|执行|打开|关闭|播放|暂停|跳转|导航|渲染|更新|删除|移除|添加|记录|驱动|调度|安装|卸载|挂载|释放|刷新|重连|恢复|改为|修改|下发|装配|开闸|换代|换腿|喂|送入|写入/

const IDENT = /[A-Za-z_$][\w$]{2,}/g

/** 接口签名的返回类型：`f(…): T`；没写为 undefined */
export function signatureReturns(signature: string | undefined): ReturnShape | undefined {
  if (!signature) return undefined
  const m = /\)\s*:\s*([^;{\n]+?)\s*(;|$|\n|\})/m.exec(signature)
  if (!m) return undefined
  return returnShapeOf(m[1])
}

/** 返回类型文本的形态 */
export function returnShapeOf(type: string): ReturnShape {
  const t = type.replace(/\s+/g, '')
  if (/^(void|undefined|never)$/.test(t)) return 'void'
  if (/^Promise<(void|undefined)>$/.test(t)) return 'promise-void'
  if (/^Promise</.test(t)) return 'promise-value'
  return 'value'
}

interface Signal {
  side: ClassifiedType
  weight: number
  why: string
  code?: true
}

const fmt = (n: number) => Math.round(n * 10) / 10

/** 模块或其祖先的角色 */
const roleIn = (index: ModelIndex, id: string) =>
  (index.pathOf.get(id) ?? [id])
    .map(p => index.modules.get(p)?.role)
    .filter(Boolean)
    .pop()

/** 关系的支撑依赖：同向的模块依赖（依赖方在 from 子树或祖先、被依赖方在 to 子树或祖先） */
function forwardFiles(index: ModelIndex, report: Pick<GovernanceReport, 'moduleDeps'> | null, r: RelationEntity): FileDep[] {
  if (!report || !index.modules.has(r.from) || !index.modules.has(r.to)) return []
  return [...report.moduleDeps.values()].filter(d => related(index, d.from, r.from) && related(index, d.to, r.to)).flatMap(d => d.files)
}

/**
 * ADR-0029 §5：给一条关系（通常是未分类的 calls）建议查询或委托，附置信度与依据。
 * report 为治理报告（有代码事实时；设计版本为 null），code 为接入层提取的调用点、签名与状态持有（没有时只按描述与名字）。
 */
export function classifyRelation(
  index: ModelIndex,
  report: Pick<GovernanceReport, 'moduleDeps'> | null,
  r: RelationEntity,
  code?: ClassifyCode,
): Classification {
  const signals: Signal[] = []
  const add = (side: ClassifiedType, weight: number, why: string, fromCode = false) => {
    if (weight > 0) signals.push({ side, weight, why, ...(fromCode ? { code: true as const } : {}) })
  }
  const toName = moduleName(index, r.to)
  let factOnly: Classification['factOnly']

  // ① 目标是共用件
  if (isSharedRole(roleIn(index, r.to))) add('queries', 1.5, `目标「${toName}」是共用件（role: shared）`)

  // ② 代码事实：交互种类、调用点与签名、状态持有
  const files = forwardFiles(index, report, r)
  const names = new Set<string>()
  const called = new Set<string>()
  const rendered: string[] = []
  if (files.length) {
    const interacting = files.filter(f => f.invokes)
    if (interacting.length && !interacting.some(plainInteraction)) {
      const kinds = new Set(interacting.flatMap(f => f.invokeKinds ?? []))
      factOnly = [...kinds].every(k => k === 'extends') ? 'extends' : [...kinds].every(k => k === 'extends' || ASSEMBLY_KINDS.includes(k)) ? 'assembly' : undefined
      if (factOnly)
        signals.push({
          side: 'commands',
          weight: 0,
          why: `代码里只有${factOnly === 'extends' ? '继承（extends，子类事实 K12）' : '组装（new / 工厂 / 注册，组装事实 K13）'}，没有调用：关系可删、由事实承载`,
          code: true,
        })
    }
    const vue = interacting.filter(f => /\.vue$/i.test(f.to))
    if (vue.length) rendered.push(...new Set(vue.map(f => f.to.split('/').pop()!.replace(/\.vue$/i, ''))))
    if (vue.length) add('commands', 2, `渲染子组件 ${[...new Set(vue.map(f => f.to.split('/').pop()))].slice(0, 3).join('、')}（把一块界面交给它，${vue[0].from}:${vue[0].line}）`, true)
    if (code) {
      let q = 0
      let c = 0
      const qWhy: string[] = []
      const cWhy: string[] = []
      const seen = new Set<string>()
      for (const f of interacting) {
        for (const s of code.sites.get(`${f.from}\0${f.to}`) ?? []) {
          const callee = s.member ?? s.name
          if (callee !== '*' && callee !== 'default') {
            names.add(callee)
            if (s.called && !s.handle && !/^use[A-Z]/.test(callee)) called.add(callee)
          }
          const key = `${f.to}\0${callee}`
          // 取句柄的组合函数（useX()）不是这次交互本身，看经它调的成员
          if (seen.has(key) || !s.called || s.handle || (!s.member && /^use[A-Z]/.test(callee))) continue
          seen.add(key)
          const decl = code.decls.get(`${f.to}\0${s.member && s.name !== '*' && s.name !== 'default' ? `${s.name}.${s.member}` : callee}`) ?? code.decls.get(`${f.to}\0${callee}`)
          const at = `${f.from}:${s.line ?? f.line}`
          const sig = decl?.signature ? `（${decl.signature}）` : ''
          if (decl?.returns === 'void' || decl?.returns === 'promise-void') {
            c += 1
            cWhy.push(`${callee}() 返回 ${decl.returns === 'void' ? 'void' : 'Promise<void>'}${sig}`)
          } else if ((decl?.returns === 'value' || decl?.returns === 'promise-value') && s.used) {
            q += 1
            qWhy.push(`${callee}() 有返回值且结果被${s.awaited ? ' await 后' : ''}使用${sig}，${at}`)
          } else if (decl?.returns === 'value' || decl?.returns === 'promise-value') {
            c += 0.5
            cWhy.push(`${callee}() 有返回值但结果没被使用，${at}`)
          } else if (s.used === true) {
            q += 0.5
            qWhy.push(`${callee}() 的结果被使用，${at}`)
          } else if (s.used === false) {
            c += 0.5
            cWhy.push(`${callee}() 作为语句调用、不取结果，${at}`)
          }
        }
      }
      const total = q + c
      if (total) {
        if (q) add('queries', fmt((2.5 * q) / total), `调用点：${qWhy.slice(0, 3).join('；')}${qWhy.length > 3 ? ` 等 ${qWhy.length} 处` : ''}`, true)
        if (c) add('commands', fmt((2.5 * c) / total), `调用点：${cWhy.slice(0, 3).join('；')}${cWhy.length > 3 ? ` 等 ${cWhy.length} 处` : ''}`, true)
      }
    }
  }
  if (code) {
    // 状态持有：调到的目标文件；没有文件依赖时按目标模块（含子树）直接归属的文件
    // 只认落在目标子树内的文件（落在祖先上的多是统一入口，如 useDesk() 所在的文件，说明不了目标）
    const subtree = index.modules.has(r.to)
      ? new Set([...code.direct].filter(([m]) => (index.pathOf.get(m) ?? []).includes(r.to)).flatMap(([, fs]) => fs))
      : new Set<string>()
    let targets = [...new Set(files.filter(f => f.invokes && subtree.has(f.to)).map(f => f.to))]
    if (!targets.length) targets = [...subtree]
    if (targets.length) {
      const facts = targets.flatMap(f => (code.state.has(f) ? [[f, code.state.get(f)!] as const] : []))
      const store = facts.find(([, s]) => s.store)
      const inst = facts.find(([, s]) => s.instance)
      const io = facts.find(([, s]) => s.io)
      if (store) add('commands', 1, `目标持有状态（${store[1].store}，${store[0]}）`, true)
      if (inst) add('commands', 1, `目标是有实例状态的类（${inst[1].instance}，${inst[0]}）`, true)
      if (io) add('commands', 1, `目标做文件或网络 IO（${io[1].io}，${io[0]}）`, true)
      if (!facts.length) add('queries', 1, `目标不持有状态（${targets.length} 个文件里没有 store、实例字段与 IO）`, true)
    }
  }

  // ③ 链路上的通知：目标（或其子树）会发出 notifies
  const emits = [...index.relations.values()].filter(x => x.type === 'notifies' && index.modules.has(x.from) && index.modules.has(r.to) && related(index, x.from, r.to))
  if (emits.length) add('commands', 1, `目标会发出通知（${emits.slice(0, 2).map(x => x.id).join('、')}${emits.length > 2 ? ` 等 ${emits.length} 条` : ''}）`)

  // ④ 接口签名的返回类型
  const x = r.interface ? index.interfaces.get(r.interface) : undefined
  if (x) names.add(x.name.replace(/[(<].*$/s, '').trim())
  const ret = signatureReturns(x?.signature)
  if (ret === 'void' || ret === 'promise-void') add('commands', 1, `接口 ${x!.name} 返回 ${ret === 'void' ? 'void' : 'Promise<void>'}`)
  else if (ret) add('queries', 1, `接口 ${x!.name} 有返回值`)

  // ⑤ 目标模块名
  const seg = r.to.split('.').slice(-1)[0]
  if (COMMAND_SEGMENT.test(seg)) add('commands', 1.5, `目标模块「${r.to}」名字像执行者（${seg}）`)
  else if (QUERY_SEGMENT.test(seg)) add('queries', 1.5, `目标模块「${r.to}」名字像取值方（${seg}）`)

  // ⑥ 名字：调到的函数与成员、接口名、说明里的标识符
  for (const m of (r.description ?? '').match(IDENT) ?? []) if (/[a-z][A-Z]|^[a-z]+$/.test(m)) names.add(m)
  const leanQ = [...names].filter(n => nameLean(n) === 'queries')
  const leanC = [...names].filter(n => nameLean(n) === 'commands')
  if (leanQ.length + leanC.length) {
    const t = leanQ.length + leanC.length
    if (leanQ.length) add('queries', fmt((1.5 * leanQ.length) / t), `名字像查询：${leanQ.slice(0, 4).join('、')}`)
    if (leanC.length) add('commands', fmt((1.5 * leanC.length) / t), `名字像命令：${leanC.slice(0, 4).join('、')}`)
  }
  // ⑦ 说明里的中文动词
  const d = r.description ?? ''
  const zq = d.match(new RegExp(ZH_QUERY, 'g'))?.length ?? 0
  const zc = d.match(new RegExp(ZH_COMMAND, 'g'))?.length ?? 0
  if (zq + zc) {
    if (zq) add('queries', fmt(zq / (zq + zc)), `说明像取值（${[...new Set(d.match(new RegExp(ZH_QUERY, 'g')))].slice(0, 3).join('、')}）`)
    if (zc) add('commands', fmt(zc / (zq + zc)), `说明像交出一件事（${[...new Set(d.match(new RegExp(ZH_COMMAND, 'g')))].slice(0, 3).join('、')}）`)
  }

  const score = {
    queries: fmt(signals.filter(s => s.side === 'queries').reduce((a, s) => a + s.weight, 0)),
    commands: fmt(signals.filter(s => s.side === 'commands').reduce((a, s) => a + s.weight, 0)),
  }
  const type: ClassifiedType = score.queries > score.commands ? 'queries' : 'commands'
  const diff = Math.abs(score.queries - score.commands)
  const fromCode = signals.some(s => s.code && s.weight > 0 && s.side === type)
  const confidence: ClassifyConfidence = diff >= 3 && fromCode ? 'high' : diff >= 1.5 ? 'medium' : 'low'
  const reasons = [...signals]
    .sort((a, b) => b.weight - a.weight)
    .map(s => (s.weight ? `${s.side === 'queries' ? '查询' : '委托'} +${s.weight}：${s.why}` : `注意：${s.why}`))
  if (!signals.some(s => s.weight)) reasons.push('没有证据：按委托（交出去更保守），请人核对')
  else if (score.queries === score.commands) reasons.push('两边平分：按委托（交出去更保守），请人核对')
  const summary = rendered.length ? `渲染 ${[...new Set(rendered)].slice(0, 4).join('、')}` : called.size ? [...called].slice(0, 4).join('、') : undefined
  return { relation: r.id, type, confidence, score, reasons, ...(factOnly ? { factOnly } : {}), ...(summary ? { summary } : {}) }
}

/** 全部未分类关系的建议；coreOnly 只给核心之间的（M17） */
export function classifyRelations(
  index: ModelIndex,
  report: Pick<GovernanceReport, 'moduleDeps'> | null,
  code?: ClassifyCode,
  filter: (r: RelationEntity) => boolean = () => true,
): Classification[] {
  return [...index.relations.values()]
    .filter(r => isUnclassified(r.type) && filter(r))
    .sort((a, b) => a.seq - b.seq)
    .map(r => classifyRelation(index, report, r, code))
}

// ── 交互口吻的说明（「谁调谁做什么」，ADR-0026；查询写「取」，委托写「交给 / 让 … 做」） ──

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** 中文与西文之间补空格（「向 ModelSource 插件取」） */
const CJK = /[\u3400-\u9fff]/
const ASCII = /[A-Za-z0-9]/
const spaced = (...parts: string[]): string =>
  parts.reduce((acc, p) => {
    const a = acc.slice(-1)
    const b = p.slice(0, 1)
    return acc && p && ((CJK.test(a) && ASCII.test(b)) || (ASCII.test(a) && CJK.test(b))) ? `${acc} ${p}` : acc + p
  }, '')

/** 去掉本函数生成过的前缀，使改写可重复 */
function stripVoice(text: string, from: string, to: string): string {
  const f = escapeRe(from)
  const t = escapeRe(to)
  return text
    .replace(new RegExp(`^${f} ?(向 ?${t} ?取|交给 ?${t}|让 ?${t} ?做)：`), '')
    .replace(new RegExp(`^${f} ?(向 ?${t} ?取结果|让 ?${t} ?接手处理)$`), '')
    .trim()
}

/**
 * 把关系的说明改为交互口吻（谁调谁做什么）：查询「A 向 B 取：…」，委托「A 交给 B：…」；没有说明时用 summary（渲染的子组件或调到的函数名）补一句。
 * 原说明以发起方的名字开头的，去掉重复的发起方。
 */
export function interactionDescription(index: ModelIndex, r: Pick<RelationEntity, 'from' | 'to' | 'description'>, type: ClassifiedType, summary?: string): string {
  const from = moduleName(index, r.from)
  const to = moduleName(index, r.to)
  let body = stripVoice((r.description ?? '').trim(), from, to)
  if (body.startsWith(from) && body.length > from.length) body = body.slice(from.length).replace(/^[，、：:\s]+/, '')
  if (!body && summary) body = summary
  if (type === 'queries') return body ? `${spaced(from, '向', to, '取')}：${body}` : spaced(from, '向', to, '取结果')
  return body ? `${spaced(from, '交给', to)}：${body}` : spaced(from, '让', to, '接手处理')
}
