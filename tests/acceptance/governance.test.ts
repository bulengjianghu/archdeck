// @vitest-environment jsdom
/**
 * 验收：docs/01-requirements.md §6.10 架构治理，以真实的 model/ 描述与本机源码驱动 agent 接口的查询核心、协调者与面板。
 * agent 接口的两层外壳（命令行、MCP）只做参数与格式，这里直接驱动查询核心；源码在本地是前提（G1），不设跳过。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { nextTick } from 'vue'
import { readProject } from '../../vite/readModelDir'
import { readSourceTree } from '../../vite/readSource'
import { readCodeDeps } from '../../vite/readDeps'
import { createService } from '../../scripts/agent/service'
import { createDeskState, type SourceFetcher } from '../../src/state/useDeskState'
import { DESK_STATE } from '../../src/state/inject'
import Panel from '../../src/components/panel/Panel.vue'
import type { SourcePayload } from '../../src/model'

const ROOT = path.resolve(import.meta.dirname, '../..')
const MODEL = path.join(ROOT, 'model')

/** 临时模型根目录：复制本项目的描述，拦截记录与基线写在这里，不碰仓库 */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arch-gov-'))
fs.cpSync(path.join(MODEL, 'h5p-arch-desk'), path.join(tmp, 'h5p-arch-desk'), { recursive: true, filter: src => !src.includes(`${path.sep}designs`) })
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }))
const svc = () => createService({ root: ROOT, client: 'mcp', env: { ...process.env, ARCH_MODEL_ROOT: tmp, ARCH_PROJECT: 'h5p-arch-desk' } })

