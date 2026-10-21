/**
 * 依赖提取（Node 侧，供 Vite 插件、命令行校验与 agent 接口共用，docs/architecture/governance.md §2）。
 * 只读懂导入语法、把说明符解析到清单中的文件，不判断归属与规则（在模型层）。
 *
 * K1：TypeScript 语法解析（不做类型检查），Vue 取 <script> 块；按修改时间与大小缓存。
 * K2：相对路径补全扩展名；裸说明符按 tsconfig 的 paths 与工作区包名解析，其余为外部依赖。
 * K3：命名导入沿再导出链追到声明文件；目标 = 声明文件，经由 = 直接导入的文件。
 */
import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import type { CodeDeps, DepKind, FileDep, PackageEntry } from '../src/model'
import { exportsResolver } from './readSource'

/** K1：参与提取的脚本文件 */
const SCRIPT = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|vue)$/i
const DECLARATION = /\.d\.(m|c)?ts$/i

/** 一条导入语句的语法摘要；names 为空数组表示不按名称穿透（默认、命名空间、副作用、export *、动态导入） */
export interface ParsedImport {
  spec: string
  line: number
  kind: DepKind
  names: string[]
}

const parseCache = new Map<string, { mtimeMs: number; size: number; imports: ParsedImport[] }>()

function scriptKind(file: string): ts.ScriptKind {
  if (/x$/i.test(file)) return ts.ScriptKind.TSX
  if (/\.(m|c)?js$/i.test(file)) return ts.ScriptKind.JS
  return ts.ScriptKind.TS
}

/** K1：解析一段脚本的导入；lineOffset 为它在文件中的起始行（Vue 的 <script> 块） */
export function parseImports(file: string, text: string, kind = scriptKind(file), lineOffset = 0): ParsedImport[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind)
  const out: ParsedImport[] = []
  const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1 + lineOffset
  const literal = (n: ts.Node | undefined) => (n && ts.isStringLiteralLike(n) ? n.text : undefined)
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st)) {
      const spec = literal(st.moduleSpecifier)
      if (!spec) continue
      const clause = st.importClause
      const named = clause?.namedBindings && ts.isNamedImports(clause.namedBindings) ? clause.namedBindings.elements : undefined
      const typeOnly = !!clause && (clause.isTypeOnly || (!clause.name && !!named && named.length > 0 && named.every(e => e.isTypeOnly)))
      // 只有命名导入时按名称穿透；带默认或命名空间导入时以经由文件为目标
      const names = clause && !clause.name && named ? named.map(e => (e.propertyName ?? e.name).text) : []
      out.push({ spec, line: lineOf(st), kind: typeOnly ? 'type' : 'value', names })
    } else if (ts.isExportDeclaration(st)) {
      const spec = literal(st.moduleSpecifier)
      if (!spec) continue
      const clause = st.exportClause
      const named = clause && ts.isNamedExports(clause) ? clause.elements : undefined
      const typeOnly = st.isTypeOnly || (!!named && named.length > 0 && named.every(e => e.isTypeOnly))
      out.push({ spec, line: lineOf(st), kind: typeOnly ? 'type' : 'value', names: named ? named.map(e => (e.propertyName ?? e.name).text) : [] })
    } else if (ts.isImportEqualsDeclaration(st) && ts.isExternalModuleReference(st.moduleReference)) {
      const spec = literal(st.moduleReference.expression)
      if (spec) out.push({ spec, line: lineOf(st), kind: st.isTypeOnly ? 'type' : 'value', names: [] })
    }
  }
  // 动态导入与 require：参数为字符串字面量
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && n.arguments.length >= 1) {
      const spec = literal(n.arguments[0])
      const isImport = n.expression.kind === ts.SyntaxKind.ImportKeyword
      const isRequire = ts.isIdentifier(n.expression) && n.expression.text === 'require'
      if (spec && (isImport || isRequire)) out.push({ spec, line: lineOf(n), kind: 'value', names: [] })
    } else if (ts.isImportTypeNode(n) && ts.isLiteralTypeNode(n.argument)) {
      const spec = literal(n.argument.literal)
      if (spec) out.push({ spec, line: lineOf(n), kind: 'type', names: [] })
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return out
}

