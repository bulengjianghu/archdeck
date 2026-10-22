/**
 * 源码归属（G3–G12、G14）：文件属于哪个模块、模块的文件与入口、入口导出与 provides 的对应、文件在当前层次的投影；场景证据文件是否存在（S15）。
 * 关于被描述系统的知识，换成命令行或 AI 查询同样成立；输入是模型索引与接入层给的文件清单，不碰文件系统。
 */
import { isLong } from '../names'
import { mapEndpoint } from '../project'
import type { Issue, LevelView, ModelIndex, ModuleEntity, ScenarioEntity } from '../types'
import { hasWildcard, matchRef, normalizeRef, staticPrefix } from './glob'
import { indexFile, packageEntry } from './resolve'
import { DEFAULT_MAX_LINES, type DirNode, type ExportMatch, type ExportedSymbol, type FileNodes, type LocalSource, type ModuleEntry, type SourceOwnership } from './types'

/** G3、G5–G8：按 codeRefs 归属每个文件 */
export function assignFiles(index: ModelIndex, files: readonly string[], ignore: readonly string[]): SourceOwnership {
  const withRefs = index.model.modules.filter(m => m.codeRefs?.length)
  const owners = new Map<string, string[]>()
  const direct = new Map<string, string[]>()
  const unowned: string[] = []
  const ignored = new Set<string>()
  const conflicts: string[] = []
  for (const file of files) {
    const hits = withRefs.filter(m => m.codeRefs!.some(r => matchRef(r, file))).map(m => m.id)
    // G5：祖先与后代同时匹配时只留最深的
    const deepest = hits.filter(id => !hits.some(other => other !== id && (index.pathOf.get(other) ?? []).includes(id)))
    if (deepest.length === 0) {
      if (ignore.some(r => matchRef(r, file))) ignored.add(file)
      else unowned.push(file)
      continue
    }
    owners.set(file, deepest)
    if (deepest.length > 1) conflicts.push(file)
    for (const id of deepest) {
      const list = direct.get(id)
      if (list) list.push(file)
      else direct.set(id, [file])
    }
  }
  return { owners, direct, unowned, ignored, conflicts }
}

/** G4：模块的文件 = 子树内全部归属文件的并集；系统根取全部已归属文件 */
export function moduleFiles(index: ModelIndex, own: SourceOwnership, moduleId: string): string[] {
  if (moduleId === index.rootId) return [...own.owners.keys()].sort()
  const out = new Set<string>()
  for (const [id, list] of own.direct) if (index.pathOf.get(id)?.includes(moduleId)) for (const f of list) out.add(f)
  return [...out].sort()
}

/** 文件是否属于模块子树 */
const inSubtree = (index: ModelIndex, own: SourceOwnership, file: string, moduleId: string) =>
  (own.owners.get(file) ?? []).some(o => index.pathOf.get(o)?.includes(moduleId))

/** G10：模块目录 = 各条 codeRefs 的目录（glob 取通配符前的部分；恰为文件时取所在目录）的公共目录；没有 codeRefs 时为 null */
export function moduleDir(module: Pick<ModuleEntity, 'codeRefs'>, files: ReadonlySet<string>): string | null {
  const refs = (module.codeRefs ?? []).map(normalizeRef).filter(Boolean)
  if (!refs.length) return null
  const dirs = refs.map(r => {
    if (hasWildcard(r)) return staticPrefix(r)
    return files.has(r) ? r.split('/').slice(0, -1).join('/') : r
  })
  const segs = dirs.map(d => (d ? d.split('/') : []))
  const common: string[] = []
  for (let i = 0; segs.every(s => i < s.length && s[i] === segs[0][i]); i++) common.push(segs[0][i])
  return common.join('/')
}

/**
 * G10：入口文件——描述的 entry；否则模块目录下有 package.json 时取包入口（K2，与依赖提取解析包名得到的文件相同），
 * 没有时取模块目录下的 index.*（K2 的补全）；按约定找到的须属于本模块子树
 */
