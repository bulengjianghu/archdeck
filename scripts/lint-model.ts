/**
 * 命令行校验架构描述：
 *   npm run lint:model                 校验模型根目录（默认 model/）下的全部项目
 *   npm run lint:model -- <项目目录>   只校验指定目录
 * 项目下的设计版本（designs/<设计>/<轮次>/，ADR-0002）逐轮一并校验，design.yaml 的问题按 error 计；设计的草图（sketches/*.yaml）按草图版本校验，并逐张两级校验（DV-10、X14）。
 * 当前版本附带源码归属警告（G9：未归属、归属冲突、entry 不存在）与架构治理（K、U、Y）：
 * 基线外的新增违规、环度上升为 error（U8，棘轮），其余为 warning；读不到源码为 error（G1，源码在本地是前提）；设计版本不对应代码，不报。
 * 当前版本另比对人拥有文件的指纹（X6）：登记后被改动为 error owned.changed，未登记为 warning。
 * 活动草图的核验（X4）：持久草图对每个版本、已定稿设计的草图对当前版本、设计的草图对本设计各轮；偏差按严重度报出（已认可的不报）。
 * 有 error 时退出码为 1；只有 warning 时为 0。
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assignFiles,
  checkSketches,
  compareOwned,
  governanceReport,
  loadModel,
  portIssues,
  reviewCounts,
  unclassifiedRelations,
  parseDesignSketches,
  sketchLifetime,
  sourceDeltaNote,
  validateSketch,
  sourceIssues,
  type AcceptedDeviation,
  type GovernanceReport,
  type Issue,
  type RawFile,
  type SketchCheck,
} from '../src/model'
import {
  DESIGNS_DIR,
  designSketches,
  SKETCHES_DIR,
  listDesigns,
  listProjectIds,
  readModelDir,
  readSketchVersion,
  resolveModelRoot,
  type ModelPayload,
} from '../vite/readModelDir'
import { readSourceTree } from '../vite/readSource'
import { readCodeDeps } from '../vite/readDeps'
import { governanceDir, ownedHashes, readBaseline, readOwned } from '../vite/governanceStore'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const arg = process.argv.slice(2).find(a => a !== '--')
const modelRoot = resolveModelRoot(root)
const projectDirs = arg ? [path.resolve(process.cwd(), arg)] : listProjectIds(modelRoot).map(id => path.join(modelRoot, id))
/** 当前版本目录 → 项目 ID（只有它们附带源码归属警告） */
const currentOf = new Map<string, string>()
/** 要校验的目录；草图版本不是目录，由 readSketchVersion 给出载荷；设计各轮附本设计的草图与认可的偏差（X4） */
interface Entry {
  dir: string
  payload?: Pick<ModelPayload, 'dir' | 'files'>
  sketches?: { design: string; file: RawFile }[]
  accepted?: Map<string, readonly AcceptedDeviation[]>
  /** 草图版本自己是尺子，不核验 */
  skipSketches?: boolean
  /** X14：草图版本逐张校验（格式错误为 error，语义提示为 warning） */
  validate?: { design: string; project: string }
  /** 项目描述目录（草图偏差的位置相对它） */
  project?: string
}
const dirs: Entry[] = []
let totalErrors = 0
for (const dir of projectDirs) {
  const projectId = path.dirname(dir) === modelRoot ? path.basename(dir) : undefined
  if (projectId) currentOf.set(dir, projectId)
  const designs = listDesigns(dir)
  const accepted = new Map(designs.map(d => [d.id, d.accepted ?? []]))
  // X3、X4：已定稿、未归档的设计的草图约束当前版本
  dirs.push({ dir, sketches: designs.filter(d => d.sketch && d.status === 'accepted').flatMap(d => designSketches(dir, d.id)), accepted, project: dir })
  for (const d of designs) {
    for (const p of d.problems) {
      console.log(`  error   ${path.relative(root, path.join(dir, DESIGNS_DIR, d.id, 'design.yaml'))}  ${p}  [design]`)
      totalErrors++
    }
    const sketch = d.sketch && projectId ? readSketchVersion(modelRoot, projectId, d.id, root) : null
    if (sketch)
      dirs.push({ dir: path.join(dir, DESIGNS_DIR, d.id, SKETCHES_DIR), payload: sketch, skipSketches: true, validate: { design: d.id, project: dir } })
    // X4：设计的草图只对最新一轮把关（早先各轮是演进的历史，页面上照常看它们的偏差）
    const own = d.sketch ? designSketches(dir, d.id) : []
    const latest = d.revisions[d.revisions.length - 1]?.id
    for (const r of d.revisions) dirs.push({ dir: path.join(dir, DESIGNS_DIR, d.id, r.id), sketches: r.id === latest ? own : [], accepted, project: dir })
  }
}