/** K1：Vue 文件的 <script> 块 */
export function parseVueImports(file: string, text: string): ParsedImport[] {
  const out: ParsedImport[] = []
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const attrs = m[1]
    const lang = /\blang\s*=\s*["']?(tsx|ts|jsx|js)/i.exec(attrs)?.[1]?.toLowerCase() ?? 'js'
    const kind = lang === 'tsx' ? ts.ScriptKind.TSX : lang === 'ts' ? ts.ScriptKind.TS : lang === 'jsx' ? ts.ScriptKind.JSX : ts.ScriptKind.JS
    const offset = text.slice(0, m.index + m[0].indexOf('>') + 1).split('\n').length - 1
    out.push(...parseImports(file, m[2], kind, offset))
  }
  return out
}

/** K1：读一个文件的导入，按修改时间与大小缓存 */
function importsOf(root: string, rel: string): ParsedImport[] {
  const abs = path.join(root, rel)
  try {
    const st = fs.statSync(abs)
    const hit = parseCache.get(abs)
    if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.imports
    const text = fs.readFileSync(abs, 'utf8')
    const imports = /\.vue$/i.test(rel) ? parseVueImports(rel, text) : parseImports(rel, text)
    parseCache.set(abs, { mtimeMs: st.mtimeMs, size: st.size, imports })
    return imports
  } catch {
    return []
  }
}

// ── 说明符解析（K2）──

const EXTS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.d.ts']

