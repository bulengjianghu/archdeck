/**
 * 草图底稿与元信息（X18，ADR-0025；S-4、B6）。底稿一律从设计的基线复制挂载点的一层：直接子模块的 ID、名称、kind、role、
 * closed，与显式写在本层的关系及类型；不复制职责文字、接口、原则。本层父模块的分层（strata，ADR-0052）的层 ID、名称、层序、
 * 可依赖的层与成员是结构，照复制；层的问题、判定问与原则是文字，不复制。同挂载点在基线里已有持久草图时声明 supersedes（根挂载即 supersedes skeleton）。
 * 复制后「相对基线」为 0。下一层草图不存在时由「基线里的子树 + 血缘指向的模块」推出（deriveChildSketch）。
 */
import { ROOT_MOUNT, type ModelIndex, type ModuleDef, type RelationDef, type SketchDef, type SketchEntity, type SketchLifetime, type StrataDef } from '../../types'
import { isMergeResult, prefixMap, sketchLineage, unmapId } from '../lineage'
import { mountScope } from '../scope'
import type { EditContext, SketchSet } from '../types'
import { shortName } from './locate'
import { done, reject, type OpOutcome } from './shared'

export interface SeedOptions {
  /** 草图 ID（设计的草图即设计 ID） */
  id: string
  lifetime?: SketchLifetime
}

/** 基线里的一个模块的结构字段 */
function structural(index: ModelIndex, id: string, as = id): ModuleDef {
  const m = index.modules.get(id)!
  return {
    id: as,
    name: m.name,
    ...(m.kind ? { kind: m.kind } : {}),
    ...(m.role ? { role: m.role } : {}),
  }
}

/** ADR-0052：基线里一组父模块的分层（结构字段）；根写 root */
function strataOf(index: ModelIndex, parents: readonly string[], rename: (x: string) => string = x => x): StrataDef | undefined {
  const out: StrataDef = {}
  for (const p of parents) {
    const list = index.strata.get(p)
    if (!list?.length) continue
    out[p === index.rootId ? ROOT_MOUNT : rename(p)] = list.map(s => ({
      id: s.id,
      name: s.name,
      ...(s.order !== undefined ? { order: s.order } : {}),
      ...(s.mayDependOn !== undefined ? { mayDependOn: [...s.mayDependOn] } : {}),
      members: s.members.map(rename),
    }))
  }
  return Object.keys(out).length ? out : undefined
}

const relationOf = (index: ModelIndex, id: string, rename: (x: string) => string = x => x): RelationDef => {
  const r = index.relations.get(id)!
  return { id: r.id, from: rename(r.from), to: rename(r.to), type: r.type }
}

