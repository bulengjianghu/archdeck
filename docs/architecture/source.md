# 专题：源码接入与归属

> 回答：被描述项目的源码从哪里读；一个文件属于哪个模块；模块的入口导出了什么，与描述对不对得上。
> 覆盖模块：接入层的「源码读取」；模型层的「源码归属」。规则见 [02-domain.md](../02-domain.md) 的 G（行数与超长：G19–G21）；界面见[工作台界面](./workbench.md) §2、§6、§8、§9；状态与同步见[视图状态与协调](./view-state.md) §4。

## 1. 分工

```text
本地源码根目录（system.source.repo，G1）     接入层：只列文件、读文件、做语法摘要，不判断归属
   │ readSourceTree / readSourceFile / readExports
   ▼
SourceTree { files, packages, lines } · SourceFile · ExportedSymbol[]
   │ （开发态端点；命令行直接调用）
   ▼
assignFiles(index, files, sourceIgnore) → SourceOwnership    模型层：归属、入口、对应、投影
moduleEntry · matchExports · fileNodes · sourceIssues · fileTree
```

- 归属判断是关于被描述系统的知识，换成命令行或 AI 查询同样需要，所以放在模型层（原则 6）。
- glob 匹配是模型层的纯函数，不依赖 Node 库。
- 接入层只负责两件事：读到文件，以及读懂 TypeScript 的语法。

## 2. 源码读取（接入层，`vite/readSource.ts`）

| 函数 | 做什么 | 规则 |
|---|---|---|
| `resolveSourceRoot(system, workspaceRoot, env)` | 先看 `ARCH_SOURCE_ROOT_<ID>`，再用工作区根目录（`ARCH_WORKSPACE_ROOT`，缺省为本包往上三级）拼上 `source.repo`；返回 `{ status: 'local', root }`，或 `{ status: 'absent', tried, reason }` | G1 |
| `listSourceFiles(root)` | 在 git 仓库内执行 `git ls-files --cached --others --exclude-standard`（相对 `root`），失败时遍历目录并排除 `node_modules`、`.git`、`dist`、`coverage` 等；按路径排序 | G2 |
| `readSourceTree(modelRoot, project, …)` | 组合以上两步，并读取清单中每个 `package.json` 的 `name` / `main` / `exports` / `types`，交给包入口（`packageEntry`）用；统计 TS / JS / Vue 文件的物理行数（按修改时间与大小缓存） | G1、G2、G10、G19 |
| `readSourceFile(root, files, path)` | 路径必须在清单中（防穿越）；超过 512 KB 或含 NUL 字节时只返回 `{ tooLarge }` / `{ binary }` | G17 |
| `readExports(root, files, path)` | TypeScript `createSourceFile` 做语法解析：`export` 声明、`export { a as b }`、`export default`；相对路径的 `export *` / `export … from` 用 `resolveRelative` 补全（K2），补全到非 TS / JS 文件时不追，最多追 5 层，记录来源文件；签名为声明文本去掉函数体与类成员体，最多 25 行 | G11 |

### 2.1 端点

| 端点 | 返回 |
|---|---|
| `GET source/<项目>.json` | `SourcePayload`：`local`（文件清单、包入口、根目录）或 `absent`（尝试的路径与原因） |
| `GET source/<项目>/file.json?path=` | `SourceFile`：文本，或 `tooLarge` / `binary`；不在清单中为 404 |
| `GET source/<项目>/exports.json?path=` | `ExportedSymbol[]`；非 TS / JS 文件为空数组 |

- 只在开发态提供。构建态不输出这些文件，页面拿到 404 就当作「构建产物不含源码」（G2）。
- 源码不监听变化。进入项目、描述刷新、用户点「刷新」时重新列出，避免监听整个被描述仓库。

## 3. 源码归属（模型层，`src/model/source/`）

