/**
 * 辅助栏缺省主语表（DL-4，ADR-0063 决策 7）：「按画布状态查缺省打开哪种资料」是一张纯数据表 + 一个纯函数。
 * 结构 / 交互视角 → 选中模块的题解（有图解开图解，否则理解页）；运行视角 → 时序图；草图画布 → 对话。
 * 协调者（DeskState 的工作区 watcher）只查表，不在 watcher 里写视角分支；加一种画布状态只加一行。
 */
import type { DocRef } from './workspace'

/** 画布状态：三个视角 + 草图画布（编辑会话进行中） */
export type CanvasState = 'structure' | 'interaction' | 'run' | 'sketch'

/** 表里的一格：题解（按选中模块推出）、时序图、对话 */
export type DefaultDocKind = 'story' | 'sequence' | 'dialogue'

export interface DefaultDocContext {
  /** 选中的模块（没有选中模块时题解无从谈起） */
  module?: string | null
  hasExplainer: (id: string) => boolean
}

export type DefaultDocTable = Readonly<Record<string, DefaultDocKind | null>>

export const DEFAULT_DOC_TABLE: DefaultDocTable = {
  structure: 'story',
  interaction: 'story',
  run: 'sequence',
  sketch: 'dialogue',
}

/** 画布状态由视角与是否在草图编辑里推出 */
export const canvasStateOf = (perspective: 'structure' | 'interaction' | 'run', sketching: boolean): CanvasState => (sketching ? 'sketch' : perspective)

/** DL-4：这个画布状态缺省打开哪份资料；表里没有这一行或无从推出（如题解但没选中模块）返回 null */
export function defaultDocFor(canvas: string, ctx: DefaultDocContext, table: DefaultDocTable = DEFAULT_DOC_TABLE): DocRef | null {
  const kind = table[canvas] ?? null
  if (kind === 'sequence') return { kind: 'sequence' }
  if (kind === 'dialogue') return { kind: 'dialogue' }
  if (kind === 'story' && ctx.module) return ctx.hasExplainer(ctx.module) ? { kind: 'explainer', module: ctx.module } : { kind: 'facts', module: ctx.module }
  return null
}
