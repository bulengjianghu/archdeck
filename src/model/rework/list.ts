/**
 * 返工清单（Q7–Q9）：把描述问题、源码归属、代码事实、架构规则与场景中能交给人或 AI 修正的问题汇总，按根因聚合，
 * 每条带文件行号、规则编号与建议动作。关于被描述系统的知识，页面、命令行与 MCP 共用同一份结果。
 */
import { RULE_LABELS, moduleName } from '../names'
import { bindRelation, forEachStep, planScenario, querySideEffects, RUNTIME_RELATION_TYPES } from '../scenario'
import { matchRef, missingEvidence, moduleEntry, type LocalSource, type SourceOwnership } from '../source'
import {
  implementerReason,
  implementerWarns,
  isCoreBetween,
  plainInteraction,
  portIssues,
  sharedHostOf,
  stepEvidence,
  unconfirmedCode,
  unconfirmedReason,
  unconfirmedWarns,
  type FileDep,
  type GovernanceReport,
  type Violation,
} from '../governance'
import { reviewDiffText, reviewStates, REVIEW_FIELD_LABELS, REVIEW_FIELDS } from '../review'
import { isolatedCouplings, type EvolutionStats } from '../evolution'
import { SKETCH_DEVIATION_LABELS, type SketchCheck } from '../intent'
import { isUnclassified, type Issue, type ModelIndex, type SourceLoc } from '../types'
import { REWORK_CATEGORIES, REWORK_SEVERITIES, type ReworkAction, type ReworkItem, type ReworkList, type ReworkLoc, type ReworkSeverity } from './types'

export interface ReworkInput {
  index: ModelIndex
  /** 加载与校验的问题（M、S、U1 等）；源码归属与门禁的问题由下面的材料重新算，传进来也会被跳过 */
  issues: readonly Issue[]
  /** 源码归属（G6、G7、G10）；没有时不含归属类返工项 */
  source?: { own: SourceOwnership; tree: Pick<LocalSource, 'files' | 'packages'> }
  /** 治理报告（K、U、Y）；没有时不含事实类返工项 */
  report?: GovernanceReport
  /** 演化事实（J）；没有时不含「时间耦合」 */
  evolution?: EvolutionStats
  /** X4：活动草图的核验结果；没有时不含草图偏差 */
  sketches?: readonly SketchCheck[]
  /** 文件依赖（K1）；与 source 同时给出时含「步骤无证据」（S17） */
  deps?: readonly FileDep[]
}

/** Q8：校验问题代码 → 规则编号 */
const ISSUE_RULES: Record<string, string[]> = {
  'yaml-syntax': ['M1'],
  schema: ['M1'],
  'duplicate-system': ['M2'],
  'missing-system': ['M2'],
  'duplicate-module': ['M3'],
  'duplicate-relation': ['M3'],
  'duplicate-actor': ['M3'],
  'duplicate-scenario': ['M3'],
  'module-id-is-system': ['M3'],
  'actor-id-conflict': ['M3'],
  'unknown-parent': ['M4'],
  'parent-cycle': ['M4'],
  'unknown-endpoint': ['M5'],
  'self-relation': ['M5'],
  'actor-relation': ['M5'],
  'ancestor-relation': ['M6'],
  'unknown-interface': ['M7'],
  'unknown-data-structure': ['M7'],
  'unknown-owner': ['M7'],
  'unknown-layer': ['M7'],
  'layer-missing-order': ['M8'],
  'layer-missing-abstraction': ['M8'],
  'mixed-layer-siblings': ['M8'],
  'nested-parent-ignored': ['M10'],
  'relation.via-target': ['M11'],
  'relation-type-renamed': ['M12'],
  'pull-not-streams': ['M13'],
  'relation.mode-ignored': ['M13'],
  'relation.bus-endpoint': ['M14'],
  'relation.depends-removed': ['M15'],
  'module.core-legacy': ['M16'],
  'roles.shadowed': ['M16'],
  'roles.unknown-module': ['M16'],
  'unknown-implementer': ['M18'],
  'relation.via-legacy': ['M20'],
  'step.sync-mismatch': ['S19'],
  'missing-responsibility': ['M9'],
  'step-relation-mismatch': ['S5a'],
  'step-relation-not-runtime': ['S12'],
  'unknown-step-endpoint': ['S5b'],
  'unknown-relation': ['S5b'],
  'unknown-ref': ['S6'],
  'ref-cycle': ['S6'],
  'duplicate-step-id': ['S11'],
  'duplicate-source-limits': ['G20'],
  'duplicate-rules': ['U1'],
  'unknown-rule-module': ['U1'],
  'allow-without-reason': ['U1'],
  'sketch-redefined': ['X1'],
  'sketch-misplaced': ['X1'],
  'owned.changed': ['X6'],
  'owned.unregistered': ['X6'],
  'owned.none': ['X6'],
}

/** Q8：描述问题的建议动作 */
function descriptionFix(i: Issue): string {
  if (i.code === 'sketch-redefined') return '草图里的实体由架构师定：去掉这里对已写字段的重定义，只补草图没写的字段或往下挂子模块；要改草图本身请交给架构师（X1、X5）'
  if (i.code === 'relation-type-renamed') return '改为新名：event → notifies 并对调 from / to，dataflow → streams；再核对说明里的方向字样'
  if (i.code === 'relation.via-legacy') return "把 via 改写为四形态：port:<接口 ID> / bus:<总线模块 ID> / channel:<通道名>（如 via: 'channel:http'，M20）"
  return i.severity === 'error' ? '改正描述：这一处的实体已被剔除，图上看不到它' : '改正描述：坏引用已被去掉'
}

