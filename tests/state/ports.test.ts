/**
 * 端口实体的视图状态与呈现数据（ADR-0029）：端口选中与 URL（V2、L13，sel=p:<接口 ID>）、画布的端口记号（L13：位置、实现者数、合并阈值、运行视角不画）、
 * 端口面板数据（K11）、治理面板的端口孤立（U14，当前版本）、子类与组装事实（K12、K13）。
 */
import { describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createDeskState, decodeSelection, encodeSelection, type SourceFetcher } from '../../src/state/useDeskState'
import { layoutView } from '../../src/layout/layout'
import { canvasScene, PORT_MERGE, type CanvasInput } from '../../src/layout/canvas'
import type { FactsPayload, FileDep, PortPanel, SourcePayload } from '../../src/model'
import { scenarioFiles } from '../fixtures/sample'

const flush = () => new Promise(r => setTimeout(r, 0))
const REFS = `
modules:
  - { id: app.solution.core, parent: app.solution, name: Core, responsibility: x, codeRefs: [src/app/**] }
  - { id: domain.models.core, parent: domain.models, name: Core, responsibility: x, codeRefs: [src/domain/**] }
  - { id: infra.framework.extra, parent: infra.framework, name: Extra, responsibility: x, codeRefs: [src/framework/**] }
relations:
  - { id: rpx, from: infra.player, to: app.solution, type: commands, via: 'port:if.plan' }
`
const LOCAL: SourcePayload = { status: 'local', root: '/repo', files: ['src/app/s.ts', 'src/domain/m.ts', 'src/framework/extra.ts'], packages: {} }
const dep = (from: string, to: string, extra: Partial<FileDep> = {}): FileDep => ({ from, to, via: to, kind: 'value', line: 1, ...extra })
const DEPS = [
  // K12：app.solution.core 的类 extends infra.framework.extra 的类
  dep('src/app/s.ts', 'src/framework/extra.ts', { inherits: [{ name: 'Base', clause: 'extends', decl: 'class' }], invokes: true, invokeKinds: ['extends'] }),
  // K13：domain.models.core new 了 infra.framework.extra 的类
  dep('src/domain/m.ts', 'src/framework/extra.ts', { invokes: true, invokeKinds: ['new'] }),
]
const facts: FactsPayload = { deps: { deps: DEPS, external: {}, parsed: 3 }, baseline: null, ledger: [] }
const fetcher: SourceFetcher = { tree: async () => LOCAL, file: async () => null, exports: async () => [], facts: async () => facts }

async function setup(url = '/', source: SourceFetcher | undefined = fetcher, version?: { design: string; revision: string }) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { render: () => null } }] })
  await router.push(url)
  const desk = createDeskState(async () => ({ dir: 'model/test', files: [...scenarioFiles(), { path: 'modules/zz-refs.yaml', text: REFS }] }), {
    ...(source ? { source } : {}),
    version,
  })
  desk.attachRouter(router)
  await desk.init()
  await flush()
  await nextTick()
  return { desk, router }
}

describe('V2、L13 端口选中', () => {
  it('sel=p:<接口 ID> 往返编码；从 URL 恢复为端口选中；不存在的接口被丢弃', async () => {
    expect(encodeSelection({ kind: 'port', id: 'if.plan' })).toBe('p:if.plan')
    expect(decodeSelection('p:if.plan')).toEqual({ kind: 'port', id: 'if.plan' })
    expect((await setup('/?level=app&sel=p:if.plan')).desk.selection.value).toEqual({ kind: 'port', id: 'if.plan' })
    expect((await setup('/?sel=p:if.ghost')).desk.selection.value).toBeNull()
  })

  it('选中端口写进 URL；选中是唯一主语（选中模块即取消端口）', async () => {
    const { desk, router } = await setup('/?level=app')
    desk.select({ kind: 'port', id: 'if.plan' })
    await flush()
    expect(router.currentRoute.value.query.sel).toBe('p:if.plan')
    desk.select({ kind: 'module', id: 'app.solution' })
    expect(desk.selection.value).toEqual({ kind: 'module', id: 'app.solution' })
  })
})

