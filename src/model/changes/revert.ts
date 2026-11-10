/**
 * 恢复到基线（CI-5，DL-2）：输入一个改动项，输出把那处恢复成基线样子的逆向操作序列（与现有编辑操作族同一表示，进同一条撤销记录）。
 * - 新增的模块 → 删除；删除的模块 → restore 放回；合并 → 删掉合并结果、放回来源；拆分 → 删掉拆出的、放回原来的；
 *   移动 → 删掉移到别处的、放回原处；改 ID（同父）→ 改回原 ID 并恢复名称（子树与下一层草图跟着改回）。
 * - 修改的模块：结构字段（名称、kind、role）取基线的值，文字字段去掉（底稿不写文字，X18）；层的可依赖层取基线；挂载点的原则去掉。
 * - 关系：新增 → 删；删除 → 按基线两端、类型、ID 连回；修改 → 两端变了就删了重连，否则类型与修饰取基线、说明去掉。
 * - 接口：新增 → 删；修改 → 名称与签名取基线。
 * 级联：试着应用后重算改动项，别的项因此消失或变了的列出来，由视图状态层确认（DL-2「别的项依赖它时先列出并确认」）。纯函数。
 */
import { applyDesignEdit } from '../intent/edit/design'
import { shortName } from '../intent/edit/locate'
import type { DesignEditContext, DesignEditOp, ModulePatch, SketchSet } from '../intent/types'
import { ROOT_MOUNT, type ModelIndex, type RelationType } from '../types'
import { changeItems, type ChangeItem } from './items'

/** 草图里模块的结构字段（底稿复制的，X18）；其余是文字字段，恢复 = 去掉 */
const STRUCTURE = new Set(['name', 'kind', 'role'])

function moduleSketch(sketches: SketchSet, id: string, fallback: string): string {
  for (const [m, d] of Object.entries(sketches)) {
    const walk = (list: NonNullable<typeof d.modules>): boolean => list.some(x => x.id === id || walk(x.children ?? []))
    if (walk(d.modules ?? [])) return m
  }
  return fallback
}