/**
 * 由下面的材料重新算、不从 issues 取的问题：未建模的步骤（S5a 的 warning）、源码归属、场景证据（S15）、门禁与事实、端口孤立（U14）；
 * 未分类（M17）只列核心之间的，也由下面重新算
 */
const recomputed = (code: string) => code === 'step-unmodeled' || code === 'relation.unclassified' || /^(source|scenario|rule|cycle|fact|port|query)\./.test(code)

const RULE_OF_KIND: Record<Violation['kind'], string> = { layer: 'U2', deps: 'U3', exposes: 'U4' }

const descLoc = (src: Partial<SourceLoc> | undefined, note?: string): ReworkLoc | undefined =>
  src?.file ? { in: 'description', file: src.file, ...(src.line ? { line: src.line } : {}), ...(note ? { note } : {}) } : undefined

const dirOf = (file: string) => file.split('/').slice(0, -1).join('/')

export function reworkList(input: ReworkInput): ReworkList {
  const { index, source, report } = input
  const name = (id: string) => moduleName(index, id)
  const items: ReworkItem[] = []

  // ── 描述问题（M、S、U1、X1）：一条问题一个根因；指纹不符（X6）另归一类 ──
  for (const i of input.issues) {
    if (recomputed(i.code)) continue
    const at = descLoc(i)
    const owned = i.code.startsWith('owned.')
    items.push({
      id: `${owned ? 'owned' : 'description'}:${i.code}:${i.file ?? ''}:${i.path ?? ''}:${i.message}`,
      category: owned ? 'owned' : 'description',
      severity: i.severity,
      rules: ISSUE_RULES[i.code] ?? ['M9'],
      code: i.code,
      title: i.message,
      ...(at ? { at } : {}),
      affected: at ? [at] : [],
      actions: owned
        ? [{ kind: 'register-owned', text: i.code === 'owned.changed' ? '由人核对改动：不该改的恢复文件；确认改动后运行 npm run arch -- own 重新登记' : '人确认内容后运行 npm run arch -- own 登记指纹', file: 'governance/owned.json' }]
        : [{ kind: 'fix-description', text: descriptionFix(i), ...(i.file ? { file: i.file } : {}) }],
      target: {},
    })
  }

  if (source) items.push(...ownershipItems(index, source.own, source.tree, name, report?.conflicted), ...evidenceItems(index, source.tree))
  if (report) items.push(...factItems(index, report, name))
  items.push(...portItems(index, report ?? null), ...sideEffectItems(index, name), ...unclassifiedItems(index, name))
  items.push(...unmodeledItems(index, name))
  items.push(...reviewItems(index, name))
  if (input.evolution) items.push(...couplingItems(index, input.evolution, name))
  for (const c of input.sketches ?? []) items.push(...sketchItems(c))
  if (source && input.deps) items.push(...unevidencedItems(index, source.own, source.tree, input.deps, name))

  const sev = (s: ReworkSeverity) => REWORK_SEVERITIES.indexOf(s)
  const cat = (c: ReworkItem['category']) => REWORK_CATEGORIES.indexOf(c)
  items.sort((a, b) => sev(a.severity) - sev(b.severity) || cat(a.category) - cat(b.category) || b.affected.length - a.affected.length || a.id.localeCompare(b.id))

  const counts = Object.fromEntries(REWORK_SEVERITIES.map(s => [s, items.filter(i => i.severity === s).length])) as ReworkList['counts']
  const byCategory = Object.fromEntries(REWORK_CATEGORIES.map(c => [c, items.filter(i => i.category === c).length])) as ReworkList['byCategory']
  return { items, counts, byCategory, facts: !!report }
}

// ── 场景证据（S15）：证据文件不在源码清单里，一条文件一个根因，归描述问题 ──

function evidenceItems(index: ModelIndex, tree: Pick<LocalSource, 'files'>): ReworkItem[] {
  return missingEvidence(index, tree.files).map(({ scenario, file }) => {
    const at = descLoc(scenario.src)!
    return {
      id: `description:scenario.evidence:${scenario.id}:${file}`,
      category: 'description',
      severity: 'warning',
      rules: ['S15'],
      code: 'scenario.evidence',
      title: `场景「${scenario.name}」的证据文件「${file}」不在源码文件清单中`,
      at,
      affected: [at],
      actions: [{ kind: 'fix-description', text: '改正 evidence 里的路径（相对源码根目录，与文件清单一致）；文件已删除时去掉这一条', file: scenario.src.file }],
      target: { scenario: scenario.id },
    }
  })
}

// ── 源码归属（G6、G7、G10） ──

