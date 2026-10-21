/**
 * 命令行校验架构描述：
 *   npm run lint:model                 校验模型根目录（默认 model/）下的全部项目
 *   npm run lint:model -- <项目目录>   只校验指定目录
 * 项目下的设计版本（designs/<设计>/<轮次>/，ADR-0002）逐轮一并校验，design.yaml 的问题按 error 计。
 * 源码在本地时，当前版本附带源码归属警告（G9：未归属、归属冲突、entry 不存在）与架构治理（K、U、Y）：
 * 基线外的新增违规、环度上升为 error（U8，棘轮），其余为 warning；设计版本不对应代码，不报。
 * 有 error 时退出码为 1；只有 warning 时为 0。
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assignFiles, governanceReport, loadModel, sourceIssues, type GovernanceReport, type Issue } from '../src/model'
import { DESIGNS_DIR, listDesigns, listProjectIds, readModelDir, resolveModelRoot } from '../vite/readModelDir'
import { readSourceTree } from '../vite/readSource'
import { readCodeDeps } from '../vite/readDeps'
import { governanceDir, readBaseline } from '../vite/governanceStore'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const arg = process.argv.slice(2).find(a => a !== '--')
const modelRoot = resolveModelRoot(root)
const projectDirs = arg ? [path.resolve(process.cwd(), arg)] : listProjectIds(modelRoot).map(id => path.join(modelRoot, id))
/** 当前版本目录 → 项目 ID（只有它们附带源码归属警告） */
const currentOf = new Map<string, string>()
const dirs: string[] = []
let totalErrors = 0
for (const dir of projectDirs) {
  dirs.push(dir)
  if (path.dirname(dir) === modelRoot) currentOf.set(dir, path.basename(dir))
  for (const d of listDesigns(dir)) {
    for (const p of d.problems) {
      console.log(`  error   ${path.relative(root, path.join(dir, DESIGNS_DIR, d.id, 'design.yaml'))}  ${p}  [design]`)
      totalErrors++
    }
    for (const r of d.revisions) dirs.push(path.join(dir, DESIGNS_DIR, d.id, r.id))
  }
}

if (projectDirs.length === 0) {
  console.error(`没有找到项目：${modelRoot} 下没有含 system.yaml 的子目录`)
  process.exit(1)
}

for (const dir of dirs) {
  const payload = readModelDir(dir, root)
  if (payload.files.length === 0) {
    console.error(`模型目录中没有 YAML 文件：${dir}`)
    totalErrors++
    continue
  }
  const loaded = loadModel(payload.files)
  const { index } = loaded
  const issues = [...loaded.issues]
  let sourceNote = ''
  let governanceNote = ''
  const project = currentOf.get(dir)
  const tree = project ? readSourceTree(modelRoot, project, root) : null
  if (tree?.status === 'local') {
    const own = assignFiles(index, tree.files, index.model.sourceIgnore)
    issues.push(...sourceIssues(index, own, tree))
    sourceNote = `；源码 ${tree.files.length} 个文件（未归属 ${own.unowned.length}、冲突 ${own.conflicts.length}、忽略 ${own.ignored.size}）`
    const report = governanceReport(index, own, tree, readCodeDeps(tree.root, tree.files, tree.packages), readBaseline(governanceDir(modelRoot, project!)))
    issues.push(...report.issues)
    governanceNote = governanceSummary(report)
  } else if (tree) sourceNote = `；源码不在本地（${tree.status === 'absent' ? (tree.tried ?? tree.reason) : ''}），跳过归属检查`
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
      sourceNote +
      governanceNote +
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
  const open = r.violations.filter(v => v.status === 'open').length
  const b = r.baseline
  return (
    `；代码事实：文件依赖 ${r.fileDeps}、模块依赖 ${r.moduleDeps.size}，关系已证实 ${n('confirmed')} / 未证实 ${n('unconfirmed')}，未描述依赖 ${r.undescribed.length}` +
    `；违规 ${b ? `新增 ${r.gate.newViolations} / 已知 ${r.gate.knownViolations}` : `${open}（无基线）`}${allowed ? ` / 已豁免 ${allowed}` : ''}` +
    `；环度 模块 ${r.cyclicity.modules} / 文件 ${r.cyclicity.files}${b ? `（基线 ${b.cyclicity.modules} / ${b.cyclicity.files}）` : ''}` +
    (r.gate.resolved ? `；基线中 ${r.gate.resolved} 条违规已消除，可运行 npm run arch -- baseline 收紧基线` : '')
  )
}
