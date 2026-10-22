/**
 * 草图的编辑与校验（docs/02-domain.md §2.21 X7b–X7f，ADR-0024）。按规则清单逐条穷举。
 */
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import {
  applyEdit,
  idImpact,
  load,
  loadModel,
  seedSketch,
  sketchCheck,
  sketchContradictions,
  sketchText,
  validateSketch,
  type EditContext,
  type EditOp,
  type SketchDef,
  type SketchEntity,
} from '../../src/model'

const SKELETON: SketchDef = {
  id: 'skeleton',
  lifetime: 'persistent',
  closed: ['ui'],
  modules: [
    { id: 'ui', name: 'UI', kind: 'layer', order: 1, mayDependOn: ['core'], responsibility: 'u', children: [{ id: 'ui.view', name: 'View', responsibility: 'v' }] },
    { id: 'core', name: 'Core', kind: 'layer', order: 2, responsibility: 'c' },
  ],
}
const persistent: SketchEntity[] = [{ def: SKELETON, file: 'intent/skeleton.yaml', src: { file: 'intent/skeleton.yaml', path: 'sketch' } }]
const design: EditContext = { persistent, designSketch: true }
const own: EditContext = { persistent: [], designSketch: false }

const DRAFT: SketchDef = {
  id: 'd',
  modules: [
    {
      id: 'core.a',
      parent: 'core',
      name: 'A',
      responsibility: 'a',
      children: [{ id: 'core.a.x', name: 'X', responsibility: 'x' }],
    },
    { id: 'core.b', parent: 'core', name: 'B', responsibility: 'b' },
    { id: 'core.a.y', parent: 'core.a', name: 'Y', responsibility: 'y' },
  ],
  closed: ['core.a'],
  relations: [
    { id: 'rel.x-b', from: 'core.a.x', to: 'core.b', type: 'calls', interface: 'if.a.run' },
    { id: 'rel.b-view', from: 'core.b', to: 'ui.view', type: 'depends' },
  ],
  interfaces: [{ id: 'if.a.run', name: 'run', owner: 'core.a' }],
}

const ok = (sketch: SketchDef, op: EditOp, ctx = design) => {
  const r = applyEdit(sketch, op, ctx)
  if (!r.ok) throw new Error(`${r.code}: ${r.reason}`)
  return r
}
const no = (sketch: SketchDef, op: EditOp, ctx = design) => {
  const r = applyEdit(sketch, op, ctx)
  if (r.ok) throw new Error('应当被拒绝')
  return r
}

