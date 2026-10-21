// @vitest-environment jsdom
/**
 * 验收：docs/01-requirements.md §6.10 架构治理，以真实的 model/ 描述与本机源码驱动 agent 接口的查询核心、协调者与面板。
 * agent 接口的两层外壳（命令行、MCP）只做参数与格式，这里直接驱动查询核心；h5player 源码不在本机时跳过对应用例。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { nextTick } from 'vue'
import { readProject } from '../../vite/readModelDir'
import { readSourceTree, workspaceRoot } from '../../vite/readSource'
import { readCodeDeps } from '../../vite/readDeps'
import { createService } from '../../scripts/agent/service'
import { createDeskState, type SourceFetcher } from '../../src/state/useDeskState'
import { DESK_STATE } from '../../src/state/inject'
import Panel from '../../src/components/panel/Panel.vue'
import type { SourcePayload } from '../../src/model'

const ROOT = path.resolve(import.meta.dirname, '../..')
const MODEL = path.join(ROOT, 'model')
const WS = workspaceRoot(ROOT)
const H5PLAYER_LOCAL = fs.existsSync(path.join(WS, 'h5player'))

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

  it.skipIf(!H5PLAYER_LOCAL)('3. h5player：@h5player/framework 的命名导入落在声明文件，经由 framework 入口', () => {
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

  it('5–6. 页面：开启「代码事实」，根层关系边有证实、叠加线可选中；根层面板显示架构治理', async () => {
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
    const p = readProject(MODEL, 'h5p-arch-desk', ROOT)!
    const desk = createDeskState(async () => p, { project: 'h5p-arch-desk', source })
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
})