| 函数 | 做什么 | 规则 |
|---|---|---|
| `matchRef(ref, file)` | glob：`*` 不跨 `/`，`**` 跨任意层（含零层），`?`，`{a,b}`；不含通配符时匹配同名文件或该目录下的文件 | G3 |
| `assignFiles(index, files, ignore)` | 对每个文件求匹配它的模块，去掉是其他匹配模块祖先的（G5），剩下的就是归属模块：0 个时查忽略清单，得到 `ignored` 或 `unowned`；2 个及以上为冲突 | G3、G5–G8 |
| `moduleFiles(index, own, id)` | 子树内全部归属文件的并集；系统根取全部已归属文件 | G4 |
| `moduleDir(module, files)` | 每条 `codeRefs` 取目录（glob 取第一个通配符段之前的部分；恰为清单中的文件时取所在目录；否则视为目录），再取它们的公共目录 | G10 |
| `moduleEntry(index, own, tree, id)` | 依次取 `entry` → 模块目录下有 `package.json` 时取 `packageEntry`，没有时取 `<模块目录>/index.*`（`indexFile`）；按约定找到的必须在清单中并属于本模块子树 | G10 |
| `completePath(base, files)` · `resolveRelative(from, spec, files)` · `indexFile(dir, files)` | 路径补全（`resolve.ts`）：原样 → 去掉 `.js` 写法补 `MODULE_EXTS` → `/index.*`；相对路径从依赖方所在目录出发 | K2、G11 |
| `packageEntry(dir, pkg, files)` | 包入口：`exports['.']` → `main` → `types` 依次补全，产物 `dist/…`、`.d.ts` 不在清单中时换成 `src/…`，再退回 `src/index.*`、`index.*`；入口文件（G10）与依赖提取解析包名（K2）都用它，所以 U4 看的经由文件与入口一致 | G10、K2 |
| `specResolver(files, packages, aliases)` | 说明符解析：相对路径补全；裸说明符先按 tsconfig `paths`（接入层读出的 `PathAlias`），再按工作区包名解析到包入口或包目录下的子路径；解析不到返回 `null` | K2 |
| `matchExports(index, id, exports)` | 模块的接口（`moduleInterfaces`：`provides` 加上 `owner` 在本模块子树内的接口）的名称（去掉括号与泛型）对导出名：`matched`、`undescribed`（导出未描述）、`unexported`（描述未导出）；默认导出不参与 | G12 |
| `fileNodes(index, view, owners)` | 归属模块逐个 `mapEndpoint` 到当前层次：`local` → 子模块节点，`external` → 边界节点（视图中有时），`skip` → 不高亮（`self: true`）；分层总览另加路径上的核心模块节点 | G14 |
| `sourceIssues(index, own, tree)` | 每个冲突文件、未归属文件一条 warning（`source.conflict` / `source.unowned`），`entry` 不在清单中一条 warning（`source.entry`，定位到描述出处） | G6、G7、G9、G10 |
| `fileTree(files, own, lines?, maxLines?)` | 按 `/` 组成目录树，目录带文件数、未归属数与忽略数，内部文件全部忽略的目录标为忽略；给出行数时目录另带行数合计与超长文件数；目录在前、按名称排序 | G18、G21 |
| `isLong(lines, maxLines)` · `moduleLines(files, lines, maxLines)` | 是否超长；一组文件（如模块的文件）的行数合计与超长数 | G20、G21 |

复杂度：`assignFiles` 为 `O(文件数 × codeRefs 条数 × 路径长度)`，5000 个文件、几百条 `codeRefs` 时是几十毫秒；模型或文件清单变化时才重算。

## 4. 数据结构

```ts
type SourcePayload =
  | { status: 'local'; root: string; files: string[]; packages: Record<string, PackageEntry>; lines?: Record<string, number> }   // packages 的键为 package.json 所在目录（'' 为根）；lines 只含统计行数的文件（G19）
  | { status: 'absent'; repo?: string; tried?: string; reason: string }
  | { status: 'unavailable' }                    // 页面侧：构建态取不到端点
interface PackageEntry { main?: string; exports?: unknown }

type SourceFile = { path: string; text: string; lang: string } | { path: string; tooLarge: number } | { path: string; binary: true }

interface ExportedSymbol {
  name: string                                   // 默认导出为 'default'
  kind: 'function' | 'class' | 'interface' | 'type' | 'enum' | 'const' | 'namespace' | 'default' | 'reexport'
  signature?: string
  line: number
  from?: string                                  // 经再导出时声明所在的文件
}

interface SourceOwnership {
  owners: Map<string, string[]>                  // 文件 → 归属模块（冲突时多个）
  direct: Map<string, string[]>                  // 模块 → 直接归属它的文件
  unowned: string[]; ignored: Set<string>; conflicts: string[]
}

interface ModuleEntry { file: string; via: 'entry' | 'index' | 'package'; missing?: boolean }
interface ExportMatch { matched: { interfaceId: string; symbol: ExportedSymbol }[]; undescribed: ExportedSymbol[]; unexported: string[] }
interface FileNodes { nodes: Set<string>; self: boolean }
interface DirNode { name: string; path: string; dirs: DirNode[]; files: string[]; count: number; unowned: number; ignored: boolean; lines: number; long: number }   // ignored：子树内文件全部忽略（G18）；lines / long：子树行数合计与超长文件数（G21）
```

## 5. 接口

```ts
// 接入层
resolveSourceRoot(system: SystemDef, workspaceRoot: string, env?): { status: 'local'; root } | { status: 'absent'; tried?; reason }
readSourceTree(modelRoot, project, projectRoot, env?): SourcePayload | null
readSourceFile(root, files, path): SourceFile | null
readExports(root, files, path): ExportedSymbol[] | null

// 模型层
matchRef(ref: string, file: string): boolean
assignFiles(index: ModelIndex, files: readonly string[], ignore: readonly string[]): SourceOwnership
moduleFiles(index, own, moduleId): string[]
moduleEntry(index, own, tree: { files; packages }, moduleId): ModuleEntry | null
matchExports(index, moduleId, exports: readonly ExportedSymbol[]): ExportMatch
fileNodes(index, view: LevelView, owners: readonly string[]): FileNodes
sourceIssues(index, own, tree): Issue[]
fileTree(files: readonly string[], own: SourceOwnership, lines?: Record<string, number>, maxLines?: number): DirNode
isLong(lines: number | undefined, maxLines: number): boolean
moduleLines(files: readonly string[], lines: Record<string, number>, maxLines: number): { lines: number; long: number; counted: number }
```