if (projectDirs.length === 0) {
  console.error(`没有找到项目：${modelRoot} 下没有含 system.yaml 的子目录`)
  process.exit(1)
}

for (const entry of dirs) {
  const dir = entry.dir
  const payload = entry.payload ?? readModelDir(dir, root)
  if (payload.files.length === 0) {
    console.error(`模型目录中没有 YAML 文件：${dir}`)
    totalErrors++
    continue
  }
  const loaded = loadModel(payload.files)
  const { index } = loaded
  const issues = [...loaded.issues]
  // X4：活动草图的核验，偏差按严重度报出（已认可的为 info，不报）
  const checks: SketchCheck[] = entry.skipSketches ? [] : checkSketches(index, parseDesignSketches(entry.sketches ?? []), entry.accepted)
  for (const c of checks)
    for (const d of c.deviations)
      if (d.severity !== 'info')
        issues.push({
          severity: d.severity,
          code: d.code,
          message: `${c.design ? `设计「${c.design}」的草图` : `持久草图「${c.sketch}」`}：${d.message}`,
          ...(d.at ? { file: d.at.file, path: d.at.path } : {}),
        })
  // X14：设计的各张草图的两级校验（上下文：当前版本的持久草图与模块、同设计的其他草图）
  if (entry.validate) {
    const cur = loadModel(readModelDir(entry.validate.project, root).files).index
    const persistent = cur.model.sketches.filter(s => sketchLifetime(s) === 'persistent')
    const mine = parseDesignSketches(designSketches(entry.validate.project, entry.validate.design))
    const set = Object.fromEntries(mine.map(s => [s.def.mount, s.def]))
    for (const s of mine)
      for (const v of validateSketch(s.def, { persistent, file: s.file, index: cur, design: set }).issues)
        if (v.severity !== 'hint')
          issues.push({
            severity: v.severity,
            code: v.code,
            message: `设计「${entry.validate.design}」的草图「${s.def.mount}」：${v.message}`,
            file: path.basename(s.file),
            ...(v.path ? { path: v.path } : {}),
          })
  }
  let sourceNote = ''
  let deltaNote = ''
  let governanceNote = ''
  const project = currentOf.get(dir)
  // X6：当前版本比对人拥有文件的指纹
  if (project) issues.push(...compareOwned(readOwned(governanceDir(modelRoot, project)), ownedHashes(dir)))
  const tree = project ? readSourceTree(modelRoot, project, root) : null
  if (tree?.status === 'local') {
    const own = assignFiles(index, tree.files, index.model.sourceIgnore)
    issues.push(...sourceIssues(index, own, tree))
    sourceNote = `；源码 ${tree.files.length} 个文件（未归属 ${own.unowned.length}、冲突 ${own.conflicts.length}、忽略 ${own.ignored.size}）`
    // G22：描述的 source.commit 与源码树 HEAD 不一致——只提醒不判错，测的可能不是描述那一份代码
    if (tree.commitDelta) deltaNote = `；源码版本：${sourceDeltaNote(tree.commitDelta)}`
    const report = governanceReport(index, own, tree, readCodeDeps(tree.root, tree.files, tree.packages), readBaseline(governanceDir(modelRoot, project!)))
    issues.push(...report.issues)
    governanceNote = governanceSummary(report)
  } else if (tree) issues.push({ severity: 'error', code: 'source.missing', message: `读不到源码（源码在本地是前提，G1）：${tree.reason}` })
  // U14：设计版本没有代码事实（K8），端口孤立只按描述判定
  else issues.push(...portIssues(index, null))
  // M17：未分类只提示，摘要给出条数与其中核心之间的条数（裁决 12）
  const unclassified = unclassifiedRelations(index)
  const unclassifiedNote = `；未分类 ${unclassified.all.length}（核心之间 ${unclassified.core.length}）`
  // Z3、Z5：需复核是人的待办，不报错，只在摘要给计数（只对当前版本）
  const rc = project ? reviewCounts(index) : null
  const reviewNote = rc ? `；确认：已确认 ${rc.reviewed} / ${rc.scope} · 需复核 ${rc.stale}` : ''
  const fmt = (i: Issue) => {
    const where = i.file ? `${payload.dir}/${i.file}${i.line ? `:${i.line}` : ''}` : '(全局)'
    return `  ${i.severity === 'error' ? 'error  ' : 'warning'} ${where}  ${i.message}  [${i.code}]`
  }
  const errors = issues.filter(i => i.severity === 'error')
  const warnings = issues.filter(i => i.severity === 'warning')
  for (const i of [...errors, ...warnings]) console.log(fmt(i))
  const top = (index.childrenOf.get(index.rootId) ?? []).length
  console.log(
    `${payload.dir}：${payload.files.length} 个文件，${index.modules.size} 个模块（根下 ${top} 个），` +
      `${index.relations.size} 条关系，${index.interfaces.size} 个接口，${index.dataStructures.size} 个数据结构` +
      (index.actors.size || index.scenarios.size ? `，${index.actors.size} 个参与者，${index.scenarios.size} 个场景` : '') +
      unclassifiedNote +
      sourceNote +
      deltaNote +
      governanceNote +
      reviewNote +
      (checks.length ? `；草图 ${checks.map(c => `${c.sketch}${c.consistent ? ' 一致' : ` 偏差 ${c.counts.error + c.counts.warning}`}`).join('、')}` : '') +
      '；' +
      `${errors.length} 个错误，${warnings.length} 个提醒`,
  )
  totalErrors += errors.length
}
process.exit(totalErrors > 0 ? 1 : 0)

