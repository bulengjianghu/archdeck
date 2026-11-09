/**
 * 项目健康度（Q10，H-1）：读源码清单、代码事实与基线，交给模型层 projectHealth 计数。项目列表每次刷新时调用；
 * 依赖提取按文件的修改时间缓存，重复调用只重解析变了的文件。
 */
import {
  assignFiles,
  gateIssues,
  governanceReport,
  loadModel,
  projectHealth,
  reviewCounts,
  type ModelIndex,
  type ProjectHealth,
  type RawFile,
} from '../src/model'
import { historyOptions, readSourceHistory } from './readHistory'
import { readSourceTree } from './readSource'
import { readCodeDeps } from './readDeps'
import { governanceDir, readBaseline } from './governanceStore'

export function readHealth(modelRoot: string, project: string, files: readonly RawFile[], root: string, env: NodeJS.ProcessEnv = process.env): ProjectHealth {
  // Z5：确认计数只读描述，读不到代码事实时也给
  const { index } = loadModel(files)
  const reviewed = reviewCounts(index)
  try {
    const tree = readSourceTree(modelRoot, project, root, env)
    if (!tree || tree.status !== 'local') return { note: tree?.reason ?? '项目不存在', reviewed }
    const own = assignFiles(index, tree.files, index.model.sourceIgnore)
    const report = governanceReport(index, own, tree, readCodeDeps(tree.root, tree.files, tree.packages), readBaseline(governanceDir(modelRoot, project)))
    // Q13：共用件的修改占比要 git 历史（按 HEAD 缓存）；读不到时只给行数占比
    const history = index.model.modules.some(m => m.role === 'shared' || m.role === 'bus')
      ? readSourceHistory(tree.root, tree.files, historyOptions(index.model.system))
      : null
    return projectHealth(index, own, report, tree.lines, history?.status === 'ok' ? history : null)
  } catch (e) {
    return { note: `代码事实读取失败：${e instanceof Error ? e.message : String(e)}`, reviewed }
  }
}

/**
 * DL-47 归档第二关（U8 棘轮）：当前版本的门禁错误（rule.new、cycle.grew）。读不到源码或代码事实时 errors 为 null 并给原因。
 */
export function readGateErrors(
  modelRoot: string,
  project: string,
  index: ModelIndex,
  root: string,
  env: NodeJS.ProcessEnv = process.env,
): { errors: { message: string }[] | null; note?: string } {
  try {
    const tree = readSourceTree(modelRoot, project, root, env)
    if (!tree || tree.status !== 'local') return { errors: null, note: `代码事实不可得：${tree?.reason ?? '项目不存在'}` }
    const own = assignFiles(index, tree.files, index.model.sourceIgnore)
    const report = governanceReport(index, own, tree, readCodeDeps(tree.root, tree.files, tree.packages), readBaseline(governanceDir(modelRoot, project)))
    return { errors: gateIssues(report).map(i => ({ message: i.message })) }
  } catch (e) {
    return { errors: null, note: `代码事实读取失败：${e instanceof Error ? e.message : String(e)}` }
  }
}
