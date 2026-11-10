/**
 * 改动项（CI-1，X11、X17，ADR-0063 决策 6）：相对设计基线的变更清单按血缘聚合为「一处一项」。
 * 输入是 compareDesign（相对基线）的结果：模块的新增 / 合并 / 拆分 / 改 ID / 移动 / 删除各是一项，随它们一起变的关系与接口并进这一项；
 * 一个模块改了几个字段是一项（compareSketch 已按模块一条）；其余的关系、接口变更各是一项。
 * 每项带稳定键（编号表按它认号，DL-3）、图上要标的模块与关系（徽标）、映射回基线的模块（影响面估算，DL-7）。纯函数。
 */
import { compareDesign, type CompareMode, type SketchChange, type SketchComparison } from '../intent/check'
import { prefixMap, sketchLineage, unmapId } from '../intent/lineage'
import type { SketchSet } from '../intent/types'
import { CHANGE_KINDS, ROOT_MOUNT, type ChangeKind, type ModelIndex, type SketchEntity } from '../types'

export interface ChangeItem {
  /** 稳定键：`<种类>:<实体>:<ID>`（拆分、删除为基线 ID）；同一处改动在后续轮次里键不变 */
  key: string
  kind: ChangeKind
  entity: SketchChange['entity']
  /** 设计里的 ID（拆分、删除为基线 ID） */
  id: string
  /** 所在草图（挂载点） */
  mount: string
  /** 一句话（按血缘措辞，X11） */
  summary: string
  /** 修改了的字段（修改项） */
  fields?: string[]
  /** 图上要标「#n」的模块（设计里的 ID；删除项为空） */
  modules: string[]
  /** 图上要标「#n」的关系 */
  relations: string[]
  /** 删除了的基线模块 / 关系（清单里悬停时在原位置显示虚框，CI-3） */
  removed: string[]
  /** 并进这一项的变更（第一条是主变更） */
  parts: SketchChange[]
}

/** 设计的草图集合 → 核验与对比的草图实体（路径口径同编辑会话：sketches/<挂载点>.yaml） */
export function designEntities(sketches: SketchSet, design: string): SketchEntity[] {
  return Object.entries(sketches).map(([mount, def]) => {
    const file = `sketches/${mount}.yaml`
    return { def, file, src: { file, path: 'sketch' }, mount, design }
  })
}

/** 主变更的模块端：设计里的 ID 与基线 ID（关系、接口按它们并入） */
function moduleEnds(c: SketchChange): { design: string[]; baseline: string[] } {
  if (c.kind === 'split') return { design: c.to ?? [], baseline: [c.id] }
  if (c.kind === 'removed') return { design: [], baseline: [c.id] }
  return { design: [c.id], baseline: [...(c.from ?? [])] }
}

const keyOf = (c: SketchChange): string => `${c.kind}:${c.entity}:${c.id}`

/** 关系变更的两端、接口变更的 owner（设计侧与基线侧都给；compareSketch 的变更本身不带） */
export type ChangeEnds = (c: SketchChange) => readonly string[]

/**
 * CI-1：按血缘聚合。结构性的模块变更（新增、合并、拆分、改 ID、移动、删除）各成一项；一端落在这些模块（设计侧或基线侧）上的关系变更、
 * owner 是它们的接口变更并进那一项；模块的修改、其余关系与接口各成一项。排在前面的结构项先认领。
 */
