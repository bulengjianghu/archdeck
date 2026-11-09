/**
 * 决策链接（E9，ADR-0028 已知缺口的第一步）：模块的 `adrs`（整数编号）对到源码根目录下的 ADR 文件（`<adrDir>/<四位编号>-*.md`，
 * adrDir 缺省 docs/adr，`system.source.adrDir` 可改）；标题取文件第一行 `# ` 之后的文字（接入层 readAdrTitles 读出、随源码清单给出）。
 * 不继承：模块只列自己写的，祖先的另计条数。纯函数，输入是模型索引、文件清单与标题表。
 */
import type { Issue, ModelIndex, SystemDef } from '../types'

export const DEFAULT_ADR_DIR = 'docs/adr'

/** 一条相关决策：编号、显示名（ADR-0025）、文件（不在源码清单里为 null）与标题 */
export interface AdrLink {
  n: number
  label: string
  file: string | null
  title?: string
}

/** ADR 文件所在目录（相对源码根目录，不带首尾斜杠） */
export const adrDir = (system: Pick<SystemDef, 'source'>): string => (system.source?.adrDir ?? DEFAULT_ADR_DIR).replace(/^\.?\/+|\/+$/g, '')

export const adrLabel = (n: number): string => `ADR-${String(n).padStart(4, '0')}`

/** 编号对应的 ADR 文件：目录下 `<四位编号>-*.md`（或正好 `<四位编号>.md`）；没有为 null */
export function adrFile(files: readonly string[], dir: string, n: number): string | null {
  const head = `${dir ? `${dir}/` : ''}${String(n).padStart(4, '0')}`
  return files.find(f => (f.startsWith(`${head}-`) || f === `${head}.md`) && f.endsWith('.md') && !f.slice(head.length).includes('/')) ?? null
}

/** E9：模块自己写的相关决策（按写的顺序，去重） */
export function moduleAdrs(index: ModelIndex, moduleId: string, files: readonly string[], titles: Readonly<Record<string, string>> = {}): AdrLink[] {
  const dir = adrDir(index.model.system)
  const ns = [...new Set(index.modules.get(moduleId)?.adrs ?? [])]
  return ns.map(n => {
    const file = adrFile(files, dir, n)
    return { n, label: adrLabel(n), file, ...(file && titles[file] ? { title: titles[file] } : {}) }
  })
}

/** E9：不继承——祖先（不含系统根）写的决策条数，面板折叠成一行 */
export function ancestorAdrs(index: ModelIndex, moduleId: string): { id: string; n: number }[] {
  const path = (index.pathOf.get(moduleId) ?? []).slice(0, -1).filter(id => id !== index.rootId)
  return path.flatMap(id => [...new Set(index.modules.get(id)?.adrs ?? [])].map(n => ({ id, n })))
}

/** E9：写了但源码根目录下找不到文件的决策——提醒 module.adr-missing（与归属警告同在源码归属阶段，只对当前版本，G9） */
export function adrIssues(index: ModelIndex, files: readonly string[]): Issue[] {
  const dir = adrDir(index.model.system)
  const issues: Issue[] = []
  for (const m of index.model.modules)
    for (const n of new Set(m.adrs ?? []))
      if (!adrFile(files, dir, n))
        issues.push({ severity: 'warning', code: 'module.adr-missing', message: `模块「${m.name}」的相关决策 ${adrLabel(n)} 在「${dir}/」下找不到文件`, ...m.src })
  return issues
}
