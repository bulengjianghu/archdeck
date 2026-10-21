/**
 * 源码归属（docs/02-domain.md §2.13 G3–G14，及 K2 的路径补全与包入口）：模型层的纯函数，按规则逐条验证。
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MAX_LINES,
  assignFiles,
  completePath,
  fileNodes,
  fileTree,
  isLong,
  loadModel,
  matchExports,
  matchRef,
  moduleDir,
  moduleEntry,
  moduleFiles,
  moduleLines,
  packageEntry,
  projectLevel,
  resolveRelative,
  sourceIssues,
  specResolver,
  staticPrefix,
  type ExportedSymbol,
  type RawFile,
} from '@/model'

const FILES: RawFile[] = [
  { path: 'system.yaml', text: 'system: { id: sys, name: Sys, source: { repo: sys } }' },
  {
    path: 'modules/layers.yaml',
    text: `
modules:
  - id: app
    name: App
    kind: layer
    order: 1
    abstraction: 应用
    responsibility: 应用层
    codeRefs: [src/app/**]
    children:
      - { id: app.ui, name: UI, core: true, responsibility: 界面, codeRefs: [src/app/ui/**] }
      - { id: app.api, name: API, responsibility: 接口, codeRefs: ['src/app/api/{client,server}.ts', src/app/api/index.ts], provides: [if.fetch, if.post] }
      - { id: app.pkg, name: Pkg, responsibility: 子包, codeRefs: [src/app/pkg] }
      - { id: app.entry, name: Entry, responsibility: 指定入口, codeRefs: [src/app/entry/**], entry: src/app/entry/main.ts }
      - { id: app.lost, name: Lost, responsibility: 入口不存在, codeRefs: [src/app/lost/**], entry: src/app/lost/nope.ts }
  - id: core
    name: Core
    kind: layer
    order: 2
    abstraction: 内核
    responsibility: 内核层
    children:
      - { id: core.a, name: A, responsibility: a, codeRefs: [src/core/shared.ts, src/core/a.ts] }
      - { id: core.b, name: B, responsibility: b, codeRefs: [src/core/*.ts] }
sourceIgnore: [docs/**, '*.md']
interfaces:
  - { id: if.fetch, name: fetchData, owner: app.api, signature: 'fetchData(): Promise<void>' }
  - { id: if.post, name: 'post<T>()', owner: app.api }
`,
  },
]

const { index } = loadModel(FILES)
const files = [
  'README.md',
  'docs/a.md',
  'src/app/main.ts',
  'src/app/ui/Button.vue',
  'src/app/ui/index.ts',
  'src/app/api/client.ts',
  'src/app/api/server.ts',
  'src/app/api/index.ts',
  'src/app/api/other.ts',
  'src/app/pkg/package.json',
  'src/app/pkg/src/main.ts',
  'src/app/entry/main.ts',
  'src/core/a.ts',
  'src/core/b.ts',
  'src/core/shared.ts',
  'tools/x.sh',
]
const own = assignFiles(index, files, index.model.sourceIgnore)
const tree = { files, packages: { 'src/app/pkg': { exports: { '.': { import: './src/main.ts' } } } } }

describe('G3 codeRefs 匹配', () => {
  it('* 不跨 /，** 跨任意层（含零层），? 与 {a,b}', () => {
    expect(matchRef('src/*.ts', 'src/a.ts')).toBe(true)
    expect(matchRef('src/*.ts', 'src/x/a.ts')).toBe(false)
    expect(matchRef('src/**', 'src/x/y/a.ts')).toBe(true)
    expect(matchRef('src/**/a.ts', 'src/a.ts')).toBe(true)
    expect(matchRef('src/?.ts', 'src/a.ts')).toBe(true)
    expect(matchRef('src/{a,b}/**', 'src/b/c.ts')).toBe(true)
    expect(matchRef('src/{a,b}/**', 'src/c/c.ts')).toBe(false)
    expect(matchRef('src/a.b.ts', 'src/aXb.ts')).toBe(false)
  })
  it('不含通配符的路径匹配同名文件或该目录下的全部文件；./ 与结尾 / 被规整', () => {
    expect(matchRef('src/app/pkg', 'src/app/pkg/src/main.ts')).toBe(true)
    expect(matchRef('./src/app/pkg/', 'src/app/pkg/package.json')).toBe(true)
    expect(matchRef('src/app/pkg', 'src/app/pkgx/a.ts')).toBe(false)
    expect(matchRef('src/core/a.ts', 'src/core/a.ts')).toBe(true)
  })
  it('通配符前的目录部分', () => {
    expect(staticPrefix('src/app/{a,b}/**')).toBe('src/app')
    expect(staticPrefix('src/a.ts')).toBe('src/a.ts')
  })
})

