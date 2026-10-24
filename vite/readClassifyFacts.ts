/**
 * 分类用的源码事实（Node 侧，ADR-0029 §5，供 `arch classify`）：只做 TypeScript 语法解析，不做类型检查。
 * - 调用点：依赖方文件里对导入名（及经它取得的成员）的调用，结果是否被 await / 赋值使用；
 * - 签名：目标文件顶层声明（函数、箭头函数常量、类与方法）的返回形态——写了返回类型按类型，没写按函数体有没有 `return <值>`；
 * - 状态持有：模块级响应式状态或可变变量、有实例字段的类、写文件或发网络请求。
 * 只读文件，不判断归属（在模型层）。
 */
import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import {
  returnShapeOf,
  type CallSiteFact,
  type ClassifyCode,
  type DeclFact,
  type FileDep,
  type FileStateFact,
  type PackageEntry,
  type ReturnShape,
} from '../src/model'
import { createResolver } from './readDeps'

const SCRIPT = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|vue)$/i

interface Script {
  sf: ts.SourceFile
  lineOffset: number
}

interface Parsed {
  scripts: Script[]
  /** Vue 模板文本 */
  template: string
  text: string
}

const cache = new Map<string, Parsed | null>()

function kindOf(file: string, lang?: string): ts.ScriptKind {
  const l = lang ?? file.split('.').pop()!.toLowerCase()
  if (l === 'tsx') return ts.ScriptKind.TSX
  if (l === 'jsx') return ts.ScriptKind.JSX
  if (/^(m|c)?js$/.test(l)) return ts.ScriptKind.JS
  return ts.ScriptKind.TS
}

function parse(root: string, rel: string): Parsed | null {
  if (cache.has(rel)) return cache.get(rel)!
  let out: Parsed | null = null
  try {
    const text = fs.readFileSync(path.join(root, rel), 'utf8')
    if (/\.vue$/i.test(rel)) {
      const scripts: Script[] = []
      const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi
      for (let m = re.exec(text); m; m = re.exec(text)) {
        const lang = /\blang\s*=\s*["']?(tsx|ts|jsx|js)/i.exec(m[1])?.[1]?.toLowerCase() ?? 'js'
        const lineOffset = text.slice(0, m.index + m[0].indexOf('>') + 1).split('\n').length - 1
        scripts.push({ sf: ts.createSourceFile(rel, m[2], ts.ScriptTarget.Latest, true, kindOf(rel, lang)), lineOffset })
      }
      out = { scripts, template: /<template\b[^>]*>([\s\S]*)<\/template>/i.exec(text)?.[1] ?? '', text }
    } else out = { scripts: [{ sf: ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, kindOf(rel)), lineOffset: 0 }], template: '', text }
  } catch {
    out = null
  }
  cache.set(rel, out)
  return out
}

const lineOf = (s: Script, n: ts.Node) => s.sf.getLineAndCharacterOfPosition(n.getStart(s.sf)).line + 1 + s.lineOffset

// ── 签名 ──

type FnLike = ts.FunctionDeclaration | ts.MethodDeclaration | ts.ArrowFunction | ts.FunctionExpression

/** 函数体里（不进内层函数）有没有 `return <值>` */
function returnsValue(body: ts.Node): boolean {
  let hit = false
  const visit = (n: ts.Node) => {
    if (hit) return
    if (ts.isFunctionLike(n) && n !== body) return
    if (ts.isReturnStatement(n) && n.expression) {
      hit = true
      return
    }
    ts.forEachChild(n, visit)
  }
  ts.forEachChild(body, visit)
  return hit
}

function shapeOf(fn: FnLike, sf: ts.SourceFile): ReturnShape {
  if (fn.type) return returnShapeOf(fn.type.getText(sf))
  const isAsync = !!fn.modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword)
  if (!fn.body) return 'unknown'
  if (fn.asteriskToken) return 'value'
  if (!ts.isBlock(fn.body)) {
    const b = fn.body
    if (ts.isVoidExpression(b)) return isAsync ? 'promise-void' : 'void'
    if (ts.isCallExpression(b) || ts.isAwaitExpression(b) || (ts.isBinaryExpression(b) && b.operatorToken.kind === ts.SyntaxKind.EqualsToken)) return 'unknown'
    return isAsync ? 'promise-value' : 'value'
  }
  const v = returnsValue(fn.body)
  return isAsync ? (v ? 'promise-value' : 'promise-void') : v ? 'value' : 'void'
}

