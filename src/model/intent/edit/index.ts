/**
 * 草图编辑（X7、X7b–X7e，ADR-0024）：applyEdit(草图, 操作, 上下文) → 新草图 + 影响 | 拒绝原因。
 * 纯函数：输入不动，在副本上按操作族修改；只拒绝做不成的操作，结构合法性交给 validateSketch（X7f）。
 */
import { stringify } from 'yaml'
import type { SketchDef } from '../../types'
import type { EditContext, EditOp, EditResult } from '../types'
import { addLayer, removeLayer, reorderLayer, setMayDependOn } from './layers'
import { addModule, removeModule, setClosed, updateModule } from './modules'
import { moveModule, renameModule } from './move'
import { addInterface, connect, removeInterface, removeRelation, updateInterface, updateRelation } from './relations'
import { setMeta } from './seed'
import type { OpOutcome } from './shared'

export { idImpact } from './move'
export { seedSketch } from './seed'
export { locateAll, locate, knownModules, moduleId, relationId, interfaceId, kebab, shortName, ID_PATTERN } from './locate'
export type { LocatedModule } from './locate'
export { removeLayer }

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
      return connect(def, ctx, op.from, op.to, op.type, op.description, op.interface)
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
    case 'setMeta':
      return setMeta(def, ctx, op.patch)
  }
}

export function applyEdit(sketch: SketchDef, op: EditOp, ctx: EditContext): EditResult {
  const draft = structuredClone(sketch)
  const out = run(draft, ctx, op)
  if ('reject' in out) return { ok: false, ...out.reject }
  return { ok: true, sketch: draft, effects: out.effects }
}

/** 草图定义的文本（YAML，顶层键 sketch）：编辑中的草图交给加载流水线时用它，规则与读文件时一致（X1） */
export function sketchText(def: SketchDef): string {
  return stringify({ sketch: def }, { lineWidth: 0 })
}
