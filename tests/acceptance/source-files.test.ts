// @vitest-environment jsdom
/**
 * 验收：docs/01-requirements.md §6.4 源代码，以真实的 model/ 描述与本机源码目录驱动协调者与界面组件。
 * 源码经接入层的读取函数直接提供（等同开发服务器端点）；源码在本地是前提（G1），不设跳过。
 */
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { nextTick } from 'vue'
import { readProject } from '../../vite/readModelDir'
import { readExports, readSourceFile, readSourceTree } from '../../vite/readSource'
import { createDeskState, type SourceFetcher } from '../../src/state/useDeskState'
import { DESK_STATE } from '../../src/state/inject'
import NavTree from '../../src/components/tree/NavTree.vue'
import Panel from '../../src/components/panel/Panel.vue'
import SourceView from '../../src/components/source/SourceView.vue'
import { assignFiles, sourceIssues, type RawFile, type SourcePayload } from '../../src/model'

const ROOT = path.resolve(import.meta.dirname, '../..')
const MODEL = path.join(ROOT, 'model')

function nodeFetcher(project: string): SourceFetcher {
  const tree = () => readSourceTree(MODEL, project, ROOT) as SourcePayload
  return {
    tree: async () => tree(),
    file: async p => {
      const t = tree()
      return t.status === 'local' ? readSourceFile(t.root, t.files, p) : null
    },
    exports: async p => {
      const t = tree()
      return t.status === 'local' ? readExports(t.root, t.files, p) : null
    },
  }
}

const settle = async () => {
  for (let i = 0; i < 3; i++) {
    await flushPromises()
    await new Promise(r => setTimeout(r, 0))
  }
  await nextTick()
}

/** G11（V15c）：⑤ 证据与细节缺省折叠——按标题展开面板里的折叠节 */
const expand = async (panel: ReturnType<typeof mount>, title: string) => {
  const btn = panel.findAll('button.fold').find(b => b.text().includes(title))
  if (btn) await btn.trigger('click')
  await settle()
}

async function open(project: string, url = `/p/${project}`, extra: RawFile[] = []) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/p/:project', component: { render: () => null } }] })
  await router.push(url)
  const p = readProject(MODEL, project, ROOT)!
  const desk = createDeskState(async () => ({ ...p, files: [...p.files, ...extra] }), { project, source: nodeFetcher(project) })
  desk.attachRouter(router)
  await desk.init()
  await settle()
  const global = { provide: { [DESK_STATE as symbol]: desk }, plugins: [router] }
  const nav = mount(NavTree, { global })
  const panel = mount(Panel, { global })
  await settle()
  const tab = (name: string) => nav.findAll('[role=tab]').find(t => t.text() === name)!
  const fileRow = (f: string) => nav.findAll('.row.file').find(r => r.attributes('data-path') === f)
  return { desk, router, nav, panel, tab, fileRow, global }
}