const sigText = (n: ts.Node, sf: ts.SourceFile) => {
  const t = n.getText(sf)
  const head = t
    .slice(0, Math.max(0, t.indexOf('{') > 0 ? t.indexOf('{') : t.length))
    .replace(/\s+/g, ' ')
    .trim()
  return head.length > 90 ? `${head.slice(0, 90)}…` : head
}

/** 文件顶层声明的签名事实：名字 → 事实；类的方法为 `类名.方法名`；默认导出为 default */
function declsOf(p: Parsed): Map<string, DeclFact> {
  const out = new Map<string, DeclFact>()
  for (const s of p.scripts) {
    const sf = s.sf
    const put = (name: string, d: DeclFact) => {
      if (!out.has(name)) out.set(name, d)
    }
    const isDefault = (n: ts.Node) => !!(ts.getCombinedModifierFlags(n as ts.Declaration) & ts.ModifierFlags.Default)
    for (const st of sf.statements) {
      if (ts.isFunctionDeclaration(st)) {
        const d: DeclFact = { kind: 'function', returns: shapeOf(st, sf), signature: sigText(st, sf), line: lineOf(s, st) }
        if (st.name) put(st.name.text, d)
        if (isDefault(st)) put('default', d)
      } else if (ts.isVariableStatement(st)) {
        for (const v of st.declarationList.declarations) {
          if (!ts.isIdentifier(v.name)) continue
          let init = v.initializer
          while (init && (ts.isAsExpression(init) || ts.isParenthesizedExpression(init) || ts.isSatisfiesExpression(init))) init = init.expression
          if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init)))
            put(v.name.text, { kind: 'function', returns: shapeOf(init, sf), signature: sigText(v, sf), line: lineOf(s, v) })
          else put(v.name.text, { kind: 'variable', line: lineOf(s, v) })
        }
      } else if (ts.isClassDeclaration(st)) {
        const name = st.name?.text ?? 'default'
        put(name, { kind: 'class', line: lineOf(s, st) })
        if (isDefault(st)) put('default', { kind: 'class', line: lineOf(s, st) })
        for (const m of st.members)
          if (ts.isMethodDeclaration(m) && m.name && ts.isIdentifier(m.name))
            put(`${name}.${m.name.text}`, { kind: 'function', returns: shapeOf(m, sf), signature: sigText(m, sf), line: lineOf(s, m) })
      } else if (ts.isExportAssignment(st)) {
        const e = st.expression
        if (ts.isArrowFunction(e) || ts.isFunctionExpression(e)) put('default', { kind: 'function', returns: shapeOf(e, sf), line: lineOf(s, st) })
      }
    }
  }
  return out
}

// ── 状态持有 ──

