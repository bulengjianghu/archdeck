/**
 * agent 接口的查询核心（docs/architecture/governance.md §5）：按项目加载描述、源码清单、代码事实与基线，调用模型层的架构治理。
 * 命令行（scripts/arch.ts）与 MCP 服务器（scripts/arch-mcp.ts）只是两层外壳，同一输入给出同一结果（Q6）。
 * 只读描述、规则与基线；写的只有拦截记录（Q5）。生成基线只给命令行用（U7）。
 * 每次查询前比对输入的指纹（描述、源码清单与各文件的修改时间与大小、基线），有变化就重建，长驻时不会拿过期的事实判定。
 */
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import {
  assignFiles,
  checkDependency,
  checkSketches,
  compareOwned,
  parseDesignSketches,
  compareDesign,
  describeModule,
  governanceReport,
  loadModel,
  locateFile,
  makeBaseline,
  moduleName,
  summarizeLedger,
  entryResolver,
  evolutionStats,
  hotspots,
  impactOf,
  levelTiers,
  placeSuggestion,
  strataMetrics,
  strataFindings,
  splitSignals,
  tierView,
  listedCouplings,
  moduleMetrics,
  structureMetrics,
  surfaceMetrics,
  surfaceOf,
  HOT_SURFACE_MODULES,
  reworkList,
  reworkMarkdown,
  type EvolutionStats,
  type HeatKind,
  type ReworkCategory,
  type ReworkList,
  type SketchCheck,
  type CheckResult,
  type CheckTarget,
  type EntryOf,
  type FileDep,
  type GovernanceReport,
  type Issue,
  type LedgerClient,
  type LocalSource,
  type ModelIndex,
  type ModuleMetrics,
  type SourceOwnership,
  type SurfaceSource,
} from '../../src/model'
import {
  designSketchFiles,
  designSketches,
  listProjectIds,
  readDesignRevision,
  readProject,
  resolveModelRoot,
  type SketchFileRef,
} from '../../vite/readModelDir'
import { readModelAt } from '../../vite/readGit'
import { archiveDesign, WriteError } from '../../vite/writeModel'
import { exportsResolver, readSourceTree } from '../../vite/readSource'
import { createResolver, readCodeDeps, resolveImport } from '../../vite/readDeps'
import { historyOptions, readSourceHistory } from '../../vite/readHistory'
import {
  appendLedger,
  BASELINE_FILE,
  OWNED_FILE,
  governanceDir,
  ownedHashes,
  readBaseline,
  readLedger,
  readOwned,
  registerOwned,
  sourceCommit,
  writeBaseline,
} from '../../vite/governanceStore'

export interface ServiceOptions {
  /** 本包根目录 */
  root: string
  client: LedgerClient
  env?: NodeJS.ProcessEnv
}

/** 一个项目加载后的全部材料 */
export interface Loaded {
  project: string
  index: ModelIndex
  issues: Issue[]
  tree: LocalSource
  files: ReadonlySet<string>
  own: SourceOwnership
  entryOf: EntryOf
  /** K18：表面的来源（入口、归属与入口导出，Q16） */
  surface: SurfaceSource
  report: GovernanceReport
  /** K1：文件依赖（步骤的代码证据用，S16） */
  deps: FileDep[]
  /** J1：演化事实；读不到 git 历史时为原因 */
  evolution: EvolutionStats | { error: string }
  /** X4：活动草图对当前版本的核验 */
  checks: SketchCheck[]
  /** 输入的指纹（stampOf） */
  stamp: string
}

export class ServiceError extends Error {}

/** 输入的指纹：描述文本、源码清单与清单中每个文件的修改时间与大小、基线文件的修改时间；依赖提取按同样的键缓存，重建只重读变了的文件 */
function stampOf(model: readonly { path: string; text: string }[], tree: LocalSource, gov: string): string {
  const h = createHash('sha1')
  const stat = (abs: string) => {
    try {
      const st = fs.statSync(abs)
      return `${st.mtimeMs}:${st.size}`
    } catch {
      return '-'
    }
  }
  for (const f of model) h.update(`${f.path}\0${f.text}\0`)
  for (const f of tree.files) h.update(`${f}\0${stat(path.join(tree.root, f))}\0`)
  h.update(`baseline\0${stat(path.join(gov, BASELINE_FILE))}`)
  h.update(`owned\0${stat(path.join(gov, OWNED_FILE))}`)
  return h.digest('hex')
}