function ownershipItems(
  index: ModelIndex,
  own: SourceOwnership,
  tree: Pick<LocalSource, 'files' | 'packages'>,
  name: (id: string) => string,
  conflicted?: readonly FileDep[],
): ReworkItem[] {
  const items: ReworkItem[] = []

  // G6：按「哪几个模块的哪几条 codeRefs 同时匹配」聚合，同一对重叠的 codeRefs 只算一个根因
  const conflicts = new Map<string, { refs: { module: string; refs: string[] }[]; files: string[] }>()
  for (const f of own.conflicts) {
    const refs = own.owners
      .get(f)!
      .map(id => ({ module: id, refs: (index.modules.get(id)?.codeRefs ?? []).filter(r => matchRef(r, f)) }))
      .sort((a, b) => a.module.localeCompare(b.module))
    const key = refs.map(r => `${r.module}=${r.refs.join('|')}`).join('&')
    const hit = conflicts.get(key)
    if (hit) hit.files.push(f)
    else conflicts.set(key, { refs, files: [f] })
  }
  for (const [key, c] of conflicts) {
    const first = index.modules.get(c.refs[0].module)
    const at = descLoc(first?.src)
    // K4：一端是这些冲突文件的依赖不提升到任何模块；冲突解决后自然计入
    const inGroup = new Set(c.files)
    const uncounted = conflicted?.filter(d => inGroup.has(d.from) || inGroup.has(d.to)).length ?? 0
    items.push({
      id: `ownership:conflict:${key}`,
      category: 'ownership',
      severity: 'warning',
      rules: uncounted ? ['G6', 'K4'] : ['G6'],
      code: 'source.conflict',
      title: `codeRefs 重叠：${c.refs.map(r => `${name(r.module)}「${r.refs.join('、')}」`).join(' 与 ')} 同时匹配 ${c.files.length} 个文件`,
      ...(uncounted ? { detail: `${uncounted} 条依赖因冲突未计入（不提升到任何模块，K4）；冲突解决后自然计入` } : {}),
      ...(at ? { at } : {}),
      affected: c.files.map(file => ({ in: 'source', file })),
      actions: [
        {
          kind: 'add-code-refs',
          text: `收窄其中一方的 codeRefs（或改成更具体的 glob），使每个文件只被一个模块匹配；文件确属多个模块时说明模块划分需要调整`,
          ...(first ? { file: first.src.file } : {}),
        },
      ],
      target: { modules: c.refs.map(r => r.module) },
    })
  }

  // G7：按所在目录聚合；建议归属取同目录（或最近的上级目录）里归属最多的模块
  const byDir = new Map<string, string[]>()
  for (const f of own.unowned) {
    const d = dirOf(f)
    const list = byDir.get(d)
    if (list) list.push(f)
    else byDir.set(d, [f])
  }
  const dirFiles = new Map<string, number>()
  for (const f of tree.files) dirFiles.set(dirOf(f), (dirFiles.get(dirOf(f)) ?? 0) + 1)
  for (const [dir, files] of byDir) {
    const owner = suggestOwner(own, tree.files, dir)
    const m = owner ? index.modules.get(owner) : undefined
    const whole = (dirFiles.get(dir) ?? 0) === files.length
    const glob = whole ? (dir ? `${dir}/*` : '*') : undefined
    const patterns = glob ? [glob] : files
    const actions: ReworkAction[] = []
    if (m)
      actions.push({
        kind: 'add-code-refs',
        text: `属于「${m.name}」时，把它们加进该模块的 codeRefs`,
        file: m.src.file,
        snippet: `codeRefs: [${[...(m.codeRefs ?? []), ...patterns].map(yamlStr).join(', ')}]`,
      })
    else actions.push({ kind: 'add-code-refs', text: '找到它们所属的模块，加进该模块的 codeRefs；没有合适的模块时说明描述漏了一个模块' })
    actions.push({
      kind: 'add-ignore',
      text: '不属于任何模块（文档、测试、配置）时加入忽略清单',
      file: 'source-ignore.yaml',
      snippet: `sourceIgnore:\n${patterns.map(p => `  - ${yamlStr(p)}`).join('\n')}`,
    })
    items.push({
      id: `ownership:unowned:${dir}`,
      category: 'ownership',
      severity: 'warning',
      rules: ['G7', 'G8'],
      code: 'source.unowned',
      title: `未归属：${dir || '（根目录）'} 下 ${files.length} 个文件没有模块的 codeRefs 匹配${whole ? '（整个目录）' : ''}`,
      ...(m ? { at: descLoc(m.src)! } : {}),
      affected: files.map(file => ({ in: 'source', file })),
      actions,
      target: { ...(owner ? { modules: [owner] } : {}), file: files[0] },
    })
  }

  // G10：entry 不存在
  for (const m of index.model.modules) {
    if (!m.entry) continue
    const e = moduleEntry(index, own, tree, m.id)
    if (!e?.missing) continue
    items.push({
      id: `ownership:entry:${m.id}`,
      category: 'ownership',
      severity: 'warning',
      rules: ['G10'],
      code: 'source.entry',
      title: `模块「${m.name}」的 entry「${e.file}」不在源码文件清单中`,
      at: descLoc(m.src)!,
      affected: [descLoc(m.src)!],
      actions: [{ kind: 'fix-description', text: '改正 entry，或删掉它按约定推出入口', file: m.src.file }],
      target: { modules: [m.id] },
    })
  }
  return items
}

/** 目录子树里归属最多的模块；子树里没有已归属文件时往上找 */
function suggestOwner(own: SourceOwnership, files: readonly string[], dir: string): string | undefined {
  for (let d = dir; ; d = dirOf(d)) {
    const votes = new Map<string, number>()
    for (const f of files) {
      if (d && !f.startsWith(`${d}/`)) continue
      for (const o of own.owners.get(f) ?? []) votes.set(o, (votes.get(o) ?? 0) + 1)
    }
    const best = [...votes].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]
    if (best) return best[0]
    if (!d) return undefined
  }
}