describe('G4 模块的文件是子树的并集', () => {
  it('层的文件包含子模块的文件与它自己直接匹配的文件', () => {
    const appFiles = moduleFiles(index, own, 'app')
    expect(appFiles).toContain('src/app/main.ts')
    expect(appFiles).toContain('src/app/ui/Button.vue')
    expect(appFiles).toContain('src/app/api/client.ts')
    expect(moduleFiles(index, own, 'app.ui')).toEqual(['src/app/ui/Button.vue', 'src/app/ui/index.ts'])
  })
  it('系统的文件 = 全部已归属文件', () => {
    expect(moduleFiles(index, own, index.rootId)).toEqual([...own.owners.keys()].sort())
  })
})

describe('G5 祖先与后代同时匹配取最深', () => {
  it('src/app/** 与 src/app/ui/** 都匹配 → 归 app.ui，不算冲突', () => {
    expect(own.owners.get('src/app/ui/Button.vue')).toEqual(['app.ui'])
    expect(own.owners.get('src/app/main.ts')).toEqual(['app'])
    expect(own.conflicts).not.toContain('src/app/ui/Button.vue')
  })
  it('{a,b} 只匹配列出的文件，其余归祖先', () => {
    expect(own.owners.get('src/app/api/other.ts')).toEqual(['app'])
  })
})

describe('G6 互不包含的模块同时匹配 → 冲突', () => {
  it('core.a 与 core.b 都写了 shared.ts：文件同时归属两者并报警告', () => {
    expect(own.conflicts).toEqual(['src/core/a.ts', 'src/core/shared.ts'])
    expect(own.owners.get('src/core/shared.ts')).toEqual(['core.a', 'core.b'])
    expect(moduleFiles(index, own, 'core.a')).toContain('src/core/shared.ts')
    expect(moduleFiles(index, own, 'core.b')).toContain('src/core/shared.ts')
    const issues = sourceIssues(index, own, tree).filter(i => i.code === 'source.conflict')
    expect(issues).toHaveLength(2)
    expect(issues[0].severity).toBe('warning')
    expect(issues[0].file).toBe('modules/layers.yaml')
  })
})

describe('G7 未归属', () => {
  it('没有模块匹配、也不在忽略清单 → 未归属并报警告', () => {
    expect(own.unowned).toEqual(['tools/x.sh'])
    const issues = sourceIssues(index, own, tree).filter(i => i.code === 'source.unowned')
    expect(issues.map(i => i.message)).toEqual([expect.stringContaining('tools/x.sh')])
  })
})