/** DL-2：一个改动项恢复到基线的逆向操作序列；做不到（没有基线里的对应）时为原因 */
export function revertOps(item: ChangeItem, sketches: SketchSet, baseline: ModelIndex): { ok: true; ops: DesignEditOp[] } | { ok: false; reason: string } {
  const main = item.parts[0]
  const at = (id: string) => ({ sketch: moduleSketch(sketches, id, item.mount), id })
  if (item.entity === 'module') {
    switch (item.kind) {
      case 'added':
        return { ok: true, ops: [{ op: 'remove', ...at(item.id) }] }
      case 'removed':
        return { ok: true, ops: [{ op: 'restore', remove: [], restore: [item.id] }] }
      case 'merged':
        return { ok: true, ops: [{ op: 'restore', remove: [at(item.id)], restore: [...(main.from ?? [])] }] }
      case 'split':
        return { ok: true, ops: [{ op: 'restore', remove: (main.to ?? []).map(at), restore: [item.id] }] }
      case 'moved':
        return { ok: true, ops: [{ op: 'restore', remove: [at(item.id)], restore: [...(main.from ?? [])] }] }
      case 'renamed': {
        const src = main.from?.[0]
        const b = src ? baseline.modules.get(src) : undefined
        if (!src || !b) return { ok: false, reason: `基线里没有「${item.id}」的来源` }
        const sketch = at(item.id).sketch
        const ops: DesignEditOp[] = [{ op: 'rename', sketch, id: item.id, newId: shortName(src) }]
        ops.push({ op: 'edit', sketch, edit: { op: 'updateModule', id: src, patch: { name: b.name } } })
        return { ok: true, ops }
      }
      case 'changed': {
        const fields = main.fields ?? []
        const ops: DesignEditOp[] = []
        if (fields.includes('abstraction') && item.id === item.mount && item.mount !== ROOT_MOUNT)
          ops.push({ op: 'edit', sketch: item.mount, edit: { op: 'setAbstraction', text: '' } })
        const b = baseline.modules.get(item.id)
        const patch: Record<string, unknown> = {}
        for (const f of fields) {
          if (f === 'parent' || f === 'mayDependOn' || (f === 'abstraction' && item.id === item.mount)) continue
          patch[f] = STRUCTURE.has(f) ? (b as unknown as Record<string, unknown> | undefined)?.[f] : undefined
        }
        if (Object.keys(patch).length) ops.push({ op: 'edit', sketch: at(item.id).sketch, edit: { op: 'updateModule', id: item.id, patch: patch as ModulePatch } })
        if (fields.includes('mayDependOn')) ops.push({ op: 'edit', sketch: ROOT_MOUNT, edit: { op: 'setMayDependOn', id: item.id, layers: [...(b?.mayDependOn ?? [])] } })
        return ops.length ? { ok: true, ops } : { ok: false, reason: `「${item.id}」改的字段（${fields.join('、')}）不能恢复` }
      }
    }
  }
  if (item.entity === 'relation') {
    const b = baseline.relations.get(item.id)
    const reconnect = (): DesignEditOp => ({
      op: 'edit',
      sketch: item.mount,
      edit: {
        op: 'connect',
        id: b!.id,
        from: b!.from,
        to: b!.to,
        type: b!.type as RelationType,
        ...(b!.via ? { via: b!.via } : {}),
        ...(b!.mode ? { mode: b!.mode } : {}),
        ...(b!.pull ? { pull: true } : {}),
      },
    })
    if (item.kind === 'added') return { ok: true, ops: [{ op: 'edit', sketch: item.mount, edit: { op: 'removeRelation', id: item.id } }] }
    if (!b) return { ok: false, reason: `基线里没有关系「${item.id}」` }
    if (item.kind === 'removed') return { ok: true, ops: [reconnect()] }
    const fields = main.fields ?? []
    if (fields.includes('from') || fields.includes('to')) return { ok: true, ops: [{ op: 'edit', sketch: item.mount, edit: { op: 'removeRelation', id: item.id } }, reconnect()] }
    return {
      ok: true,
      ops: [
        {
          op: 'edit',
          sketch: item.mount,
          edit: { op: 'updateRelation', id: item.id, patch: { type: b.type as RelationType, description: '', via: b.via ?? '', mode: b.mode ?? '', pull: !!b.pull, interface: b.interface ?? '' } },
        },
      ],
    }
  }
  const b = baseline.interfaces.get(item.id)
  if (item.kind === 'added') return { ok: true, ops: [{ op: 'edit', sketch: item.mount, edit: { op: 'removeInterface', id: item.id } }] }
  if (!b) return { ok: false, reason: `基线里没有接口「${item.id}」` }
  return { ok: true, ops: [{ op: 'edit', sketch: item.mount, edit: { op: 'updateInterface', id: item.id, patch: { name: b.name, ...(b.signature ? { signature: b.signature } : {}) } } }] }
}

/** 一处改动恢复后的级联：别的改动项因此消失或变了 */
export interface RevertPlan {
  ops: DesignEditOp[]
  /** 恢复后的草图集合（试算） */
  after: SketchSet
  /** 因此消失的别的改动项（键） */
  dropped: string[]
  /** 因此变了的别的改动项（键） */
  altered: string[]
}

/** DL-2：试算恢复一项——逆向操作 + 级联影响（不改输入） */
export function revertPlan(item: ChangeItem, sketches: SketchSet, ctx: DesignEditContext & { baseline: ModelIndex }, items: readonly ChangeItem[]): { ok: true; plan: RevertPlan } | { ok: false; reason: string } {
  const r = revertOps(item, sketches, ctx.baseline)
  if (!r.ok) return r
  let design = sketches
  for (const op of r.ops) {
    const out = applyDesignEdit(design, op, ctx)
    if (!out.ok) return { ok: false, reason: out.reason }
    design = out.design
  }
  const after = new Map(changeItems(design, ctx.baseline, ctx.design).map(i => [i.key, i]))
  const others = items.filter(i => i.key !== item.key)
  const dropped = others.filter(i => !after.has(i.key)).map(i => i.key)
  const altered = others.filter(i => after.has(i.key) && after.get(i.key)!.summary !== i.summary).map(i => i.key)
  return { ok: true, plan: { ops: r.ops, after: design, dropped, altered } }
}
