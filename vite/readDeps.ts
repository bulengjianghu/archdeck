/**
 * 依赖提取（Node 侧，供 Vite 插件、命令行校验与 agent 接口共用，docs/architecture/governance.md §2）。
 * 只读懂导入语法、把说明符解析到清单中的文件，不判断归属与规则（在模型层）。
 *
 * K1：TypeScript 语法解析（不做类型检查），Vue 取 <script> 块；按修改时间与大小缓存；类型与值按每个导入的名字区分。
 * K2：相对路径补全扩展名；裸说明符按 tsconfig 的 paths 与工作区包名解析，其余为外部依赖。
 * K3：命名导入沿再导出链追到声明文件；目标 = 声明文件，经由 = 直接导入的文件。
 */
import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { joinPath, packageName, specResolver, type CodeDeps, type DepKind, type FileDep, type PackageEntry, type PathAlias } from '../src/model'
import { exportsResolver } from './readSource'

/** K1：参与提取的脚本文件 */
const SCRIPT = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|vue)$/i
const DECLARATION = /\.d\.(m|c)?ts$/i

/**
 * 一条导入语句的语法摘要；names 为空数组表示不按名称穿透（默认、命名空间、副作用、export *、动态导入）。
 * kind 为整条语句的种类（全部为类型时 type）；types 为写成只引类型的名字（`type X` 或整条 `import type`）。
 * heritage 为本文件类声明的 implements / extends 引用到的导入名；默认或命名空间导入被引用时为 `*`（K5 的 implements 证据，ADR-0022）。
 */
export interface ParsedImport {
  spec: string
  line: number
  kind: DepKind
  names: string[]
  types: string[]
  heritage?: string[]
  /** `export … from`：只把对方的名字转出去，不引用它的实现（不算值使用，K1、K7） */
  reexport?: true
  /** 值导入里没有在值的位置被引用的导入名（只在类型位置出现，或只转出）；不按名称穿透的导入为 ['*']（K1：不算值使用） */
  inert?: string[]
  /** 被引用、但从没被调用的导入名（不按名称穿透的导入为 '*'）：只作为成员读取的基（`X.a`、`X[k]`）记 member，其余（读变量、作为值交出）记 bare（K1：交互使用的判定） */
  reads?: { name: string; how: RefKind }[]
}

/**
 * K1：一个导入名在值位置的引用方式。invoke：调用、new、标签模板、类的 extends、成员调用（`X.a()` 的 X）、模板里渲染为组件或调用；
 * member：成员读取的基（`X.a`、`X[k]`，没有调用）；bare：其余值位置（读取、赋值、作为参数或属性值交出）。
 */
export type RefKind = 'invoke' | 'member' | 'bare'
const RANK: Record<RefKind, number> = { member: 0, bare: 1, invoke: 2 }
const stronger = (a: RefKind | undefined, b: RefKind): RefKind => (a && RANK[a] >= RANK[b] ? a : b)

/** 类声明 implements / extends 子句引用的标识符（取 `a.b.C` 最左边的 a） */
function heritageLocals(sf: ts.SourceFile): Set<string> {
  const out = new Set<string>()
  const leftmost = (e: ts.Expression): string | undefined =>
    ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) ? leftmost(e.expression) : undefined
  const visit = (n: ts.Node) => {
    if ((ts.isClassDeclaration(n) || ts.isClassExpression(n)) && n.heritageClauses)
      for (const h of n.heritageClauses)
        for (const t of h.types) {
          const id = leftmost(t.expression)
          if (id) out.add(id)
        }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return out
}

/** 名字是否在类型位置（类型节点、implements 子句、类型别名与接口声明里） */
function inTypePosition(n: ts.Node): boolean {
  for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
    if (p.kind >= ts.SyntaxKind.FirstTypeNode && p.kind <= ts.SyntaxKind.LastTypeNode) return true
    if (ts.isHeritageClause(p)) return p.token === ts.SyntaxKind.ImplementsKeyword
    if (ts.isTypeAliasDeclaration(p) || ts.isInterfaceDeclaration(p)) return true
    if (ts.isStatement(p) || ts.isSourceFile(p)) return false
  }
  return false
}

