/**
 * 返工清单（Q7–Q9）：把描述问题、源码归属、代码事实、架构规则与场景中能交给人或 AI 修正的问题汇总，按根因聚合，
 * 每条带文件行号、规则编号与建议动作。关于被描述系统的知识，页面、命令行与 MCP 共用同一份结果。
 */
import { RULE_LABELS, moduleName } from '../names'
import { bindRelation, forEachStep, RUNTIME_RELATION_TYPES } from '../scenario'
import { matchRef, missingEvidence, moduleEntry, type LocalSource, type SourceOwnership } from '../source'
import { contractNames, unconfirmedCode, unconfirmedReason, unconfirmedWarns, type FileDep, type GovernanceReport, type Violation } from '../governance'
import type { Issue, ModelIndex, SourceLoc } from '../types'
import { REWORK_CATEGORIES, REWORK_SEVERITIES, type ReworkAction, type ReworkItem, type ReworkList, type ReworkLoc, type ReworkSeverity } from './types'

export interface ReworkInput {
  index: ModelIndex
  /** 加载与校验的问题（M、S、U1 等）；源码归属与门禁的问题由下面的材料重新算，传进来也会被跳过 */
  issues: readonly Issue[]
  /** 源码归属（G6、G7、G10）；没有时不含归属类返工项 */
  source?: { own: SourceOwnership; tree: Pick<LocalSource, 'files' | 'packages'> }
  /** 治理报告（K、U、Y）；没有时不含事实类返工项 */
  report?: GovernanceReport
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
  'implements-no-interface': ['M11'],
  'relation-type-renamed': ['M12'],
  'pull-not-streams': ['M13'],
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
}

/** Q8：描述问题的建议动作 */
function descriptionFix(i: Issue): string {
  if (i.code === 'relation-type-renamed') return '改为新名：event → notifies 并对调 from / to，dataflow → streams；再核对说明里的方向字样'
  if (i.code === 'implements-no-interface') return '确实实现了契约时在目标模块声明接口（interfaces 的 owner 或 provides）；只是使用对方时改为 depends'
  return i.severity === 'error' ? '改正描述：这一处的实体已被剔除，图上看不到它' : '改正描述：坏引用已被去掉'
}

/** 由下面的材料重新算、不从 issues 取的问题：未建模的步骤（S5a 的 warning）、源码归属、场景证据（S15）、门禁与事实 */
const recomputed = (code: string) => code === 'step-unmodeled' || /^(source|scenario|rule|cycle|fact)\./.test(code)

const RULE_OF_KIND: Record<Violation['kind'], string> = { layer: 'U2', deps: 'U3', exposes: 'U4' }

const descLoc = (src: Partial<SourceLoc> | undefined, note?: string): ReworkLoc | undefined =>
  src?.file ? { in: 'description', file: src.file, ...(src.line ? { line: src.line } : {}), ...(note ? { note } : {}) } : undefined

const dirOf = (file: string) => file.split('/').slice(0, -1).join('/')