describe('§6.4 源代码验收', () => {
  it('1. h5p-arch-desk 的文件页签列出本包源码，内部全部忽略的目录标为已忽略', async () => {
    const { nav, tab, fileRow } = await open('h5p-arch-desk')
    await tab('文件').trigger('click')
    await settle()
    expect(nav.find('.file-tree').text()).toContain(ROOT)
    expect(nav.findAll('.row.dir').some(r => r.attributes('data-dir') === 'src')).toBe(true)
    expect(fileRow('package.json')).toBeTruthy()
    // G18：docs/、model/、tests/ 内部全部忽略，目录本身也标为已忽略；src/ 不是
    const dirRow = (d: string) => nav.findAll('.row.dir').find(r => r.attributes('data-dir') === d)!
    expect(['docs', 'model', 'tests'].map(d => dirRow(d).classes().includes('ignored'))).toEqual([true, true, true])
    expect(dirRow('src').classes()).not.toContain('ignored')
  })

  it('2. 选中「导航树」：面板列出它的文件，文件树高亮这些文件；选中「呈现层」：文件是子树的并集', async () => {
    const { desk, nav, panel, tab, fileRow } = await open('h5p-arch-desk')
    desk.revealModule('present.nav-tree')
    await tab('文件').trigger('click')
    await settle()
    const files = desk.files.filesOf('present.nav-tree')
    expect(files).toEqual(expect.arrayContaining(['src/components/tree/NavTree.vue', 'src/components/tree/FileTree.vue', 'src/components/tree/ModuleTree.vue']))
    expect(panel.text()).toContain('源代码文件')
    await expand(panel, '源代码文件')
    expect(panel.text()).toContain('src/components/tree/FileTree.vue')
    expect(fileRow('src/components/tree/NavTree.vue')!.classes()).toContain('hit')
    expect(nav.findAll('.row.file.hit')).toHaveLength(files.length)

    desk.revealModule('present')
    await settle()
    const all = desk.files.filesOf('present')
    expect(all).toEqual(expect.arrayContaining([...files, 'src/components/GraphCanvas.vue', 'src/main.ts']))
    expect(all.every(f => !f.startsWith('src/model/'))).toBe(true)
  })

  it('3. 选中文件：URL 带 sel=f:，文件面板显示归属模块，画布上本层包含它的模块高亮，模块树展开到归属模块，副栏只读预览；刷新后仍选中', async () => {
    const file = 'src/components/tree/FileTree.vue'
    const { desk, router, panel, global } = await open('h5p-arch-desk')
    desk.selectFile(file)
    await settle()
    expect(router.currentRoute.value.query.sel).toBe(`f:${file}`)
    expect(desk.files.owners.value).toEqual(['present.nav-tree.files'])
    expect(panel.text()).toContain('归属模块')
    expect(panel.text()).toContain('文件树')
    // 根层是分层总览：高亮所在的带（呈现层）
    expect([...desk.files.hits.value!.nodes]).toContain('present')
    // 模块树展开到归属模块并标出
    const nav = mount(NavTree, { global })
    await settle()
    await nav
      .findAll('[role=tab]')
      .find(t => t.text() === '模块')!
      .trigger('click')
    await settle()
    expect(
      nav
        .findAll('.row')
        .find(r => r.attributes('data-id') === 'present.nav-tree.files')!
        .classes(),
    ).toContain('owner')
    // 下钻到呈现层：呈现层声明了分层（ADR-0052），导航树在「区块」层，区块层超七、普通成员折叠——高亮所在的带；临时展开后高亮导航树
    desk.goTo('present', { kind: 'file', id: file })
    await settle()
    expect([...desk.files.hits.value!.nodes]).toEqual(['s:present/block'])
    desk.toggleBand('s:present/block')
    await settle()
    // G14：分层总览高亮所在的带与路径上露出的模块
    expect([...desk.files.hits.value!.nodes]).toEqual(['s:present/block', 'present.nav-tree'])
    // G15、WS-8：选中文件即在资料区打开它的源代码预览标签
    expect(desk.workspace.state.value.groups[0].tabs).toEqual([{ id: `src:${file}`, doc: { kind: 'source', path: file }, preview: true }])
    expect(desk.workspace.dockShown.value).toBe(true)
    const view = mount(SourceView, { props: { path: file }, global })
    await settle()
    expect(view.text()).toContain('只读')
    expect(view.text()).toContain('文件树')
    expect(view.find('.code-view').text()).toContain('<script setup lang="ts">')
    // 刷新：同一地址重新打开
    const again = await open('h5p-arch-desk', router.currentRoute.value.fullPath)
    expect(again.desk.selection.value).toEqual({ kind: 'file', id: file })
    expect(again.desk.levelId.value).toBe('present')
  })

  it('4. 选中「模型层」：面板显示入口与导出，loadModel 与描述的接口对上，对不上的分组列出（ADR-0052：入口归模型层自身）', async () => {
    const { desk, panel } = await open('h5p-arch-desk', '/p/h5p-arch-desk?sel=m:model')
    expect(desk.files.entryOf('model')).toEqual({ file: 'src/model/index.ts', via: 'entry' })
    await settle()
    // G11（V15c）：入口文件并入「源代码文件」节（fold），入口导出折叠，展开再断言
    await expand(panel, '源代码文件')
    await expand(panel, '入口导出')
    const text = panel.text()
    expect(text).toContain('入口文件')
    expect(text).toContain('src/model/index.ts')
    expect(text).toContain('已对应描述的接口')
    expect(text).toContain('if.model.loadModel')
    expect(text).toContain('导出了但描述里没有')
  })

  it('5. 两个互不包含的模块写同一文件、或有文件没有模块匹配：页面与 lint 报警告；加入忽略清单后未归属警告消失', async () => {
    const conflict: RawFile = {
      path: 'modules/zz-conflict.yaml',
      text: 'modules: [{ id: present.extra, parent: present, name: Extra, responsibility: x, codeRefs: [src/components/tree/FileTree.vue] }]',
    }
    const narrowed: RawFile = { path: 'zz-ignore.yaml', text: 'sourceIgnore: []' }
    const { desk } = await open('h5p-arch-desk', '/p/h5p-arch-desk', [conflict, narrowed])
    expect(desk.allIssues.value.filter(i => i.code === 'source.conflict').map(i => i.message)).toEqual([expect.stringContaining('FileTree.vue')])

    // 不写忽略清单时，文档等文件都是未归属（页面与 lint 用同一套 sourceIssues）
    const p = readProject(MODEL, 'h5p-arch-desk', ROOT)!
    const files = p.files.filter(f => f.path !== 'source-ignore.yaml')
    const bare = await open('h5p-arch-desk', '/p/h5p-arch-desk')
    const { index } = (await import('../../src/model')).loadModel(files)
    const tree = readSourceTree(MODEL, 'h5p-arch-desk', ROOT)
    if (tree?.status !== 'local') throw new Error('本包源码应在本地')
    const lintIssues = sourceIssues(index, assignFiles(index, tree.files, index.model.sourceIgnore), tree)
    expect(lintIssues.some(i => i.code === 'source.unowned' && i.message.includes('docs/README.md'))).toBe(true)
    // 有忽略清单的真实描述：没有未归属
    expect(bare.desk.allIssues.value.filter(i => i.code === 'source.unowned')).toEqual([])
    expect(bare.desk.files.ownership.value!.ignored.has('docs/README.md')).toBe(true)
  })

  it('6. 资料区不跟随选中（WS-8、G15）：打开场景开时序图；选中文件开源代码预览；单步、选中模块不改资料区；退出场景关时序图', async () => {
    const { desk } = await open('h5p-arch-desk')
    const ws = desk.workspace
    const ids = () => ws.state.value.groups.flatMap(g => g.tabs.map(t => `${t.id}${t.preview ? '~' : ''}`))
    expect(ws.dockShown.value).toBe(false)
    desk.openScenario('sc.open-and-play')
    await settle()
    expect(ids()).toEqual(['seq'])
    desk.selectFile('src/state/useDeskState.ts')
    await settle()
    expect(desk.selected.value).toEqual({ kind: 'file', id: 'src/state/useDeskState.ts' })
    expect(ids()).toEqual(['seq', 'src:src/state/useDeskState.ts~'])
    expect(ws.state.value.groups[0].active).toBe('src:src/state/useDeskState.ts')
    const before = ws.state.value
    desk.next()
    await settle()
    expect(desk.selected.value!.kind).toBe('step')
    desk.select({ kind: 'module', id: 'state' })
    await settle()
    expect(ws.state.value).toBe(before)
    // 另一个文件：替换预览标签
    desk.selectFile('src/state/inject.ts')
    await settle()
    expect(ids()).toEqual(['seq', 'src:src/state/inject.ts~'])
    // 关掉标签后再选同一个文件：选中没变，不重新打开（只有选中变为另一个文件才打开）
    ws.dispatch({ type: 'close', group: 0, id: 'src:src/state/inject.ts' })
    desk.selectFile('src/state/inject.ts')
    await settle()
    expect(ids()).toEqual(['seq'])
    // 退出场景：时序图标签关闭，资料区随之消失
    desk.closeScenario()
    await settle()
    expect(ids()).toEqual([])
    expect(ws.dockShown.value).toBe(false)
  })

  it('h5player：Framework 的入口导出与描述的接口对应，描述的真实归属问题报为警告', async () => {
    const { desk } = await open('h5player', '/p/h5player?level=infra&sel=m:infra.framework')
    expect(desk.files.entryOf('infra.framework')).toEqual({ file: 'packages/framework/src/index.ts', via: 'index' })
    const exports = desk.files.exports('packages/framework/src/index.ts')
    await settle()
    expect(exports.value.status).toBe('ok')
    const match = desk.files.exportMatch('infra.framework', exports.value.status === 'ok' ? exports.value.value : [])!
    expect(match.matched.map(m => m.symbol.name)).toEqual(expect.arrayContaining(['Framework', 'Context']))
    expect(desk.allIssues.value.some(i => i.code === 'source.conflict')).toBe(true)
  })
})
