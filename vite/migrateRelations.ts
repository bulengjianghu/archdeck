/**
 * 关系类型迁移的改写（M12、ADR-0022）：event → notifies 并翻转 from / to，dataflow → streams。
 * 用 YAML 文档模型定位节点，只替换这几个值在原文中的字符，注释、引号与排版原样保留。命令行入口见 scripts/migrate-relations.ts。
 */
import { isMap, isScalar, isSeq, parseDocument, type Scalar } from 'yaml'
import { LEGACY_RELATION_TYPES, type LegacyRelationType } from '../src/model'

/** 描述里与方向有关的字样 */
const DIRECTION_WORDS = /订阅|发布|监听|方向|→|←|->|<-/

interface Edit {
  start: number
  end: number
  text: string
}

export interface Review {
  file: string
  line: number
  id: string
  description: string
}

const lineAt = (text: string, offset: number) => text.slice(0, offset).split('\n').length

/** 一个文件的改写：返回新文本与统计；没有旧名时返回 null */
export function migrateText(text: string): { text: string; flipped: string[]; renamed: string[]; review: Omit<Review, 'file'>[] } | null {
  const doc = parseDocument(text)
  if (doc.errors.length) return null
  const relations = doc.get('relations', true)
  if (!isSeq(relations)) return null
  const edits: Edit[] = []
  const flipped: string[] = []
  const renamed: string[] = []
  const review: Omit<Review, 'file'>[] = []
  const slice = (n: Scalar) => text.slice(n.range![0], n.range![1])
  for (const item of relations.items) {
    if (!isMap(item)) continue
    const type = item.get('type', true)
    if (!isScalar(type) || !(String(type.value) in LEGACY_RELATION_TYPES) || !type.range) continue
    const legacy = LEGACY_RELATION_TYPES[String(type.value) as LegacyRelationType]
    const id = String(item.get('id') ?? '?')
    edits.push({ start: type.range[0], end: type.range[1], text: legacy.to })
    if (legacy.flip) {
      const from = item.get('from', true)
      const to = item.get('to', true)
      if (!isScalar(from) || !isScalar(to) || !from.range || !to.range) continue
      edits.push({ start: from.range[0], end: from.range[1], text: slice(to) }, { start: to.range[0], end: to.range[1], text: slice(from) })
      flipped.push(id)
      const desc = item.get('description')
      if (typeof desc === 'string' && DIRECTION_WORDS.test(desc)) review.push({ line: lineAt(text, type.range[0]), id, description: desc.trim() })
    } else renamed.push(id)
  }
  if (!edits.length) return null
  let out = text
  for (const e of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end)
  return { text: out, flipped, renamed, review }
}
