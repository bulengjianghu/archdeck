/**
 * 单张草图上的编辑：按操作族分派（X7b）。设计级的跨草图操作在 design.ts。
 */
import { stringify } from 'yaml'
import type { SketchDef } from '../../types'
import { migrateSketch } from '../../load'
import { pruneStrata } from './strata'
import { knownModules } from './locate'
import type { EditContext, EditOp, EditResult } from '../types'
import { addLayer, reorderLayer, setMayDependOn } from './layers'
import { addModule, removeModule, setClosed, updateModule } from './modules'
import { moveModule, renameModule } from './move'
import { addInterface, connect, implement, removeInterface, removeRelation, updateInterface, updateRelation } from './relations'
import { setMeta } from './seed'
import { addReference, autoArrange, moveNode, relabel, removeReference, setAbstraction } from './layout'
import type { OpOutcome } from './shared'

function run(def: SketchDef, ctx: EditContext, op: EditOp): OpOutcome {
  switch (op.op) {
    case 'addLayer':
      return addLayer(def, ctx, op.name, op.at, op.id)
    case 'reorderLayer':
      return reorderLayer(def, ctx, op.id, op.to)
    case 'setMayDependOn':
      return setMayDependOn(def, ctx, op.id, op.layers)
    case 'addModule':
      return addModule(def, ctx, op.parent, op.name, op.id, op.kind)
    case 'updateModule':
      return updateModule(def, ctx, op.id, op.patch)
    case 'setClosed':
      return setClosed(def, ctx, op.id, op.closed)
    case 'moveModule':
      return moveModule(def, ctx, op.id, op.parent, op.newId)
    case 'renameModule':
      return renameModule(def, ctx, op.id, op.newId)
    case 'removeModule':
      return removeModule(def, ctx, op.id)
    case 'connect':
      return connect(def, ctx, op.from, op.to, op.type, op.description, op.interface, { via: op.via, mode: op.mode, pull: op.pull }, op.id)
    case 'updateRelation':
      return updateRelation(def, ctx, op.id, op.patch)
    case 'removeRelation':
      return removeRelation(def, ctx, op.id)
    case 'addInterface':
      return addInterface(def, ctx, op.owner, op.name, op.signature)
    case 'updateInterface':
      return updateInterface(def, ctx, op.id, op.patch)
    case 'removeInterface':
      return removeInterface(def, ctx, op.id)
    case 'implement':
      return implement(def, ctx, op.interface, op.module, op.remove)
    case 'setMeta':
      return setMeta(def, ctx, op.patch)
    case 'setAbstraction':
      return setAbstraction(def, op.text)
    case 'moveNode':
      return moveNode(def, ctx, op.positions)
    case 'relabel':
      return relabel(def, ctx, op.id, op.label)
    case 'autoArrange':
      return autoArrange(def, op.area)
    case 'addReference':
      return addReference(def, ctx, op.id)
    case 'removeReference':
      return removeReference(def, op.id)
  }
}

export function applyEdit(sketch: SketchDef, op: EditOp, ctx: EditContext): EditResult {
  // M26：旧写法 kind: layer 先读作 strata（ADR-0052）；编辑器只产出新写法
  const draft = structuredClone(migrateSketch(sketch))
  const out = run(draft, ctx, op)
  if ('reject' in out) return { ok: false, ...out.reject }
  pruneStrata(draft, id => knownModules(draft, ctx.persistent).has(id) || !!ctx.known?.(id))
  return { ok: true, sketch: draft, effects: out.effects }
}

/** 草图定义的文本（YAML，顶层键 sketch）：编辑中的草图交给加载流水线时用它，规则与读文件时一致（X1） */
export function sketchText(def: SketchDef): string {
  return stringify({ sketch: def }, { lineWidth: 0 })
}
