/**
 * 图解标签的空态（LY-13c）：主语没有讲解时，说清缺什么、怎么补，并给出「相关的、有图解的模块」——
 * 模块：最近的有图解的祖先（所属）；关系 / 代码依赖 / 耦合：两端；步骤：两端；文件：归属模块；端口：所属模块；层：父模块；
 * 场景、参与者、环：根（系统）。纯函数，只读索引。
 */
import type { ModelIndex } from '@/model'
import type { Subject } from '@/state/useDeskState'

export interface LinkContext {
  has: (id: string) => boolean
  /** 回放中当前步骤的两端（主语是步骤时） */
  frame: { from: string; to: string } | null
  /** 选中文件的归属模块 */
  fileOwners: readonly string[]
}

/** 最近的有图解的祖先（含自己之外的父辈，直到根） */
function nearestWith(idx: ModelIndex, id: string, has: (id: string) => boolean): string | null {
  const path = idx.pathOf.get(id) ?? []
  for (let i = path.length - 2; i >= 0; i--) if (has(path[i])) return path[i]
  return null
}

const uniq = (xs: (string | null | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x))]

export function explainerLinks(idx: ModelIndex, s: Subject, ctx: LinkContext): { why: string; modules: string[] } {
  const keep = (ids: (string | null | undefined)[]) =>
    uniq(ids)
      .filter(id => idx.modules.has(id) || id === idx.rootId)
      .filter(ctx.has)
  const ends = (a?: string, b?: string) => keep([a, b, a ? nearestWith(idx, a, ctx.has) : null, b ? nearestWith(idx, b, ctx.has) : null])
  const root = keep([idx.rootId])
  switch (s.kind) {
    case 'system':
      return { why: '系统还没有根图解。图解由 AI 按描述生成（04 §3.11），生成后出现在这里。', modules: [] }
    case 'module':
      return {
        why: '这个模块还没有图解。图解只为系统、层与核心模块写（04 §3.11）；先看它所属模块的讲解，或到描述看它的事实。',
        modules: keep([nearestWith(idx, s.id, ctx.has)]),
      }
    case 'relation': {
      const r = idx.relations.get(s.id)
      return { why: '关系没有自己的图解，讲解在两端的模块里。', modules: ends(r?.from, r?.to) }
    }
    case 'dep': {
      const [a, b] = s.id.split('->')
      return { why: '代码依赖没有图解，讲解在两端的模块里。', modules: ends(a, b) }
    }
    case 'couple': {
      const [a, b] = s.id.split('~')
      return { why: '时间耦合没有图解，讲解在两端的模块里。', modules: ends(a, b) }
    }
    case 'step':
      return { why: '步骤没有自己的图解，讲解在它两端的模块里。', modules: ends(ctx.frame?.from, ctx.frame?.to) }
    case 'scenario':
      return { why: '场景还没有图解（本轮只生成系统与模块的图解）；按时间怎么走看「时序图」，每一步的事实在「描述」。', modules: root }
    case 'file':
      return { why: '文件没有图解，讲解在它归属的模块里。', modules: keep(ctx.fileOwners.flatMap(o => [o, nearestWith(idx, o, ctx.has)])) }
    case 'port': {
      const owner = idx.interfaces.get(s.id)?.owner
      return { why: '端口没有图解，讲解在它所属的模块里。', modules: keep([owner, owner ? nearestWith(idx, owner, ctx.has) : null]) }
    }
    case 'stratum': {
      const parent = s.id.includes('/') ? s.id.slice(0, s.id.lastIndexOf('/')) : idx.rootId
      return { why: '层的讲解写在它的父模块的图解里。', modules: keep([parent, nearestWith(idx, parent, ctx.has)]) }
    }
    default:
      return { why: '这类对象没有图解；系统的讲解在根图解里。', modules: root }
  }
}
