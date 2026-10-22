/**
 * 描述写入的同步适配器（B1–B5，ADR-0019）：页面只追加人拥有的三类内容；写入方式由项目视图注入（开发服务器的 HTTP 端点）。
 * 写后不改视图状态：开发服务器推送描述变化，模型源同步按 N5 重新加载。
 */
import type { RuleKind } from '@/model'

export type WriteOutcome = { ok: true; file: string } | { ok: false; error: string }

export interface ModelWriter {
  feedback(input: { design: string; revision: string; text: string }): Promise<WriteOutcome>
  allow(input: { from: string; to: string; rule?: RuleKind; reason: string }): Promise<WriteOutcome>
  ignore(input: { pattern: string }): Promise<WriteOutcome>
}

const none = async (): Promise<WriteOutcome> => ({ ok: false, error: '没有注入写入来源' })

/** 没有注入写入来源时（只看描述的测试） */
export const NO_WRITER: ModelWriter = { feedback: none, allow: none, ignore: none }