describe('§6.10 架构治理验收', () => {
  it('1. locate：归属、各级职责、可依赖的层', () => {
    const r = svc().locate('src/model/load.ts')
    expect(r.kind).toBe('file')
    if (r.kind !== 'file') return
    expect(r.owners).toEqual(['model.pipeline.loader'])
    expect(r.module!.path.map(p => p.id)).toEqual(['model', 'model.pipeline', 'model.pipeline.loader'])
    expect(r.module!.rules.layers).toEqual([{ layer: 'model（模型层）', mayDependOn: [] }])
  })

  it('2. check：模型层不可依赖视图状态层；视图状态层依赖 @/model 允许并附目标语义；外部包无约束', () => {
    const s = svc()
    const denied = s.check('src/model/load.ts', '../state/inject')
    expect(denied.verdict).toBe('denied')
    expect(denied.checks[0].hits[0].reason).toContain('「模型层」不可依赖「视图状态层」')
    const allowed = s.check('src/state/useDeskState.ts', '@/model', undefined, ['loadModel'])
    expect(allowed.verdict).toBe('allowed')
    expect(allowed.targets[0].responsibility).toBeTruthy()
    expect(s.check('src/model/load.ts', 'vue').verdict).toBe('unconstrained')
  })

  it('2a. U10：呈现层经 @/model 只许用契约——moduleName 允许，projectLevel 穿透入口落到 Projector，违反依赖白名单', () => {
    const s = svc()
    expect(s.check('src/components/Breadcrumb.vue', '@/model', undefined, ['moduleName', 'RELATION_TYPES', 'isLong']).verdict).toBe('allowed')
    const denied = s.check('src/components/Breadcrumb.vue', '@/model', undefined, ['projectLevel'])
    expect(denied.verdict).toBe('denied')
    expect(denied.checks.flatMap(c => c.hits).some(h => h.kind === 'deps' && h.reason.includes('类型与 Schema'))).toBe(true)
  })

  it('3. h5player：@h5player/framework 的命名导入落在声明文件，经由 framework 入口', () => {
    const tree = readSourceTree(MODEL, 'h5player', ROOT) as Extract<SourcePayload, { status: 'local' }>
    const code = readCodeDeps(tree.root, tree.files, tree.packages)
    const viaIndex = code.deps.filter(d => d.via === 'packages/framework/src/index.ts' && d.from.startsWith('packages/player/'))
    expect(viaIndex.length).toBeGreaterThan(0)
    expect(viaIndex.every(d => d.to.startsWith('packages/framework/src/'))).toBe(true)
    expect(viaIndex.some(d => d.to !== d.via)).toBe(true)
  })

  it('4. 规则、基线与棘轮：白名单违规；生成基线后无新增；再越界一次为 rule.new', () => {
    fs.writeFileSync(path.join(tmp, 'h5p-arch-desk', 'rules.yaml'), 'rules:\n  modules:\n    - { module: state.layout, mayDependOn: [model.types] }\n')
    const s = svc()
    const before = s.violations()
    expect(before.length).toBeGreaterThan(0)
    expect(before.every(v => v.status === 'open' && v.key.startsWith('deps:state.layout:'))).toBe(true)
    s.baseline()
    expect(s.rescan().gateFailed).toBe(false)
    // 收紧白名单：原来允许的依赖变成新增违规
    fs.writeFileSync(path.join(tmp, 'h5p-arch-desk', 'rules.yaml'), 'rules:\n  modules:\n    - { module: state.layout, mayDependOn: [] }\n')
    const after = s.rescan()
    expect(after.gateFailed).toBe(true)
    expect(s.violations(undefined, true).length).toBeGreaterThan(0)
    fs.rmSync(path.join(tmp, 'h5p-arch-desk', 'rules.yaml'))
    fs.rmSync(path.join(tmp, 'h5p-arch-desk', 'governance', 'baseline.json'))
  })

  it('5–6. 页面：开启「代码事实」，根层关系边有证实；描述漏掉关系时出现叠加线、可选中；根层面板显示架构治理', async () => {
    const tree = () => readSourceTree(MODEL, 'h5p-arch-desk', ROOT) as SourcePayload
    const source: SourceFetcher = {
      tree: async () => tree(),
      file: async () => null,
      exports: async () => [],
      facts: async () => {
        const t = tree()
        return t.status === 'local' ? { deps: readCodeDeps(t.root, t.files, t.packages), baseline: null, ledger: [] } : null
      },
    }
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/p/:project', component: { render: () => null } }] })
    await router.push('/p/h5p-arch-desk')
    // 本项目的描述已无未描述依赖：去掉「呈现层 → 契约」这条关系（moduleName 等，U10），造出跨层的未描述依赖
    const p = readProject(MODEL, 'h5p-arch-desk', ROOT)!
    const dropped = 'rel.ad.present-names'
    const files = p.files.map(f => ({ ...f, text: f.text.replace(new RegExp(`^.*id: ${dropped},.*\\n`, 'm'), '') }))
    expect(files.some((f, i) => f.text !== p.files[i].text)).toBe(true)
    const desk = createDeskState(async () => ({ ...p, files }), { project: 'h5p-arch-desk', source })
    desk.attachRouter(router)
    await desk.init()
    for (let i = 0; i < 3; i++) await flushPromises()
    const panel = mount(Panel, { global: { provide: { [DESK_STATE as symbol]: desk }, plugins: [router] } })
    await nextTick()
    expect(panel.text()).toContain('架构治理')
    expect(panel.text()).toMatch(/已证实 \d+/)

    desk.setToggles({ showFacts: true })
    const level = desk.facts.level.value!
    expect([...level.edgeFacts.values()]).toContain('confirmed')
    const o = level.overlays[0]
    expect(o).toBeDefined()
    desk.select({ kind: 'dep', id: `${o.fromModule}->${o.toModule}` })
    await flushPromises()
    expect(router.currentRoute.value.query.sel).toBe(`d:${o.fromModule}->${o.toModule}`)
    await nextTick()
    expect(panel.text()).toContain('模块依赖')

    // K5a：Projector 文件内的概念子模块之间的关系不判定，面板说明原因
    desk.select({ kind: 'relation', id: 'rel.ad.overview-endpoints' })
    await flushPromises()
    await nextTick()
    expect(panel.text()).toContain('不判定：概念拆分，同文件')
  })

  it('7. 写前判定与重新扫描写拦截记录，报告随之计数', () => {
    const s = svc()
    const n0 = s.report().checks
    s.check('src/model/load.ts', '../state/inject')
    s.rescan()
    const r = s.report()
    expect(r.checks).toBe(n0 + 1)
    expect(r.rescans).toBeGreaterThan(0)
    expect(fs.readFileSync(path.join(tmp, 'h5p-arch-desk', 'governance', 'ledger.jsonl'), 'utf8')).toContain('"client":"mcp"')
  })

  it('9. 返工清单：按根因聚合，命令行与 MCP 同一份 JSON / Markdown，每条带位置、规则与建议', () => {
    // 去掉一个模块的 codeRefs：它目录下的文件成为未归属，按目录合并为一条
    const layers = path.join(tmp, 'h5p-arch-desk', 'intent', 'skeleton.yaml')
    const text = fs.readFileSync(layers, 'utf8')
    fs.writeFileSync(layers, text.replace(/codeRefs: \[\s*src\/components\/shared\/\*\*\s*\]/, 'codeRefs: []'))
    try {
      const r = svc().issues()
      const unowned = r.list.items.find(i => i.id === 'ownership:unowned:src/components/shared')!
      expect(unowned.affected.length).toBeGreaterThan(2)
      expect(unowned.actions.map(a => a.kind)).toEqual(['add-code-refs', 'add-ignore'])
      expect(r.markdown).toContain(`### [提醒] ${unowned.title}`)
      expect(r.markdown).toContain('src/components/shared/*')
      // 同一查询核心：两次调用（命令行、MCP 两层外壳的输入）结果一致
      expect(svc().issues().list).toEqual(r.list)
    } finally {
      fs.writeFileSync(layers, text)
    }
  })

  it('9a. h5player：越过同一条层边界依赖同一模块的违规合并为一条，带全部文件证据', () => {
    const s = createService({ root: ROOT, client: 'cli', env: { ...process.env, ARCH_PROJECT: 'h5player' } })
    const r = s.issues()
    const violations = r.list.items.filter(i => i.category === 'violation')
    const total = s.overview().violations
    expect(violations.length).toBeLessThan(total.new + total.known + total.open)
    expect(violations[0].affected.length).toBeGreaterThan(100)
    expect(violations[0].actions.map(a => a.kind)).toEqual(['fix-code', 'add-exception'])
    // K4：归属冲突文件的依赖不提升，冲突项注明未计入的条数
    const conflicts = r.list.items.filter(i => i.code === 'source.conflict')
    expect(conflicts.length).toBeGreaterThan(0)
    expect(conflicts.every(i => /^\d+ 条依赖因冲突未计入/.test(i.detail ?? ''))).toBe(true)
  })

  it('11. 关系的 via（K5b）：本项目经 HTTP / HMR / 路由 / 注入 / 回调的关系不判定，lint 0 个提醒', () => {
    const l = svc().load()
    expect(l.report.relations.get('rel.ad.desk-fetch')).toMatchObject({ status: 'skipped', via: 'http' })
    expect(l.report.relations.get('rel.p7.file-preview')).toMatchObject({ status: 'skipped', via: 'inject' })
    expect(l.report.issues.filter(i => i.severity !== 'error' && i.code.startsWith('fact.'))).toEqual([])
  })
})

