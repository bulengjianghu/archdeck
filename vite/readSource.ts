/**
 * 源码读取（Node 侧，供 Vite 插件与命令行校验共用，docs/architecture/source.md §2）。
 * 只列文件、读文件、做 TypeScript 语法摘要，不判断文件属于哪个模块（归属在模型层）。
 *
 * 源码根目录（G1）：ARCH_SOURCE_ROOT_<项目> 优先；否则为工作区根目录 + system.source.repo，
 * 工作区根目录缺省为本包往上三级（work4/），可用 ARCH_WORKSPACE_ROOT 覆盖；
 * 自项目——repo 与本包同名（G22）——缺省为本包目录，不外推到工作区（worktree 里那是主检出的另一份代码）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import ts from 'typescript'
import { loadModel } from '../src/model'
import {
  LINE_COUNTED,
  resolveRelative,
  type CommitDelta,
  type ExportedSymbol,
  type PackageEntry,
  type SourceFile,
  type SourcePayload,
  type SystemDef,
} from '../src/model'
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

export type SourceRoot = { status: 'local'; root: string } | { status: 'error'; tried?: string; reason: string }

/**
 * G1：解析源码根目录；G22：自项目——repo 与所在包目录 selfRoot 同名（基名相同）——缺省为 selfRoot，
 * 不按工作区根目录外推（worktree 里外推到的是主检出的另一份代码，会静默测错）。源码在本地是前提，
 * 根目录不存在或未写 repo 是配置错误，返回原因与尝试的路径（调用方报错），不抛异常
 */
export function resolveSourceRoot(project: string, system: SystemDef, workspace: string, env: NodeJS.ProcessEnv = process.env, selfRoot?: string): SourceRoot {
  const repo = system.source?.repo
  const override = env[sourceRootEnvKey(project)]
  if (!override && !repo) return { status: 'error', reason: `描述未写 system.source.repo（或用环境变量 ${sourceRootEnvKey(project)} 指定源码根目录）` }
  const self = !override && selfRoot !== undefined && !!repo && path.basename(repo) === path.basename(selfRoot)
  const target = self ? path.resolve(selfRoot) : path.resolve(workspace, override ?? repo!)
  if (!fs.existsSync(target) || !fs.statSync(target).isDirectory())
    return {
      status: 'error',
      tried: target,
      reason: `源码根目录不存在：${target}（检查 system.source.repo，或用 ${sourceRootEnvKey(project)} / ARCH_WORKSPACE_ROOT 指定）`,
    }
  return { status: 'local', root: target }
}

const gitIn = (root: string, args: string[]) =>
  execFileSync('git', args, { cwd: root, maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })
    .toString('utf8')
    .trim()

/** G22：源码树的 git HEAD 提交；不在 git 仓库内、还没有提交或 git 不可用（发布产物等）为 null——静默跳过 */
export function readHeadCommit(root: string): string | null {
  try {
    return gitIn(root, ['rev-parse', 'HEAD']) || null
  } catch {
    return null
  }
}

/** G22：描述的 source.commit 与源码树 HEAD 的比对；一致（HEAD 以它开头，容忍短哈希）、未写 commit 或读不到 git 时为 null */
export function sourceCommitDelta(system: SystemDef, root: string): CommitDelta | null {
  const described = system.source?.commit?.trim()
  if (!described) return null
  const head = readHeadCommit(root)
  if (!head || head.startsWith(described)) return null
  let ahead: number | null = null
  try {
    const n = Number.parseInt(gitIn(root, ['rev-list', '--count', `${described}..HEAD`]), 10)
    if (Number.isFinite(n)) ahead = n
  } catch {
    /* 描述的提交不在源码树历史中（深克隆截断、改写历史等）：只报不一致，不给差数 */
  }
  return { described, head, ahead }
}

