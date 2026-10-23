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