const normalize = (p: string) => path.posix.normalize(p).replace(/^\.\//, '').replace(/\/$/, '')

/** 一个路径（不含扩展名或带 .js 写法）补全到清单中的文件 */
function complete(base: string, files: ReadonlySet<string>): string | null {
  const b = normalize(base)
  if (files.has(b)) return b
  const stem = b.replace(/\.(m|c)?js$/, '')
  for (const e of EXTS) if (files.has(stem + e)) return stem + e
  for (const e of EXTS) if (files.has(`${b}/index${e}`)) return `${b}/index${e}`
  return null
}

/** tsconfig 的 paths：模式前缀 → 目标模板（相对源码根目录，含 *） */
export type PathAlias = { prefix: string; suffix: string; targets: string[] }

/** K2：清单中各 tsconfig*.json 的 compilerOptions.paths（不追 extends） */
export function readPathAliases(root: string, files: readonly string[]): PathAlias[] {
  const out: PathAlias[] = []
  for (const f of files) {
    if (!/(^|\/)tsconfig[^/]*\.json$/.test(f)) continue
    const cfg = ts.readConfigFile(path.join(root, f), p => fs.readFileSync(p, 'utf8'))
    const opts = cfg.config?.compilerOptions
    if (!opts?.paths) continue
    const dir = path.posix.dirname(f) === '.' ? '' : path.posix.dirname(f)
    const base = normalize(path.posix.join(dir, opts.baseUrl ?? '.'))
    for (const [pattern, targets] of Object.entries(opts.paths as Record<string, string[]>)) {
      const star = pattern.indexOf('*')
      out.push({
        prefix: star < 0 ? pattern : pattern.slice(0, star),
        suffix: star < 0 ? '' : pattern.slice(star + 1),
        targets: targets.map(t => normalize(path.posix.join(base, t))),
      })
    }
  }
  return out
}

/** 包入口：exports['.'] → main → types；指向不在清单中的产物时换成 src/….ts，再退回 src/index、index */
function packageEntry(dir: string, pkg: PackageEntry, files: ReadonlySet<string>): string | null {
  const pick = (x: unknown): string | undefined => {
    if (typeof x === 'string') return x
    if (x && typeof x === 'object') {
      const o = x as Record<string, unknown>
      for (const k of ['.', 'import', 'default', 'types', 'require']) {
        const v = pick(o[k])
        if (v) return v
      }
    }
    return undefined
  }
  const candidates = [pick(pkg.exports), pkg.main, pkg.types].filter((c): c is string => !!c)
  for (const c of candidates) {
    const p = path.posix.join(dir, c)
    const hit = complete(p, files) ?? complete(p.replace(/(^|\/)dist\//, '$1src/').replace(/\.d\.ts$|\.(m|c)?js$/, ''), files)
    if (hit) return hit
  }
  return complete(path.posix.join(dir, 'src/index'), files) ?? complete(path.posix.join(dir, 'index'), files)
}

/** K2 的解析上下文：清单、包名 → 目录与入口、路径别名 */
export interface Resolver {
  resolve(from: string, spec: string): string | null
}

export function createResolver(root: string, files: readonly string[], packages: Record<string, PackageEntry>): Resolver {
  const set = new Set(files)
  const aliases = readPathAliases(root, files)
  const byName = new Map<string, string>()
  for (const [dir, pkg] of Object.entries(packages)) if (pkg.name && !byName.has(pkg.name)) byName.set(pkg.name, dir)
  const entries = new Map<string, string | null>()
  return {
    resolve(from, spec) {
      if (spec.startsWith('.') || spec.startsWith('/')) return complete(path.posix.join(path.posix.dirname(from), spec), set)
      for (const a of aliases) {
        if (!spec.startsWith(a.prefix) || !spec.endsWith(a.suffix)) continue
        const mid = spec.slice(a.prefix.length, spec.length - a.suffix.length)
        for (const t of a.targets) {
          const hit = complete(t.replace('*', mid), set)
          if (hit) return hit
        }
      }
      const parts = spec.split('/')
      const name = spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
      const dir = byName.get(name)
      if (dir === undefined) return null
      const sub = spec.slice(name.length + 1)
      if (sub) return complete(path.posix.join(dir, sub), set)
      if (!entries.has(name)) entries.set(name, packageEntry(dir, packages[dir], set))
      return entries.get(name)!
    },
  }
}

/** 外部依赖的包名 */
const packageName = (spec: string) => {
  const parts = spec.split('/')
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

/** K3：一条导入的目标：命名导入按名称追到声明文件，其余为经由文件 */
export function importTargets(via: string, names: readonly string[], exportsOf: (file: string) => { name: string; from?: string }[]): string[] {
  if (!names.length) return [via]
  const syms = exportsOf(via)
  const out = new Set<string>()
  for (const n of names) out.add(syms.find(s => s.name === n)?.from ?? via)
  return [...out]
}

/** K1–K3：全部文件依赖与外部依赖 */
export function readCodeDeps(root: string, files: readonly string[], packages: Record<string, PackageEntry>): CodeDeps {
  const resolver = createResolver(root, files, packages)
  const exportsOf = exportsResolver(root, files)
  const deps: FileDep[] = []
  const external: Record<string, number> = {}
  let parsed = 0
  for (const from of files) {
    if (!SCRIPT.test(from) || DECLARATION.test(from)) continue
    parsed++
    for (const imp of importsOf(root, from)) {
      const via = resolver.resolve(from, imp.spec)
      if (!via) {
        const key = imp.spec.startsWith('.') ? '(未解析的相对路径)' : packageName(imp.spec)
        external[key] = (external[key] ?? 0) + 1
        continue
      }
      for (const to of importTargets(via, imp.names, exportsOf)) if (to !== from) deps.push({ from, to, via, kind: imp.kind, line: imp.line })
    }
  }
  return { deps, external, parsed }
}

/** Q2：从某个文件出发的一个说明符的目标（写前判定用）；解析不到为空数组 */
export function resolveImport(
  root: string,
  files: readonly string[],
  packages: Record<string, PackageEntry>,
  from: string,
  spec: string,
  names: readonly string[] = [],
) {
  const via = createResolver(root, files, packages).resolve(from, spec)
  if (!via) return []
  return importTargets(via, names, exportsResolver(root, files)).map(to => ({ to, via }))
}