/** 治理摘要（K7、U8、Y2） */
function governanceSummary(r: GovernanceReport): string {
  const conf = [...r.relations.values()]
  const n = (s: string) => conf.filter(c => c.status === s).length
  const allowed = r.violations.filter(v => v.status === 'allowed').length
  const impl = [...r.implementers.values()].flatMap(p => p.implementers)
  const open = r.violations.filter(v => v.status === 'open').length
  const b = r.baseline
  return (
    `；代码事实：文件依赖 ${r.fileDeps}、模块依赖 ${r.moduleDeps.size}，关系已证实 ${n('confirmed')} / 未证实 ${n('unconfirmed')}，未解释的交互 ${r.undescribed.length}` +
    `；有实现者的端口 ${r.implementers.size}（实现者 ${impl.length}，仅代码事实 ${impl.filter(i => !i.described).length}）、子类 ${r.subclasses.length}、组装 ${r.assembly.length}（组装根 ${r.assemblyRoots.length}）` +
    `；违规 ${b ? `新增 ${r.gate.newViolations} / 已知 ${r.gate.knownViolations}` : `${open}（无基线）`}${allowed ? ` / 已豁免 ${allowed}` : ''}` +
    `；环度 模块 ${r.cyclicity.modules} / 文件 ${r.cyclicity.files}${b ? `（基线 ${b.cyclicity.modules} / ${b.cyclicity.files}）` : ''}` +
    // K21、K22：拆分信号与向上却不是控制反转的边只给计数（info，详见 arch issues --category split）
    `；拆分信号 ${r.issues.filter(i => i.code.startsWith('split.')).length}、向上非控制反转 ${r.issues.filter(i => i.code === 'tier.upward').length}` +
    (r.gate.resolved ? `；基线中 ${r.gate.resolved} 条违规已消除，可运行 npm run arch -- baseline 收紧基线` : '')
  )
}