describe('X7b 编辑操作是纯函数，只拒绝不成立的操作', () => {
  it('不修改输入；同样输入同样输出', () => {
    const before = structuredClone(DRAFT)
    const a = ok(DRAFT, { op: 'addModule', parent: 'core', name: 'New Thing' })
    const b = ok(DRAFT, { op: 'addModule', parent: 'core', name: 'New Thing' })
    expect(DRAFT).toEqual(before)
    expect(a).toEqual(b)
  })

  it('拒绝：目标不存在、ID 已占用、前缀不符、同一对同类型关系已有、连祖先与后代、设计草图改动持久草图的模块', () => {
    expect(no(DRAFT, { op: 'removeModule', id: 'core.zz' }).code).toBe('not-found')
    expect(no(DRAFT, { op: 'addModule', parent: 'core', name: 'B', id: 'core.b' }).code).toBe('id-taken')
    expect(no(DRAFT, { op: 'addModule', parent: 'core', name: 'Q', id: 'ui.q' }).code).toBe('id-prefix')
    expect(no(DRAFT, { op: 'connect', from: 'core.a.x', to: 'core.b', type: 'calls' }).code).toBe('duplicate-relation')
    expect(no(DRAFT, { op: 'connect', from: 'core.a', to: 'core.a.x', type: 'calls' }).code).toBe('ancestor')
    expect(no(DRAFT, { op: 'moveModule', id: 'ui.view', parent: 'core' }).code).toBe('persistent')
    expect(no(DRAFT, { op: 'updateModule', id: 'ui', patch: { name: 'X' } }).code).toBe('persistent')
  })

  it('结构问题照常应用、交给校验：层依赖成环可以先连上', () => {
    const r = ok(SKELETON, { op: 'setMayDependOn', id: 'core', layers: ['ui'] }, own)
    expect(r.sketch.modules![1].mayDependOn).toEqual(['ui'])
    expect(validateSketch(r.sketch, { persistent: [], file: 'intent/skeleton.yaml' }).issues.map(i => i.code)).toContain('sketch.layer-cycle')
  })

  it('新模块跟随父模块的写法：父在本草图里就嵌进 children，否则平铺写 parent', () => {
    const nested = ok(DRAFT, { op: 'addModule', parent: 'core.a', name: 'Z' }).sketch
    expect(nested.modules![0].children!.map(c => c.id)).toEqual(['core.a.x', 'core.a.z'])
    const flat = ok(DRAFT, { op: 'addModule', parent: 'ui', name: 'Panel' }).sketch
    expect(flat.modules!.at(-1)).toEqual({ id: 'ui.panel', name: 'Panel', parent: 'ui' })
  })

  it('加层按插入位置给 order、其后顺延；层排序重排为 1…N', () => {
    const added = ok(SKELETON, { op: 'addLayer', name: 'Share', at: 1 }, own).sketch
    expect(added.modules!.map(m => [m.id, m.order])).toEqual([
      ['ui', 1],
      ['core', 3],
      ['share', 2],
    ])
    const moved = ok(added, { op: 'reorderLayer', id: 'ui', to: 2 }, own).sketch
    expect(Object.fromEntries(moved.modules!.map(m => [m.id, m.order]))).toEqual({ share: 1, core: 2, ui: 3 })
  })

  it('改字段：空值删掉字段；setClosed 增删 closed；setMeta 改 lifetime / supersedes', () => {
    const r = ok(DRAFT, { op: 'updateModule', id: 'core.b', patch: { responsibility: '', core: true, name: ' B2 ' } }).sketch
    expect(r.modules![1]).toEqual({ id: 'core.b', parent: 'core', name: 'B2', core: true })
    expect(ok(DRAFT, { op: 'setClosed', id: 'core.a', closed: false }).sketch.closed).toBeUndefined()
    expect(ok(DRAFT, { op: 'setClosed', id: 'core.b', closed: true }).sketch.closed).toEqual(['core.a', 'core.b'])
    expect(ok(DRAFT, { op: 'setMeta', patch: { supersedes: 'skeleton' } }).sketch.supersedes).toBe('skeleton')
    expect(no(DRAFT, { op: 'setMeta', patch: { supersedes: 'nope' } }).code).toBe('not-found')
  })
})

describe('X7c ID 生成', () => {
  it('模块 = 父 ID + kebab-case 短名；中文名为 m1、m2…；重名加序号', () => {
    expect(ok(DRAFT, { op: 'addModule', parent: 'core', name: 'Edit Session' }).effects.created).toEqual(['core.edit-session'])
    expect(ok(DRAFT, { op: 'addModule', parent: 'core', name: '编辑' }).effects.created).toEqual(['core.m1'])
    expect(ok(DRAFT, { op: 'addModule', parent: 'core', name: 'b' }).effects.created).toEqual(['core.b-2'])
  })

  it('关系 = rel.<from 短名>-<to 短名>；同一对已有别的类型时加类型后缀（L5）', () => {
    const one = ok(DRAFT, { op: 'connect', from: 'core.a.y', to: 'core.b', type: 'calls' })
    expect(one.effects.created).toEqual(['rel.y-b'])
    const two = ok(one.sketch, { op: 'connect', from: 'core.a.y', to: 'core.b', type: 'notifies' })
    expect(two.effects.created).toEqual(['rel.y-b-notifies'])
  })

  it('接口 = if.<owner 短路径>.<名称>', () => {
    expect(ok(DRAFT, { op: 'addInterface', owner: 'core.b', name: 'save' }).effects.created).toEqual(['if.b.save'])
  })
})

