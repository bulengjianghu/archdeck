/**
 * codeRefs 与忽略清单的匹配（G3、G8）：模型层自己的纯函数，不依赖 Node 库。
 * - `*` 不跨 `/`，`**` 跨任意层（含零层），`?` 一个非 `/` 字符，`{a,b}` 任选其一（可嵌套）；
 * - 不含通配符的路径匹配同名文件，或该目录下的全部文件。
 */

const WILDCARD = /[*?{]/

export const hasWildcard = (ref: string) => WILDCARD.test(ref)

/** 去掉开头的 `./` 与 `/`、结尾的 `/` */
export function normalizeRef(ref: string): string {
  return ref.trim().replace(/^(\.\/)+/, '').replace(/^\/+/, '').replace(/\/+$/, '')
}

const cache = new Map<string, RegExp>()

function toRegExp(glob: string): RegExp {
  let cached = cache.get(glob)
  if (cached) return cached
  let re = ''
  let depth = 0
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // `**/` 匹配零层或多层目录；末尾的 `**` 匹配其后的一切
        if (glob[i + 2] === '/') {
          re += '(?:.*/)?'
          i += 2
        } else {
          re += '.*'
          i += 1
        }
      } else re += '[^/]*'
    } else if (c === '?') re += '[^/]'
    else if (c === '{') {
      depth++
      re += '(?:'
    } else if (c === '}' && depth > 0) {
      depth--
      re += ')'
    } else if (c === ',' && depth > 0) re += '|'
    else re += c.replace(/[.+^$()|[\]\\]/g, '\\$&')
  }
  cached = new RegExp(`^${re}$`)
  cache.set(glob, cached)
  return cached
}

/** G3：一条 codeRefs（或忽略条目）是否匹配某个文件 */
export function matchRef(ref: string, file: string): boolean {
  const r = normalizeRef(ref)
  if (!r) return false
  if (!hasWildcard(r)) return file === r || file.startsWith(`${r}/`)
  return toRegExp(r).test(file)
}

/** glob 第一个通配符段之前的目录部分（如 `src/a/{b,c}/**` → `src/a`）；不含通配符时原样返回 */
export function staticPrefix(ref: string): string {
  const r = normalizeRef(ref)
  if (!hasWildcard(r)) return r
  const segs = r.split('/')
  const k = segs.findIndex(s => WILDCARD.test(s))
  return segs.slice(0, k).join('/')
}