export function moduleEntry(index: ModelIndex, own: SourceOwnership, tree: Pick<LocalSource, 'files' | 'packages'>, moduleId: string): ModuleEntry | null {
  const m = index.modules.get(moduleId)
  if (!m) return null
  const files = new Set(tree.files)
  if (m.entry) {
    const file = normalizeRef(m.entry)
    return files.has(file) ? { file, via: 'entry' } : { file, via: 'entry', missing: true }
  }
  const dir = moduleDir(m, files)
  if (dir === null) return null
  const pkg = tree.packages[dir]
  const file = pkg ? packageEntry(dir, pkg, files) : indexFile(dir, files)
  return file && inSubtree(index, own, file, moduleId) ? { file, via: pkg ? 'package' : 'index' } : null
}

/** 接口名去掉括号与泛型，与导出名比较（G12） */
const bareName = (name: string) => name.replace(/[(<].*$/s, '').trim()

/** G12：模块的接口 = provides，加上 owner 为本模块或其子孙的接口 */
export function moduleInterfaces(index: ModelIndex, moduleId: string): string[] {
  const out = new Set(index.modules.get(moduleId)?.provides ?? [])
  for (const x of index.interfaces.values()) if (x.owner && index.pathOf.get(x.owner)?.includes(moduleId)) out.add(x.id)
  return [...out]
}

/** G12：入口导出与模块的接口按名称对应；默认导出不参与 */
export function matchExports(index: ModelIndex, moduleId: string, exports: readonly ExportedSymbol[]): ExportMatch {
  const provides = moduleInterfaces(index, moduleId)
  const byName = new Map<string, string>()
  for (const id of provides) {
    const x = index.interfaces.get(id)
    if (x && !byName.has(bareName(x.name))) byName.set(bareName(x.name), id)
  }
  const matched: ExportMatch['matched'] = []
  const undescribed: ExportedSymbol[] = []
  const used = new Set<string>()
  for (const s of exports) {
    const id = s.name === 'default' ? undefined : byName.get(s.name)
    if (id && !used.has(id)) {
      matched.push({ interfaceId: id, symbol: s })
      used.add(id)
    } else if (s.name !== 'default') undescribed.push(s)
  }
  return { matched, undescribed, unexported: provides.filter(id => !used.has(id)) }
}

/** G14：归属模块按 mapEndpoint 投影到当前层次；分层总览另加路径上的核心模块 */
export function fileNodes(index: ModelIndex, view: LevelView, owners: readonly string[]): FileNodes {
  const present = new Set(view.nodes.map(n => n.id))
  const nodes = new Set<string>()
  let self = false
  for (const o of owners) {
    const e = mapEndpoint(index, view.parentId, o)
    if (e.kind === 'local' && present.has(e.node)) nodes.add(e.node)
    else if (e.kind === 'external' && present.has(`boundary:${e.node}`)) nodes.add(`boundary:${e.node}`)
    else if (e.kind === 'skip' && index.pathOf.get(view.parentId)?.includes(o)) self = true
    if (view.mode === 'layered') {
      const path = index.pathOf.get(o) ?? []
      for (const n of view.nodes) if (n.role === 'core' && path.includes(n.moduleId)) nodes.add(n.id)
    }
  }
  return { nodes, self }
}

/** S15：场景声明的证据文件中不在源码清单里的（只校验存在，不解析内容） */
export function missingEvidence(index: ModelIndex, files: readonly string[]): { scenario: ScenarioEntity; file: string }[] {
  const set = new Set(files)
  return index.model.scenarios.flatMap(scenario => (scenario.evidence ?? []).filter(file => !set.has(file)).map(file => ({ scenario, file })))
}

/** G6、G7、G10、S15：归属警告与证据文件警告（只对当前版本报，G9 由调用方决定） */
export function sourceIssues(index: ModelIndex, own: SourceOwnership, tree: Pick<LocalSource, 'files' | 'packages'>): Issue[] {
  const issues: Issue[] = []
  const name = (id: string) => index.modules.get(id)?.name ?? id
  for (const f of own.conflicts) {
    const ids = own.owners.get(f)!
    issues.push({
      severity: 'warning',
      code: 'source.conflict',
      message: `源码文件「${f}」同时归属互不包含的模块：${ids.map(name).join('、')}`,
      ...index.modules.get(ids[0])?.src,
    })
  }
  for (const f of own.unowned) issues.push({ severity: 'warning', code: 'source.unowned', message: `源码文件「${f}」没有归属任何模块，也不在忽略清单中` })
  for (const m of index.model.modules) {
    if (!m.entry) continue
    const e = moduleEntry(index, own, tree, m.id)
    if (e?.missing) issues.push({ severity: 'warning', code: 'source.entry', message: `模块「${m.name}」的 entry「${e.file}」不在源码文件清单中`, ...m.src })
  }
  for (const { scenario, file } of missingEvidence(index, tree.files)) {
    issues.push({ severity: 'warning', code: 'scenario.evidence', message: `场景「${scenario.name}」的证据文件「${file}」不在源码文件清单中`, ...scenario.src })
  }
  return issues
}

/** 目录树：目录在前、按名称排序；目录带文件数与未归属数；G18：子树内文件全部忽略的目录也是忽略状态 */
/** G21：一组文件（如模块的文件）的行数合计、超长文件数与统计了行数的文件数 */
export function moduleLines(files: readonly string[], lines: Readonly<Record<string, number>>, maxLines: number): { lines: number; long: number; counted: number } {
  let total = 0
  let long = 0
  let counted = 0
  for (const f of files) {
    const n = lines[f]
    if (n === undefined) continue
    counted++
    total += n
    if (isLong(n, maxLines)) long++
  }
  return { lines: total, long, counted }
}

/** G18、G21：目录树，目录带文件数、未归属数、忽略状态，给出行数时另带行数合计与超长文件数 */
export function fileTree(files: readonly string[], own: SourceOwnership, lines: Readonly<Record<string, number>> = {}, maxLines = DEFAULT_MAX_LINES): DirNode {
  const root: DirNode = { name: '', path: '', dirs: [], files: [], count: 0, unowned: 0, ignored: false, lines: 0, long: 0 }
  const ignoredCount = new Map<DirNode, number>()
  const unowned = new Set(own.unowned)
  const dirOf = new Map<string, DirNode>([['', root]])
  const ensure = (path: string): DirNode => {
    let d = dirOf.get(path)
    if (d) return d
    const cut = path.lastIndexOf('/')
    const parent = ensure(cut < 0 ? '' : path.slice(0, cut))
    d = { name: path.slice(cut + 1), path, dirs: [], files: [], count: 0, unowned: 0, ignored: false, lines: 0, long: 0 }
    parent.dirs.push(d)
    dirOf.set(path, d)
    return d
  }
  for (const f of files) {
    const cut = f.lastIndexOf('/')
    const dir = cut < 0 ? '' : f.slice(0, cut)
    ensure(dir).files.push(f)
    const bad = unowned.has(f) ? 1 : 0
    const skip = own.ignored.has(f) ? 1 : 0
    const n = lines[f] ?? 0
    const long = isLong(lines[f], maxLines) ? 1 : 0
    for (let p: string | null = dir; p !== null; p = p === '' ? null : p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '') {
      const d = dirOf.get(p)!
      d.count++
      d.unowned += bad
      d.lines += n
      d.long += long
      ignoredCount.set(d, (ignoredCount.get(d) ?? 0) + skip)
    }
  }
  const sort = (d: DirNode) => {
    d.dirs.sort((a, b) => a.name.localeCompare(b.name))
    d.files.sort((a, b) => a.localeCompare(b))
    d.dirs.forEach(sort)
  }
  sort(root)
  for (const d of dirOf.values()) d.ignored = d.count > 0 && ignoredCount.get(d) === d.count
  return root
}