describe('G8 忽略清单', () => {
  it('命中的未归属文件不报警；已归属的文件不受影响', () => {
    expect([...own.ignored].sort()).toEqual(['README.md', 'docs/a.md'])
    const withBroadIgnore = assignFiles(index, files, ['src/**'])
    expect(withBroadIgnore.owners.get('src/app/main.ts')).toEqual(['app'])
    expect(withBroadIgnore.ignored.has('src/app/main.ts')).toBe(false)
  })
  it('多个文件的 sourceIgnore 合并', () => {
    const more = loadModel([...FILES, { path: 'source-ignore.yaml', text: 'sourceIgnore: [tools/**]' }])
    expect(more.index.model.sourceIgnore).toEqual(['docs/**', '*.md', 'tools/**'])
    expect(assignFiles(more.index, files, more.index.model.sourceIgnore).unowned).toEqual([])
  })
  it('忽略清单格式不对时整份文件被跳过（schema）', () => {
    const bad = loadModel([...FILES, { path: 'source-ignore.yaml', text: 'sourceIgnore: tools/**' }])
    expect(bad.issues.some(i => i.code === 'schema' && i.file === 'source-ignore.yaml')).toBe(true)
  })
})

describe('G10 入口文件', () => {
  it('模块目录 = codeRefs 的公共目录', () => {
    const set = new Set(files)
    expect(moduleDir(index.modules.get('app.api')!, set)).toBe('src/app/api')
    expect(moduleDir(index.modules.get('core.a')!, set)).toBe('src/core')
    expect(moduleDir(index.modules.get('app.pkg')!, set)).toBe('src/app/pkg')
    expect(moduleDir(index.modules.get('core')!, set)).toBeNull()
  })
  it('约定的 index.ts', () => {
    expect(moduleEntry(index, own, tree, 'app.api')).toEqual({ file: 'src/app/api/index.ts', via: 'index' })
    expect(moduleEntry(index, own, tree, 'app.ui')).toEqual({ file: 'src/app/ui/index.ts', via: 'index' })
  })
  it('package.json 的 exports（import 条件）', () => {
    expect(moduleEntry(index, own, tree, 'app.pkg')).toEqual({ file: 'src/app/pkg/src/main.ts', via: 'package' })
    const main = { files, packages: { 'src/app/pkg': { main: 'src/main.ts' } } }
    expect(moduleEntry(index, own, main, 'app.pkg')).toEqual({ file: 'src/app/pkg/src/main.ts', via: 'package' })
  })
  it('描述的 entry 优先；指向的文件不存在时报警告', () => {
    expect(moduleEntry(index, own, tree, 'app.entry')).toEqual({ file: 'src/app/entry/main.ts', via: 'entry' })
    expect(moduleEntry(index, own, tree, 'app.lost')).toEqual({ file: 'src/app/lost/nope.ts', via: 'entry', missing: true })
    expect(sourceIssues(index, own, tree).filter(i => i.code === 'source.entry').map(i => i.message)).toEqual([expect.stringContaining('nope.ts')])
  })
  it('按约定找到的文件必须属于本模块子树：core.b 的目录下没有 index.ts，层 app 的入口不是 app.ui 的', () => {
    expect(moduleEntry(index, own, tree, 'core.b')).toBeNull()
    const withIndex = [...files, 'src/app/index.ts']
    const own2 = assignFiles(index, withIndex, [])
    expect(moduleEntry(index, own2, { files: withIndex, packages: {} }, 'app')).toEqual({ file: 'src/app/index.ts', via: 'index' })
    // 公共目录 src/app/api 下的 index.ts 归 app.api，不能当作另一个模块的入口
    const other = loadModel([...FILES, { path: 'x.yaml', text: 'modules: [{ id: z, name: Z, responsibility: z, codeRefs: [src/app/api/other.ts, src/app/api/client.ts] }]' }])
    const own3 = assignFiles(other.index, files, [])
    expect(moduleEntry(other.index, own3, tree, 'z')).toBeNull()
  })
})

