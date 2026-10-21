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
  describeModule,
  governanceReport,
  loadModel,
  locateFile,
  makeBaseline,
  moduleName,
  summarizeLedger,
  entryResolver,
  type CheckResult,
  type CheckTarget,
  type EntryOf,
  type GovernanceReport,
  type Issue,
  type LedgerClient,
  type LocalSource,
  type ModelIndex,
  type SourceOwnership,
} from '../../src/model'
import { listProjectIds, readProject, resolveModelRoot } from '../../vite/readModelDir'
import { readSourceTree } from '../../vite/readSource'
import { readCodeDeps, resolveImport } from '../../vite/readDeps'
import { appendLedger, BASELINE_FILE, governanceDir, readBaseline, readLedger, sourceCommit, writeBaseline } from '../../vite/governanceStore'

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
  report: GovernanceReport
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

  /** 指纹没变就用缓存；fresh 时无论如何重建（rescan、baseline） */
  function load(p?: string, fresh = false): Loaded {
    const project = projectId(p)
    const payload = readProject(modelRoot, project, opts.root)!
    const tree = readSourceTree(modelRoot, project, opts.root, env)
    // K8：源码不在本地时没有事实
    if (!tree || tree.status !== 'local')
      throw new ServiceError(`项目 ${project} 的源码不在本地（${tree?.status === 'absent' ? (tree.tried ?? tree.reason) : '未知'}），没有代码事实`)
    const gov = governanceDir(modelRoot, project)
    const stamp = stampOf(payload.files, tree, gov)
    const hit = cache.get(project)
    if (hit && !fresh && hit.stamp === stamp) return hit
    const { index, issues } = loadModel(payload.files)
    const own = assignFiles(index, tree.files, index.model.sourceIgnore)
    const deps = readCodeDeps(tree.root, tree.files, tree.packages)
    const report = governanceReport(index, own, tree, deps, readBaseline(gov))
    const loaded: Loaded = { project, index, issues, tree, files: new Set(tree.files), own, entryOf: entryResolver(index, own, tree), report, stamp }
    cache.set(project, loaded)
    // Q3：本会话还没扫描过时，「上一次扫描」是首次加载的结果，不随自动重建移动
    if (!lastScan.has(project)) lastScan.set(project, violationKeys(report))
    return loaded
  }

  const record = (project: string, entry: Parameters<typeof appendLedger>[1]) => appendLedger(governanceDir(modelRoot, project), entry)
  const now = () => new Date().toISOString()
  const name = (l: Loaded, id: string) => moduleName(l.index, id)

  return {
    modelRoot,
    load,

    projects() {
      return listProjectIds(modelRoot).map(id => {
        const tree = readSourceTree(modelRoot, id, opts.root, env)
        return {
          id,
          source:
            tree?.status === 'local'
              ? { status: 'local', root: tree.root, files: tree.files.length }
              : { status: 'absent', tried: tree?.status === 'absent' ? tree.tried : undefined },
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

    /** Q4 */
    report(p?: string) {
      const project = projectId(p)
      return { project, ...summarizeLedger(readLedger(governanceDir(modelRoot, project))) }
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