/** G2：git 仓库内按 git 的忽略规则列出（已跟踪 + 未跟踪且未忽略），否则遍历并排除依赖与产物目录 */
export function listSourceFiles(root: string): string[] {
  let files: string[]
  try {
    const out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
      cwd: root,
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
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
      const str = (v: unknown) => (typeof v === 'string' ? v : undefined)
      out[f === 'package.json' ? '' : f.slice(0, -'/package.json'.length)] = {
        main: str(pkg.main),
        exports: pkg.exports,
        ...(str(pkg.name) ? { name: str(pkg.name) } : {}),
        ...(str(pkg.types) ? { types: str(pkg.types) } : {}),
      }
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
  // G22：projectRoot 是本工具所在的包，repo 与它同名的项目是自项目，源码根缺省为它
  const at = resolveSourceRoot(project, system, workspaceRoot(projectRoot, env), env, projectRoot)
  if (at.status === 'error') return at
  const files = listSourceFiles(at.root)
  // G22：描述的提交与源码树 HEAD 不一致时随清单交给页面与命令行，各给一条提醒
  const delta = sourceCommitDelta(system, at.root)
  return {
    status: 'local',
    root: at.root,
    files,
    packages: readPackages(at.root, files),
    lines: countLines(at.root, files),
    adrTitles: readAdrTitles(at.root, files),
    ...(delta ? { commitDelta: delta } : {}),
  }
}

/**
 * E9：ADR 文件（文件名以四位编号开头的 .md，不论在哪个目录；模型层按 adrDir 取用）第一行的标题，供模块面板「相关决策」；读不出的不列
 */
export function readAdrTitles(root: string, files: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const f of files) {
    if (!/(^|\/)\d{4}[^/]*\.md$/.test(f)) continue
    try {
      const title = adrTitle(fs.readFileSync(path.join(root, f), 'utf8').slice(0, 4096))
      if (title) out[f] = title
    } catch {
      /* 读不了就不给标题 */
    }
  }
  return out
}

/** E9：ADR 文件首个 `# ` 行（一级标题；前面可以有空行、front matter 等）之后的文字，去掉与编号重复的「ADR-0025：」式前缀；读不出为 undefined */
export function adrTitle(text: string): string | undefined {
  const m = text
    .split('\n')
    .map(l => /^#\s+(.*)$/.exec(l.trim()))
    .find(x => !!x)
  if (!m) return undefined
  return m[1].replace(/^ADR[-\s]?\d+\s*[：:]\s*/, '').trim() || undefined
}

/** G19：行数缓存，键为绝对路径，按修改时间与大小判断是否过期 */
const lineCache = new Map<string, { mtimeMs: number; size: number; lines: number }>()

/** G19：TS / JS / Vue 等文件的物理行数（换行符个数，末行无换行另计 1，空文件为 0） */
export function countLines(root: string, files: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const rel of files) {
    if (!LINE_COUNTED.test(rel)) continue
    const abs = path.join(root, rel)
    try {
      const st = fs.statSync(abs)
      const hit = lineCache.get(abs)
      if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) {
        out[rel] = hit.lines
        continue
      }
      const buf = fs.readFileSync(abs)
      let n = 0
      for (let i = buf.indexOf(10); i !== -1; i = buf.indexOf(10, i + 1)) n++
      if (buf.length > 0 && buf[buf.length - 1] !== 10) n++
      lineCache.set(abs, { mtimeMs: st.mtimeMs, size: st.size, lines: n })
      out[rel] = n
    } catch {
      /* 读不到（刚删除等）就不统计 */
    }
  }
  return out
}

const LANGS: Record<string, string> = {
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'jsx',
  vue: 'vue',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  md: 'markdown',
  css: 'css',
  scss: 'scss',
  html: 'html',
  sh: 'shellscript',
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

const clip = (text: string) => {
  const lines = text
    .replace(/^export\s+(default\s+)?(declare\s+)?/, '')
    .trimEnd()
    .split('\n')
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
      .filter(
        m =>
          !(ts.getCombinedModifierFlags(m as ts.Declaration) & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)) &&
          !(m.name && ts.isPrivateIdentifier(m.name)),
      )
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
    return clip(
      `${keyword} ${name} = ${init.typeParameters ? `<${init.typeParameters.map(t => t.getText(sf)).join(', ')}>` : ''}${params}${init.type ? `: ${init.type.getText(sf)}` : ''} => …`,
    )
  }
  return `${keyword} ${name}`
}

const hasModifier = (node: ts.Node, kind: ts.SyntaxKind) => !!(ts.canHaveModifiers(node) && ts.getModifiers(node)?.some(m => m.kind === kind))

type Local = { kind: ExportedSymbol['kind']; signature: string; line: number; callable?: true; data?: true }

/** 初始值的外壳（`as`、`satisfies`、括号、`Object.freeze(…)`）去掉后的表达式 */
function unwrapInit(e: ts.Expression): ts.Expression {
  for (;;) {
    if (ts.isAsExpression(e) || ts.isSatisfiesExpression(e) || ts.isParenthesizedExpression(e) || ts.isTypeAssertionExpression(e)) e = e.expression
    else if (ts.isCallExpression(e) && e.arguments.length === 1 && e.expression.getText() === 'Object.freeze') e = e.arguments[0]
    else return e
  }
}

