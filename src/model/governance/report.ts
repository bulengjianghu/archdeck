/**
 * 治理报告（K4–K7、U2–U9、Y1–Y3）：把代码事实、架构规则与基线组合成一份报告，页面、lint:model 与 agent 接口共用。
 */
import { RULE_LABELS, moduleName } from '../names'
import { moduleEntry, type LocalSource, type SourceOwnership } from '../source'
import type { Issue, ModelIndex } from '../types'
import { assemblyFacts, confirmImplementers, confirmRelations, heritageFacts, implementerReason, implementerWarns, liftDeps, undescribedDeps, unconfirmedCode, unconfirmedReason, unconfirmedWarns } from './facts'
import { portIssues } from './ports'
import { cyclicityOf, fileCycles, moduleCycles } from './cycles'
import { evaluateRules, type EntryOf } from './rules'
import { sharedHostOf, sharedReverse, sharedSuggestions } from './roles'
import { carrierGap, carrierOf, moduleElementEdges } from './carrier'
import { surfaceIssues } from './surface'
import type { Baseline, CodeDeps, ElementEdge, GovernanceReport, Violation } from './types'

/** G10：入口文件（不存在的 entry 不算） */
export function entryResolver(index: ModelIndex, own: SourceOwnership, tree: Pick<LocalSource, 'files' | 'packages'>): EntryOf {
  const cache = new Map<string, string | null>()
  return id => {
    if (!cache.has(id)) {
      const e = moduleEntry(index, own, tree, id)
      cache.set(id, e && !e.missing ? e.file : null)
    }
    return cache.get(id)!
  }
}

/** U8：按基线标出新增 / 已知；已豁免的不变 */
function withBaseline(violations: Violation[], baseline: Baseline | null): Violation[] {
  if (!baseline) return violations
  const known = new Set(baseline.violations)
  return violations.map(v => (v.status === 'allowed' ? v : { ...v, status: known.has(v.key) ? 'known' : 'new' }))
}