/** 基线里同挂载点的持久草图（根挂载时为骨架） */
const persistentAt = (index: ModelIndex, mount: string): SketchEntity | undefined =>
  index.model.sketches.find(s => s.def.mount === mount && (s.def.lifetime ?? (/(^|\/)intent\//.test(s.file) ? 'persistent' : 'until-implemented')) === 'persistent')

/** X18：基线里各草图的 closed 中落在本层（挂载点或本层模块）的 */
function closedAt(index: ModelIndex, mount: string, local: ReadonlySet<string>): string[] {
  const out = new Set<string>()
  for (const s of index.model.sketches) for (const c of s.def.closed ?? []) if (c === mount || local.has(c)) out.add(c)
  return [...out]
}

/** X18：从基线复制挂载点的一层 */
export function seedFromBaseline(mount: string, baseline: ModelIndex, opts: SeedOptions): SketchDef {
  const scope = mountScope(baseline, mount)
  const local = new Set(scope.modules)
  let modules: ModuleDef[]
  if (mount === ROOT_MOUNT)
    modules = scope.modules
      .filter(id => scope.parentOf.get(id) === baseline.rootId)
      .map(layer => {
        const kids = scope.modules.filter(id => scope.parentOf.get(id) === layer).map(id => structural(baseline, id))
        return { ...structural(baseline, layer), ...(kids.length ? { children: kids } : {}) }
      })
  else modules = scope.modules.map(id => structural(baseline, id))
  const closed = closedAt(baseline, mount, local)
  const relations = scope.relations.map(id => relationOf(baseline, id))
  const persistent = persistentAt(baseline, mount)
  const strata = strataOf(baseline, mount === ROOT_MOUNT ? [baseline.rootId, ...modules.map(m => m.id)] : [mount])
  return {
    id: opts.id,
    mount,
    lifetime: opts.lifetime ?? 'until-implemented',
    ...(persistent && persistent.def.id !== opts.id ? { supersedes: persistent.def.id } : {}),
    ...(closed.length ? { closed } : {}),
    modules,
    ...(strata ? { strata } : {}),
    ...(relations.length ? { relations } : {}),
  }
}

/**
 * X18：推出下一层草图（只在会话里，未改动不写文件）。挂载点在基线里 → 照基线复制；
 * 是改 ID / 移动的结果（或在其子树里）→ 复制基线对应模块的一层并换成新前缀、记 from；
 * 是合并结果 → 来源各成一个子模块（`<挂载点>.<来源短名>`，from 指向来源），来源之间的关系随来源进入这一层；全新模块 → 空草图。
 */
export function deriveChildSketch(mount: string, baseline: ModelIndex, design: SketchSet, opts: SeedOptions): SketchDef {
  if (baseline.modules.has(mount)) return seedFromBaseline(mount, baseline, opts)
  const lineage = sketchLineage(Object.values(design))
  const empty: SketchDef = { id: opts.id, mount, lifetime: opts.lifetime ?? 'until-implemented', modules: [] }
  if (isMergeResult(lineage, mount)) {
    const from = lineage.get(mount)!.filter(src => baseline.modules.has(src))
    const as = (src: string) => `${mount}.${shortName(src)}`
    const set = new Set(from)
    const relations = [...baseline.relations.values()].filter(r => set.has(r.from) && set.has(r.to)).map(r => relationOf(baseline, r.id, as))
    return { ...empty, modules: from.map(src => ({ ...structural(baseline, src, as(src)), from: [src] })), ...(relations.length ? { relations } : {}) }
  }
  const map = prefixMap(lineage)
  const origin = lineage.get(mount)?.length === 1 ? lineage.get(mount)![0] : unmapId(map, mount)
  if (origin === mount || !baseline.modules.has(origin)) return empty
  const { supersedes: _supersedes, ...seeded } = seedFromBaseline(origin, baseline, opts)
  const rename = (id: string) => (id === origin || id.startsWith(`${origin}.`) ? `${mount}${id.slice(origin.length)}` : id)
  return {
    ...seeded,
    mount,
    ...(seeded.closed ? { closed: seeded.closed.map(rename) } : {}),
    modules: (seeded.modules ?? []).map(m => ({ ...m, id: rename(m.id), from: [m.id] })),
    ...(seeded.strata
      ? { strata: Object.fromEntries(Object.entries(seeded.strata).map(([k, list]) => [rename(k), list.map(s => ({ ...s, members: (s.members ?? []).map(rename) }))])) }
      : {}),
    ...(seeded.relations ? { relations: seeded.relations.map(r => ({ ...r, from: rename(r.from), to: rename(r.to) })) } : {}),
  }
}

export function setMeta(def: SketchDef, ctx: EditContext, patch: { lifetime?: SketchLifetime; supersedes?: string | null }): OpOutcome {
  if (patch.lifetime) def.lifetime = patch.lifetime
  if ('supersedes' in patch) {
    if (!ctx.designSketch && patch.supersedes) return reject('invalid', '持久草图不能声明 supersedes')
    if (patch.supersedes && !ctx.persistent.some(p => p.def.id === patch.supersedes)) return reject('not-found', `没有持久草图「${patch.supersedes}」`)
    if (patch.supersedes) def.supersedes = patch.supersedes
    else delete def.supersedes
  }
  return done()
}
