/**
 * 源代码的数据类型（docs/architecture/source.md §4）：接入层产出的文件清单与导出，模型层产出的归属。
 * 路径一律相对源码根目录、以 `/` 分隔。
 */

/** package.json 中与入口有关的字段（G10） */
export interface PackageEntry {
  main?: string
  exports?: unknown
}

/** G19：统计行数的源码文件 */
export const LINE_COUNTED = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|vue)$/i

/** G20：超长阈值的缺省值 */
export const DEFAULT_MAX_LINES = 500

/** 源码清单：开发服务器实时读取（G1、G2）；构建态取不到端点时为 unavailable */
export type SourcePayload =
  | { status: 'local'; root: string; files: string[]; packages: Record<string, PackageEntry>; lines?: Record<string, number> }
  | { status: 'absent'; repo?: string; tried?: string; reason: string }
  | { status: 'unavailable' }

export type LocalSource = Extract<SourcePayload, { status: 'local' }>

/** 单个文件的内容（G17）：过大或二进制时不给文本 */
export type SourceFile =
  | { path: string; text: string; lang: string }
  | { path: string; tooLarge: number }
  | { path: string; binary: true }

export type ExportKind = 'function' | 'class' | 'interface' | 'type' | 'enum' | 'const' | 'namespace' | 'default' | 'reexport'

/** 入口导出的一个符号（G11） */
export interface ExportedSymbol {
  /** 默认导出为 'default' */
  name: string
  kind: ExportKind
  signature?: string
  line: number
  /** 经再导出时，声明所在的文件 */
  from?: string
}

/** 文件归属（G3–G8） */
export interface SourceOwnership {
  /** 文件 → 归属模块；冲突时多个（G6） */
  owners: Map<string, string[]>
  /** 模块 → 直接归属它的文件 */
  direct: Map<string, string[]>
  unowned: string[]
  ignored: Set<string>
  conflicts: string[]
}

export interface ModuleEntry {
  file: string
  via: 'entry' | 'index' | 'package'
  /** 描述的 entry 指向的文件不在文件清单中（G10） */
  missing?: boolean
}

export interface ExportMatch {
  matched: { interfaceId: string; symbol: ExportedSymbol }[]
  /** 导出了但描述里没有 */
  undescribed: ExportedSymbol[]
  /** 描述里有但入口没导出（接口 ID） */
  unexported: string[]
}

/** 选中文件在当前层次的投影（G14） */
export interface FileNodes {
  /** 要高亮的视图节点 ID */
  nodes: Set<string>
  /** 有归属模块是当前父模块或其祖先 */
  self: boolean
}

export interface DirNode {
  name: string
  /** 相对源码根目录；根为 '' */
  path: string
  dirs: DirNode[]
  files: string[]
  /** 子树内文件数 */
  count: number
  /** 子树内未归属文件数 */
  unowned: number
  /** G18：子树内的文件全部是忽略状态 */
  ignored: boolean
  /** G21：子树内统计了行数的文件的行数合计 */
  lines: number
  /** G21：子树内超长文件数 */
  long: number
}