export function aggregateChanges(comparisons: readonly SketchComparison[], ends: ChangeEnds): ChangeItem[] {
  const items: ChangeItem[] = []
  const owner = new Map<string, ChangeItem>()
  const all = comparisons.flatMap(c => c.changes.map(x => ({ mount: c.mount, change: x })))
  for (const { mount, change: c } of all) {
    if (c.entity !== 'module' || c.kind === 'changed') continue
    const e = moduleEnds(c)
    const item: ChangeItem = {
      key: keyOf(c),
      kind: c.kind,
      entity: 'module',
      id: c.id,
      mount,
      summary: c.message,
      modules: e.design,
      relations: [],
      removed: c.kind === 'removed' ? [c.id] : [],
      parts: [c],
    }
    items.push(item)
    for (const id of [...e.design, ...e.baseline]) if (!owner.has(id)) owner.set(id, item)
  }
  for (const { mount, change: c } of all) {
    if (c.entity === 'module' && c.kind !== 'changed') continue
    const host = c.entity === 'module' ? undefined : ends(c).map(e => owner.get(e)).find(x => !!x)
    if (host) {
      host.parts.push(c)
      if (c.entity === 'relation') (c.kind === 'removed' ? host.removed : host.relations).push(c.id)
      continue
    }
    items.push({
      key: keyOf(c),
      kind: c.kind,
      entity: c.entity,
      id: c.id,
      mount,
      summary: c.message,
      ...(c.fields ? { fields: [...c.fields] } : {}),
      modules: c.entity === 'module' ? [c.id] : [],
      relations: c.entity === 'relation' && c.kind !== 'removed' ? [c.id] : [],
      removed: c.entity === 'relation' && c.kind === 'removed' ? [c.id] : [],
      parts: [c],
    })
  }
  return items.sort((a, b) => CHANGE_KINDS.indexOf(a.kind) - CHANGE_KINDS.indexOf(b.kind) || a.key.localeCompare(b.key))
}

/** 关系与接口的端点：设计里的定义与基线里的定义（关系两端、接口 owner） */
export function changeEnds(sketches: SketchSet, baseline: ModelIndex): ChangeEnds {
  const relDefs = new Map(Object.values(sketches).flatMap(d => (d.relations ?? []).map(x => [x.id, x] as const)))
  const ifDefs = new Map(Object.values(sketches).flatMap(d => (d.interfaces ?? []).map(x => [x.id, x] as const)))
  return c => {
    if (c.entity === 'relation') {
      const d = relDefs.get(c.id)
      const prev = baseline.relations.get(c.id)
      return [...(d ? [d.from, d.to] : []), ...(prev ? [prev.from, prev.to] : [])]
    }
    if (c.entity === 'interface') {
      const o = ifDefs.get(c.id)?.owner ?? baseline.interfaces.get(c.id)?.owner
      return o ? [o] : []
    }
    return []
  }
}

/** CI-1：一个设计的改动项——相对基线的对比（compareDesign，X17）按血缘聚合 */
export function changeItems(sketches: SketchSet, baseline: ModelIndex, design: string, mode: CompareMode = 'baseline'): ChangeItem[] {
  const r = compareDesign(designEntities(sketches, design), baseline, mode)
  return aggregateChanges(r.sketches, changeEnds(sketches, baseline))
}

/**
 * DL-7：改动项映射回基线模块——合并算两者、拆分算原来的、改 ID 与移动算原来的、改关系算两端、修改算它自己（基线里的对应）、
 * 删除算被删的；全新的框（新增模块）为空（标「新」）。关系、接口的端点按前缀映射找到基线里的对应，基线里没有的不算。
 */
export function baselineOrigins(item: ChangeItem, sketches: SketchSet, baseline: ModelIndex): string[] {
  const ends = changeEnds(sketches, baseline)
  const map = prefixMap(sketchLineage(Object.values(sketches)))
  const back = (id: string) => {
    const b = unmapId(map, id)
    return baseline.modules.has(b) ? b : baseline.modules.has(id) ? id : null
  }
  const out = new Set<string>()
  for (const c of item.parts) {
    if (c.entity === 'module') {
      if (c.kind === 'added') continue
      if (c.kind === 'merged' || c.kind === 'renamed' || c.kind === 'moved') for (const f of c.from ?? []) out.add(f)
      else if (c.kind === 'split' || c.kind === 'removed') out.add(c.id)
      else {
        const b = c.id === ROOT_MOUNT ? null : back(c.id)
        if (b) out.add(b)
      }
      continue
    }
    // 并进模块项的关系不另算两端（它跟着模块走）；关系项、接口项才算两端 / owner
    if (item.entity === 'module') continue
    for (const e of ends(c)) {
      const b = back(e)
      if (b) out.add(b)
    }
  }
  return [...out].sort()
}

/** 改动项是不是全新的框：只有新增模块（映射不回基线），影响面标「新」不给数（DL-7） */
export const isFresh = (item: ChangeItem): boolean => item.entity === 'module' && item.kind === 'added'
