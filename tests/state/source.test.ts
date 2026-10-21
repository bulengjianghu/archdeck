/**
 * 视图状态层的源码部分：文件选中（G16）、源码同步（G2）、协调者的派生（G9、G13、G14）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createDeskState, decodeSelection, encodeSelection, type ModelPayload, type SourceFetcher } from '../../src/state/useDeskState'
import { httpSourceFetcher } from '../../src/components/source/httpSource'
import { createSourceSync } from '../../src/state/sync/source'
import { selectedOf } from '../../src/state/transition'
import type { SourcePayload } from '../../src/model'
import { sampleFiles, scenarioFiles } from '../fixtures/sample'

const flush = () => new Promise(r => setTimeout(r, 0))

const REFS = `
modules:
  - { id: infra.framework.extra, parent: infra.framework, name: Extra, responsibility: x, codeRefs: [src/framework/extra.ts] }
sourceIgnore: [docs/**]
`
const LOCAL: SourcePayload = {
  status: 'local',
  root: '/repo',
  files: ['docs/a.md', 'src/framework/extra.ts', 'src/stray.ts'],
  packages: {},
}
const fetcher = (tree: SourcePayload = LOCAL): SourceFetcher => ({
  tree: async () => tree,
  file: async p => ({ path: p, text: `// ${p}`, lang: 'typescript' }),
  exports: async () => [],
})

async function setup(url = '/', opts: { files?: ModelPayload['files']; source?: SourceFetcher; version?: { design: string; revision: string } } = {}) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { render: () => null } }] })
  await router.push(url)
  const files = opts.files ?? [...scenarioFiles(), { path: 'modules/zz-refs.yaml', text: REFS }]
  const desk = createDeskState(async () => ({ dir: 'model/test', files }), { source: opts.source ?? fetcher(), version: opts.version })
  desk.attachRouter(router)
  await desk.init()
  await flush()
  await nextTick()
  return { desk, router }
}

describe('G16 文件是一种选中', () => {
  it('sel=f:<路径> 往返编码', () => {
    const s = { kind: 'file', id: 'src/a/b.ts' } as const
    expect(encodeSelection(s)).toBe('f:src/a/b.ts')
    expect(decodeSelection('f:src/a/b.ts')).toEqual(s)
  })
  it('从 URL 恢复文件选中；选中文件只替换地址', async () => {
    const { desk, router } = await setup('/?sel=f:src/framework/extra.ts')
    expect(desk.selection.value).toEqual({ kind: 'file', id: 'src/framework/extra.ts' })
    const before = router.options.history.state.position
    desk.selectFile('src/stray.ts')
    await flush()
    expect(router.currentRoute.value.query.sel).toBe('f:src/stray.ts')
    expect(router.options.history.state.position).toBe(before)
  })
  it('运行视角下选中文件（V3、G16），取消选中回到进度所在的步骤或场景（V4）', async () => {
    const { desk } = await setup()
    desk.openScenario('sc.play')
    desk.selectFile('src/framework/extra.ts')
    expect(selectedOf(desk.state.value)).toEqual({ kind: 'file', id: 'src/framework/extra.ts' })
    expect(desk.run.participation.value).toBeNull()
    desk.select(null)
    expect(selectedOf(desk.state.value)).toEqual({ kind: 'scenario', id: 'sc.play' })
  })
})

describe('G2 源码同步', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('构建态：清单端点 404 → unavailable；文件 404 → missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })))
    const f = httpSourceFetcher('p')
    expect(await f.tree()).toEqual({ status: 'unavailable' })
    const sync = createSourceSync(f)
    await sync.refresh()
    expect(sync.tree.value).toEqual({ status: 'unavailable' })
    const r = sync.file('a.ts')
    await flush()
    expect(r.value).toEqual({ status: 'missing' })
  })
  it('文件按路径缓存，刷新清单时作废', async () => {
    const file = vi.fn(async (p: string) => ({ path: p, text: 'x', lang: 'text' }))
    const sync = createSourceSync({ ...fetcher(), file })
    await sync.refresh()
    const a = sync.file('a.ts')
    expect(sync.file('a.ts')).toBe(a)
    await flush()
    expect(a.value).toEqual({ status: 'ok', value: { path: 'a.ts', text: 'x', lang: 'text' } })
    await sync.refresh()
    expect(sync.file('a.ts')).not.toBe(a)
    expect(file).toHaveBeenCalledTimes(2)
  })
  it('取清单失败：作为「不在本地」显示原因，不抛错', async () => {
    const sync = createSourceSync({ ...fetcher(), tree: async () => Promise.reject(new Error('boom')) })
    await sync.refresh()
    expect(sync.tree.value).toMatchObject({ status: 'absent', reason: expect.stringContaining('boom') })
  })
  it('未注入源码来源时等同构建态', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { render: () => null } }] })
    const desk = createDeskState(async () => ({ dir: 'm', files: sampleFiles() }))
    desk.attachRouter(router)
    await desk.init()
    await flush()
    expect(desk.files.payload.value).toEqual({ status: 'unavailable' })
    expect(desk.files.tree.value).toBeNull()
  })
})

describe('协调者的源码派生', () => {
  it('G9：当前版本的归属警告并入问题列表；设计版本不报', async () => {
    const { desk } = await setup()
    expect(desk.files.ownership.value?.unowned).toEqual(['src/stray.ts'])
    expect(desk.allIssues.value.filter(i => i.code === 'source.unowned').map(i => i.message)).toEqual([expect.stringContaining('src/stray.ts')])
    const design = await setup('/', { version: { design: 'd', revision: 'r1' } })
    expect(design.desk.files.ownership.value?.unowned).toEqual(['src/stray.ts'])
    expect(design.desk.files.warnings.value).toEqual([])
  })
  it('G13：选中模块时给出其文件（子树并集）', async () => {
    const { desk } = await setup()
    desk.select({ kind: 'module', id: 'infra' })
    expect([...desk.files.moduleFiles.value]).toEqual(['src/framework/extra.ts'])
    expect(desk.files.filesOf('infra.framework')).toEqual(['src/framework/extra.ts'])
  })
  it('G14：选中文件时给出归属模块及其在当前层次的投影', async () => {
    const { desk } = await setup('/?level=infra')
    desk.selectFile('src/framework/extra.ts')
    expect(desk.files.owners.value).toEqual(['infra.framework.extra'])
    expect([...desk.files.hits.value!.nodes]).toEqual(['infra.framework'])
    desk.goTo('infra.framework.extra', { kind: 'file', id: 'src/framework/extra.ts' })
    expect(desk.files.hits.value).toEqual({ nodes: new Set(), self: true })
  })
  it('描述重新加载时重新取源码清单', async () => {
    let n = 0
    const f = { ...fetcher(), tree: async () => (n++, LOCAL) }
    const { desk } = await setup('/', { source: f })
    expect(n).toBe(1)
    await desk.reload()
    await flush()
    expect(n).toBe(2)
  })
})
