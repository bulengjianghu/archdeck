/**
 * 源码读取（Node 侧，供 Vite 插件与命令行校验共用，docs/architecture/source.md §2）。
 * 只列文件、读文件、做 TypeScript 语法摘要，不判断文件属于哪个模块（归属在模型层）。
 *
 * 源码根目录（G1）：ARCH_SOURCE_ROOT_<项目> 优先；否则为工作区根目录 + system.source.repo，
 * 工作区根目录缺省为本包往上三级（work4/），可用 ARCH_WORKSPACE_ROOT 覆盖。
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import ts from 'typescript'
import { loadModel } from '../src/model'
import type { ExportedSymbol, PackageEntry, SourceFile, SourcePayload, SystemDef } from '../src/model'
import { readProject } from './readModelDir'

/** G17：超过这个大小不预览 */
export const MAX_PREVIEW_BYTES = 512 * 1024
/** G11：再导出最多追几层、签名最多几行 */
const MAX_REEXPORT_DEPTH = 5
const MAX_SIGNATURE_LINES = 25
/** G2：不在 git 仓库内时排除的目录 */
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.vite', '.cache', '.turbo', '.next', 'out'])

export function workspaceRoot(projectRoot: string, env: NodeJS.ProcessEnv = process.env): string {
  return path.resolve(projectRoot, env.ARCH_WORKSPACE_ROOT ?? '../../..')
}

export const sourceRootEnvKey = (project: string) => `ARCH_SOURCE_ROOT_${project.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`

export type SourceRoot = { status: 'local'; root: string } | { status: 'absent'; repo?: string; tried?: string; reason: string }

/** G1：解析源码根目录；不在本地时返回原因，不抛错 */
export function resolveSourceRoot(project: string, system: SystemDef, workspace: string, env: NodeJS.ProcessEnv = process.env): SourceRoot {
  const repo = system.source?.repo
  const override = env[sourceRootEnvKey(project)]
  if (!override && !repo) return { status: 'absent', reason: '描述未写 system.source.repo' }
  const root = path.resolve(workspace, override ?? repo!)
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return { status: 'absent', repo, tried: root, reason: '源码不在本地' }
  return { status: 'local', root }
}

/** G2：git 仓库内按 git 的忽略规则列出（已跟踪 + 未跟踪且未忽略），否则遍历并排除依赖与产物目录 */
export function listSourceFiles(root: string): string[] {
  let files: string[]
  try {
    const out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })
    files = [...new Set(out.toString('utf8').split('\0').filter(Boolean))].filter(f => {
      try {
        return fs.statSync(path.join(root, f)).isFile() // 去掉已删除未提交的文件与子模块目录
      } catch {
        return false
      }
    })
  } catch {
    files = []
    const walk = (dir: string, rel: string) => {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const r = rel ? `${rel}/${ent.name}` : ent.name
        if (ent.isDirectory()) {
          if (!SKIP_DIRS.has(ent.name)) walk(path.join(dir, ent.name), r)
        } else if (ent.isFile()) files.push(r)
      }
    }
    walk(root, '')
  }
  return files.sort((a, b) => a.localeCompare(b))
}

/** 清单中每个 package.json 的入口字段，键为所在目录（根为 ''） */
function readPackages(root: string, files: readonly string[]): Record<string, PackageEntry> {
  const out: Record<string, PackageEntry> = {}
  for (const f of files) {
    if (f !== 'package.json' && !f.endsWith('/package.json')) continue
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(root, f), 'utf8')) as PackageEntry
      out[f === 'package.json' ? '' : f.slice(0, -'/package.json'.length)] = { main: typeof pkg.main === 'string' ? pkg.main : undefined, exports: pkg.exports }
    } catch {
      /* 坏的 package.json 当作没有入口 */
    }
  }
  return out
}

/** 某个项目的源码清单；项目不存在返回 null */
export function readSourceTree(modelRoot: string, project: string, projectRoot: string, env: NodeJS.ProcessEnv = process.env): SourcePayload | null {
  const payload = readProject(modelRoot, project, projectRoot)
  if (!payload) return null
  const system = loadModel(payload.files).index.model.system
  const at = resolveSourceRoot(project, system, workspaceRoot(projectRoot, env), env)
  if (at.status === 'absent') return at
  const files = listSourceFiles(at.root)
  return { status: 'local', root: at.root, files, packages: readPackages(at.root, files) }
}