/** 标识符在值位置的引用方式（K1）：沿成员访问链上溯，链顶被调用为 invoke，链非空为 member，否则 bare；extends 子句为 invoke */
function refKind(n: ts.Identifier): RefKind {
  let top: ts.Node = n
  while (
    (ts.isPropertyAccessExpression(top.parent) || ts.isElementAccessExpression(top.parent) || ts.isNonNullExpression(top.parent)) &&
    top.parent.expression === top
  )
    top = top.parent
  const q = top.parent
  if (
    (ts.isCallExpression(q) && q.expression === top) ||
    (ts.isNewExpression(q) && q.expression === top) ||
    (ts.isTaggedTemplateExpression(q) && q.tag === top)
  )
    return 'invoke'
  if (ts.isExpressionWithTypeArguments(q) && ts.isHeritageClause(q.parent) && q.parent.token === ts.SyntaxKind.ExtendsKeyword) return 'invoke'
  if ((ts.isJsxOpeningElement(q) || ts.isJsxSelfClosingElement(q) || ts.isJsxClosingElement(q)) && q.tagName === top) return 'invoke'
  return top === n ? 'bare' : 'member'
}

/** K1：在值的位置被引用的标识符及最强的引用方式（不含导入声明、类型位置、属性名、本地再导出 export { x } 与 export default x、instanceof 右侧——只引类不调用） */
function valueRefs(sf: ts.SourceFile): Map<string, RefKind> {
  const out = new Map<string, RefKind>()
  const visit = (n: ts.Node) => {
    // 本地再导出 `export { x }`、`export default x` 只是转出，不是使用
    if (ts.isImportDeclaration(n) || ts.isExportSpecifier(n) || (ts.isExportAssignment(n) && ts.isIdentifier(n.expression))) return
    if (ts.isIdentifier(n)) {
      const p = n.parent
      const isName =
        (ts.isPropertyAccessExpression(p) && p.name === n) ||
        ((ts.isPropertyAssignment(p) || ts.isMethodDeclaration(p) || ts.isPropertyDeclaration(p) || ts.isPropertySignature(p)) && p.name === n) ||
        (ts.isQualifiedName(p) && p.right === n) ||
        (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword && p.right === n)
      if (!isName && !inTypePosition(n)) out.set(n.text, stronger(out.get(n.text), refKind(n)))
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return out
}

const parseCache = new Map<string, { mtimeMs: number; size: number; imports: ParsedImport[] }>()

function scriptKind(file: string): ts.ScriptKind {
  if (/x$/i.test(file)) return ts.ScriptKind.TSX
  if (/\.(m|c)?js$/i.test(file)) return ts.ScriptKind.JS
  return ts.ScriptKind.TS
}

/** K1：解析一段脚本的导入；lineOffset 为它在文件中的起始行（Vue 的 <script> 块）；extraRefs 为脚本之外引用到的名字及引用方式（Vue 模板） */
export function parseImports(
  file: string,
  text: string,
  kind = scriptKind(file),
  lineOffset = 0,
  extraRefs?: (name: string) => RefKind | undefined,
): ParsedImport[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind)
  const out: ParsedImport[] = []
  const refs = valueRefs(sf)
  const how = (local: string): RefKind | undefined => {
    const a = refs.get(local)
    const b = extraRefs?.(local)
    return a && b ? stronger(a, b) : (a ?? b)
  }
  const referenced = (local: string) => !!how(local)
  const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1 + lineOffset
  const inHeritage = heritageLocals(sf)
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
      const types = clause && !clause.name && named ? named.filter(e => typeOnly || e.isTypeOnly).map(e => (e.propertyName ?? e.name).text) : []
      const ns = clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings) ? clause.namedBindings.name.text : undefined
      const heritage = [
        ...(names.length ? named!.filter(e => inHeritage.has(e.name.text)).map(e => (e.propertyName ?? e.name).text) : []),
        ...((clause?.name && inHeritage.has(clause.name.text)) || (ns && inHeritage.has(ns)) ? ['*'] : []),
      ]
      // 只在类型位置出现、或只转出的值导入名不算引用了实现（K1）；副作用导入（没有导入子句）照常算
      const locals: [string, string][] = clause
        ? [
            ...(clause.name ? ([[clause.name.text, '*']] as [string, string][]) : []),
            ...(ns ? ([[ns, '*']] as [string, string][]) : []),
            ...(named ?? []).filter(e => !e.isTypeOnly).map(e => [e.name.text, (e.propertyName ?? e.name).text] as [string, string]),
          ]
        : []
      const inert =
        typeOnly || !clause ? [] : names.length ? locals.filter(([l]) => !referenced(l)).map(([, x]) => x) : locals.some(([l]) => referenced(l)) ? [] : ['*']
      // 被引用却从没被调用的名字（K1 的交互使用判定）；不按名称穿透时取各本地名中最强的引用方式
      const reads: { name: string; how: RefKind }[] = []
      if (!typeOnly && clause) {
        if (names.length) {
          for (const [l, x] of locals) {
            const h = how(l)
            if (h && h !== 'invoke') reads.push({ name: x, how: h })
          }
        } else {
          const hs = locals.map(([l]) => how(l)).filter((h): h is RefKind => !!h)
          const h = hs.reduce<RefKind | undefined>((a, b) => stronger(a, b), undefined)
          if (h && h !== 'invoke') reads.push({ name: '*', how: h })
        }
      }
      out.push({
        spec,
        line: lineOf(st),
        kind: typeOnly ? 'type' : 'value',
        names,
        types,
        ...(heritage.length ? { heritage } : {}),
        ...(inert.length ? { inert } : {}),
        ...(reads.length ? { reads } : {}),
      })
    } else if (ts.isExportDeclaration(st)) {
      const spec = literal(st.moduleSpecifier)
      if (!spec) continue
      const clause = st.exportClause
      const named = clause && ts.isNamedExports(clause) ? clause.elements : undefined
      const typeOnly = st.isTypeOnly || (!!named && named.length > 0 && named.every(e => e.isTypeOnly))
      const name = (e: ts.ExportSpecifier) => (e.propertyName ?? e.name).text
      out.push({
        spec,
        line: lineOf(st),
        kind: typeOnly ? 'type' : 'value',
        names: named?.map(name) ?? [],
        types: named?.filter(e => typeOnly || e.isTypeOnly).map(name) ?? [],
        reexport: true,
      })
    } else if (ts.isImportEqualsDeclaration(st) && ts.isExternalModuleReference(st.moduleReference)) {
      const spec = literal(st.moduleReference.expression)
      if (spec) out.push({ spec, line: lineOf(st), kind: st.isTypeOnly ? 'type' : 'value', names: [], types: [] })
    }
  }
  // 动态导入与 require：参数为字符串字面量
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && n.arguments.length >= 1) {
      const spec = literal(n.arguments[0])
      const isImport = n.expression.kind === ts.SyntaxKind.ImportKeyword
      const isRequire = ts.isIdentifier(n.expression) && n.expression.text === 'require'
      if (spec && (isImport || isRequire)) out.push({ spec, line: lineOf(n), kind: 'value', names: [], types: [] })
    } else if (ts.isImportTypeNode(n) && ts.isLiteralTypeNode(n.argument)) {
      const spec = literal(n.argument.literal)
      if (spec) out.push({ spec, line: lineOf(n), kind: 'type', names: [], types: [] })
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return out
}