describe('§6.13 意图验收（X4、X8）：命令行 / MCP 的 sketch-check 与 sketch archive 经同一查询核心', () => {
  const design = path.join(tmp, 'h5p-arch-desk', 'designs', 'gate')
  const write = (rel: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(design, rel)), { recursive: true })
    fs.writeFileSync(path.join(design, rel), text)
  }
  afterAll(() => fs.rmSync(design, { recursive: true, force: true }))

  it('活动草图对当前版本：骨架一致；设计的草图不一致时归档被拒绝，一致后归档改状态、为草图覆盖的模块写确认记录（source: sketch:gate）', () => {
    const s = svc()
    expect(s.sketchCheck().checks.map(c => [c.sketch, c.consistent])).toEqual([['skeleton', true]])
    write('design.yaml', 'design:\n  name: 门禁\n  status: accepted\n  revisions: []\n')
    write('sketches/root.yaml', 'sketch:\n  id: gate\n  mount: root\n  modules:\n    - { id: model, name: 模型层, kind: layer }\n')
    write(
      'sketches/model.intent.yaml',
      'sketch:\n  id: gate\n  mount: model.intent\n  modules:\n    - { id: model.intent.check, name: 核验 }\n    - { id: model.intent.nowhere, name: 不存在 }\n',
    )
    const bad = s.sketchCheck(undefined, 'gate')
    expect(bad.target).toBe('当前版本')
    // 根挂载的设计草图与骨架同挂载点、没声明 supersedes 即矛盾（X4、X10）；挂在 model.intent 上的那张缺模块
    expect(bad.checks.map(c => [c.mount, c.deviations.map(d => d.key)])).toEqual([
      ['root', ['contradiction:root']],
      ['model.intent', ['missing-module:model.intent.nowhere']],
    ])
    expect(bad.compare?.current.counts.added).toBe(1)
    expect(() => s.sketchArchive(undefined, 'gate')).toThrow('不能归档')
    expect(() => s.sketchCheck(undefined, 'nope')).toThrow('没有草图')
    fs.rmSync(path.join(design, 'sketches/root.yaml'))
    write('sketches/model.intent.yaml', 'sketch:\n  id: gate\n  mount: model.intent\n  modules:\n    - { id: model.intent.check, name: 核验 }\n')
    const r = s.sketchArchive(undefined, 'gate')
    expect(r).toMatchObject({
      project: 'h5p-arch-desk',
      outcome: 'archive',
      reviewed: { count: 1, file: expect.stringMatching(/h5p-arch-desk\/reviewed\.yaml$/) },
    })
    expect(fs.readFileSync(path.join(design, 'design.yaml'), 'utf8')).toContain('status: implemented')
    const reviewed = parse(fs.readFileSync(path.join(tmp, 'h5p-arch-desk', 'reviewed.yaml'), 'utf8')).reviewed as {
      module: string
      source: string
      hash: string
    }[]
    expect(reviewed.filter(e => e.source === 'sketch:gate')).toEqual([expect.objectContaining({ module: 'model.intent.check', hash: expect.any(String) })])
  })
})