const LANGS: Record<string, string> = {
  ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'tsx', js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'jsx',
  vue: 'vue', json: 'json', yaml: 'yaml', yml: 'yaml', md: 'markdown', css: 'css', scss: 'scss', html: 'html', sh: 'shellscript',
}

export function langOf(file: string): string {
  return LANGS[file.slice(file.lastIndexOf('.') + 1).toLowerCase()] ?? 'text'
}

/** G17：读单个文件；路径必须在清单中（防穿越）；过大或二进制不给文本 */
export function readSourceFile(root: string, files: readonly string[], rel: string): SourceFile | null {
  if (!files.includes(rel)) return null
  const full = path.join(root, rel)
  const size = fs.statSync(full).size
  if (size > MAX_PREVIEW_BYTES) return { path: rel, tooLarge: size }
  const buf = fs.readFileSync(full)
  if (buf.includes(0)) return { path: rel, binary: true }
  return { path: rel, text: buf.toString('utf8'), lang: langOf(rel) }
}

// ── 导出解析（G11）──

const SCRIPT_EXT = /\.(m|c)?(t|j)sx?$/i

/** 相对路径的模块说明符解析到清单中的文件 */
function resolveModule(from: string, spec: string, files: ReadonlySet<string>): string | null {
  if (!spec.startsWith('.')) return null
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec))
  const stem = base.replace(/\.(m|c)?js$/, '')
  const candidates = [base, `${stem}.ts`, `${stem}.tsx`, `${stem}.mts`, `${stem}.js`, `${stem}.jsx`, `${stem}.d.ts`, `${base}/index.ts`, `${base}/index.tsx`, `${base}/index.js`]
  return candidates.find(c => files.has(c)) ?? null
}

const clip = (text: string) => {
  const lines = text.replace(/^export\s+(default\s+)?(declare\s+)?/, '').trimEnd().split('\n')
  return lines.length > MAX_SIGNATURE_LINES ? [...lines.slice(0, MAX_SIGNATURE_LINES - 1), '// …'].join('\n') : lines.join('\n')
}

/** 声明文本去掉函数体与类成员体 */
function signatureOf(node: ts.Node, sf: ts.SourceFile): string {
  const text = sf.text
  const upTo = (body: ts.Node | undefined) => (body ? text.slice(node.getStart(sf), body.getStart(sf)).trimEnd() : node.getText(sf))
  if (ts.isFunctionDeclaration(node)) return clip(upTo(node.body))
  if (ts.isClassDeclaration(node)) {
    const head = text.slice(node.getStart(sf), node.members.pos).trimEnd()
    const members = node.members
      .filter(m => !(ts.getCombinedModifierFlags(m as ts.Declaration) & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)) && !(m.name && ts.isPrivateIdentifier(m.name)))
      .map(m => {
        const body = ts.isMethodDeclaration(m) || ts.isConstructorDeclaration(m) || ts.isGetAccessor(m) || ts.isSetAccessor(m) ? m.body : undefined
        const t = body ? text.slice(m.getStart(sf), body.getStart(sf)).trimEnd() : m.getText(sf).replace(/\s*=[\s\S]*$/, '')
        return `  ${t.replace(/;$/, '')}`
      })
    return clip(`${head.replace(/\{$/, '').trimEnd()} {\n${members.join('\n')}\n}`)
  }
  return clip(node.getText(sf))
}

function variableSignature(decl: ts.VariableDeclaration, list: ts.VariableDeclarationList, sf: ts.SourceFile): string {
  const keyword = list.flags & ts.NodeFlags.Const ? 'const' : list.flags & ts.NodeFlags.Let ? 'let' : 'var'
  const name = decl.name.getText(sf)
  if (decl.type) return clip(`${keyword} ${name}: ${decl.type.getText(sf)}`)
  const init = decl.initializer
  if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
    const params = `(${init.parameters.map(p => p.getText(sf)).join(', ')})`
    return clip(`${keyword} ${name} = ${init.typeParameters ? `<${init.typeParameters.map(t => t.getText(sf)).join(', ')}>` : ''}${params}${init.type ? `: ${init.type.getText(sf)}` : ''} => …`)
  }
  return `${keyword} ${name}`
}

const hasModifier = (node: ts.Node, kind: ts.SyntaxKind) => !!(ts.canHaveModifiers(node) && ts.getModifiers(node)?.some(m => m.kind === kind))