const STORE = /^\s*(export\s+)?(const|let)\s+[\w$]+\s*(:[^=]+)?=\s*(reactive|ref|shallowRef|shallowReactive|defineStore|createStore|writable|signal)\s*[<(]/m
const MODULE_LET = /^(export\s+)?let\s+[\w$]+/m
const INSTANCE = /this\.[\w$]+\s*=(?![=>])/
const IO =
  /\b(writeFileSync|writeFile|appendFileSync|appendFile|renameSync|unlinkSync|rmSync|mkdirSync)\s*\(|\bfs\.(write|append|rm|unlink|mkdir|rename)\w*\s*\(|localStorage\.setItem|sendBeacon|\.postMessage\s*\(|new\s+WebSocket\b|new\s+XMLHttpRequest\b|method:\s*['"](POST|PUT|DELETE|PATCH)['"]/

function stateOf(p: Parsed): FileStateFact | undefined {
  const text = p.scripts.map(s => s.sf.text).join('\n')
  const out: FileStateFact = {}
  const store = STORE.exec(text)?.[4] ?? (MODULE_LET.test(text) ? '模块级 let' : undefined)
  if (store) out.store = store
  const inst = INSTANCE.exec(text)?.[0]
  if (inst) out.instance = inst.replace(/\s*=$/, '').trim()
  const io = IO.exec(text)?.[0]
  if (io) out.io = io.replace(/\s*\($/, '').trim()
  return Object.keys(out).length ? out : undefined
}

// ── 调用点 ──

interface Binding {
  imported: string
  local: string
}

/** 调用结果的使用：语句调用为 false；箭头函数的表达式体看不出（undefined）；其余为 true */
function usage(call: ts.Node): { used?: boolean; awaited: boolean } {
  let n = call
  let awaited = false
  while (
    n.parent &&
    (ts.isAwaitExpression(n.parent) || ts.isParenthesizedExpression(n.parent) || ts.isNonNullExpression(n.parent) || ts.isAsExpression(n.parent))
  ) {
    if (ts.isAwaitExpression(n.parent)) awaited = true
    n = n.parent
  }
  const p = n.parent
  if (!p) return { awaited }
  if (ts.isExpressionStatement(p) || ts.isVoidExpression(p)) return { used: false, awaited }
  if (ts.isArrowFunction(p) && p.body === n) return { awaited }
  return { used: true, awaited }
}

function sitesIn(p: Parsed, bindings: readonly Binding[]): CallSiteFact[] {
  const out: CallSiteFact[] = []
  const byLocal = new Map(bindings.map(b => [b.local, b.imported]))
  /** 调用结果存进的变量 → 导入名（`const v = X()`，再看 v.m(…)） */
  const aliases = new Map<string, string>()
  for (const s of p.scripts) {
    const visit = (n: ts.Node) => {
      if (ts.isImportDeclaration(n)) return
      if (ts.isIdentifier(n) && byLocal.has(n.text)) {
        const name = byLocal.get(n.text)!
        const par = n.parent
        const isName =
          (ts.isPropertyAccessExpression(par) && par.name === n) || ((ts.isPropertyAssignment(par) || ts.isMethodDeclaration(par)) && par.name === n)
        if (!isName) {
          if (ts.isCallExpression(par) && par.expression === n) {
            out.push({ name, called: true, ...usage(par), line: lineOf(s, n) })
            const decl = par.parent
            if (decl && ts.isVariableDeclaration(decl) && decl.initializer === par) {
              if (ts.isIdentifier(decl.name)) aliases.set(decl.name.text, name)
              else if (ts.isObjectBindingPattern(decl.name))
                for (const el of decl.name.elements) {
                  const m = el.propertyName && ts.isIdentifier(el.propertyName) ? el.propertyName.text : ts.isIdentifier(el.name) ? el.name.text : undefined
                  if (m) out.push({ name, member: m, called: false, line: lineOf(s, el) })
                }
            }
          } else if (ts.isPropertyAccessExpression(par) && par.expression === n) {
            let top: ts.Expression = par
            while (ts.isPropertyAccessExpression(top.parent) && top.parent.expression === top) top = top.parent
            const member = (top as ts.PropertyAccessExpression).name.text
            const call = top.parent
            if (ts.isCallExpression(call) && call.expression === top) out.push({ name, member, called: true, ...usage(call), line: lineOf(s, n) })
            else out.push({ name, member, called: false, line: lineOf(s, n) })
          }
        }
      }
      ts.forEachChild(n, visit)
    }
    visit(s.sf)
    // 别名变量的成员调用：v.m(…) / v.a.m(…)
    if (aliases.size) {
      const visitAlias = (n: ts.Node) => {
        if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) && aliases.has(n.expression.text)) {
          let top: ts.Expression = n
          while (ts.isPropertyAccessExpression(top.parent) && top.parent.expression === top) top = top.parent
          const call = top.parent
          const member = (top as ts.PropertyAccessExpression).name.text
          if (ts.isCallExpression(call) && call.expression === top)
            out.push({ name: aliases.get(n.expression.text)!, member, called: true, handle: true, ...usage(call), line: lineOf(s, n) })
        }
        ts.forEachChild(n, visitAlias)
      }
      visitAlias(s.sf)
    }
  }
  // Vue 模板：X(…) / X.m(…) / 别名 v.m(…)；模板里看不出结果是否被使用
  if (p.template) {
    const scan = (local: string, name: string, handle = false) => {
      const re = new RegExp(`(^|[^\\w$.])${local.replace(/\$/g, '\\$')}((?:\\s*\\??\\.\\s*[\\w$]+)*)\\s*\\(`, 'g')
      for (let m = re.exec(p.template); m; m = re.exec(p.template)) {
        const chain = m[2]
          .split('.')
          .map(x => x.replace(/[?\s]/g, ''))
          .filter(Boolean)
        // 事件处理（@click="…"、v-on:…）里的调用不取结果：命令；绑定与插值里的调用取结果：查询
        const before = p.template.slice(0, m.index + m[1].length)
        const attr = /([@:\w.-]+)\s*=\s*"[^"]*$/.exec(before)?.[1]
        const inMustache = before.lastIndexOf('{{') > before.lastIndexOf('}}')
        const used = attr ? !(attr.startsWith('@') || attr.startsWith('v-on:')) : inMustache ? true : undefined
        out.push({
          name,
          ...(chain.length ? { member: chain[chain.length - 1] } : {}),
          called: true,
          ...(handle ? { handle: true as const } : {}),
          ...(used !== undefined ? { used } : {}),
        })
      }
    }
    for (const [local, name] of byLocal) scan(local, name)
    for (const [local, name] of aliases) scan(local, name, true)
  }
  return out
}

function importsIn(p: Parsed): { spec: string; bindings: Binding[] }[] {
  const out: { spec: string; bindings: Binding[] }[] = []
  for (const s of p.scripts)
    for (const st of s.sf.statements) {
      if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier) || st.importClause?.isTypeOnly) continue
      const c = st.importClause
      const bindings: Binding[] = []
      if (c?.name) bindings.push({ imported: 'default', local: c.name.text })
      const nb = c?.namedBindings
      if (nb && ts.isNamespaceImport(nb)) bindings.push({ imported: '*', local: nb.name.text })
      if (nb && ts.isNamedImports(nb))
        for (const e of nb.elements) if (!e.isTypeOnly) bindings.push({ imported: (e.propertyName ?? e.name).text, local: e.name.text })
      out.push({ spec: st.moduleSpecifier.text, bindings })
    }
  return out
}

/**
 * 读分类用的源码事实：deps 为已提取的文件依赖（K1），direct 为模块 → 直接归属的文件（SourceOwnership.direct）。
 * 只看有交互使用（invokes）的依赖的调用点；签名与状态持有按需解析目标文件。
 */
export function readClassifyCode(
  root: string,
  files: readonly string[],
  packages: Record<string, PackageEntry>,
  deps: readonly FileDep[],
  direct: ReadonlyMap<string, readonly string[]>,
): ClassifyCode {
  cache.clear()
  const resolver = createResolver(root, files, packages)
  const sites = new Map<string, CallSiteFact[]>()
  const decls = new Map<string, DeclFact>()
  const state = new Map<string, FileStateFact>()
  const declDone = new Set<string>()
  const importsCache = new Map<string, { via: string | null; bindings: Binding[] }[]>()
  for (const d of deps) {
    if (!d.invokes || !SCRIPT.test(d.from)) continue
    const p = parse(root, d.from)
    if (!p) continue
    let imps = importsCache.get(d.from)
    if (!imps) {
      imps = importsIn(p).map(i => ({ via: resolver.resolve(d.from, i.spec), bindings: i.bindings }))
      importsCache.set(d.from, imps)
    }
    const names = d.names ?? []
    const bindings = imps
      .filter(i => i.via === d.via)
      .flatMap(i => i.bindings)
      .filter(b => (names.length ? names.includes(b.imported) : b.imported === 'default' || b.imported === '*'))
    if (bindings.length) {
      const key = `${d.from}\0${d.to}`
      sites.set(key, [...(sites.get(key) ?? []), ...sitesIn(p, bindings)])
    }
    if (!declDone.has(d.to)) {
      declDone.add(d.to)
      const t = parse(root, d.to)
      if (t) {
        if (/\.vue$/i.test(d.to)) decls.set(`${d.to}\0default`, { kind: 'component' })
        for (const [n, x] of declsOf(t)) decls.set(`${d.to}\0${n}`, x)
      }
    }
  }
  const all = new Set<string>([...deps.map(d => d.to), ...[...direct.values()].flat()])
  for (const f of all) {
    if (!SCRIPT.test(f)) continue
    const p = parse(root, f)
    const s = p && stateOf(p)
    if (s) state.set(f, s)
  }
  cache.clear()
  return { sites, decls, state, direct }
}
