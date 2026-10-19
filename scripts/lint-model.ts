/**
 * 命令行校验架构描述：npm run lint:model [-- <模型目录>]
 * 有 error 时退出码为 1；只有 warning 时为 0。
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadModel, type Issue } from '../src/model'
import { readModelDir, resolveModelDir } from '../vite/readModelDir'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const arg = process.argv.slice(2).find(a => a !== '--')
const dir = arg ? path.resolve(process.cwd(), arg) : resolveModelDir(root)
const payload = readModelDir(dir, root)

if (payload.files.length === 0) {
  console.error(`模型目录中没有 YAML 文件：${dir}`)
  process.exit(1)
}

const { index, issues } = loadModel(payload.files)
const fmt = (i: Issue) => {
  const where = i.file ? `${payload.dir}/${i.file}${i.line ? `:${i.line}` : ''}` : '(全局)'
  return `  ${i.severity === 'error' ? 'error  ' : 'warning'} ${where}  ${i.message}  [${i.code}]`
}
const errors = issues.filter(i => i.severity === 'error')
const warnings = issues.filter(i => i.severity === 'warning')
for (const i of [...errors, ...warnings]) console.log(fmt(i))

const layers = (index.childrenOf.get(index.rootId) ?? []).length
console.log(
  `\n${payload.dir}：${payload.files.length} 个文件，${index.modules.size} 个模块（根下 ${layers} 个），` +
    `${index.relations.size} 条关系，${index.interfaces.size} 个接口，${index.dataStructures.size} 个数据结构；` +
    `${errors.length} 个错误，${warnings.length} 个提醒`,
)
process.exit(errors.length > 0 ? 1 : 0)