/** 初始值是纯数据（字面量、数组、不含函数的对象字面量、Symbol(…)、new Map / Set(…)）的常量：对它的任何使用都是纯值读取（K1） */
function isDataInit(init: ts.Expression | undefined, depth = 0): boolean {
  if (!init || depth > 4) return false
  const e = unwrapInit(init)
  if (ts.isStringLiteralLike(e) || ts.isNumericLiteral(e) || ts.isBigIntLiteral(e) || ts.isRegularExpressionLiteral(e)) return true
  if (e.kind === ts.SyntaxKind.TrueKeyword || e.kind === ts.SyntaxKind.FalseKeyword || e.kind === ts.SyntaxKind.NullKeyword) return true
  if (ts.isPrefixUnaryExpression(e) && ts.isNumericLiteral(e.operand)) return true
  if (ts.isTemplateExpression(e)) return true
  // 枚举成员（`Kind.A`）当作数据；标识符可能是函数或组件，不算
  const leaf = (x: ts.Expression) => isDataInit(x, depth + 1) || (ts.isPropertyAccessExpression(x) && ts.isIdentifier(x.expression))
  if (ts.isArrayLiteralExpression(e)) return e.elements.every(x => !ts.isSpreadElement(x) && leaf(x))
  if (ts.isObjectLiteralExpression(e)) return e.properties.every(p => ts.isPropertyAssignment(p) && leaf(p.initializer))
  if (ts.isCallExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === 'Symbol') return true
  if (ts.isNewExpression(e) && ts.isIdentifier(e.expression) && ['Map', 'Set'].includes(e.expression.text)) return true
  return false
}

/** 说明符解析：相对路径之外（工作区包名、路径别名）的解析由调用方给出（K2）；不给时只追相对路径 */
type SpecResolve = (from: string, spec: string) => string | null