export function reworkList(input: ReworkInput): ReworkList {
  const { index, source, report } = input
  const name = (id: string) => moduleName(index, id)
  const items: ReworkItem[] = []

  // ── 描述问题（M、S、U1）：一条问题一个根因 ──
  for (const i of input.issues) {
    if (recomputed(i.code)) continue
    const at = descLoc(i)
    items.push({
      id: `description:${i.code}:${i.file ?? ''}:${i.path ?? ''}:${i.message}`,
      category: 'description',
      severity: i.severity,
      rules: ISSUE_RULES[i.code] ?? ['M9'],
      code: i.code,
      title: i.message,
      ...(at ? { at } : {}),
      affected: at ? [at] : [],
      actions: [{ kind: 'fix-description', text: descriptionFix(i), ...(i.file ? { file: i.file } : {}) }],
      target: {},
    })
  }

  if (source) items.push(...ownershipItems(index, source.own, source.tree, name, report?.conflicted), ...evidenceItems(index, source.tree))
  if (report) items.push(...factItems(index, report, name))
  items.push(...unmodeledItems(index, name))

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

  // K6：报警的未证实关系（编译期关系——含证据像 depends 的 implements，K5；结构性实现为 info——以及两端之间没有任何依赖的运行时关系）；一条关系一个根因
  for (const [id, c] of report.relations) {
    const r = index.relations.get(id)!
    if (!unconfirmedWarns(r, c) && !c.structural) continue
    const at = descLoc(r.src)
    const evidence = () =>
      c.deps.flatMap(k => report.moduleDeps.get(k)?.files ?? []).map(f => ({ in: 'source' as const, file: f.from, line: f.line, note: `→ ${f.to}${f.names?.length ? `（${f.names.join(', ')}）` : ''}` }))
    // K5：结构性实现（只引了数据类型）只提示，建议在类上写明 implements
    if (c.structural) {
      const candidates = [...contractNames(index, r.to)]
      items.push({
        id: `unconfirmed:${id}`,
        category: 'unconfirmed',
        severity: 'info',
        rules: ['K5'],
        code: 'fact.structural',
        title: `关系「${id}」（${r.type}，${name(r.from)} → ${name(r.to)}）${unconfirmedReason(r, c)}`,
        ...(at ? { at } : {}),
        affected: [...(at ? [at] : []), ...evidence()],
        actions: [
          {
            kind: 'add-implements',
            text: `在实现方的类上写明 implements <接口>，让代码显式声明契约；「${name(r.to)}」声明的接口：${candidates.join('、') || '（无）'}`,
            ...(candidates.length ? { snippet: candidates.map(n => `class … implements ${n} {`).join('   # 或\n') } : {}),
          },
        ],
        target: { relation: id, modules: [r.from, r.to] },
      })
      continue
    }
    items.push({
      id: `unconfirmed:${id}`,
      category: 'unconfirmed',
      severity: 'warning',
      rules: ['K5', 'K6'],
      code: unconfirmedCode(c),
      title: `关系「${id}」（${r.type}，${name(r.from)} → ${name(r.to)}）${unconfirmedReason(r, c)}`,
      ...(at ? { at } : {}),
      // 证据像 depends：受影响的是引用了对方非接口名字的那些导入
      affected: [...(at ? [at] : []), ...(c.likeDepends ? evidence() : [])],
      actions: c.likeDepends
        ? [
            {
              kind: 'to-depends',
              text: '代码是在使用对方的实现而不是实现它的契约时，改为 depends',
              file: r.src.file,
              snippet: `- { id: ${id}, from: ${r.from}, to: ${r.to}, type: depends }`,
            },
            { kind: 'fix-description', text: `确实实现了契约时，在「${name(r.to)}」的描述里声明被实现的接口（interfaces 的 owner 或 provides），名称与代码一致` },
          ]
        : [
            { kind: 'fix-relation', text: '代码里确实没有这条依赖时，删掉或改正这条关系（端点、方向或类型）', file: r.src.file },
            { kind: 'add-code-refs', text: '代码里有这条依赖时，检查两端的 codeRefs 是否覆盖了依赖所在的文件' },
          ],
      target: { relation: id, modules: [r.from, r.to] },
    })
  }

  // K7：未描述依赖；一条模块依赖一个根因
  for (const d of report.undescribed) {
    const m = index.modules.get(d.from)
    const values = d.files.filter(f => f.kind === 'value')
    items.push({
      id: `undescribed:${d.key}`,
      category: 'undescribed',
      severity: 'info',
      rules: ['K7'],
      code: 'fact.undescribed',
      title: `未描述依赖：${name(d.from)} → ${name(d.to)}（${values.length} 处值导入）`,
      affected: values.map(f => ({ in: 'source', file: f.from, line: f.line, note: f.via === f.to ? `→ ${f.to}` : `→ ${f.via} ⇒ ${f.to}` })),
      actions: [
        {
          kind: 'add-relation',
          text: '依赖合理时补一条关系（运行时调用写 calls，编译期依赖写 depends）',
          ...(m ? { file: m.src.file } : {}),
          snippet: `relations:\n  - { id: rel.${d.from}--${d.to}, from: ${d.from}, to: ${d.to}, type: depends }`,
        },
        { kind: 'fix-code', text: '不该有这条依赖时改代码' },
      ],
      target: { modules: [d.from, d.to], dep: d.key },
    })
  }
  return items
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
            text: '补一条两端之间的运行时关系（命令 calls、通知 notifies、流 streams，箭头为控制流方向）；端点写能表达清楚的最深模块',
            ...(index.modules.get(g.a) ? { file: index.modules.get(g.a)!.src.file } : {}),
            snippet: `relations:\n  - { id: rel.${g.a}--${g.b}, from: ${g.a}, to: ${g.b}, type: calls }`,
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
