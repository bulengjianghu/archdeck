/** 草图画布的显示名：变更角标（新 / 改 / 合 / 拆 / 移，F-62）；改 ID 并入「改」（T1 裁决 2） */
import type { ChangeKind } from '@/model'

export const CHANGE_BADGES: Readonly<Record<ChangeKind, { text: string; title: string }>> = {
  added: { text: '新', title: '新增' },
  changed: { text: '改', title: '修改' },
  renamed: { text: '改', title: '改 ID' },
  merged: { text: '合', title: '合并' },
  split: { text: '拆', title: '拆分' },
  moved: { text: '移', title: '移动（降级 / 升级 / 移入）' },
  removed: { text: '删', title: '删除' },
}

/** 六类计数（F-51、F-62）：改 ID 并入修改（T1 裁决 2）；面板的设计概览与信息条的对比区共用 */
export const CHANGE_SIX: readonly { key: string; label: string; mark: string; kinds: readonly ChangeKind[] }[] = [
  { key: 'added', label: '新增', mark: '+', kinds: ['added'] },
  { key: 'changed', label: '修改', mark: '~', kinds: ['changed', 'renamed'] },
  { key: 'merged', label: '合并', mark: '合', kinds: ['merged'] },
  { key: 'split', label: '拆分', mark: '拆', kinds: ['split'] },
  { key: 'moved', label: '移动', mark: '移', kinds: ['moved'] },
  { key: 'removed', label: '删除', mark: '−', kinds: ['removed'] },
]

export const sixCounts = (c: Readonly<Record<ChangeKind, number>> | undefined) =>
  CHANGE_SIX.map(x => ({ key: x.key, label: x.label, mark: x.mark, n: x.kinds.reduce((a, k) => a + (c?.[k] ?? 0), 0) }))

/** 变更清单的分组（F-53，按血缘）：新增 / 修改 / 合并 / 拆分 / 移动 / 改 ID / 删除；待重连另列 */
export const CHANGE_GROUPS: readonly { kind: ChangeKind; label: string }[] = [
  { kind: 'added', label: '新增' },
  { kind: 'changed', label: '修改' },
  { kind: 'merged', label: '合并' },
  { kind: 'split', label: '拆分' },
  { kind: 'moved', label: '移动' },
  { kind: 'renamed', label: '改 ID' },
  { kind: 'removed', label: '删除' },
]
