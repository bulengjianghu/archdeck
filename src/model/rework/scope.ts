/**
 * 返工清单按范围汇总（LY-13 核对标签的系统 / 层汇总，第二十二轮波 3）：一个模块（层、系统根）之下的返工项——
 * 目标模块、关系两端或代码依赖两端落在这棵子树里即算；按「违规、环、未证实、未归属、需复核」五类计数。
 * 纯函数，命令行与页面同一口径（根的范围即整份清单）。
 */
import type { ModelIndex } from '../types'
import { SCOPE_CATEGORIES, type ReworkItem, type ReworkList, type ScopeCategory } from './types'

const inTree = (index: ModelIndex, root: string, id: string | undefined) => !!id && (index.pathOf.get(id) ?? []).includes(root)

/** 这一项落在 root 这棵子树里吗（根即全部） */
export function itemUnder(index: ModelIndex, root: string, item: ReworkItem): boolean {
  if (root === index.rootId) return true
  const t = item.target
  if (t.modules?.some(m => inTree(index, root, m))) return true
  if (t.relation) {
    const r = index.relations.get(t.relation)
    if (r && (inTree(index, root, r.from) || inTree(index, root, r.to))) return true
  }
  if (t.dep) {
    const [a, b] = t.dep.split('->')
    if (inTree(index, root, a) || inTree(index, root, b)) return true
  }
  return false
}

/** roots：一棵或几棵子树（多成员的层传它的成员） */
export function reworkScope(list: ReworkList, index: ModelIndex, roots: readonly string[]): { items: ReworkItem[]; counts: Record<ScopeCategory, number> } {
  const items = list.items.filter(i => roots.some(root => itemUnder(index, root, i)))
  const counts = Object.fromEntries(SCOPE_CATEGORIES.map(c => [c, items.filter(i => i.category === c).length])) as Record<ScopeCategory, number>
  return { items, counts }
}
