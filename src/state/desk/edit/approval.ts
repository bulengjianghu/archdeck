/**
 * 认可与任务单的会话一面（TK-1–TK-4，DL-32–DL-38）：设计的状态动作（认可 / 回到起草 / 放弃）经写入端口落到 design.yaml，
 * 写后重新加载（N5）；认可前总览（全设计的改动项、影响面、涉及的场景）；认可后的任务单（模型层 taskList，与命令行同一份）。
 * 去向与拒绝原因只由模型层的迁移表给（designTransition），这里只收集条件。
 */
import { computed, type ComputedRef, type ShallowRef } from 'vue'
import {
  CHANGE_KINDS,
  checkSketches,
  designEntities,
  designTransition,
  taskList,
  taskMarkdown,
  type AcceptedDeviation,
  type ChangeKind,
  type DesignApproval,
  type DesignStatus,
  type ImpactEstimate,
  type ModelIndex,
  type TaskList,
} from '@/model'
import type { ModelWriter } from '../ports'
import type { EditSession } from './session'
import type { EditDerivations } from './derive'
import type { ChangesGroup, NumberedItem } from './changes'
import type { PayloadSketch } from './commands'

export interface ApprovalInputs {
  session: ShallowRef<EditSession | null>
  derive: EditDerivations
  changes: ChangesGroup
  /** 设计 ID（持久草图没有认可） */
  design: string | null
  status: () => DesignStatus | undefined
  approval: () => DesignApproval | undefined
  accepted: () => readonly AcceptedDeviation[]
  name: () => string | undefined
  baseline: () => ModelIndex | null
  current: () => ModelIndex | null
  /** 载荷里各张草图读取时的指纹（会话没有读到时的退路；认可时交给服务端比对：认可的就是人看过的那一份） */
  sketchFiles: () => readonly PayloadSketch[]
  writer: ModelWriter
  reload: () => Promise<void>
}

export type ApprovalOutcome = { ok: true } | { ok: false; reason: string }

/** 认可前总览（DL-38）：改动项按类别分组、影响面、涉及的场景 */
export interface ApprovalOverview {
  groups: { kind: ChangeKind; items: NumberedItem[] }[]
  total: number
  impact: ImpactEstimate | null
}

export function createApproval(i: ApprovalInputs) {
  const status = computed(() => i.status())
  /** DL-32：「认可」此刻能不能做（不能时为原因） */
  const acceptBlocked = computed<string | null>(() => {
    const s = status.value
    if (!i.design || !s || !i.session.value) return '只有设计的草图能认可'
    const errors = i.derive.designErrors.value
    const hints = i.derive.designWarnings.value
    const r = designTransition(s, 'accept', {
      saved: !i.derive.dirty.value,
      errors: errors.length,
      firstError: errors[0]?.message,
      hints: hints.length,
      firstHint: hints[0]?.message,
    })
    return r.ok ? null : r.reason
  })

  const overview: ComputedRef<ApprovalOverview> = computed(() => {
    const items = i.changes.items.value
    const groups = CHANGE_KINDS.map(kind => ({ kind, items: items.filter(x => x.kind === kind) })).filter(g => g.items.length)
    return { groups, total: items.length, impact: items.length ? i.changes.impactOf(items.map(x => x.n)) : null }
  })

  async function act(action: 'accept' | 'withdraw' | 'abandon'): Promise<ApprovalOutcome> {
    const s = status.value
    if (!i.design || !s) return { ok: false, reason: '只有设计能改状态' }
    if (action === 'accept' && acceptBlocked.value) return { ok: false, reason: acceptBlocked.value }
    const t = designTransition(s, action)
    if (!t.ok) return { ok: false, reason: t.reason }
    // 认可的是保存后的那一份：会话保存后已接上新指纹（载荷要等重新加载才更新），以会话为准
    const read = i.session.value?.read
    const sketches =
      action === 'accept'
        ? read && Object.keys(read).length
          ? Object.fromEntries(Object.values(read).map(r => [r.file, r.hash]))
          : Object.fromEntries(i.sketchFiles().map(f => [f.path ?? f.file, f.hash]))
        : undefined
    const r = await i.writer.designStatus({ design: i.design, action, ...(sketches ? { sketches } : {}) })
    if (!r.ok) return { ok: false, reason: r.error }
    await i.reload()
    return { ok: true }
  }

  /** TK-2、TK-3：任务单——会话里的草图（认可后锁定，即磁盘上的那一份）对当前版本的核验，按号归到改动项 */
  const tasks = computed<TaskList | null>(() => {
    const s = i.session.value
    const b = i.baseline()
    const cur = i.current() ?? b
    const st = status.value
    if (!s || !b || !cur || !i.design || !st) return null
    const checks = checkSketches(cur, designEntities(s.doc.sketches, i.design), new Map([[i.design, i.accepted()]]), new Map([[i.design, b]])).filter(
      c => c.design === i.design,
    )
    return taskList({
      design: i.design,
      name: i.name(),
      status: st,
      approval: i.approval(),
      sketches: s.doc.sketches,
      baseline: b,
      table: i.changes.table.value,
      checks,
    })
  })
  /** 任务模式（DL-38）：设计已认可（或认可已撤回仍要提示）时「改动」页签带状态列 */
  const taskMode = computed(() => status.value === 'accepted')

  return {
    status,
    acceptBlocked,
    overview,
    accept: () => act('accept'),
    withdraw: () => act('withdraw'),
    abandon: () => act('abandon'),
    tasks,
    taskMode,
    /** 复制给 agent 的 Markdown（与 arch tasks 同一份） */
    markdown: () => (tasks.value ? taskMarkdown(tasks.value) : ''),
    /** 导出给外部系统的 JSON（与 arch tasks --json 同一份） */
    json: () => (tasks.value ? JSON.stringify(tasks.value, null, 2) : ''),
  }
}

export type ApprovalGroup = ReturnType<typeof createApproval>