// ── 代码事实与架构规则（K6、K7、U2–U8、Y2） ──

function factItems(index: ModelIndex, report: GovernanceReport, name: (id: string) => string): ReworkItem[] {
  const items: ReworkItem[] = []
  const rulesFile = index.model.rulesSrc?.file ?? 'rules.yaml'

  // U6 的违规按（基线状态、种类、规则所在、被依赖方）再聚合：多个模块越过同一条边界依赖同一个模块是一个根因
  const groups = new Map<string, Violation[]>()
  for (const v of report.violations) {
    const key = `${v.status}:${v.kind}:${v.at}:*->${v.to}`
    const list = groups.get(key)
    if (list) list.push(v)
    else groups.set(key, [v])
  }
  for (const [key, vs] of groups) {
    const v = vs[0]
    const sevOf: Record<Violation['status'], ReworkSeverity> = { new: 'error', known: 'warning', open: 'warning', allowed: 'info' }
    const code = v.status === 'new' ? 'rule.new' : v.status === 'known' ? 'rule.known' : v.status === 'allowed' ? 'rule.allowed' : 'rule.violation'
    const src = v.kind === 'layer' ? index.modules.get(v.at)?.src : index.model.rulesSrc
    const label = { new: '新增违规', known: '已知违规', open: '违规', allowed: '已豁免' }[v.status]
    const froms = vs.map(x => x.from)
    // 一条时例外只放这一对；多条时放在规则所在（层或写规则的模块）上，一条覆盖全部
    const allowFrom = vs.length === 1 ? v.from : v.at
    const actions: ReworkAction[] =
      v.status === 'allowed'
        ? [{ kind: 'fix-code', text: `已按例外豁免（${v.allowReason}）；偿还后删掉 rules.yaml 中的这条例外` }]
        : [
            { kind: 'fix-code', text: `改代码：${v.reason}；按访问面与可依赖的模块改走允许的路径${vs.length > 1 ? `；${vs.length} 个模块都依赖「${name(v.to)}」时，先看它是否放错了层或该拆出契约` : ''}` },
            {
              kind: 'add-exception',
              text: '确属合理时加例外，必须写理由（由架构师决定）',
              file: rulesFile,
              snippet: `allow:\n  - { from: ${allowFrom}, to: ${v.to}, rule: ${v.kind}, reason: <写理由> }`,
            },
          ]
    items.push({
      id: `violation:${key}`,
      category: 'violation',
      severity: sevOf[v.status],
      rules: [RULE_OF_KIND[v.kind], 'U6', v.status === 'allowed' ? 'U5' : 'U8'],
      code,
      status: v.status,
      title:
        vs.length === 1
          ? `${label}（${RULE_LABELS[v.kind]}）${name(v.from)} → ${name(v.to)}：${v.reason}`
          : `${label}（${RULE_LABELS[v.kind]}）${vs.length} 个模块 → ${name(v.to)}：${v.reason}`,
      ...(vs.length > 1 ? { detail: `依赖方：${froms.map(name).join('、')}` } : {}),
      ...(src ? { at: descLoc(src)! } : {}),
      affected: vs.flatMap(x => x.files.map(f => ({ in: 'source' as const, file: f.from, line: f.line, note: f.via === f.to ? `→ ${f.to}` : `→ ${f.via} ⇒ ${f.to}` }))),
      actions,
      target: { modules: [v.to, ...froms], ...(vs.length === 1 ? { dep: `${v.from}->${v.to}` } : {}) },
    })
  }

  const b = report.baseline
  if (b && report.gate.cycleGrew)
    items.push({
      id: 'cycle:grew',
      category: 'cycle',
      severity: 'error',
      rules: ['Y2', 'U8'],
      code: 'cycle.grew',
      title: `环度上升：模块 ${b.cyclicity.modules} → ${report.cyclicity.modules}，文件 ${b.cyclicity.files} → ${report.cyclicity.files}`,
      affected: report.moduleCycles.filter(c => !c.tolerated).map(c => ({ in: 'source' as const, file: c.members.map(name).join(' ↔ '), note: `模块环 ${c.members.length}` })),
      actions: [{ kind: 'fix-code', text: '拆开新出现或扩大的环：去掉环上最便宜的一条依赖（npm run arch -- cycles 列出环的成员）' }],
      target: {},
    })
  if (b && report.gate.resolved)
    items.push({
      id: 'cycle:resolved',
      category: 'cycle',
      severity: 'info',
      rules: ['U7', 'U8'],
      code: 'baseline.resolved',
      title: `基线中 ${report.gate.resolved} 条违规已消除，可收紧基线`,
      affected: [],
      actions: [{ kind: 'rebaseline', text: '评审后运行 npm run arch -- baseline 并提交 governance/baseline.json' }],
      target: {},
    })

  // K6：报警的未证实交互关系（两端之间没有任何依赖）；一条关系一个根因
  for (const [id, c] of report.relations) {
    const r = index.relations.get(id)!
    if (!unconfirmedWarns(r, c)) continue
    const at = descLoc(r.src)
    items.push({
      id: `unconfirmed:${id}`,
      category: 'unconfirmed',
      severity: 'warning',
      rules: ['K5', 'K6'],
      code: unconfirmedCode(c),
      title: `关系「${id}」（${r.type}，${name(r.from)} → ${name(r.to)}）${unconfirmedReason(r, c)}`,
      ...(at ? { at } : {}),
      affected: at ? [at] : [],
      actions: [
        { kind: 'fix-relation', text: '代码里确实没有这条依赖时，删掉或改正这条关系（端点、方向或类型）', file: r.src.file },
        { kind: 'add-code-refs', text: '代码里有这条依赖时，检查两端的 codeRefs 是否覆盖了依赖所在的文件' },
      ],
      target: { relation: id, modules: [r.from, r.to] },
    })
  }

  // K5c、K6：端口实现者——证据像使用、未证实为 warning，结构性实现为 info；一个（端口，实现者）一个根因；只列描述写了的实现者（「仅代码事实」的不要求补写）
  for (const [port, p] of report.implementers) {
    const x = index.interfaces.get(port)!
    for (const i of p.implementers) {
      if (!i.described || !(implementerWarns(i) || i.structural)) continue
      const at = descLoc(x.src)
      const evidence = i.deps
        .flatMap(k => report.moduleDeps.get(k)?.files ?? [])
        .map(f => ({ in: 'source' as const, file: f.from, line: f.line, note: `→ ${f.to}${f.names?.length ? `（${f.names.join(', ')}）` : ''}` }))
      const title = `接口「${x.name}」（${port}）的实现者「${name(i.module)}」${implementerReason(i)}`
      const target = { modules: [i.module, ...(p.owner ? [p.owner] : [])] }
      if (i.structural) {
        items.push({
          id: `unconfirmed:${port}#${i.module}`,
          category: 'unconfirmed',
          severity: 'info',
          rules: ['K5c'],
          code: 'fact.structural',
          title,
          ...(at ? { at } : {}),
          affected: [...(at ? [at] : []), ...evidence],
          actions: [{ kind: 'add-implements', text: `在「${name(i.module)}」的类上写明 implements ${x.name}，让代码显式声明契约`, snippet: `class … implements ${x.name} {` }],
          target,
        })
        continue
      }
      items.push({
        id: `unconfirmed:${port}#${i.module}`,
        category: 'unconfirmed',
        severity: 'warning',
        rules: ['K5c', 'K6'],
        code: unconfirmedCode(i),
        title,
        ...(at ? { at } : {}),
        affected: [...(at ? [at] : []), ...(i.likeDepends ? evidence : [])],
        actions: i.likeDepends
          ? [
              {
                kind: 'drop-implementer',
                text: `是在使用「${p.owner ? name(p.owner) : port}」而不是实现这个端口时，从 implementedBy 去掉「${i.module}」，按这次使用的交互写关系（查询或委托）`,
                file: x.src.file,
                snippet: `relations:\n  - { id: rel.${i.module}--${p.owner ?? port}, from: ${i.module}, to: ${p.owner ?? port}, type: queries }   # 或 commands`,
              },
              { kind: 'fix-description', text: '确实实现了这个端口时，核对接口名与代码一致（类 implements / extends 它，或引用它的名字）' },
            ]
          : [
              { kind: 'fix-description', text: `代码里确实没有实现时，从接口的 implementedBy 去掉「${i.module}」`, file: x.src.file },
              { kind: 'add-code-refs', text: '代码里有实现时，检查实现者与定义模块的 codeRefs 是否覆盖了实现所在的文件' },
            ],
        target,
      })
    }
  }

  // U12：共用件反向依赖；一条模块依赖一个根因（ADR-0027）
  for (const d of report.sharedReverse) {
    const host = sharedHostOf(index, d.from)!
    const m = index.modules.get(host)
    items.push({
      id: `shared:${d.key}`,
      category: 'shared',
      severity: 'warning',
      rules: ['U12'],
      code: 'role.shared-reverse',
      title: `共用件反向依赖：${name(d.from)} → ${name(d.to)}（共用件「${name(host)}」用到了普通或核心模块）`,
      ...(m ? { at: descLoc(m.src)! } : {}),
      affected: d.files.map(f => ({ in: 'source' as const, file: f.from, line: f.line, note: f.via === f.to ? `→ ${f.to}` : `→ ${f.via} ⇒ ${f.to}` })),
      actions: [
        { kind: 'fix-code', text: `把「${name(d.to)}」里被用到的部分下沉进共用件，或改由使用方传入` },
        { kind: 'drop-role', text: `确实不是共用件时取消它的角色（由架构师决定）`, file: m?.roleFrom === 'roles' ? 'intent/roles.yaml' : m?.src.file },
      ],
      target: { modules: [d.from, d.to], dep: d.key },
    })
  }

  // K7：未解释的交互；一条模块依赖一个根因
  for (const d of report.undescribed) {
    const m = index.modules.get(d.from)
    const values = d.files.filter(plainInteraction)
    items.push({
      id: `undescribed:${d.key}`,
      category: 'undescribed',
      severity: 'info',
      rules: ['K7'],
      code: 'fact.undescribed',
      title: `未解释的交互：${name(d.from)} → ${name(d.to)}（${values.length} 处交互使用）`,
      affected: values.map(f => ({ in: 'source', file: f.from, line: f.line, note: f.via === f.to ? `→ ${f.to}` : `→ ${f.via} ⇒ ${f.to}` })),
      actions: [
        {
          kind: 'add-relation',
          text: '这次使用是哪种交互就补哪种（按三问：取值无副作用为 queries，交出一件事为 commands；异步的加 mode: async）；只是借用工具函数、常量而没有架构含义的可不补（K7）',
          ...(m ? { file: m.src.file } : {}),
          snippet: `relations:\n  - { id: rel.${d.from}--${d.to}, from: ${d.from}, to: ${d.to}, type: queries }   # 或 commands`,
        },
        { kind: 'fix-code', text: '不该有这条依赖时改代码' },
      ],
      target: { modules: [d.from, d.to], dep: d.key },
    })
  }
  return items
}