describe('G10 入口与 K2 包入口同一套', () => {
  const pkgFiles = ['pkg/package.json', 'pkg/index.ts', 'pkg/src/index.ts', 'pkg/src/main.ts', 'ui/index.tsx', 'ui/Button.vue', 'app/main.ts']
  const model = loadModel([
    {
      path: 'm.yaml',
      text: 'modules: [{ id: pkg, name: Pkg, responsibility: p, codeRefs: [pkg/**] }, { id: ui, name: UI, responsibility: u, codeRefs: [ui/**] }, { id: app, name: App, responsibility: a, codeRefs: [app/**] }]',
    },
  ])
  const ownP = assignFiles(model.index, pkgFiles, [])
  const entryWith = (pkg: object) => moduleEntry(model.index, ownP, { files: pkgFiles, packages: { pkg } }, 'pkg')
  it('模块目录有 package.json 时取包入口，优先于目录下的 index：main 指向不在清单中的产物 dist/….js 时换成 src/….ts', () => {
    expect(entryWith({ main: 'dist/index.js' })).toEqual({ file: 'pkg/src/index.ts', via: 'package' })
    expect(entryWith({ main: 'src/main.ts' })).toEqual({ file: 'pkg/src/main.ts', via: 'package' })
    expect(entryWith({ types: 'dist/main.d.ts' })).toEqual({ file: 'pkg/src/main.ts', via: 'package' })
    // 没有入口字段：退回 src/index.*，再退回 index.*
    expect(entryWith({})).toEqual({ file: 'pkg/src/index.ts', via: 'package' })
  })
  it('与依赖提取解析包名得到的文件相同（U4 看的经由文件即入口）', () => {
    for (const pkg of [{ main: 'dist/index.js' }, { main: 'src/main.ts' }, { exports: { '.': { require: './dist/main.cjs' } } }, {}]) {
      const resolve = specResolver(pkgFiles, { pkg: { name: '@x/pkg', ...pkg } })
      expect(entryWith(pkg)?.file).toBe(resolve('app/main.ts', '@x/pkg'))
    }
  })
  it('没有 package.json 时取目录下的 index.*（按 K2 的扩展名）', () => {
    expect(moduleEntry(model.index, ownP, { files: pkgFiles, packages: {} }, 'ui')).toEqual({ file: 'ui/index.tsx', via: 'index' })
    expect(moduleEntry(model.index, ownP, { files: pkgFiles, packages: {} }, 'app')).toBeNull()
  })
})

describe('K2 路径补全与包入口（模型层）', () => {
  const set = new Set(['src/a.ts', 'src/b.vue', 'src/c.d.ts', 'src/lib/index.mts', 'src/m.mjs', 'core/src/index.ts', 'core/src/x.ts'])
  it('原样 → .js 写法换成 .ts 等 → 补扩展名 → /index.*；规范化 . 与 ..', () => {
    expect(completePath('src/a.js', set)).toBe('src/a.ts')
    expect(completePath('src/b', set)).toBe('src/b.vue')
    expect(completePath('src/c', set)).toBe('src/c.d.ts')
    expect(completePath('src/lib', set)).toBe('src/lib/index.mts')
    expect(completePath('src/m.mjs', set)).toBe('src/m.mjs')
    expect(completePath('./src/lib/../a', set)).toBe('src/a.ts')
    expect(completePath('src/none', set)).toBeNull()
  })
  it('相对路径从依赖方所在目录出发；越过根目录不命中；裸说明符不算相对路径', () => {
    expect(resolveRelative('src/lib/index.mts', '../a', set)).toBe('src/a.ts')
    expect(resolveRelative('src/a.ts', '../../src/a', set)).toBeNull()
    expect(resolveRelative('src/a.ts', 'core', set)).toBeNull()
  })
  it('包入口：exports 的 . / import / default / types / require 条件 → main → types，产物退回 src', () => {
    expect(packageEntry('core', { exports: { '.': { require: './dist/x.cjs' } } }, set)).toBe('core/src/x.ts')
    expect(packageEntry('core', { exports: './src/x.ts', main: 'dist/index.js' }, set)).toBe('core/src/x.ts')
    expect(packageEntry('core', { main: 'dist/index.js' }, set)).toBe('core/src/index.ts')
    expect(packageEntry('core', {}, set)).toBe('core/src/index.ts')
    expect(packageEntry('src', {}, new Set(['src/x.ts']))).toBeNull()
  })
  it('tsconfig paths 先于工作区包名；包名带子路径解析到包目录下', () => {
    const r = specResolver([...set], { core: { name: '@x/core' } }, [{ prefix: '@/', suffix: '', targets: ['src/*'] }])
    expect(r('src/a.ts', '@/lib')).toBe('src/lib/index.mts')
    expect(r('src/a.ts', '@x/core')).toBe('core/src/index.ts')
    expect(r('src/a.ts', '@x/core/src/x')).toBe('core/src/x.ts')
    expect(r('src/a.ts', 'vue')).toBeNull()
  })
})

