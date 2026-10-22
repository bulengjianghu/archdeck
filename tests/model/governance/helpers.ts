/** 架构治理单测的共用 fixture：两层四模块的描述、规则、源码清单与文件依赖（docs/02-domain.md K、U、Y、Q）。文件依赖直接给出（提取在接入层，见 tests/access/readDeps.test.ts） */
import {
  assignFiles,
  entryResolver,
  governanceReport,
  loadModel,
  type Baseline,
  type CodeDeps,
  type FileDep,
  type RawFile,
} from '@/model'

export const LAYERS = `
modules:
  - id: ui
    name: UI
    kind: layer
    order: 1
    abstraction: 界面
    responsibility: 界面层
    mayDependOn: [core]
    children:
      - { id: ui.view, name: View, responsibility: 视图, codeRefs: [src/ui/view/**] }
      - { id: ui.store, name: Store, responsibility: 状态, codeRefs: [src/ui/store/**] }
  - id: core
    name: Core
    kind: layer
    order: 2
    abstraction: 内核
    responsibility: 内核层
    mayDependOn: []
    children:
      - { id: core.api, name: Api, responsibility: 对外接口, codeRefs: [src/core/api/**], entry: src/core/api/index.ts, provides: [if.get] }
      - { id: core.impl, name: Impl, responsibility: 实现, codeRefs: [src/core/impl/**] }
      - { id: core.util, name: Util, responsibility: 工具, codeRefs: [src/core/util/**] }
      - { id: core.future, name: Future, status: target, responsibility: 规划中 }
interfaces:
  - { id: if.get, name: get, owner: core.api, signature: 'get(id: string): Item' }
relations:
  - { id: rel.1, from: ui.view, to: ui.store, type: depends }
  - { id: rel.2, from: ui.store, to: core.api, type: calls }
  - { id: rel.3, from: core.impl, to: core.util, type: depends }
  - { id: rel.4, from: core.api, to: core.impl, type: calls }
  - { id: rel.5, from: core.util, to: core.future, type: depends }
  - { id: rel.6, from: core.util, to: ui.store, type: streams }
`

export const RULES = `
rules:
  modules:
    - { module: core.api, exposes: [entry] }
    - { module: ui.view, mayDependOn: [ui.store], reason: 视图只认状态 }
  allow:
    - { from: core.util, to: ui.view, rule: layer, reason: 测试例外 }
`

export const files = (rules = RULES): RawFile[] => [
  { path: 'system.yaml', text: 'system: { id: sys, name: Sys }' },
  { path: 'modules/layers.yaml', text: LAYERS },
  { path: 'rules.yaml', text: rules },
]

export const SRC = [
  'src/ui/view/a.ts',
  'src/ui/store/s.ts',
  'src/core/api/index.ts',
  'src/core/api/client.ts',
  'src/core/impl/i.ts',
  'src/core/util/u.ts',
  'src/tests/x.ts',
]

export const dep = (from: string, to: string, via = to, line = 1): FileDep => ({ from, to, via, kind: 'value', line })

export const DEPS: FileDep[] = [
  dep('src/ui/view/a.ts', 'src/ui/store/s.ts'), // ui.view → ui.store：rel.1
  dep('src/ui/store/s.ts', 'src/core/api/client.ts', 'src/core/api/index.ts'), // 经入口访问 core.api
  dep('src/ui/store/s.ts', 'src/core/api/client.ts', 'src/core/api/client.ts', 2), // 绕过入口（U4）
  dep('src/ui/view/a.ts', 'src/core/util/u.ts', 'src/core/util/u.ts', 3), // 白名单之外（U3）
  dep('src/core/impl/i.ts', 'src/ui/view/a.ts'), // core 不可依赖 ui（U2）
  dep('src/core/util/u.ts', 'src/ui/view/a.ts'), // 同上，但有例外（U5）
  dep('src/core/api/index.ts', 'src/core/api/client.ts'), // 同一模块
  dep('src/tests/x.ts', 'src/ui/view/a.ts'), // 一端未归属
  dep('src/ui/store/s.ts', 'src/core/util/u.ts', 'src/core/util/u.ts', 4), // 证实 streams 反向
]
export const CODE: CodeDeps = { deps: DEPS, external: { vue: 2 }, parsed: 6 }

export function setup(rules?: string, baseline: Baseline | null = null) {
  const { index, issues } = loadModel(files(rules))
  const own = assignFiles(index, SRC, [])
  const tree = { files: SRC, packages: {} }
  const report = governanceReport(index, own, tree, CODE, baseline)
  return { index, issues, own, tree, report, entryOf: entryResolver(index, own, tree) }
}
