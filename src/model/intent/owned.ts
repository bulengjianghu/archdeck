/**
 * 指纹门禁的比对（X6）：人拥有的文件（isOwnedFile）的内容指纹记在 governance/owned.json，由命令行登记、写入端点更新；
 * 这里只做比对——指纹怎么算、文件怎么读是接入层的事（治理存储）。
 */
import type { Issue } from '../types'
import { isOwnedFile, type OwnedRecord } from './types'

/**
 * 比对：已登记的文件内容不符或已不存在 → error owned.changed；人拥有的文件未登记 → warning owned.unregistered；
 * 没有记录 → warning owned.none。hashes 为项目下人拥有文件的当前指纹（路径 → 指纹）。
 */
export function compareOwned(record: OwnedRecord | null, hashes: Readonly<Record<string, string>>): Issue[] {
  const owned = Object.keys(hashes).filter(isOwnedFile).sort()
  if (!record) {
    return owned.length
      ? [{ severity: 'warning', code: 'owned.none', message: `人拥有的文件（${owned.join('、')}）还没有登记指纹：人确认内容后运行 npm run arch -- own（X6）` }]
      : []
  }
  const issues: Issue[] = []
  for (const [file, hash] of Object.entries(record.files).sort(([a], [b]) => a.localeCompare(b))) {
    const now = hashes[file]
    if (now === undefined)
      issues.push({ severity: 'error', code: 'owned.changed', message: `人拥有的文件「${file}」已登记指纹但现在不存在：恢复它，或由人确认后运行 npm run arch -- own（X6）`, file })
    else if (now !== hash)
      issues.push({
        severity: 'error',
        code: 'owned.changed',
        message: `人拥有的文件「${file}」在登记指纹后被改动（多半是 AI 重新生成时碰了它）：由人核对后恢复，或确认改动后运行 npm run arch -- own（X6）`,
        file,
      })
  }
  for (const file of owned)
    if (!(file in record.files)) issues.push({ severity: 'warning', code: 'owned.unregistered', message: `人拥有的文件「${file}」还没有登记指纹：人确认内容后运行 npm run arch -- own（X6）`, file })
  return issues
}
