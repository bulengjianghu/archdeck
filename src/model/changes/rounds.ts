/**
 * 按轮快照（CI-5，DL-1）：AI 的每一轮在开始时记下设计的草图集合；撤回更早的一轮 = 把那一轮碰过的模块与关系恢复成那一轮开始前的样子，
 * 后面的轮次（或人）也碰过的列出来确认，别处不动。撤回最近一轮就是一步撤销（视图状态层）。纯函数。
 */
import { locateAll } from '../intent/edit/locate'
import type { DesignEditOp, SketchSet } from '../intent/types'
import type { ModuleDef, RelationDef } from '../types'

export interface Touched {
  modules: string[]
  relations: string[]
}

/** 设计里每个模块的样子（所在草图、父、去掉子模块的字段）与每条关系的样子（所在草图、定义）；位置不算 */
function shapes(set: SketchSet): { modules: Map<string, string>; relations: Map<string, string> } {
  const modules = new Map<string, string>()
  const relations = new Map<string, string>()
  for (const [mount, def] of Object.entries(set)) {
    for (const m of locateAll(def)) {
      const { children: _c, ...fields } = m.node as ModuleDef
      modules.set(m.id, JSON.stringify([mount, m.parentId ?? null, fields]))
    }
    for (const r of def.relations ?? []) relations.set(r.id, JSON.stringify([mount, r as RelationDef]))
  }
  return { modules, relations }
}

const diffKeys = (a: Map<string, string>, b: Map<string, string>) => [...new Set([...a.keys(), ...b.keys()])].filter(k => a.get(k) !== b.get(k)).sort()

/** 一轮碰过的模块与关系：开始前与结束后样子不同的（新增、删除、改字段、换草图或父） */
export function touchedBetween(before: SketchSet, after: SketchSet): Touched {
  const a = shapes(before)
  const b = shapes(after)
  return { modules: diffKeys(a.modules, b.modules), relations: diffKeys(a.relations, b.relations) }
}

/** 撤回更早一轮时要确认的：这一轮碰过、之后又被改过的（此刻的样子与这一轮结束时不同） */
export function laterTouched(touched: Touched, roundAfter: SketchSet, now: SketchSet): Touched {
  const a = shapes(roundAfter)
  const b = shapes(now)
  return { modules: touched.modules.filter(id => a.modules.get(id) !== b.modules.get(id)), relations: touched.relations.filter(id => a.relations.get(id) !== b.relations.get(id)) }
}

/** DL-1：撤回一轮的操作——把这一轮碰过的模块与关系恢复成这一轮开始前的快照 */
export const restoreRoundOps = (before: SketchSet, touched: Touched): DesignEditOp[] =>
  touched.modules.length || touched.relations.length ? [{ op: 'restoreEntities', snapshot: before, modules: [...touched.modules], relations: [...touched.relations] }] : []