/** K1：Vue 文件的 <script> 块 */
export function parseVueImports(file: string, text: string): ParsedImport[] {
  const out: ParsedImport[] = []
  // 模板里出现的名字（组件标签的 PascalCase 与 kebab-case、表达式里的标识符）都算值引用
  const template = /<template\b[^>]*>([\s\S]*)<\/template>/i.exec(text)?.[1] ?? ''
  const kebab = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
  // 组件标签与调用（含成员调用 X.a(…)）为 invoke；X.a / X[…] 为 member；其余出现为 bare
  const inTemplate = (name: string): RefKind | undefined => {
    const n = name.replace(/\$/g, '\\$')
    if (new RegExp(`<(${n}|${kebab(name)})[\\s/>]`).test(template) || new RegExp(`(^|[^\\w$.])${n}(\\s*\\??\\.\\s*[\\w$]+)*\\s*\\(`).test(template))
      return 'invoke'
    if (new RegExp(`(^|[^\\w$.])${n}\\s*(\\??\\.|\\[)`).test(template)) return 'member'
    return new RegExp(`\\b(${n}|${kebab(name)})\\b`).test(template) ? 'bare' : undefined
  }
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const attrs = m[1]
    const lang = /\blang\s*=\s*["']?(tsx|ts|jsx|js)/i.exec(attrs)?.[1]?.toLowerCase() ?? 'js'
    const kind = lang === 'tsx' ? ts.ScriptKind.TSX : lang === 'ts' ? ts.ScriptKind.TS : lang === 'jsx' ? ts.ScriptKind.JSX : ts.ScriptKind.JS
    const offset = text.slice(0, m.index + m[0].indexOf('>') + 1).split('\n').length - 1
    out.push(...parseImports(file, m[2], kind, offset, inTemplate))
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

// ── 说明符解析（K2）：解析规则在模型层（specResolver），这里只读 tsconfig ──

/** K2：清单中各 tsconfig*.json 的 compilerOptions.paths（不追 extends） */
export function readPathAliases(root: string, files: readonly string[]): PathAlias[] {
  const out: PathAlias[] = []
  for (const f of files) {
    if (!/(^|\/)tsconfig[^/]*\.json$/.test(f)) continue
    const cfg = ts.readConfigFile(path.join(root, f), p => fs.readFileSync(p, 'utf8'))
    const opts = cfg.config?.compilerOptions
    if (!opts?.paths) continue
    const dir = path.posix.dirname(f) === '.' ? '' : path.posix.dirname(f)
    const base = joinPath(dir, opts.baseUrl ?? '.')
    for (const [pattern, targets] of Object.entries(opts.paths as Record<string, string[]>)) {
      const star = pattern.indexOf('*')
      out.push({
        prefix: star < 0 ? pattern : pattern.slice(0, star),
        suffix: star < 0 ? '' : pattern.slice(star + 1),
        targets: targets.map(t => joinPath(base, t)),
      })
    }
  }
  return out
}

/** K2 的解析上下文：清单、包名 → 目录与入口、路径别名 */
export interface Resolver {
  resolve(from: string, spec: string): string | null
}

export function createResolver(root: string, files: readonly string[], packages: Record<string, PackageEntry>): Resolver {
  return { resolve: specResolver(files, packages, readPathAliases(root, files)) }
}

type ExportsOf = (file: string) => { name: string; kind?: string; from?: string; callable?: true; data?: true }[]

/** K3：一条导入的目标：命名导入按名称追到声明文件，其余为经由文件 */
export function importTargets(via: string, names: readonly string[], exportsOf: ExportsOf): string[] {
  return importTargetKinds({ kind: 'value', names, types: [] }, via, exportsOf).map(t => t.to)
}

/** 一条导入落到一个目标：种类，以及落到它的导入名与是否被类的 implements / extends 引用（K1，供 K5 的 implements 证据） */
export interface ImportTarget {
  to: string
  kind: DepKind
  names?: string[]
  heritage?: true
  /** 引用了实现：值导入的名字声明为函数、类或变量（不是类型、枚举），或不按名称穿透的值导入；再导出不算（K5 的 implements 证据分档、U11、U12 的值使用） */
  uses?: true
  /** 交互使用：引用了实现，且不只是纯值读取——被调用、new、extends、渲染，或把函数、类、组件作为值交出；只读常量、只读成员不算（K1，K7 的口径） */
  invokes?: true
}

/** K1：纯值读取——声明为纯数据常量；或从没被调用，且只作为成员读取的基，或声明不是函数、类、组件（常量、只读值）而被读取或交出 */
function pureRead(read: { how: RefKind } | undefined, sym: { kind?: string; callable?: true; data?: true } | undefined, whole: boolean): boolean {
  // 纯数据常量（字面量、数组、对象字面量、Symbol）：连 `X.map(…)` 这类成员调用也只是读它
  if (sym?.data) return true
  if (!read) return false
  if (read.how === 'member') return true
  // bare：交出函数、类、组件（运行时分派）算交互；不按名称穿透的默认 / 命名空间导入保守地算交互
  if (whole) return false
  return !!sym && !sym.callable && !['function', 'class', 'default', 'reexport', 'namespace'].includes(sym.kind ?? '')
}

/** 数据类型的声明：interface、type 别名、枚举——只引它们不算使用实现 */
const DATA_DECL = new Set(['interface', 'type', 'enum'])

/** 声明为类型的导出（K1）：interface 与 type 别名 */
const TYPE_DECL = new Set(['interface', 'type'])

/**
 * K1、K3：一条导入的目标与种类。命名导入按名称追到声明文件；一个名字是类型，当它写成只引类型或声明为 interface / type；
 * 一个目标只承接类型名时为 type，否则为 value。不按名称穿透的导入以经由文件为目标、取整条语句的种类。
 */
export function importTargetKinds(
  imp: {
    kind: DepKind
    names: readonly string[]
    types: readonly string[]
    heritage?: readonly string[]
    reexport?: true
    inert?: readonly string[]
    reads?: readonly { name: string; how: RefKind }[]
  },
  via: string,
  exportsOf: ExportsOf,
): ImportTarget[] {
  const readOf = (n: string) => imp.reads?.find(r => r.name === n)
  if (!imp.names.length) {
    const uses = imp.kind === 'value' && !imp.reexport && !imp.inert?.includes('*')
    return [
      {
        to: via,
        kind: imp.kind,
        ...(imp.heritage?.includes('*') ? { heritage: true as const } : {}),
        ...(uses ? { uses: true as const } : {}),
        ...(uses && !pureRead(readOf('*'), undefined, true) ? { invokes: true as const } : {}),
      },
    ]
  }
  const syms = exportsOf(via)
  const out = new Map<string, ImportTarget & { names: string[] }>()
  for (const n of imp.names) {
    const sym = syms.find(s => s.name === n)
    const to = sym?.from ?? via
    const kind: DepKind = imp.kind === 'type' || imp.types.includes(n) || TYPE_DECL.has(sym?.kind ?? '') ? 'type' : 'value'
    const hit = out.get(to) ?? { to, kind, names: [] }
    if (hit.kind !== 'value') hit.kind = kind
    hit.names.push(n)
    if (imp.heritage?.includes(n)) hit.heritage = true
    if (kind === 'value' && !imp.reexport && !imp.inert?.includes(n) && !DATA_DECL.has(sym?.kind ?? '')) {
      hit.uses = true
      if (!pureRead(readOf(n), sym, false)) hit.invokes = true
    }
    out.set(to, hit)
  }
  return [...out.values()]
}

/** K1–K3：全部文件依赖与外部依赖 */
export function readCodeDeps(root: string, files: readonly string[], packages: Record<string, PackageEntry>): CodeDeps {
  const resolver = createResolver(root, files, packages)
  const exportsOf = exportsResolver(root, files, resolver.resolve)
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
      for (const t of importTargetKinds(imp, via, exportsOf)) if (t.to !== from) deps.push({ from, line: imp.line, via, ...t })
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
  const resolver = createResolver(root, files, packages)
  const via = resolver.resolve(from, spec)
  if (!via) return []
  return importTargets(via, names, exportsResolver(root, files, resolver.resolve)).map(to => ({ to, via }))
}
