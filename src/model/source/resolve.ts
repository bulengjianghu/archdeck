/**
 * 路径补全与说明符解析（K2）：入口文件（G10）、导出解析（G11）与依赖提取（K2、K3）共用这一套。
 * 输入是文件清单、各 package.json 的入口字段与 tsconfig 的 paths，不碰文件系统。路径一律相对源码根目录、以 `/` 分隔。
 */
import type { PackageEntry, PathAlias } from './types'

/** K2：补全时依次尝试的扩展名 */
export const MODULE_EXTS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.d.ts'] as const

/** 拼接并规范化：去掉空段与 `.`，`..` 回退一级；越过根目录的 `..` 保留（不会命中清单） */
export function joinPath(...parts: string[]): string {
  const out: string[] = []
  for (const p of parts.join('/').split('/')) {
    if (p === '' || p === '.') continue
    if (p === '..' && out.length && out[out.length - 1] !== '..') out.pop()
    else out.push(p)
  }
  return out.join('/')
}

const dirname = (file: string) => (file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '')

/** K2：目录的 index 文件（按 MODULE_EXTS） */
export function indexFile(dir: string, files: ReadonlySet<string>): string | null {
  for (const e of MODULE_EXTS) if (files.has(joinPath(dir, `index${e}`))) return joinPath(dir, `index${e}`)
  return null
}

/** K2：路径补全到清单中的文件：原样 → 去掉 `.js` 写法补扩展名 → `/index.*` */
export function completePath(base: string, files: ReadonlySet<string>): string | null {
  const b = joinPath(base)
  if (files.has(b)) return b
  const stem = b.replace(/\.(m|c)?js$/, '')
  for (const e of MODULE_EXTS) if (files.has(stem + e)) return stem + e
  return indexFile(b, files)
}

/** K2：从 from 文件出发的相对路径说明符；不是相对路径或补全不到为 null */
export function resolveRelative(from: string, spec: string, files: ReadonlySet<string>): string | null {
  if (!spec.startsWith('.') && !spec.startsWith('/')) return null
  return completePath(joinPath(dirname(from), spec), files)
}

/** exports 的取值：字符串，或依次取 `.` / `import` / `default` / `types` / `require` 条件 */
function pickExport(x: unknown): string | undefined {
  if (typeof x === 'string') return x
  if (x && typeof x === 'object' && !Array.isArray(x)) {
    const o = x as Record<string, unknown>
    for (const k of ['.', 'import', 'default', 'types', 'require']) {
      const v = pickExport(o[k])
      if (v) return v
    }
  }
  return undefined
}

/**
 * K2：包入口——`exports['.']` → `main` → `types` 依次补全；指向不在清单中的产物（`dist/….js`、`.d.ts`）时换成 `src/…` 再补全；
 * 都没有时退回 `src/index.*`、`index.*`。dir 为 package.json 所在目录（根为 ''）。
 */
export function packageEntry(dir: string, pkg: PackageEntry, files: ReadonlySet<string>): string | null {
  const candidates = [pickExport(pkg.exports), pkg.main, pkg.types].filter((c): c is string => !!c)
  for (const c of candidates) {
    const p = joinPath(dir, c)
    const hit = completePath(p, files) ?? completePath(p.replace(/(^|\/)dist\//, '$1src/').replace(/\.d\.ts$|\.(m|c)?js$/, ''), files)
    if (hit) return hit
  }
  return indexFile(joinPath(dir, 'src'), files) ?? indexFile(dir, files)
}

/** 裸说明符的包名：`@scope/name` 或第一段 */
export const packageName = (spec: string) => {
  const parts = spec.split('/')
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

/** K2：说明符解析到清单中的文件；解析不到（三方库、Node 内建）为 null */
export type SpecResolver = (from: string, spec: string) => string | null

/** K2：相对路径补全；裸说明符先按 tsconfig 的 paths，再按工作区包名解析到包入口或包目录下的子路径 */
export function specResolver(files: readonly string[], packages: Readonly<Record<string, PackageEntry>>, aliases: readonly PathAlias[] = []): SpecResolver {
  const set = new Set(files)
  const byName = new Map<string, string>()
  for (const [dir, pkg] of Object.entries(packages)) if (pkg.name && !byName.has(pkg.name)) byName.set(pkg.name, dir)
  const entries = new Map<string, string | null>()
  return (from, spec) => {
    if (spec.startsWith('.') || spec.startsWith('/')) return resolveRelative(from, spec, set)
    for (const a of aliases) {
      if (!spec.startsWith(a.prefix) || !spec.endsWith(a.suffix)) continue
      const mid = spec.slice(a.prefix.length, spec.length - a.suffix.length)
      for (const t of a.targets) {
        const hit = completePath(t.replace('*', mid), set)
        if (hit) return hit
      }
    }
    const name = packageName(spec)
    const dir = byName.get(name)
    if (dir === undefined) return null
    const sub = spec.slice(name.length + 1)
    if (sub) return completePath(joinPath(dir, sub), set)
    if (!entries.has(name)) entries.set(name, packageEntry(dir, packages[dir], set))
    return entries.get(name)!
  }
}
