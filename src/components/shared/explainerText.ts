/** 图解改动的文字（EX-7）：增 / 删 / 改，资料区与属性栏共用 */
import type { BasisChange } from '@/state/useDeskState'

export const BASIS_CHANGE_TEXT: Record<BasisChange['kind'], string> = { added: '增', removed: '删', changed: '改' }

/** EX-7：过期的一句话；没有记录依据时为「未记录依据」 */
export const staleText = (s: { recorded: unknown; changes: readonly unknown[] }) => (s.recorded ? `基于旧描述 · ${s.changes.length} 处改动` : '未记录依据')
