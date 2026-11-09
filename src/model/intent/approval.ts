/**
 * 设计的认可与状态迁移（DL-9、DL-32–DL-35，07 §3.1，ADR-0063 决策 2）：认可记在 design.yaml（status: accepted + 各张草图的内容指纹），
 * 不写确认记录。这里只有纯函数——迁移表（designTransition）、锁定判定（editLock）、认可指纹比对（approvalDrift）；
 * 指纹怎么算、文件怎么写在接入层（vite/designStatus.ts），页面与命令行同一张表。
 */
import type { DesignApproval, DesignStatus } from '../design'

/** 人对设计状态的动作：认可、回到起草、放弃、归档（归档动作本身随波 4，这里只判条件） */
export type DesignAction = 'accept' | 'withdraw' | 'abandon' | 'archive'

export const DESIGN_ACTIONS: readonly DesignAction[] = ['accept', 'withdraw', 'abandon', 'archive']

export const DESIGN_ACTION_LABELS: Record<DesignAction, string> = { accept: '认可', withdraw: '回到起草', abandon: '放弃', archive: '归档' }

/** 认可指纹比对的结果（DL-35） */
export interface ApprovalDrift {
  /** 指纹不同的草图（键为相对设计目录的路径，如 sketches/state.desk.yaml） */
  changed: string[]
  /** 认可后新加的草图 */
  added: string[]
  /** 认可后删掉的草图 */
  removed: string[]
  /** 没有认可记录（未认可或已撤回） */
  missing: boolean
  /** 一致：有记录、三者都空 */
  intact: boolean
}

/** 迁移的条件（缺省为满足） */
export interface TransitionContext {
  /** 认可：草图都已保存（页面没有未保存的改动，且认可的就是磁盘上的那一份） */
  saved?: boolean
  /** 认可：格式错误数与第一条的说明 */
  errors?: number
  firstError?: string
  /** 认可：未解决的语义提示数（成环、矛盾、待重连，X14）与第一条的说明 */
  hints?: number
  firstHint?: string
  /** 归档第一关：核验一致（X4） */
  consistent?: boolean
  /** 归档第二关：棘轮无新增（U8） */
  ratchet?: boolean
  /** 归档第三关：认可指纹比对（DL-35） */
  drift?: ApprovalDrift
}

export type TransitionResult = { ok: true; to: DesignStatus } | { ok: false; reason: string }

const no = (reason: string): TransitionResult => ({ ok: false, reason })

/** 锁定与拒绝的说明（信息条、对话与画布同一句） */
export const LOCKED_ACCEPTED = '设计已认可，草图已锁定：要改先「回到起草」'
export const LOCKED_IMPLEMENTED = '设计已实现，只看'
export const LOCKED_ABANDONED = '设计已放弃，只看'
export const DRIFT_REASON = '草图自认可后已改动：先「回到起草」再认可'

/** DL-32：「评审中」不再产生，旧设计按起草中迁移 */
const drafting = (s: DesignStatus) => s === 'draft' || s === 'reviewing'

/** DL-32：07 §3.1 的迁移表——每一行一个去向或一句拒绝原因 */
export function designTransition(from: DesignStatus, action: DesignAction, ctx: TransitionContext = {}): TransitionResult {
  if (from === 'implemented') return no(`${LOCKED_IMPLEMENTED}：已实现的设计不能再「${DESIGN_ACTION_LABELS[action]}」`)
  if (from === 'abandoned') return no(`${LOCKED_ABANDONED}：已放弃的设计不能再「${DESIGN_ACTION_LABELS[action]}」`)
  if (drafting(from)) {
    if (action === 'abandon') return { ok: true, to: 'abandoned' }
    if (action === 'withdraw') return no('设计还没认可，不用「回到起草」')
    if (action === 'archive') return no('设计还没认可：先「认可」，代码改到位后才能归档')
    if (ctx.saved === false) return no('有未保存的改动：先保存，认可的是保存后的草图')
    if (ctx.errors) return no(`有 ${ctx.errors} 个格式错误，改正后才能认可${ctx.firstError ? `（${ctx.firstError}）` : ''}`)
    if (ctx.hints) return no(`有 ${ctx.hints} 个未解决的提示，处理后才能认可${ctx.firstHint ? `（${ctx.firstHint}）` : ''}`)
    return { ok: true, to: 'accepted' }
  }
  // 已认可
  if (action === 'accept') return no('设计已经认可过了')
  if (action === 'withdraw') return { ok: true, to: 'draft' }
  if (action === 'abandon') return { ok: true, to: 'abandoned' }
  if (ctx.consistent === false) return no('核验不一致：代码还没改到草图那样（看任务单里「待做」的项）')
  if (ctx.ratchet === false) return no('规则有新违反（棘轮）：先修掉新增的违规或环')
  if (ctx.drift && !ctx.drift.intact) return no(ctx.drift.missing ? '没有认可记录：先「认可」' : DRIFT_REASON)
  return { ok: true, to: 'implemented' }
}

/** DL-34：编辑锁——已认可 / 已实现 / 已放弃时拒绝一切改动，返回原因；起草中为 null */
export function editLock(status: DesignStatus | undefined): string | null {
  if (status === 'accepted') return LOCKED_ACCEPTED
  if (status === 'implemented') return LOCKED_IMPLEMENTED
  if (status === 'abandoned') return LOCKED_ABANDONED
  return null
}

/** DL-35：认可记录里的指纹与此刻设计目录下的草图指纹（键：相对设计目录的路径）逐张比 */
export function approvalDrift(approval: DesignApproval | undefined, now: Readonly<Record<string, string>>): ApprovalDrift {
  const rec = approval?.sketches
  if (!rec || approval?.withdrawnAt) return { changed: [], added: [], removed: [], missing: true, intact: false }
  const changed = Object.keys(rec)
    .filter(f => f in now && now[f] !== rec[f])
    .sort()
  const removed = Object.keys(rec)
    .filter(f => !(f in now))
    .sort()
  const added = Object.keys(now)
    .filter(f => !(f in rec))
    .sort()
  return { changed, added, removed, missing: false, intact: !changed.length && !added.length && !removed.length }
}

/** DL-35：比对结果的一句话（归档拒绝、面板提示） */
export function driftText(d: ApprovalDrift): string {
  if (d.missing) return '没有认可记录'
  if (d.intact) return '草图与认可时一致'
  const part = (label: string, xs: string[]) => (xs.length ? [`${label} ${xs.join('、')}`] : [])
  return `${DRIFT_REASON}（${[...part('改了', d.changed), ...part('新加', d.added), ...part('删了', d.removed)].join('；')}）`
}
