/**
 * 草图底稿与元信息（S-4、L-3、P-5，B6）：新建设计的底稿——缺省空草图；「改骨架（定稿后晋升替换骨架）」复制持久草图的层与第二级
 * （含 closed、core、mayDependOn）并声明 supersedes。复制而不 supersedes 的底稿与骨架重复，改任何已写字段即矛盾（X4），所以两者绑定。
 */
import type { SketchDef, SketchEntity, SketchLifetime } from '../../types'
import type { EditContext } from '../types'
import { done, reject, type OpOutcome } from './shared'

export function seedSketch(id: string, from: 'empty' | { persistent: SketchEntity }): SketchDef {
  if (from === 'empty') return { id, lifetime: 'until-implemented', modules: [] }
  const p = structuredClone(from.persistent.def)
  return {
    id,
    lifetime: 'until-implemented',
    supersedes: p.id,
    ...(p.closed?.length ? { closed: p.closed } : {}),
    modules: p.modules ?? [],
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