describe('K11 端口面板数据', () => {
  it('portOf：定义模块、实现者（描述的）、使用者（经端口）；portsOf 只列算端口的接口', async () => {
    const { desk } = await setup('/?level=app')
    const p = desk.facts.portOf('if.plan')!
    expect(p).toMatchObject({ port: 'if.plan', owner: 'app.solution', isPort: true })
    expect(p.implementers.map(i => [i.module, i.described])).toEqual([['infra.player', true]])
    expect(p.users.map(u => [u.relation, u.how, u.type])).toEqual([['rpx', 'port', 'commands']])
    expect(desk.facts.portsOf('app.solution').map(x => x.port)).toEqual(['if.plan'])
    // if.sm 没有实现者也没有经端口的使用者：不算端口
    expect(desk.facts.portsOf('infra.framework.sm')).toEqual([])
    expect(desk.facts.portOf('if.sm')!.isPort).toBe(false)
  })

  it('U14：治理面板显示当前版本的端口孤立——有实现者没有使用者为 info port.no-user；设计版本没有（只在 lint:model 报）', async () => {
    const { desk } = await setup()
    expect(desk.facts.portProblems.value.map(i => [i.code, i.severity])).toEqual([['port.no-user', 'info']])
    expect(desk.facts.portProblems.value[0].message).toContain('if.model')
    const design = await setup('/', fetcher, { design: 'd', revision: 'r1' })
    expect(design.desk.facts.portProblems.value).toEqual([])
  })
})

describe('L13 画布的端口记号', () => {
  it('普通层次：定义了端口的子模块带记号（实现者数），按布局方向取进边一侧；运行视角不画', async () => {
    const { desk } = await setup('/?level=app')
    const marks = desk.facts.portMarks.value!
    // 子模块与边界节点（domain 的子树定义了 if.model）
    expect([...marks.keys()]).toEqual(['app.solution', 'domain'])
    const input: CanvasInput = {
      positioned: await layoutView(desk.view.value!),
      index: desk.index.value,
      selection: { kind: 'port', id: 'if.plan' },
      hover: null,
      stage: null,
      scenarioView: null,
      emphasis: null,
      participants: new Map(),
      mode: 'hide',
      reveal: [],
      diff: null,
      fileHits: null,
      branchPointId: null,
      ports: marks,
    }
    const scene = canvasScene(input)
    const node = scene.nodes.find(n => n.id === 'app.solution')!
    expect(node.data.ports).toEqual({
      side: input.positioned!.direction === 'RIGHT' ? 'left' : 'top',
      items: [{ id: 'if.plan', name: 'Plan', implementers: 1 }],
      selected: 'if.plan',
    })
    expect(scene.nodes.filter(n => n.data.ports).map(n => n.id)).toEqual(['app.solution', 'boundary:domain'])
    // 边界节点的进边在顶边
    expect(scene.nodes.find(n => n.id === 'boundary:domain')!.data.ports).toMatchObject({ side: 'top', items: [{ id: 'if.model', implementers: 2 }] })
    // 超过 3 个合成「端口 ×N」
    const many: PortPanel[] = Array.from({ length: PORT_MERGE + 1 }, (_, i) => ({ port: 'if.plan', isPort: true, implementers: [], users: [], owner: `x${i}` }))
    const merged = canvasScene({ ...input, ports: new Map([['app.solution', many]]) }).nodes.find(n => n.id === 'app.solution')!
    expect(merged.data.ports).toMatchObject({ items: [], merged: PORT_MERGE + 1 })
    desk.openScenario('sc.play')
    expect(desk.facts.portMarks.value).toBeNull()
  })

  it('分层总览只画核心模块的端口', async () => {
    const { desk } = await setup('/')
    const marks = desk.facts.portMarks.value!
    const cores = new Set(desk.view.value!.nodes.filter(n => n.role === 'core').map(n => n.moduleId))
    for (const id of marks.keys()) expect(cores.has(id)).toBe(true)
    expect(marks.has('app.solution')).toBe(true)
    // domain.models 不是核心：它的端口 if.model 在分层总览不画
    expect(marks.has('domain.models')).toBe(false)
  })
})

describe('K12、K13 子类与组装事实（面板「知识」行旁）', () => {
  it('structureOf：基类 / 子类、组装 / 被组装于、组装根；structureBetween：两端之间（任一方向、含子树）', async () => {
    const { desk } = await setup()
    const extra = desk.facts.structureOf('infra.framework.extra')!
    expect(extra.subclasses.map(f => f.key)).toEqual(['app.solution.core->infra.framework.extra'])
    expect(extra.assembledBy.map(f => f.key)).toEqual(['domain.models.core->infra.framework.extra'])
    const dom = desk.facts.structureOf('domain.models')!
    expect(dom.assembles.map(f => f.to)).toEqual(['infra.framework.extra'])
    expect(desk.facts.structureOf('domain.models.core')!.root).toBe(true)
    const b = desk.facts.structureBetween('infra', 'app')
    expect([b.subclass.length, b.assembly.length]).toEqual([1, 0])
    const design = await setup('/', fetcher, { design: 'd', revision: 'r1' })
    expect(design.desk.facts.structureOf('infra')).toBeNull()
  })
})