export function createService(opts: ServiceOptions) {
  const env = opts.env ?? process.env
  const modelRoot = resolveModelRoot(opts.root, env)
  const cache = new Map<string, Loaded>()
  /** Q3：本会话上一次扫描的违规键（还没扫描过时为首次加载的结果） */
  const lastScan = new Map<string, Set<string>>()
  const violationKeys = (r: GovernanceReport) => new Set(r.violations.filter(v => v.status !== 'allowed').map(v => v.key))

  /** Q6：项目缺省为 ARCH_PROJECT，否则为唯一项目 */
  function projectId(p?: string): string {
    const ids = listProjectIds(modelRoot)
    const id = p ?? env.ARCH_PROJECT ?? (ids.length === 1 ? ids[0] : undefined)
    if (!id) throw new ServiceError(`请指定项目：${ids.join('、')}`)
    if (!ids.includes(id)) throw new ServiceError(`项目不存在：${id}（可选：${ids.join('、')}）`)
    return id
  }

  /** Q11：没给项目时由设计 ID 推出——在全部项目里找这个设计，恰好一个即用它，否则报错并列出候选 */
  function projectOfDesign(p: string | undefined, design: string | undefined): string {
    if (p || !design || env.ARCH_PROJECT) return projectId(p)
    const ids = listProjectIds(modelRoot)
    const hits = ids.filter(id => fs.existsSync(path.join(modelRoot, id, 'designs', design, 'design.yaml')))
    if (hits.length === 1) return hits[0]
    if (!hits.length) throw new ServiceError(`没有项目有设计「${design}」（项目：${ids.join('、')}）`)
    throw new ServiceError(`多个项目都有设计「${design}」，请用 --project 指定：${hits.join('、')}`)
  }

  /** 指纹没变就用缓存；fresh 时无论如何重建（rescan、baseline） */
  function load(p?: string, fresh = false): Loaded {
    const project = projectId(p)
    const payload = readProject(modelRoot, project, opts.root)!
    const tree = readSourceTree(modelRoot, project, opts.root, env)
    // G1：源码在本地是前提，读不到是配置错误
    if (!tree || tree.status !== 'local') throw new ServiceError(`项目 ${project} 读不到源码：${tree?.reason ?? '项目不存在'}`)
    const gov = governanceDir(modelRoot, project)
    const stamp = stampOf(
      [
        ...payload.files,
        ...(payload.sketches ?? []).map(s => s.file),
        ...(payload.designs ?? []).map(d => ({ path: `designs/${d.id}/design.yaml`, text: JSON.stringify(d.accepted ?? []) })),
      ],
      tree,
      gov,
    )
    const hit = cache.get(project)
    if (hit && !fresh && hit.stamp === stamp) return hit
    const { index, issues: loadIssues } = loadModel(payload.files)
    // X6：人拥有文件的指纹比对，与 lint:model 同一函数
    const issues = [...loadIssues, ...compareOwned(readOwned(gov), ownedHashes(path.join(modelRoot, project)))]
    const own = assignFiles(index, tree.files, index.model.sourceIgnore)
    const deps = readCodeDeps(tree.root, tree.files, tree.packages)
    const report = governanceReport(index, own, tree, deps, readBaseline(gov))
    const hist = historyOptions(index.model.system)
    const history = readSourceHistory(tree.root, tree.files, hist)
    const evolution = history.status === 'ok' ? evolutionStats(index, own, history, tree.lines ?? {}, report, hist.coupling) : { error: history.reason }
    const checks = checkSketches(index, parseDesignSketches(payload.sketches ?? []), new Map((payload.designs ?? []).map(d => [d.id, d.accepted ?? []])))
    const entryOf = entryResolver(index, own, tree)
    const exportsOf = exportsResolver(tree.root, tree.files, createResolver(tree.root, tree.files, tree.packages).resolve)
    const loaded: Loaded = {
      project,
      index,
      issues,
      tree,
      files: new Set(tree.files),
      own,
      entryOf,
      surface: { entryOf, own, exportsOf },
      report,
      deps: deps.deps,
      evolution,
      checks,
      stamp,
    }
    cache.set(project, loaded)
    // Q3：本会话还没扫描过时，「上一次扫描」是首次加载的结果，不随自动重建移动
    if (!lastScan.has(project)) lastScan.set(project, violationKeys(report))
    return loaded
  }

  const record = (project: string, entry: Parameters<typeof appendLedger>[1]) => appendLedger(governanceDir(modelRoot, project), entry)
  const now = () => new Date().toISOString()
  const name = (l: Loaded, id: string) => moduleName(l.index, id)
  /** K16：一行指标；I 保留两位小数 */
  const metricsRow = (l: Loaded, m: ModuleMetrics) => ({
    id: m.module,
    name: name(l, m.module),
    ca: m.ca,
    ce: m.ce,
    instability: m.instability === null ? null : Math.round(m.instability * 100) / 100,
    band: m.band,
    // K19：有入口的模块带表面宽度 W 与越过入口数 B
    ...(m.w !== undefined ? { w: m.w, b: m.b! } : {}),
  })

  return {
    modelRoot,
    load,

    projects() {
      return listProjectIds(modelRoot).map(id => {
        const tree = readSourceTree(modelRoot, id, opts.root, env)
        return {
          id,
          source: tree?.status === 'local' ? { status: 'local', root: tree.root, files: tree.files.length } : { status: 'error', reason: tree?.reason },
        }
      })
    },

    /** 规模与门禁摘要 */
    overview(p?: string) {
      const l = load(p)
      const r = l.report
      const conf = [...r.relations.values()]
      return {
        project: l.project,
        system: l.index.model.system.name,
        sourceRoot: l.tree.root,
        fileDeps: r.fileDeps,
        moduleDeps: r.moduleDeps.size,
        relations: {
          confirmed: conf.filter(c => c.status === 'confirmed').length,
          unconfirmed: conf.filter(c => c.status === 'unconfirmed').length,
          skipped: conf.filter(c => c.status === 'skipped').length,
        },
        undescribed: r.undescribed.length,
        violations: {
          new: r.gate.newViolations,
          known: r.gate.knownViolations,
          open: r.violations.filter(v => v.status === 'open').length,
          allowed: r.violations.filter(v => v.status === 'allowed').length,
        },
        cyclicity: r.cyclicity,
        baseline: r.baseline
          ? {
              createdAt: r.baseline.createdAt,
              commit: r.baseline.commit,
              cyclicity: r.baseline.cyclicity,
              violations: r.baseline.violations.length,
              resolved: r.gate.resolved,
            }
          : null,
        cycleGrew: r.gate.cycleGrew,
      }
    },

    /** Q1：文件或模块 */
    locate(target: string, p?: string) {
      const l = load(p)
      if (l.index.modules.has(target)) return { kind: 'module' as const, module: describeModule(l.index, l.own, l.report, l.entryOf, target) }
      return { kind: 'file' as const, ...locateFile(l.index, l.own, l.files, l.report, l.entryOf, target.replace(/^\.\//, '')) }
    },

    /** Q2：写前判定；to 为模块 ID、清单中的文件，或从 from 文件出发的导入说明符（names 为命名导入的名称） */
    check(from: string, to: string, p?: string, names: readonly string[] = []): CheckResult & { resolved: CheckTarget[]; external?: string } {
      const l = load(p)
      const src = from.replace(/^\.\//, '')
      let targets: CheckTarget[]
      let external: string | undefined
      if (l.index.modules.has(to)) targets = [{ to }]
      else if (l.files.has(to.replace(/^\.\//, ''))) targets = [{ to: to.replace(/^\.\//, ''), via: to.replace(/^\.\//, '') }]
      else if (l.files.has(src)) {
        targets = resolveImport(l.tree.root, l.tree.files, l.tree.packages, src, to, names)
        if (!targets.length) external = to
      } else throw new ServiceError(`「${to}」既不是模块、也不是源码文件；按导入说明符解析时依赖方必须是源码文件`)
      const result: CheckResult & { resolved: CheckTarget[]; external?: string } = external
        ? {
            verdict: 'unconstrained',
            notes: [`「${external}」是外部依赖（三方库或 Node 内建），不受模块规则约束`],
            checks: [],
            targets: [],
            resolved: [],
            external,
          }
        : { ...checkDependency(l.index, l.own, l.report, l.entryOf, src, targets), resolved: targets }
      record(l.project, {
        at: now(),
        tool: 'check_dependency',
        client: opts.client,
        from,
        to,
        verdict: result.verdict,
        rules: [...new Set(result.checks.flatMap(c => c.hits.filter(h => !h.allowed).map(h => h.kind)))],
        cycle: result.checks.some(c => c.cycle.createsOrGrows),
      })
      return result
    },

    violations(p?: string, onlyNew = false) {
      const l = load(p)
      return l.report.violations
        .filter(v => (onlyNew ? v.status === 'new' : true))
        .map(v => ({
          key: v.key,
          kind: v.kind,
          status: v.status,
          from: `${v.from}（${name(l, v.from)}）`,
          to: `${v.to}（${name(l, v.to)}）`,
          reason: v.reason,
          ...(v.allowReason ? { allowReason: v.allowReason } : {}),
          evidence: v.files.slice(0, 5).map(f => `${f.from}:${f.line} → ${f.via === f.to ? f.to : `${f.via} ⇒ ${f.to}`}`),
          more: Math.max(0, v.files.length - 5),
        }))
    },

    cycles(p?: string) {
      const l = load(p)
      const r = l.report
      return {
        cyclicity: r.cyclicity,
        baseline: r.baseline?.cyclicity ?? null,
        modules: r.moduleCycles.map(c => ({ size: c.members.length, tolerated: c.tolerated, members: c.members.map(m => `${m}（${name(l, m)}）`) })),
        files: r.fileCycles.map(c => ({
          size: c.members.length,
          tolerated: c.tolerated,
          members: c.members.length > 30 ? [...c.members.slice(0, 30), `…另 ${c.members.length - 30} 个`] : c.members,
        })),
      }
    },

    /** Q3：重新扫描，与基线、与本会话上一次扫描比较 */
    rescan(p?: string) {
      const project = projectId(p)
      const before = lastScan.get(project) ?? new Set<string>()
      const l = load(project, true)
      const r = l.report
      const now_ = violationKeys(r)
      lastScan.set(project, now_)
      const baseKeys = new Set(r.baseline?.violations ?? [])
      const out = {
        violations: now_.size,
        sinceLastScan: { added: [...now_].filter(k => !before.has(k)), removed: [...before].filter(k => !now_.has(k)) },
        sinceBaseline: r.baseline ? { added: [...now_].filter(k => !baseKeys.has(k)), removed: [...baseKeys].filter(k => !now_.has(k)) } : null,
        cyclicity: r.cyclicity,
        baselineCyclicity: r.baseline?.cyclicity ?? null,
        gateFailed: r.gate.newViolations > 0 || r.gate.cycleGrew,
      }
      record(project, { at: now(), tool: 'rescan', client: opts.client, violations: now_.size, newViolations: r.gate.newViolations, cyclicity: r.cyclicity })
      return out
    },

    /** Q7–Q9：返工清单；同一份结果给 JSON 与 Markdown */
    issues(p?: string, category?: ReworkCategory): { project: string; list: ReworkList; markdown: string } {
      const l = load(p)
      const evo = 'error' in l.evolution ? {} : { evolution: l.evolution }
      const all = reworkList({
        index: l.index,
        issues: l.issues,
        source: { own: l.own, tree: l.tree },
        report: l.report,
        deps: l.deps,
        ...evo,
        sketches: l.checks,
      })
      const items = category ? all.items.filter(i => i.category === category) : all.items
      const list: ReworkList = category ? { ...all, items } : all
      const modelDir = path.relative(opts.root, path.join(modelRoot, l.project)).split(path.sep).join('/')
      return { project: l.project, list, markdown: reworkMarkdown(list, `${l.index.model.system.name}（${l.project}）`, { modelDir, sourceRoot: l.tree.root }) }
    },

    /** J8：热度前 N（与页面系统面板同一函数） */
    hotspots(p?: string, kind: HeatKind = 'changes', limit = 10) {
      const l = load(p)
      if ('error' in l.evolution) throw new ServiceError(`项目 ${l.project} 没有演化事实：${l.evolution.error}`)
      const s = l.evolution
      return {
        project: l.project,
        kind,
        window: { days: s.days, since: s.since, commits: s.commits, fixes: s.fixes },
        modules: hotspots(s, kind, limit).map(m => ({
          id: m.id,
          name: name(l, m.id),
          changes: m.changes,
          fixes: m.fixes,
          lines: m.lines,
          heat: Math.round(kind === 'fixes' ? m.fixHeat : m.heat),
        })),
      }
    },

    /** J4、J6：时间耦合（与页面同一结果）；onlyIsolated 只列无依赖无关系的对 */
    coupling(p?: string, onlyIsolated = false) {
      const l = load(p)
      if ('error' in l.evolution) throw new ServiceError(`项目 ${l.project} 没有演化事实：${l.evolution.error}`)
      const s = l.evolution
      return {
        project: l.project,
        window: { days: s.days, since: s.since, commits: s.commits },
        pairs: listedCouplings(s)
          .filter(c => !onlyIsolated || (!c.dependency && !c.relation))
          .map(c => ({
            a: `${c.a}（${name(l, c.a)}）`,
            b: `${c.b}（${name(l, c.b)}）`,
            shared: c.shared,
            ratioA: Math.round(c.ratioA * 100) / 100,
            ratioB: Math.round(c.ratioB * 100) / 100,
            dependency: c.dependency,
            relation: c.relation,
            commits: c.commits.slice(0, 5).map(h => h.slice(0, 8)),
          })),
      }
    },

    /**
     * Q14、K15：影响面——传入闭包（改它牵动谁）与传出闭包（它要谁才能工作），按距离分组、标出环成员（Y1）；附该模块的 Ca / Ce / I（K16）。
     * direction 只给一个方向；valuesOnly 去掉只引类型（同 Y1）。只读，不写拦截记录（同 Q1）。
     */
    impact(target: string, p?: string, opts: { direction?: 'in' | 'out'; valuesOnly?: boolean } = {}) {
      const l = load(p)
      if (!l.index.modules.has(target) || target === l.index.rootId) throw new ServiceError(`「${target}」不是模块`)
      const valuesOnly = !!opts.valuesOnly
      const imp = impactOf(l.index, l.report, target, { valuesOnly, own: l.own, surface: l.surface })!
      const m = moduleMetrics(l.index, l.report, target, { valuesOnly })!
      const side = (list: typeof imp.incoming, files: number) => ({
        modules: list.length,
        files,
        byDistance: [...new Set(list.map(e => e.distance))].map(distance => ({
          distance,
          modules: list
            .filter(e => e.distance === distance)
            .map(e => ({ id: e.module, name: name(l, e.module), ...(e.inCycle ? { inCycle: true } : {}), ...(e.possible ? { possible: true } : {}) })),
        })),
      })
      return {
        project: l.project,
        module: target,
        name: name(l, target),
        valuesOnly,
        inCycle: imp.inCycle,
        metrics: metricsRow(l, m),
        ...(opts.direction !== 'out' ? { incoming: side(imp.incoming, imp.files!.incoming) } : {}),
        ...(opts.direction !== 'in' ? { outgoing: side(imp.outgoing, imp.files!.outgoing) } : {}),
      }
    },

    /**
     * Q14、K16：扇入 Ca、扇出 Ce 与不稳定度 I。给模块时为它的明细（含贡献最多的 5 个依赖方 / 被依赖方）；
     * 给 level 时为该父模块的子模块；都不给时为全系统的叶子模块。top 按 Ca 降序（并列按 Ce 降序）取前 N。只读。
     */
    metrics(p?: string, opts: { module?: string; level?: string; top?: number; valuesOnly?: boolean } = {}) {
      const l = load(p)
      const valuesOnly = !!opts.valuesOnly
      if (opts.module) {
        if (!l.index.modules.has(opts.module) || opts.module === l.index.rootId) throw new ServiceError(`「${opts.module}」不是模块`)
        const d = moduleMetrics(l.index, l.report, opts.module, { valuesOnly, surface: l.surface })!
        return {
          kind: 'module' as const,
          project: l.project,
          valuesOnly,
          module: metricsRow(l, d),
          topDependents: d.topDependents.map(x => ({ id: x.module, name: name(l, x.module), files: x.files })),
          topDependencies: d.topDependencies.map(x => ({ id: x.module, name: name(l, x.module), files: x.files })),
        }
      }
      if (opts.level && !l.index.pathOf.has(opts.level)) throw new ServiceError(`「${opts.level}」不是模块`)
      const all = structureMetrics(l.index, l.report, { valuesOnly, surface: l.surface })
      const ids = opts.level
        ? (l.index.childrenOf.get(opts.level) ?? [])
        : [...l.index.modules.keys()].filter(id => id !== l.index.rootId && !(l.index.childrenOf.get(id) ?? []).length)
      let rows = ids.map(id => all.get(id)!).filter(Boolean)
      if (opts.top) rows = [...rows].sort((a, b) => b.ca - a.ca || b.ce - a.ce || a.module.localeCompare(b.module)).slice(0, opts.top)
      return {
        kind: 'list' as const,
        project: l.project,
        valuesOnly,
        scope: opts.level ? `${opts.level}（${name(l, opts.level)}）的子模块` : '全系统的叶子模块',
        total: ids.length,
        modules: rows.map(m => metricsRow(l, m)),
      }
    },

    /**
     * L28、K21、K22：普通层次按本层值依赖分层——每层的子模块（自上而下，第 1 层为入口）、环组、孤立的、向上的交互边（是否控制反转）、
     * 有交互却没有值依赖的兄弟与拆分信号（不占文件、共用文件）。分层总览（作者声明的层）不适用。只读。
     */
    tiers(level: string, p?: string) {
      const l = load(p)
      if (!l.index.modules.has(level)) throw new ServiceError(`「${level}」不是模块`)
      const view = tierView(l.index, level)
      const t = levelTiers(l.index, view, l.report)
      if (!t) throw new ServiceError(`「${level}」声明了分层（ADR-0052）：按作者声明的层排，不算依赖深度；改用 strata ${level}`)
      const moduleOf = (id: string) => view.nodes.find(n => n.id === id)?.moduleId ?? id
      const ref = (id: string) => ({ id: moduleOf(id), name: name(l, moduleOf(id)) })
      const split = splitSignals(l.index, l.own, level)
      return {
        project: l.project,
        level,
        name: name(l, level),
        nodes: t.nodes.length,
        deps: t.deps,
        banded: t.banded,
        tiers: Array.from({ length: t.count }, (_, i) => ({ tier: i + 1, modules: t.nodes.filter(n => t.tier.get(n) === i).map(ref) })),
        groups: t.groups.map((g, i) => ({ id: t.groupIds[i], modules: g.map(ref) })),
        isolated: t.isolated.map(ref),
        upward: t.upward.map(u => ({ edge: u.edge, from: ref(u.from), to: ref(u.to), inversion: u.inversion, relations: u.relations })),
        undepended: t.undepended.map(u => ({ from: ref(u.from), to: ref(u.to), edges: u.edges })),
        notes: t.notes,
        split: { noFiles: split.noFiles.map(id => ({ id, name: name(l, id) })), shared: split.shared },
      }
    },

    /**
     * ST（ADR-0052）：父模块声明的分层——各层的问题、判定问、原则、可依赖的层、成员、Ca / Ce / I、本层的向上依赖，与 ST-3–ST-5 的提示。只读。
     */
    strata(parent: string, p?: string) {
      const l = load(p)
      const id = parent === 'root' ? l.index.rootId : parent
      if (id !== l.index.rootId && !l.index.modules.has(id)) throw new ServiceError(`「${parent}」不是模块`)
      const layers = strataMetrics(l.index, id, l.report)
      const under = (x: string) => layers.some(s => s.members.some(m => (l.index.pathOf.get(x) ?? []).includes(m)))
      const findings = strataFindings(l.index, l.report).filter(f => f.modules[0] === id || f.modules.some(under))
      return {
        project: l.project,
        parent: id,
        name: name(l, id),
        declared: layers.length > 0,
        children: (l.index.childrenOf.get(id) ?? []).length,
        layers: layers.map(s => ({
          ...s,
          members: s.members.map(m => ({ id: m, name: name(l, m) })),
          upward: s.upward.map(u => ({ ...u, from: { id: u.from, name: name(l, u.from) }, to: { id: u.to, name: name(l, u.to) } })),
        })),
        notes: findings.map(f => ({ code: f.issue.code, message: f.issue.message })),
        ...(layers.length
          ? {}
          : {
              hint: `「${name(l, id)}」没有声明分层：子模块 ${(l.index.childrenOf.get(id) ?? []).length} 个${(l.index.childrenOf.get(id) ?? []).length > 7 ? '，超过七个，按 ST-1 归纳 2–5 个有原则的层或记拆分信号' : ''}；依赖深度见 tiers`,
            }),
      }
    },

    /** ST-2（ADR-0052）：在已分层的父模块下新增模块时的归属建议——各层的问题与判定问，按职责文字的重合度排序。只读。 */
    place(parent: string, responsibility: string, p?: string) {
      const l = load(p)
      const id = parent === 'root' ? l.index.rootId : parent
      const r = placeSuggestion(l.index, id, responsibility)
      if (!r) throw new ServiceError(`「${parent}」没有声明分层：不需要选层`)
      return { project: l.project, ...r, name: name(l, id) }
    },

    /**
     * Q16、K18、K19：模块的表面——元素清单（种类 · 声明状态 · 扇入 · 使用它的模块）、W / B、越过入口清单（依赖方文件:行 → 符号）与建议
     * （越过入口的：提升到入口导出或改经入口；导出未声明、被 HOT_SURFACE_MODULES 个以上模块使用的：声明接口；声明未导出的：导出或删去声明）。只读。
     */
    surface(target: string, p?: string) {
      const l = load(p)
      if (!l.index.modules.has(target) || target === l.index.rootId) throw new ServiceError(`「${target}」不是模块`)
      const s = surfaceOf(l.index, l.surface, target, l.report)!
      const m = surfaceMetrics(l.index, l.report, l.surface, target)
      const use = new Map(m.uses.map(u => [u.element.name, u]))
      const elements = s.elements.map(e => {
        const u = use.get(e.name)
        return {
          name: e.name,
          kind: e.kind,
          state: e.state,
          ...(e.interfaceId ? { interface: e.interfaceId } : {}),
          ...(e.file ? { at: e.line ? `${e.file}:${e.line}` : e.file } : {}),
          fanIn: u?.modules.length ?? 0,
          modules: (u?.modules ?? []).map(id => `${id}（${name(l, id)}）`),
        }
      })
      const bypasses = m.bypasses.map(f => ({
        at: `${f.from}:${f.line}`,
        to: f.via === f.to ? f.to : `${f.via} ⇒ ${f.to}`,
        ...(f.names?.length ? { names: f.names } : {}),
      }))
      const suggestions: string[] = []
      if (!s.entry)
        suggestions.push('没有入口（G10：描述的 entry、包入口或模块目录下的 index.*）：表面只有声明接口，W / B 不给；需要对外的符号时给模块定一个入口')
      const deep = [...new Set(m.bypasses.map(f => f.via))]
      if (deep.length)
        suggestions.push(
          `越过入口 ${m.bypasses.length} 处（${deep.slice(0, 5).join('、')}${deep.length > 5 ? ` 等 ${deep.length} 个文件` : ''}）：把用到的符号提升到入口 ${s.entry} 导出、依赖方改经入口导入（U18）`,
        )
      const hot = elements.filter(e => e.state === 'exported-only' && e.fanIn >= HOT_SURFACE_MODULES)
      if (hot.length)
        suggestions.push(`导出未声明、被 ${HOT_SURFACE_MODULES} 个以上模块使用：${hot.map(e => `${e.name}（${e.fanIn}）`).join('、')}——在描述里声明接口（U19）`)
      const dead = elements.filter(e => e.state === 'declared-only')
      if (dead.length) suggestions.push(`声明了接口、入口没导出：${dead.map(e => e.name).join('、')}——导出它，或从描述里去掉（G12）`)
      return {
        project: l.project,
        module: target,
        name: name(l, target),
        entry: s.entry,
        exports: s.exports,
        w: m.w,
        b: m.b,
        whole: m.whole,
        elements,
        bypasses,
        suggestions,
      }
    },

    /** Q4 */
    report(p?: string) {
      const project = projectId(p)
      const s = summarizeLedger(readLedger(governanceDir(modelRoot, project)))
      return {
        project,
        summary: `写前判定 ${s.checks} 次 · 重新扫描 ${s.rescans} 次 · 确认写入 ${s.reviewedWrites} 次 · 草图写回 ${s.sketchWrites} 次 · 角色认可 ${s.roleWrites} 次`,
        ...s,
      }
    },

    /**
     * X4、X17：草图核验——缺省为活动草图对当前版本；给了 design 时为该设计的各张草图逐张对当前版本（revision 为某一轮时对那一轮），
     * 并附两个对比（相对基线：架构师改了什么；相对当前版本 / 该轮：实现还差什么），按血缘表述；基线读设计 base.commit 那一版描述（git）。
     */
    sketchCheck(
      p?: string,
      design?: string,
      revision?: string,
    ): { project: string; target: string; checks: SketchCheck[]; compare?: { baseline?: DesignComparison; current: DesignComparison; base?: string } } {
      const project = projectOfDesign(p, design)
      if (!design) {
        const l = load(project)
        return { project, target: '当前版本', checks: l.checks }
      }
      const dir = path.join(modelRoot, project)
      const files = designSketches(dir, design)
      if (!files.length) throw new ServiceError(`设计「${design}」没有草图（designs/${design}/sketches/*.yaml）`)
      const entities = parseDesignSketches(files)
      const info = readProject(modelRoot, project, opts.root)!.designs?.find(d => d.id === design)
      const accepted = new Map([[design, info?.accepted ?? []]])
      const commit = info?.base?.commit
      const baseFiles = commit ? readModelAt(dir, commit) : null
      const baseline = baseFiles ? loadModel(baseFiles).index : null
      const baselines = new Map([[design, baseline]])
      let target = '当前版本'
      let index: ModelIndex
      if (revision) {
        const payload = readDesignRevision(modelRoot, project, design, revision, opts.root)
        if (!payload || revision === 'sketch') throw new ServiceError(`轮次不存在：${design} / ${revision}`)
        index = loadModel(payload.files).index
        target = `${design} / ${revision}`
      } else index = load(project).index
      return {
        project,
        target,
        checks: checkSketches(index, entities, accepted, baselines).filter(c => c.design === design),
        compare: {
          ...(baseline ? { baseline: compareDesign(entities, baseline, 'baseline'), base: commit } : {}),
          current: compareDesign(entities, index, 'current'),
        },
      }
    },

    /** X9：设计的草图清单（设计面板用）：挂载点、文件、指纹、是否需要初始布局 */
    designSketches(p: string | undefined, design: string): { project: string; design: string; sketches: SketchFileRef[] } {
      const project = projectOfDesign(p, design)
      return { project, design, sketches: designSketchFiles(path.join(modelRoot, project), design) }
    },

    /** X3、X8：归档 / 晋升，与页面同一函数；不一致即拒绝 */
    sketchArchive(p: string | undefined, design: string) {
      const project = projectOfDesign(p, design)
      try {
        const r = archiveDesign(modelRoot, project, design, opts.root)
        cache.delete(project)
        return { project, ...r }
      } catch (e) {
        if (e instanceof WriteError) throw new ServiceError(e.message)
        throw e
      }
    },

    /** X6：登记人拥有文件的指纹，只给命令行、由人执行 */
    own(p?: string) {
      const project = projectId(p)
      const r = registerOwned(modelRoot, project)
      cache.delete(project)
      return { file: path.relative(opts.root, r.file), files: r.files }
    },

    /** U7：只给命令行，由人执行 */
    baseline(p?: string) {
      const l = load(p, true)
      const b = makeBaseline(l.report, new Date().toISOString(), sourceCommit(l.tree.root))
      const file = writeBaseline(governanceDir(modelRoot, l.project), b)
      cache.delete(l.project)
      return { file: path.relative(opts.root, file), violations: b.violations.length, cyclicity: b.cyclicity, commit: b.commit }
    },
  }
}

export type ArchService = ReturnType<typeof createService>

/** X17：一个设计对同一对象的两个对比之一（全设计 = 各张的并集） */
export type DesignComparison = ReturnType<typeof compareDesign>