describe('X7d 移动与改 ID', () => {
  it('移动 = 改父 + 改 ID：级联后代（嵌套与平铺）、关系两端、接口 owner、closed；关系与接口自身 ID 不变', () => {
    const r = ok(DRAFT, { op: 'moveModule', id: 'core.a', parent: 'ui' })
    expect(r.effects.renamed).toEqual([
      ['core.a', 'ui.a'],
      ['core.a.x', 'ui.a.x'],
      ['core.a.y', 'ui.a.y'],
    ])
    const s = r.sketch
    expect(s.modules!.find(m => m.id === 'ui.a')).toMatchObject({ parent: 'ui', children: [{ id: 'ui.a.x' }] })
    expect(s.modules!.find(m => m.id === 'ui.a.y')).toMatchObject({ parent: 'ui.a' })
    expect(s.relations![0]).toMatchObject({ id: 'rel.x-b', from: 'ui.a.x' })
    expect(s.interfaces![0]).toMatchObject({ id: 'if.a.run', owner: 'ui.a' })
    expect(s.closed).toEqual(['ui.a'])
  })

  it('撤销 = 回到移动前的值（同一个操作的反向）', () => {
    const moved = ok(DRAFT, { op: 'moveModule', id: 'core.a', parent: 'ui' }).sketch
    const back = ok(moved, { op: 'moveModule', id: 'ui.a', parent: 'core' }).sketch
    expect(new Set(load([{ path: 'sketch.yaml', text: sketchText(back) }]).model.modules.map(m => m.id))).toEqual(new Set(['core.a', 'core.a.x', 'core.b', 'core.a.y']))
  })

  it('改 ID 只改短名 = 父不变的移动，同一级联；换父前缀被拒绝', () => {
    const r = ok(DRAFT, { op: 'renameModule', id: 'core.a', newId: 'core.alpha' })
    expect(r.effects.renamed[0]).toEqual(['core.a', 'core.alpha'])
    expect(r.sketch.relations![0].from).toBe('core.alpha.x')
    expect(no(DRAFT, { op: 'renameModule', id: 'core.a', newId: 'ui.a' }).code).toBe('id-prefix')
  })

  it('不能移到自己的后代之下', () => {
    expect(no(DRAFT, { op: 'moveModule', id: 'core.a', parent: 'core.a.x' }).code).toBe('ancestor')
  })

  it('idImpact：草图内改写条数与当前版本里引用旧 ID 的条数', () => {
    const { index } = loadModel([
      { path: 'system.yaml', text: 'system: { id: s, name: S }' },
      { path: 'm.yaml', text: 'modules: [{ id: core, name: C, kind: layer, order: 1, children: [{ id: core.a, name: A, children: [{ id: core.a.deep, name: D }] }, { id: core.b, name: B }] }]\nrelations: [{ id: r1, from: core.a.deep, to: core.b, type: calls }]' },
    ])
    const impact = idImpact(DRAFT, design, 'core.a', 'ui', undefined, index)
    expect(impact.renamed).toHaveLength(3)
    expect(impact.references).toBe(3) // rel.x-b 起点、if.a.run 的 owner、closed
    expect(impact.outside).toEqual({ modules: 2, relations: 1, interfaces: 0, messages: 0 })
    expect(idImpact(DRAFT, design, 'ui.view', 'core').rejected).toMatch(/持久草图/)
  })
})

describe('X7e 删除级联', () => {
  it('删子树（嵌套与平铺），级联删两端落在子树内的关系、owner 在子树内的接口、closed 与经由接口的引用', () => {
    const r = ok(DRAFT, { op: 'removeModule', id: 'core.a' })
    expect(r.sketch.modules!.map(m => m.id)).toEqual(['core.b'])
    expect(r.sketch.relations!.map(x => x.id)).toEqual(['rel.b-view'])
    expect(r.sketch.interfaces).toEqual([])
    expect(r.sketch.closed).toBeUndefined()
    expect(r.effects.removed.sort()).toEqual(['core.a', 'core.a.x', 'core.a.y', 'if.a.run', 'rel.x-b'].sort())
  })

  it('删层同删除模块；删层后 mayDependOn 里的引用一并去掉', () => {
    const r = ok(SKELETON, { op: 'removeModule', id: 'core' }, own)
    expect(r.sketch.modules!.map(m => m.id)).toEqual(['ui'])
    expect(r.sketch.modules![0].mayDependOn).toEqual([])
  })

  it('删关系、删接口（同时去掉关系上的经由接口）', () => {
    expect(ok(DRAFT, { op: 'removeRelation', id: 'rel.b-view' }).sketch.relations!.map(r => r.id)).toEqual(['rel.x-b'])
    expect(ok(DRAFT, { op: 'removeInterface', id: 'if.a.run' }).sketch.relations![0].interface).toBeUndefined()
  })
})

