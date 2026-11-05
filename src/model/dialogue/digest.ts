/**
 * 梳理卡（DA-7，DL-15）：AI 把白板照片对到真实系统上的四组——对上 / 对不上 / 多 / 少，每项可带「不确定」。
 * 这里把 agent 的梳理块变成可渲染的数据：组标题与说明、对到的模块名（描述里没有的标出来）、不确定计数。
 */
import type { ModelIndex } from '../types'
import { DIGEST_GROUPS, type DigestBlock, type DigestGroup } from './protocol'

export const DIGEST_GROUP_TEXT: Record<DigestGroup, { title: string; hint: string }> = {
  matched: { title: '对上', hint: '照片上的框 / 线与系统一致' },
  mismatched: { title: '对不上', hint: '一个框对应代码里多个模块，或名字对不上' },
  extra: { title: '多', hint: '画了，但代码里没有这个模块或依赖' },
  missing: { title: '少', hint: '系统里有，照片上没画' },
}

export interface DigestItemView {
  label: string
  modules: { id: string; name: string; known: boolean }[]
  note?: string
  uncertain: boolean
}

export interface DigestView {
  groups: { key: DigestGroup; title: string; hint: string; items: DigestItemView[] }[]
  total: number
  uncertain: number
}

export function digestView(index: ModelIndex, block: DigestBlock): DigestView {
  const groups = DIGEST_GROUPS.map(key => ({
    key,
    ...DIGEST_GROUP_TEXT[key],
    items: block.groups[key].map(it => ({
      label: it.label,
      modules: (it.modules ?? []).map(id => {
        const m = index.modules.get(id)
        return { id, name: m?.name ?? id, known: !!m }
      }),
      ...(it.note ? { note: it.note } : {}),
      uncertain: !!it.uncertain,
    })),
  }))
  const all = groups.flatMap(g => g.items)
  return { groups, total: all.length, uncertain: all.filter(i => i.uncertain).length }
}