describe('G12 导出与 provides 按名称对应', () => {
  const sym = (name: string): ExportedSymbol => ({ name, kind: 'function', line: 1 })
  it('接口名去掉括号与泛型后相同即对应；对不上的分两组；默认导出不参与', () => {
    const m = matchExports(index, 'app.api', [sym('fetchData'), sym('post'), sym('helper'), sym('default')])
    expect(m.matched.map(x => x.interfaceId)).toEqual(['if.fetch', 'if.post'])
    expect(m.undescribed.map(s => s.name)).toEqual(['helper'])
    expect(m.unexported).toEqual([])
    expect(matchExports(index, 'app.api', [sym('fetchData')]).unexported).toEqual(['if.post'])
  })
  it('模块的接口还包括 owner 在本模块子树内、但未写进 provides 的接口', () => {
    const more = loadModel([...FILES, { path: 'i.yaml', text: 'interfaces: [{ id: if.render, name: render, owner: app.ui }]' }]).index
    expect(matchExports(more, 'app.ui', [sym('render')]).matched.map(x => x.interfaceId)).toEqual(['if.render'])
    expect(matchExports(more, 'app', [sym('render'), sym('fetchData')]).matched.map(x => x.interfaceId)).toEqual(['if.render', 'if.fetch'])
  })
})

describe('G14 选中文件在当前层次的投影', () => {
  it('根层（分层总览）：高亮所在的带与路径上的核心模块', () => {
    const view = projectLevel(index, index.rootId)
    expect([...fileNodes(index, view, ['app.ui']).nodes].sort()).toEqual(['app', 'app.ui'])
    expect([...fileNodes(index, view, ['app.api']).nodes]).toEqual(['app'])
  })
  it('普通层次：落在子模块上；冲突文件的归属模块都高亮', () => {
    const view = projectLevel(index, 'core')
    expect([...fileNodes(index, view, own.owners.get('src/core/shared.ts')!).nodes].sort()).toEqual(['core.a', 'core.b'])
  })
  it('归属模块是当前父模块本身：不高亮节点，self 为真', () => {
    const view = projectLevel(index, 'app')
    const r = fileNodes(index, view, ['app'])
    expect(r.nodes.size).toBe(0)
    expect(r.self).toBe(true)
  })
  it('归属模块在本层外：有边界节点时高亮它', () => {
    const files2: RawFile[] = [...FILES, { path: 'r.yaml', text: 'relations: [{ id: r1, from: app.ui, to: core.a, type: calls }]' }]
    const idx = loadModel(files2).index
    const view = projectLevel(idx, 'app')
    expect([...fileNodes(idx, view, ['core.a']).nodes]).toEqual(['boundary:core'])
    expect(fileNodes(idx, projectLevel(idx, 'app', { showBoundaries: false }), ['core.a']).nodes.size).toBe(0)
  })
})