// ── 端口孤立（U14）：一个端口一个根因；有代码事实时含「仅代码事实」的实现者，没有时只按描述（K8） ──

function portItems(index: ModelIndex, report: GovernanceReport | null): ReworkItem[] {
  return portIssues(index, report).map(i => {
    const at = descLoc(i)
    return {
      id: `port:${i.code}:${i.file ?? ''}:${i.path ?? ''}`,
      category: 'port' as const,
      severity: i.severity,
      rules: ['U14'],
      code: i.code,
      title: i.message,
      ...(at ? { at } : {}),
      affected: at ? [at] : [],
      actions: [
        {
          kind: 'fix-port' as const,
          text: i.code === 'port.no-implementer' ? '补实现者（接口的 implementedBy，或代码里类 implements 它）、删去指向它的 via: port:，或确认端口是否多余' : '对外端口时不用改；否则确认端口是否多余',
          ...(i.file ? { file: i.file } : {}),
        },
      ],
      target: {},
    }
  })
}

// ── 查询副作用（U13）：一对（查询关系，委托 / 通知关系）一个根因，带两处步骤位置 ──

function sideEffectItems(index: ModelIndex, name: (id: string) => string): ReworkItem[] {
  const groups = new Map<string, { query: string; effect: string; steps: ReworkLoc[]; scenario: string }>()
  for (const sc of index.scenarios.values())
    for (const e of querySideEffects(index, planScenario(index, sc.id))) {
      const key = `${e.query}->${e.effect}`
      if (groups.has(key)) continue
      const step = (f: typeof e.queryFrame, what: string) => descLoc(f.src, `场景「${sc.name}」步骤 ${f.stepPath}：${what}`)!
      groups.set(key, { query: e.query, effect: e.effect, scenario: sc.id, steps: [step(e.queryFrame, '查询'), step(e.effectFrame, '副作用')] })
    }
  return [...groups.entries()].map(([key, g]) => {
    const q = index.relations.get(g.query)!
    const e = index.relations.get(g.effect)!
    return {
      id: `query-side-effect:${key}`,
      category: 'query-side-effect' as const,
      severity: 'warning' as const,
      rules: ['U13'],
      code: 'query.side-effect',
      title: `查询有副作用：「${g.query}」（${name(q.from)} → ${name(q.to)}）的闭包里有${e.type === 'notifies' ? '通知' : '委托'}「${g.effect}」（${name(e.from)} → ${name(e.to)}）`,
      at: descLoc(q.src) ?? g.steps[0],
      affected: g.steps,
      actions: [
        {
          kind: 'to-command' as const,
          text: '被调方确实拥有后果时把这条查询改为委托（commands）；否则把副作用移出查询的链路',
          file: q.src.file,
          snippet: `- { id: ${q.id}, from: ${q.from}, to: ${q.to}, type: commands }`,
        },
      ],
      target: { relation: g.query, modules: [q.from, q.to], scenario: g.scenario },
    }
  })
}

