/**
 * 项目健康度（Q10，H-1）：读源码清单、代码事实与基线，交给模型层 projectHealth 计数。项目列表每次刷新时调用；
 * 依赖提取按文件的修改时间缓存，重复调用只重解析变了的文件。
 */
import { assignFiles, governanceReport, loadModel, projectHealth, reviewCounts, type ProjectHealth, type RawFile } from '../src/model'
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
    return projectHealth(index, own, report)
  } catch (e) {
    return { note: `代码事实读取失败：${e instanceof Error ? e.message : String(e)}`, reviewed }
  }
}