/** memo：本次解析中已算过的文件；stack：当前再导出链（防环） */
function collectExports(
  root: string,
  file: string,
  files: ReadonlySet<string>,
  depth: number,
  memo: Map<string, ExportedSymbol[]>,
  stack: ReadonlySet<string>,
  resolve?: SpecResolve,
  cuts: Set<string> = new Set(),
): ExportedSymbol[] {
  if (stack.has(file)) {
    cuts.add(file)
    return []
  }
  const done = memo.get(file)
  if (done) return done
  // 再导出成环时，环内比本文件更早进栈的文件被截断：本文件的结果不完整，不缓存（否则后续从别处进来的查询会丢名字）；
  // 截断的只有本文件自己时，本文件的导出表是完整的，照常缓存
  const own = new Set<string>()
  const chain = new Set(stack).add(file)
  const text = fs.readFileSync(path.join(root, file), 'utf8')
  const kind = /x$/i.test(file) ? ts.ScriptKind.TSX : /\.(m|c)?js$/i.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind)
  const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1
  const locals = new Map<string, Local>()
  /** 本文件的导入绑定：本地名 → 说明符与导出名（默认导入为 default）；供 `import { X } from '…'; export { X }` 按再导出解析（K3） */
  const imported = new Map<string, { spec: string; name: string }>()
  const out: ExportedSymbol[] = []
  const add = (s: ExportedSymbol) => {
    if (!out.some(o => o.name === s.name)) out.push(s)
  }

  // 先收集顶层声明，供 `export { a as b }` 查找
  for (const st of sf.statements) {
    const exported = hasModifier(st, ts.SyntaxKind.ExportKeyword)
    const isDefault = hasModifier(st, ts.SyntaxKind.DefaultKeyword)
    const declare = (name: string | undefined, k: ExportedSymbol['kind'], node: ts.Node, signature = signatureOf(node, sf), callable = false, data = false) => {
      const c = { ...(callable ? { callable: true as const } : {}), ...(data ? { data: true as const } : {}) }
      if (name) locals.set(name, { kind: k, signature, line: lineOf(node), ...c })
      if (exported) add({ name: isDefault ? 'default' : (name ?? 'default'), kind: isDefault ? 'default' : k, signature, line: lineOf(node), ...c })
    }
    if (ts.isImportDeclaration(st) && st.importClause && !st.importClause.isTypeOnly && ts.isStringLiteral(st.moduleSpecifier)) {
      const spec = st.moduleSpecifier.text
      const c = st.importClause
      if (c.name) imported.set(c.name.text, { spec, name: 'default' })
      if (c.namedBindings && ts.isNamedImports(c.namedBindings))
        for (const e of c.namedBindings.elements) if (!e.isTypeOnly) imported.set(e.name.text, { spec, name: (e.propertyName ?? e.name).text })
    }
    if (ts.isFunctionDeclaration(st)) declare(st.name?.text, 'function', st)
    else if (ts.isClassDeclaration(st)) declare(st.name?.text, 'class', st)
    else if (ts.isInterfaceDeclaration(st)) declare(st.name.text, 'interface', st)
    else if (ts.isTypeAliasDeclaration(st)) declare(st.name.text, 'type', st)
    else if (ts.isEnumDeclaration(st)) declare(st.name.text, 'enum', st)
    else if (ts.isModuleDeclaration(st)) declare(st.name.getText(sf), 'namespace', st, `namespace ${st.name.getText(sf)}`)
    else if (ts.isVariableStatement(st))
      for (const d of st.declarationList.declarations)
        if (ts.isIdentifier(d.name)) {
          const init = d.initializer
          const callable = !!init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init) || ts.isClassExpression(init))
          const data = !!(st.declarationList.flags & ts.NodeFlags.Const) && isDataInit(init)
          declare(d.name.text, 'const', d, variableSignature(d, st.declarationList, sf), callable, data)
        }
  }

  for (const st of sf.statements) {
    if (ts.isExportAssignment(st)) {
      add({ name: 'default', kind: 'default', signature: clip(`export default ${st.expression.getText(sf)}`.split('\n')[0]), line: lineOf(st) })
      continue
    }
    if (!ts.isExportDeclaration(st)) continue
    const spec = st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier) ? st.moduleSpecifier.text : undefined
    const targetOf = (sp: string) => (sp.startsWith('.') ? resolveRelative(file, sp, files) : (resolve?.(file, sp) ?? null))
    const target = spec ? targetOf(spec) : null
    // 补全到非 TS / JS 文件（如 .vue）时不追
    const subOf = (t: string | null) =>
      t && SCRIPT_EXT.test(t) && depth < MAX_REEXPORT_DEPTH ? collectExports(root, t, files, depth + 1, memo, chain, resolve, own) : []
    const sub = () => subOf(target)
    const clause = st.exportClause
    if (!clause) {
      // export * from './x'：不含默认导出
      for (const s of sub()) if (s.name !== 'default') add({ ...s, from: s.from ?? target! })
    } else if (ts.isNamespaceExport(clause)) {
      add({
        name: clause.name.text,
        kind: 'namespace',
        signature: `export * as ${clause.name.text} from '${spec}'`,
        line: lineOf(st),
        from: target ?? undefined,
      })
    } else {
      const fromTarget = spec ? sub() : []
      for (const el of clause.elements) {
        const local = (el.propertyName ?? el.name).text
        const name = el.name.text
        if (spec) {
          const hit = fromTarget.find(s => s.name === local)
          add(
            hit
              ? { ...hit, name, from: hit.from ?? target! }
              : { name, kind: 'reexport', signature: `export { ${el.getText(sf)} } from '${spec}'`, line: lineOf(el), from: target ?? undefined },
          )
        } else {
          const l = locals.get(local)
          const imp = l ? undefined : imported.get(local)
          // `import { X } from '…'; export { X }`：与 `export { X } from '…'` 同样追到声明文件（K3）
          const t = imp ? targetOf(imp.spec) : null
          const hit = imp ? subOf(t).find(s => s.name === imp.name) : undefined
          add(l ? { name, ...l } : hit ? { ...hit, name, from: hit.from ?? t! } : { name, kind: 'reexport', line: lineOf(el), ...(t ? { from: t } : {}) })
        }
      }
    }
  }
  own.delete(file)
  if (own.size) for (const f of own) cuts.add(f)
  else memo.set(file, out)
  return out
}

/** K3：同一批文件共用解析结果的导出查询（再导出带声明文件 from）；非脚本或不在清单中为空数组 */
export function exportsResolver(root: string, files: readonly string[], resolve?: SpecResolve): (file: string) => ExportedSymbol[] {
  const set = new Set(files)
  const memo = new Map<string, ExportedSymbol[]>()
  return file => {
    if (!set.has(file) || !SCRIPT_EXT.test(file)) return []
    try {
      return collectExports(root, file, set, 0, memo, new Set(), resolve)
    } catch {
      return []
    }
  }
}

/** G11：入口文件的导出；非 TS / JS 文件为空数组；不在清单中为 null */
export function readExports(root: string, files: readonly string[], rel: string): ExportedSymbol[] | null {
  if (!files.includes(rel)) return null
  if (!SCRIPT_EXT.test(rel)) return []
  return collectExports(root, rel, new Set(files), 0, new Map(), new Set())
}