// ── 未分类（M17）：只列核心之间的（裁决 12），其余只计数 ──

function unclassifiedItems(index: ModelIndex, name: (id: string) => string): ReworkItem[] {
  return [...index.relations.values()]
    .filter(r => isUnclassified(r.type) && isCoreBetween(index, r))
    .map(r => {
      const at = descLoc(r.src)
      return {
        id: `unclassified:${r.id}`,
        category: 'unclassified' as const,
        severity: 'info' as const,
        rules: ['M17', 'X23'],
        code: 'relation.unclassified',
        title: `未分类：关系「${r.id}」（${name(r.from)} → ${name(r.to)}）是核心之间的 calls`,
        ...(at ? { at } : {}),
        affected: at ? [at] : [],
        actions: [
          {
            kind: 'classify' as const,
            text: '按三问定为 queries（要结果、无副作用）或 commands（交出一件事、被调方拥有后果），写进草图即确认（X23）',
            file: r.src.file,
            snippet: `- { id: ${r.id}, from: ${r.from}, to: ${r.to}, type: queries }   # 或 commands`,
          },
        ],
        target: { relation: r.id, modules: [r.from, r.to] },
      }
    })
}

// ── 时间耦合（J4、J6）：无依赖且无描述关系的耦合对，一对一个根因 ──

