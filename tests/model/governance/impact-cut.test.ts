/** K15d：可截断处与「可能波及」（ADR-0037）——按名字对被依赖方的具名契约判，再导出透传；只标传入闭包 */
import { describe, expect, it } from 'vitest'
import { assignFiles, contractOf, cuttableDep, governanceReport, impactOf, levelImpact, loadModel, projectLevel, type FileDep } from '@/model'
import { files, SRC } from './helpers'

const named = (from: string, to: string, names: string[], extra: Partial<FileDep> = {}): FileDep => ({
  from,
  to,
  via: to,
  kind: 'value',
  line: 1,
  names,
  uses: true,
  invokes: true,
  ...extra,
})

/** core.api 声明接口 get 与数据结构 Item */
const withContract = () =>
  files().map(f =>
    f.path === 'modules/layers.yaml'
      ? { ...f, text: f.text.replace('provides: [if.get] }', 'provides: [if.get], dataStructures: [ds.Item] }') + 'dataStructures:\n  - { id: ds.Item, name: Item }\n' }
      : f,
  )

function setupCut(deps: FileDep[]) {
  const { index } = loadModel(withContract())
  const own = assignFiles(index, SRC, [])
  const report = governanceReport(index, own, { files: SRC, packages: {} }, { deps, external: {}, parsed: SRC.length }, null)
  return { index, report }
}

const API = 'src/core/api/client.ts'
const D1 = named('src/ui/store/s.ts', API, ['get', 'Item']) // 只用具名契约：可截断
const D2 = named('src/ui/view/a.ts', 'src/ui/store/s.ts', ['useStore']) // 契约外的名字：不可截断
const D3: FileDep = { from: 'src/core/impl/i.ts', to: API, via: API, kind: 'value', line: 1, names: ['get', 'secret'], reexport: true } // 再导出：透传
const D4 = named('src/core/util/u.ts', 'src/core/impl/i.ts', ['x'])
const D5 = named('src/ui/view/a.ts', API, ['secret']) // 契约外：不可截断

describe('K15d 可截断处', () => {
  it('具名契约 = 子树声明的接口与数据结构的名字', () => {
    const { index } = setupCut([])
    expect([...contractOf(index, 'core.api')].sort()).toEqual(['Item', 'get'])
    expect([...contractOf(index, 'core')].sort()).toEqual(['Item', 'get'])
    expect(contractOf(index, 'ui.view').size).toBe(0)
  })

  it('每条文件依赖都只经具名契约或只是再导出才可截断；整模块导入、契约外的名字、子类不可截断', () => {
    const { index } = setupCut([])
    const d = (fs: FileDep[]) => ({ to: 'core.api', files: fs })
    expect(cuttableDep(index, d([D1]))).toBe(true)
    expect(cuttableDep(index, d([D3]))).toBe(true)
    expect(cuttableDep(index, d([D1, D5]))).toBe(false)
    expect(cuttableDep(index, d([named('src/ui/store/s.ts', API, [])]))).toBe(false)
    expect(cuttableDep(index, d([{ ...D1, names: undefined }]))).toBe(false)
    expect(cuttableDep(index, d([{ ...D1, inherits: [{ name: 'get', clause: 'extends', decl: 'class' }] }]))).toBe(false)
    expect(cuttableDep(index, d([{ ...D1, inherits: [{ name: 'get', clause: 'implements', decl: 'interface' }] }]))).toBe(true)
    // 再导出之外又用了实现的不算透传
    expect(cuttableDep(index, d([{ ...D3, uses: true }]))).toBe(false)
    expect(cuttableDep(index, d([]))).toBe(false)
  })

  it('传入闭包：只能经可截断依赖到达的为可能波及，有一条不经可截断依赖的路径即必然波及；距离仍取最短；传出闭包不标', () => {
    const { index, report } = setupCut([D1, D2, D3, D4])
    const tag = (es: { module: string; distance: number; possible?: true }[]) => es.map(e => `${e.module}@${e.distance}${e.possible ? '?' : ''}`)
    expect(tag(impactOf(index, report, 'core.api')!.incoming)).toEqual(['core.impl@1?', 'ui.store@1?', 'core.util@2?', 'ui.view@2?'])
    const firm = setupCut([D1, D2, D3, D4, D5])
    expect(tag(impactOf(firm.index, firm.report, 'core.api')!.incoming)).toEqual(['core.impl@1?', 'ui.store@1?', 'ui.view@1', 'core.util@2?'])
    expect(impactOf(index, report, 'ui.view')!.outgoing.every(e => !e.possible)).toBe(true)
  })

  it('本层投影：节点下的传入命中全是可能波及时节点为可能波及', () => {
    const cut = setupCut([D1, D2])
    const root = (s: ReturnType<typeof setupCut>) => levelImpact(s.index, projectLevel(s.index, s.index.rootId), impactOf(s.index, s.report, 'core.api')!)
    expect(root(cut).get('ui')).toEqual({ direction: 'in', distance: 1, inCycle: false, possible: true })
    const mixed = setupCut([D1, D2, D5])
    expect(root(mixed).get('ui')).toEqual({ direction: 'in', distance: 1, inCycle: false })
  })
})