type Local = { kind: ExportedSymbol['kind']; signature: string; line: number }

/** memo：本次解析中已算过的文件；stack：当前再导出链（防环） */
function collectExports(root: string, file: string, files: ReadonlySet<string>, depth: number, memo: Map<string, ExportedSymbol[]>, stack: ReadonlySet<string>): ExportedSymbol[] {
  if (stack.has(file)) return []
  const done = memo.get(file)
  if (done) return done
  const chain = new Set(stack).add(file)
  const text = fs.readFileSync(path.join(root, file), 'utf8')
  const kind = /x$/i.test(file) ? ts.ScriptKind.TSX : /\.(m|c)?js$/i.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind)
  const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1
  const locals = new Map<string, Local>()
  const out: ExportedSymbol[] = []
  const add = (s: ExportedSymbol) => {
    if (!out.some(o => o.name === s.name)) out.push(s)
  }

  // 先收集顶层声明，供 `export { a as b }` 查找
  for (const st of sf.statements) {
    const exported = hasModifier(st, ts.SyntaxKind.ExportKeyword)
    const isDefault = hasModifier(st, ts.SyntaxKind.DefaultKeyword)
    const declare = (name: string | undefined, k: ExportedSymbol['kind'], node: ts.Node, signature = signatureOf(node, sf)) => {
      if (name) locals.set(name, { kind: k, signature, line: lineOf(node) })
      if (exported) add({ name: isDefault ? 'default' : (name ?? 'default'), kind: isDefault ? 'default' : k, signature, line: lineOf(node) })
    }
    if (ts.isFunctionDeclaration(st)) declare(st.name?.text, 'function', st)
    else if (ts.isClassDeclaration(st)) declare(st.name?.text, 'class', st)
    else if (ts.isInterfaceDeclaration(st)) declare(st.name.text, 'interface', st)
    else if (ts.isTypeAliasDeclaration(st)) declare(st.name.text, 'type', st)
    else if (ts.isEnumDeclaration(st)) declare(st.name.text, 'enum', st)
    else if (ts.isModuleDeclaration(st)) declare(st.name.getText(sf), 'namespace', st, `namespace ${st.name.getText(sf)}`)
    else if (ts.isVariableStatement(st))
      for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name)) declare(d.name.text, 'const', d, variableSignature(d, st.declarationList, sf))
  }

  for (const st of sf.statements) {
    if (ts.isExportAssignment(st)) {
      add({ name: 'default', kind: 'default', signature: clip(`export default ${st.expression.getText(sf)}`.split('\n')[0]), line: lineOf(st) })
      continue
    }
    if (!ts.isExportDeclaration(st)) continue
    const spec = st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier) ? st.moduleSpecifier.text : undefined
    const target = spec ? resolveModule(file, spec, files) : null
    const sub = () => (target && depth < MAX_REEXPORT_DEPTH ? collectExports(root, target, files, depth + 1, memo, chain) : [])
    const clause = st.exportClause
    if (!clause) {
      // export * from './x'：不含默认导出
      for (const s of sub()) if (s.name !== 'default') add({ ...s, from: s.from ?? target! })
    } else if (ts.isNamespaceExport(clause)) {
      add({ name: clause.name.text, kind: 'namespace', signature: `export * as ${clause.name.text} from '${spec}'`, line: lineOf(st), from: target ?? undefined })
    } else {
      const fromTarget = spec ? sub() : []
      for (const el of clause.elements) {
        const local = (el.propertyName ?? el.name).text
        const name = el.name.text
        if (spec) {
          const hit = fromTarget.find(s => s.name === local)
          add(hit ? { ...hit, name, from: hit.from ?? target! } : { name, kind: 'reexport', signature: `export { ${el.getText(sf)} } from '${spec}'`, line: lineOf(el), from: target ?? undefined })
        } else {
          const l = locals.get(local)
          add(l ? { name, ...l } : { name, kind: 'reexport', line: lineOf(el) })
        }
      }
    }
  }
  memo.set(file, out)
  return out
}

/** G11：入口文件的导出；非 TS / JS 文件为空数组；不在清单中为 null */
export function readExports(root: string, files: readonly string[], rel: string): ExportedSymbol[] | null {
  if (!files.includes(rel)) return null
  if (!SCRIPT_EXT.test(rel)) return []
  return collectExports(root, rel, new Set(files), 0, new Map(), new Set())
}