function couplingItems(index: ModelIndex, stats: EvolutionStats, name: (id: string) => string): ReworkItem[] {
  return isolatedCouplings(stats).map(c => {
    const ma = index.modules.get(c.a)
    const pct = (r: number) => `${Math.round(r * 100)}%`
    return {
      id: `coupling:${c.id}`,
      category: 'coupling' as const,
      severity: 'info' as const,
      rules: ['J4', 'J6'],
      code: 'evolution.coupling',
      title: `时间耦合：${name(c.a)} 与 ${name(c.b)} 同提交 ${c.shared} 次（占各自修改次数 ${pct(c.ratioA)} / ${pct(c.ratioB)}），两端之间没有依赖也没有描述关系`,
      detail: `近 ${stats.days} 天内总是一起改，代码事实看不见：可能存在未描述的运行时关系（事件、注入、约定），或两者本应是一个模块、或该按变化原因重新拆分`,
      affected: c.commits.slice(0, 20).map(h => ({ in: 'source' as const, file: `提交 ${h.slice(0, 8)}` })),
      actions: [
        {
          kind: 'add-relation' as const,
          text: '检查是否存在未描述的运行时关系：有则补关系（calls / notifies / streams，经注入或回调的写 via）',
          ...(ma ? { file: ma.src.file } : {}),
          snippet: `relations:\n  - { id: rel.${c.a}--${c.b}, from: ${c.a}, to: ${c.b}, type: calls }`,
        },
        { kind: 'fix-code' as const, text: '没有运行时关系时，检查两者是否应合并，或按变化原因重新拆分' },
      ],
      target: { modules: [c.a, c.b] },
    }
  })
}

// ── 步骤无证据（S16、S17）：同一对端点（含方向）的步骤一个根因；ref 内联的帧按它写在哪个场景的哪一步去重 ──

function unevidencedItems(
  index: ModelIndex,
  own: SourceOwnership,
  tree: Pick<LocalSource, 'files' | 'packages'>,
  deps: readonly FileDep[],
  name: (id: string) => string,
): ReworkItem[] {
  const entryOf = (id: string) => {
    const e = moduleEntry(index, own, tree, id)
    return e && !e.missing ? e.file : null
  }
  const groups = new Map<string, { from: string; to: string; steps: ReworkLoc[]; seen: Set<string>; scenarios: Set<string> }>()
  for (const sc of index.scenarios.values())
    for (const f of planScenario(index, sc.id).frames.values()) {
      if (stepEvidence(f, index, own, deps, entryOf).level !== 'none') continue
      const key = `${f.from}->${f.to}`
      const g = groups.get(key) ?? { from: f.from, to: f.to, steps: [], seen: new Set<string>(), scenarios: new Set<string>() }
      groups.set(key, g)
      const step = `${f.scenarioId}#${f.stepPath}`
      if (g.seen.has(step)) continue
      g.seen.add(step)
      g.scenarios.add(f.scenarioId)
      const loc = descLoc(f.src, `场景「${index.scenarios.get(f.scenarioId)?.name ?? f.scenarioId}」步骤 ${f.stepPath}：${f.label ?? `${f.kind} ${f.from} → ${f.to}`}`)
      if (loc) g.steps.push(loc)
    }

  return [...groups].map(([key, g]) => {
    const first = g.steps[0]
    return {
      id: `unevidenced:${key}`,
      category: 'unevidenced' as const,
      severity: 'warning' as const,
      rules: ['S16', 'S17'],
      code: 'step.no-evidence',
      title: `步骤无证据：${name(g.from)} → ${name(g.to)} 的 ${g.steps.length} 个步骤在代码里找不到两端之间的任何依赖`,
      detail: '两端的文件之间没有导入（值与类型都没有）：步骤可能写错了端点或接口，或代码经注入 / 回调传递而静态导入看不见',
      ...(first ? { at: first } : {}),
      affected: g.steps,
      actions: [
        { kind: 'fix-description' as const, text: '检查步骤（或其关系）的接口名与两端：端点写能表达清楚的最深模块', ...(first ? { file: first.file } : {}) },
        { kind: 'add-code-refs' as const, text: '检查两端模块的 codeRefs 是否漏了真正承载这次调用的文件' },
        { kind: 'fix-relation' as const, text: '确实经注入 / 回调传递的，给步骤对应的关系写 via（静态导入证实不了，不判定）', snippet: 'via: inject   # 或 callback、port' },
      ],
      target: { modules: [g.from, g.to].filter(id => index.modules.has(id)), scenario: [...g.scenarios][0] },
    }
  })
}

// ── 结构中未建模的步骤（P11、S5a、S13） ──

function unmodeledItems(index: ModelIndex, name: (id: string) => string): ReworkItem[] {
  const groups = new Map<string, { a: string; b: string; steps: ReworkLoc[]; scenarios: Set<string> }>()
  for (const sc of index.scenarios.values())
    forEachStep(sc.steps, s => {
      if (!('msg' in s) || s.msg.from === s.msg.to) return
      const bound = bindRelation(index, { kind: s.kind, from: s.msg.from, to: s.msg.to, relation: s.msg.relation })
      if (bound.relation && !bound.issue) return
      const [a, b] = [s.msg.from, s.msg.to].sort()
      const key = `${a}<->${b}`
      const g = groups.get(key) ?? { a, b, steps: [], scenarios: new Set<string>() }
      groups.set(key, g)
      g.scenarios.add(sc.id)
      g.steps.push(descLoc(s.src, `场景「${sc.name}」步骤 ${s.path}：${s.msg.label ?? `${s.kind} ${s.msg.from} → ${s.msg.to}`}`)!)
    })

  const items: ReworkItem[] = []
  for (const [key, g] of groups) {
    const { runtime: candidates, other } = relationsBetween(index, g.a, g.b)
    const first = g.steps[0]
    const ends = `${name(g.a)} ↔ ${name(g.b)}`
    const actions: ReworkAction[] = candidates.length
      ? [
          {
            kind: 'add-step-relation',
            text: `两端之间有 ${candidates.length} 条运行时关系，推断不出是哪一条：在步骤上写 relation 指明`,
            file: first?.file,
            snippet: candidates.map(id => `relation: ${id}`).join('   # 或\n'),
          },
          { kind: 'add-relation', text: '都不是时补一条恰好连在两端上的运行时关系' },
        ]
      : [
          {
            kind: 'add-relation',
            text: '补一条两端之间的交互关系（查询 queries、委托 commands、通知 notifies、流 streams，箭头为控制流方向）；端点写能表达清楚的最深模块',
            ...(index.modules.get(g.a) ? { file: index.modules.get(g.a)!.src.file } : {}),
            snippet: `relations:\n  - { id: rel.${g.a}--${g.b}, from: ${g.a}, to: ${g.b}, type: commands }`,
          },
          { kind: 'add-step-relation', text: '步骤端点写错了时改正步骤的 from / to', file: first?.file },
        ]
    items.push({
      id: `unmodeled:${key}`,
      category: 'unmodeled',
      severity: 'warning',
      rules: ['P11', 'S5a', 'S13'],
      code: 'step-unmodeled',
      title: `结构中未建模：${ends} 之间 ${g.steps.length} 个步骤没有对应的关系${candidates.length ? '（候选关系不唯一）' : ''}`,
      ...(other.length && !candidates.length ? { detail: `两端之间只有编译期关系（${other.join('、')}），步骤只对应运行时关系（S12）` } : {}),
      ...(first ? { at: first } : {}),
      affected: g.steps,
      actions,
      target: { modules: [g.a, g.b].filter(id => index.modules.has(id)), scenario: [...g.scenarios][0] },
    })
  }
  return items
}