describe('X7f 草图校验', () => {
  const v = (s: SketchDef) => validateSketch(s, { persistent, file: 'designs/d/sketch.yaml' })
  const codes = (s: SketchDef) => v(s).issues.map(i => i.code)

  it('合法草图：ok，没有 error', () => {
    expect(v(DRAFT)).toEqual({ ok: true, issues: [] })
  })

  it('格式错误（schema）：不认识的字段', () => {
    expect(codes({ ...DRAFT, modules: [{ id: 'core.q', parent: 'core', name: 'Q', bogus: 1 } as never] })).toEqual(['sketch.schema'])
  })

  it('ID 格式、重复、前缀', () => {
    const bad: SketchDef = { id: 'd', modules: [{ id: 'core.a', parent: 'core', name: 'A', responsibility: 'a' }, { id: 'core.a', parent: 'core', name: 'A2', responsibility: 'a' }, { id: 'ui.z', parent: 'core', name: 'Z', responsibility: 'z' }] }
    expect(codes(bad)).toEqual(expect.arrayContaining(['sketch.id-dup', 'sketch.id-prefix']))
  })

  it('引用完整（范围：本草图 ∪ 持久草图）、不连祖先与后代', () => {
    const s: SketchDef = {
      id: 'd',
      modules: [{ id: 'core.a', parent: 'core', name: 'A', responsibility: 'a', children: [{ id: 'core.a.x', name: 'X', responsibility: 'x' }] }],
      relations: [
        { id: 'r1', from: 'core.a', to: 'ui.view', type: 'calls' },
        { id: 'r2', from: 'core.a', to: 'gone', type: 'calls' },
        { id: 'r3', from: 'core.a', to: 'core.a.x', type: 'calls' },
      ],
      closed: ['nope'],
    }
    const issues = v(s).issues
    expect(issues.filter(i => i.code === 'sketch.ref').map(i => i.path)).toEqual(['sketch.relations.1', 'sketch.closed.0'])
    expect(issues.find(i => i.code === 'sketch.ancestor')?.target).toEqual({ relation: 'r3' })
  })

  it('层依赖成环（本草图的写法优先）；可依赖的不是层', () => {
    const s: SketchDef = { id: 'd', modules: [{ id: 'core', name: 'Core', kind: 'layer', order: 2, mayDependOn: ['ui'], responsibility: 'c' }] }
    expect(codes(s)).toContain('sketch.layer-cycle')
    expect(codes({ id: 'd', modules: [{ id: 'core', name: 'Core', kind: 'layer', order: 2, mayDependOn: ['ui.view'], responsibility: 'c' }] })).toContain('sketch.ref')
  })

  it('与持久草图矛盾：与核验同一函数、同一稳定键', () => {
    const s: SketchDef = { id: 'd', modules: [{ id: 'ui.extra', parent: 'ui', name: 'E', responsibility: 'e' }] }
    expect(codes(s)).toEqual(['sketch.contradiction'])
    const entity = { def: s, file: 'designs/d/sketch.yaml', src: { file: 'designs/d/sketch.yaml', path: 'sketch' } }
    const viaCheck = sketchCheck(entity, loadModel([]).index, { persistent }).deviations.filter(d => d.code === 'sketch.contradiction')
    expect(viaCheck.map(d => d.key)).toEqual(sketchContradictions(entity, persistent).map(d => d.key))
    expect(viaCheck[0].key).toBe('contradiction:ui.extra')
    expect(v({ ...s, supersedes: 'skeleton' }).ok).toBe(true)
  })

  it('没写职责只是提醒，不拦保存', () => {
    const r = v({ id: 'd', modules: [{ id: 'core.q', parent: 'core', name: 'Q' }] })
    expect(r.ok).toBe(true)
    expect(r.issues.map(i => [i.severity, i.code])).toEqual([['warning', 'sketch.empty']])
  })
})

describe('B6 新建设计的底稿', () => {
  it('缺省空草图；「改骨架」复制层与第二级（含 closed）并声明 supersedes', () => {
    expect(seedSketch('n', 'empty')).toEqual({ id: 'n', lifetime: 'until-implemented', modules: [] })
    const copy = seedSketch('n', { persistent: persistent[0] })
    expect(copy).toMatchObject({ id: 'n', supersedes: 'skeleton', closed: ['ui'], modules: [{ id: 'ui', children: [{ id: 'ui.view' }] }, { id: 'core' }] })
    expect(validateSketch(copy, { persistent, file: 'designs/n/sketch.yaml' }).ok).toBe(true)
    copy.modules![0].children!.push({ id: 'ui.more', name: 'More', responsibility: 'm' })
    expect(validateSketch(copy, { persistent, file: 'designs/n/sketch.yaml' }).ok).toBe(true)
  })

  it('sketchText 序列化后经同一条加载流水线读回同样的草图', () => {
    expect(parse(sketchText(DRAFT))).toEqual({ sketch: DRAFT })
  })
})