describe('目录树', () => {
  it('目录在前、按名称排序，带文件数与未归属数', () => {
    const root = fileTree(files, own)
    expect(root.count).toBe(files.length)
    expect(root.unowned).toBe(1)
    expect(root.dirs.map(d => d.name)).toEqual(['docs', 'src', 'tools'])
    expect(root.files).toEqual(['README.md'])
    const src = root.dirs[1]
    expect(src.dirs.map(d => d.name)).toEqual(['app', 'core'])
    expect(root.dirs[2].unowned).toBe(1)
  })
  it('G18：目录内全部文件（含子目录）都是忽略状态时目录本身也是忽略状态', () => {
    const root = fileTree(files, own)
    const docs = root.dirs.find(d => d.name === 'docs')!
    expect(docs.ignored).toBe(true)
    expect(root.dirs.find(d => d.name === 'src')!.ignored).toBe(false)
    expect(root.dirs.find(d => d.name === 'tools')!.ignored).toBe(false)
    expect(root.ignored).toBe(false)
    // 子目录逐级忽略，上级目录也忽略；混有一个未忽略文件就不是
    const nested = ['a/b/x.md', 'a/c/y.md', 'a/z.md']
    const ownN = assignFiles(index, nested, ['**/*.md'])
    const a = fileTree(nested, ownN).dirs[0]
    expect([a.ignored, ...a.dirs.map(d => d.ignored)]).toEqual([true, true, true])
    const mixed = [...nested, 'a/c/keep.ts']
    const m = fileTree(mixed, assignFiles(index, mixed, ['**/*.md'])).dirs[0]
    expect([m.ignored, m.dirs.find(d => d.name === 'b')!.ignored, m.dirs.find(d => d.name === 'c')!.ignored]).toEqual([false, true, false])
  })
})

describe('G19–G21 行数与超长', () => {
  const lines = { 'src/app/main.ts': 700, 'src/app/ui/Button.vue': 120, 'src/core/a.ts': 501, 'src/core/b.ts': 500 }

  it('G20：超过阈值才算超长，没有行数的文件不算；阈值缺省 500', () => {
    expect(DEFAULT_MAX_LINES).toBe(500)
    expect(isLong(501, 500)).toBe(true)
    expect(isLong(500, 500)).toBe(false)
    expect(isLong(undefined, 500)).toBe(false)
  })

  it('G21：目录带子树行数合计与超长文件数；阈值可变', () => {
    const root = fileTree(files, own, lines, 500)
    const src = root.dirs.find(d => d.name === 'src')!
    expect([src.lines, src.long]).toEqual([1821, 2])
    const core = src.dirs.find(d => d.name === 'core')!
    expect([core.lines, core.long]).toEqual([1001, 1])
    expect(fileTree(files, own, lines, 100).dirs.find(d => d.name === 'src')!.long).toBe(4)
    // 不给行数时合计为 0
    expect(fileTree(files, own).lines).toBe(0)
  })

  it('G21：一组文件的行数合计、超长数与统计了行数的文件数', () => {
    expect(moduleLines(['src/core/a.ts', 'src/core/b.ts', 'tools/x.sh'], lines, 500)).toEqual({ lines: 1001, long: 1, counted: 2 })
  })

  it('G20：sourceLimits 读入描述；重复声明时用第一处并提醒', () => {
    const one = loadModel([...FILES, { path: 'limits.yaml', text: 'sourceLimits: { maxLines: 300 }' }])
    expect(one.index.model.sourceLimits).toEqual({ maxLines: 300 })
    const two = loadModel([...FILES, { path: 'a.yaml', text: 'sourceLimits: { maxLines: 300 }' }, { path: 'b.yaml', text: 'sourceLimits: { maxLines: 800 }' }])
    expect(two.index.model.sourceLimits).toEqual({ maxLines: 300 })
    expect(two.issues.some(i => i.code === 'duplicate-source-limits' && i.file === 'b.yaml')).toBe(true)
    expect(loadModel([...FILES, { path: 'bad.yaml', text: 'sourceLimits: { maxLines: 0 }' }]).issues.some(i => i.severity === 'error')).toBe(true)
  })
})