// ── 需复核的模块（Z3）：人的待办，一个模块一条，不给片段、不交给 agent ──

function reviewItems(index: ModelIndex, name: (id: string) => string): ReworkItem[] {
  const items: ReworkItem[] = []
  for (const [id, st] of reviewStates(index)) {
    if (st.status !== 'stale' || !st.entry) continue
    const m = index.modules.get(id)!
    const at = descLoc(m.src)
    const changed = st.diff ? REVIEW_FIELDS.filter(f => st.diff![f].length).map(f => REVIEW_FIELD_LABELS[f]) : []
    items.push({
      id: `review:${id}`,
      category: 'review',
      severity: 'warning',
      rules: ['Z3'],
      code: 'review.stale',
      title: `需复核：${name(id)}——${st.entry.at} 确认后${changed.length ? `${changed.join('、')}变了` : '内容变了'}`,
      detail: st.diff ? reviewDiffText(st.diff) : '记录里没有确认时的摘要，列不出差异',
      ...(at ? { at } : {}),
      affected: [],
      actions: [{ kind: 'review', text: '在面板上复核并确认（人的动作，不交给 agent；AI 不要改 reviewed.yaml）' }],
      target: { modules: [id] },
    })
  }
  return items
}

// ── 草图偏差（X4）：一条偏差一个根因；已认可的不进返工清单（没有要返工的，在设计面板列出） ──

function sketchItems(c: SketchCheck): ReworkItem[] {
  const file = c.deviations[0]?.at?.file
  const who = c.design ? `设计「${c.design}」的草图` : `持久草图「${c.sketch}」`
  return c.deviations.filter(d => !d.accepted).map(d => {
    const at = descLoc(d.at)
    const actions: ReworkAction[] = []
    if (d.code === 'sketch.contradiction') actions.push({ kind: 'accept-deviation', text: '架构师决定：改草图使其与持久草图一致，或在草图里声明 supersedes 替换它（X3）', ...(file ? { file } : {}) })
    else {
      actions.push({ kind: 'follow-sketch', text: 'AI 按草图改描述：沿用草图的 ID 与父子关系，只在草图之下展开（X5）' })
      if (d.severity !== 'error')
        actions.push({ kind: 'accept-deviation', text: '确有理由时由架构师在设计面板「认可偏差（写理由）」，记入 design.yaml 的 accepted', ...(c.design ? { file: `designs/${c.design}/design.yaml` } : {}) })
      else actions.push({ kind: 'accept-deviation', text: '错误不能认可；意图确实要改时由架构师改草图' })
    }
    return {
      id: `sketch:${c.sketch}:${d.key}`,
      category: 'sketch',
      severity: d.severity,
      rules: d.rules,
      code: d.code,
      title: `${who}偏差（${SKETCH_DEVIATION_LABELS[d.code]}）：${d.message}`,
      ...(d.detail ? { detail: d.detail } : {}),
      ...(at ? { at } : {}),
      affected: at ? [at] : [],
      actions,
      target: d.target,
    }
  })
}

/** 两端（含祖先）之间的关系：运行时的与其余的 */
function relationsBetween(index: ModelIndex, a: string, b: string): { runtime: string[]; other: string[] } {
  const covers = (x: string, id: string) => x === id || !!index.pathOf.get(id)?.includes(x)
  const linked = [...index.relations.values()].filter(r => (covers(r.from, a) && covers(r.to, b)) || (covers(r.from, b) && covers(r.to, a)))
  return {
    runtime: linked.filter(r => RUNTIME_RELATION_TYPES.includes(r.type)).map(r => r.id),
    other: linked.filter(r => !RUNTIME_RELATION_TYPES.includes(r.type)).map(r => r.id),
  }
}

/** YAML 中需要加引号的字符串 */
function yamlStr(s: string): string {
  return /^[\w./*-]+$/.test(s) && !/^[-.*]/.test(s) ? s : `'${s.replace(/'/g, "''")}'`
}