export function governanceReport(
  index: ModelIndex,
  own: SourceOwnership,
  tree: Pick<LocalSource, 'files' | 'packages'>,
  code: CodeDeps,
  baseline: Baseline | null,
): GovernanceReport {
  const entryOf = entryResolver(index, own, tree)
  const { moduleDeps, skipped, conflicted, nested } = liftDeps(index, own, code.deps)
  const implementers = confirmImplementers(index, moduleDeps, own.direct, nested)
  const relations = confirmRelations(index, moduleDeps, own.direct, nested, implementers)
  const undescribed = undescribedDeps(index, moduleDeps, implementers)
  const assembly = assemblyFacts(moduleDeps)
  const shared = sharedReverse(index, moduleDeps.values())
  const violations = withBaseline(evaluateRules(index, own, moduleDeps.values(), entryOf), baseline)
  const mc = moduleCycles(index, moduleDeps.values())
  const fc = fileCycles(index, own, code.deps)
  const cyclicity = { modules: cyclicityOf(mc), files: cyclicityOf(fc) }

  const counted = violations.filter(v => v.status !== 'allowed')
  const current = new Set(counted.map(v => v.key))
  const cycleGrew = !!baseline && (cyclicity.modules > baseline.cyclicity.modules || cyclicity.files > baseline.cyclicity.files)
  const gate = {
    newViolations: counted.filter(v => v.status === 'new').length,
    knownViolations: counted.filter(v => v.status === 'known').length,
    resolved: baseline ? baseline.violations.filter(k => !current.has(k)).length : 0,
    cycleGrew,
  }

  const issues: Issue[] = []
  const name = (id: string) => moduleName(index, id)
  const rulesSrc = index.model.rulesSrc
  for (const v of counted) {
    const code = v.status === 'new' ? 'rule.new' : v.status === 'known' ? 'rule.known' : 'rule.violation'
    const first = v.files[0]
    const src = v.kind === 'layer' ? index.modules.get(v.at)?.src : rulesSrc
    issues.push({
      severity: v.status === 'new' ? 'error' : 'warning',
      code,
      message: `${v.status === 'new' ? '新增违规' : '违规'}（${RULE_LABELS[v.kind]}）${name(v.from)} → ${name(v.to)}：${v.reason}；${v.files.length} 处，如 ${first.from}:${first.line}`,
      ...src,
    })
  }
  if (cycleGrew)
    issues.push({
      severity: 'error',
      code: 'cycle.grew',
      message: `环度上升：模块 ${baseline!.cyclicity.modules} → ${cyclicity.modules}，文件 ${baseline!.cyclicity.files} → ${cyclicity.files}`,
    })
  // K5c、K6：端口实现者未证实（证据像使用时为 fact.like-depends；结构性实现只进返工清单）
  for (const [port, p] of implementers)
    for (const i of p.implementers) {
      if (!i.described || !implementerWarns(i)) continue
      const x = index.interfaces.get(port)!
      issues.push({
        severity: 'warning',
        code: unconfirmedCode(i),
        message: `接口「${x.name}」（${port}）的实现者「${name(i.module)}」${implementerReason(i)}（K5c）`,
        ...x.src,
      })
    }
  // K6：交互关系未证实且两端之间没有任何依赖；D6：附承载缺段的原因（K5d）
  const surface = { entryOf, own }
  let elementEdges: ElementEdge[] | null = null
  for (const [id, c] of relations) {
    const r = index.relations.get(id)!
    if (!unconfirmedWarns(r, c)) continue
    elementEdges ??= moduleElementEdges(index, { moduleDeps, implementers }, surface)
    const gap = carrierGap(index, carrierOf(index, { moduleDeps, implementers, relations }, elementEdges, r))
    issues.push({
      severity: 'warning',
      code: unconfirmedCode(c),
      message: `关系「${id}」（${r.type}，${name(r.from)} → ${name(r.to)}）${unconfirmedReason(r, c)}${gap}`,
      ...r.src,
    })
  }

  // U12：共用件反向依赖（warning，不进门禁与基线）
  for (const d of shared) {
    const first = d.files.find(f => f.uses) ?? d.files[0]
    issues.push({
      severity: 'warning',
      code: 'role.shared-reverse',
      message: `共用件反向依赖：${name(d.from)} → ${name(d.to)}（共用件「${name(sharedHostOf(index, d.from)!)}」用到了普通或核心模块）；${d.files.length} 处，如 ${first.from}:${first.line}（U12）`,
      ...index.modules.get(d.from)?.src,
    })
  }

  // U14：端口孤立（无实现者 warning、无使用者 info）
  issues.push(...portIssues(index, { relations, implementers }))
  // U18、U19：越过入口、热表面未声明（info，不进门禁）
  issues.push(...surfaceIssues(index, { moduleDeps }, surface))

  return {
    moduleDeps,
    skipped,
    conflicted,
    fileDeps: code.deps.length,
    external: code.external,
    relations,
    implementers,
    subclasses: heritageFacts(index, moduleDeps),
    assembly: assembly.facts,
    assemblyRoots: assembly.roots,
    undescribed,
    sharedReverse: shared,
    sharedSuggestions: sharedSuggestions(index, moduleDeps.values()),
    violations,
    moduleCycles: mc,
    fileCycles: fc,
    cyclicity,
    baseline,
    gate,
    issues,
  }
}

/** U9：页面问题提示只列门禁错误 */
export const gateIssues = (report: GovernanceReport): Issue[] => report.issues.filter(i => i.code === 'rule.new' || i.code === 'cycle.grew')

/** U7：由当前报告生成基线 */
export function makeBaseline(report: GovernanceReport, createdAt: string, commit?: string): Baseline {
  return {
    createdAt,
    ...(commit ? { commit } : {}),
    violations: report.violations
      .filter(v => v.status !== 'allowed')
      .map(v => v.key)
      .sort(),
    cyclicity: report.cyclicity,
  }
}
