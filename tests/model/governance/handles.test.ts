/**
 * 把手（ADR-0033）：L23b 束的把手数 M 与按所属子模块分组的悬停数据、L20b 表面元素所属的子模块（接口 owner / 声明文件的归属）。
 */
import { describe, expect, it } from 'vitest'
import { bundleHandles, elementOwner, elementSub, loadModel, subUnder, type SurfaceElement } from '@/model'

const MODEL = `
modules:
  - id: fam
    name: 族
    responsibility: 发起方
    children:
      - { id: fam.session, name: 会话, responsibility: 会话 }
      - { id: fam.video, name: 视频, responsibility: 视频 }
  - id: lat
    name: 延迟
    responsibility: 接收方
    provides: [if.law]
    children:
      - { id: lat.law, name: 律, responsibility: 律 }
      - { id: lat.run, name: 运行, responsibility: 运行, provides: [if.run] }
      - id: lat.timers
        name: 计时器
        responsibility: 计时器
        children:
          - { id: lat.timers.hold, name: 保持, responsibility: 保持 }
  - { id: other, name: 其他, responsibility: 别处 }
interfaces:
  - { id: if.run, name: runLaw, signature: 'runLaw(): void' }
  - { id: if.hold, name: HoldUnseen, owner: lat.timers.hold, signature: 'class HoldUnseen {}' }
  - { id: if.within, name: within, owner: lat.timers, signature: 'within(): void' }
  - { id: if.law, name: decide, owner: lat, signature: 'decide(): void' }
  - { id: if.ext, name: Sink, owner: other, signature: 'interface Sink {}' }
relations:
  - { id: r.run, from: fam.session, to: lat.run, type: commands, interface: if.run }
  - { id: r.hold, from: fam.session, to: lat.timers.hold, type: commands, interface: if.hold }
  - { id: r.hold2, from: fam.video, to: lat.timers.hold, type: commands, interface: if.hold }
  - { id: r.within, from: fam.video, to: lat.timers, type: commands, interface: if.within }
  - { id: r.law, from: fam.session, to: lat, type: commands, interface: if.law }
  - { id: r.bare, from: fam.video, to: lat.law, type: commands }
  - { id: r.ext, from: fam.video, to: lat, type: commands, interface: if.ext }
`

const { index } = loadModel([
  { path: 'system.yaml', text: 'system: { id: sys, name: Sys }' },
  { path: 'modules/m.yaml', text: MODEL },
])

describe('L23b：束的把手', () => {
  it('subUnder：owner 在接收方之下的那一级；owner 即接收方、不在子树内或未知为本体（null）', () => {
    expect(subUnder(index, 'lat', 'lat.timers.hold')).toBe('lat.timers')
    expect(subUnder(index, 'lat', 'lat.run')).toBe('lat.run')
    expect(subUnder(index, 'lat', 'lat')).toBeNull()
    expect(subUnder(index, 'lat', 'other')).toBeNull()
    expect(subUnder(index, 'lat', null)).toBeNull()
  })

  it('M = 接收方表面上不同接口的个数：重复接口算一个，没写接口与不在接收方表面上的不计；provides 写的接口算接收方的', () => {
    const h = bundleHandles(index, 'lat', ['r.run', 'r.hold', 'r.hold2', 'r.within', 'r.law', 'r.bare', 'r.ext'])
    expect(h.relations).toBe(7)
    expect(h.handles).toBe(4)
  })

  it('按所属子模块分组、组按条数降序（同数时子模块按声明顺序、本体在后）；各条带接口名与种类', () => {
    const h = bundleHandles(index, 'lat', ['r.run', 'r.hold', 'r.hold2', 'r.within', 'r.law', 'r.bare', 'r.ext'])
    expect(h.groups.map(g => [g.sub, g.items.map(x => x.relation)])).toEqual([
      ['lat.timers', ['r.hold', 'r.hold2', 'r.within']],
      [null, ['r.law', 'r.bare', 'r.ext']],
      ['lat.run', ['r.run']],
    ])
    expect(h.groups[0].items[0]).toMatchObject({ name: 'HoldUnseen', interface: 'if.hold', handle: true, type: 'commands' })
    expect(h.groups[1].items.map(x => [x.name, x.handle])).toEqual([
      ['decide', true],
      [null, false],
      ['Sink', false],
    ])
  })

  it('接收方提升为上层（分层总览的层）时，子模块取该层之下的那一级', () => {
    const h = bundleHandles(index, 'lat.timers', ['r.hold', 'r.within'])
    expect(h.handles).toBe(2)
    expect(h.groups.map(g => g.sub)).toEqual(['lat.timers.hold', null])
  })
})

describe('L20b：表面元素所属的子模块', () => {
  const el = (x: Partial<SurfaceElement>): SurfaceElement => ({ module: 'lat', name: 'x', kind: 'operation', state: 'declared', ...x })
  const own = { owners: new Map([['src/lat/timers/t.ts', ['lat.timers.hold']]]) }

  it('匹配接口的取接口 owner（没写 owner 取 provides 它的模块），否则取声明文件的归属；都没有为 null', () => {
    expect(elementOwner(index, own, el({ interfaceId: 'if.run' }))).toBe('lat.run')
    expect(elementOwner(index, own, el({ file: 'src/lat/timers/t.ts' }))).toBe('lat.timers.hold')
    expect(elementOwner(index, own, el({ file: 'src/none.ts' }))).toBeNull()
    expect(elementSub(index, own, 'lat', el({ file: 'src/lat/timers/t.ts' }))).toBe('lat.timers')
    expect(elementSub(index, own, 'lat', el({ interfaceId: 'if.law' }))).toBeNull()
  })
})
