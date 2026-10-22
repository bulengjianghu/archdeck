/**
 * 返工清单的 Markdown（Q9）：给 agent 的指令，命令行、MCP 与页面「复制给 agent 的指令」同一份文本。
 * 描述文件的路径加上模型目录前缀，源码文件的路径相对源码根目录。
 */
import { REWORK_SEVERITY_LABELS, type ReworkItem, type ReworkList, type ReworkLoc } from './types'

export interface ReworkMarkdownOptions {
  /** 模型目录（相对本包，如 `model/h5player`），加在描述文件路径前 */
  modelDir?: string
  /** 源码根目录，写在清单开头 */
  sourceRoot?: string
  /** 每条最多列多少个受影响位置，缺省 20 */
  limit?: number
}


export function reworkLocText(loc: ReworkLoc, opts: ReworkMarkdownOptions = {}): string {
  const file = loc.in === 'description' && opts.modelDir ? `${opts.modelDir}/${loc.file}` : loc.file
  return `${file}${loc.line ? `:${loc.line}` : ''}${loc.note ? ` ${loc.note}` : ''}`
}

/** 一条返工项：标题、位置、受影响、建议动作 */
export function reworkItemMarkdown(item: ReworkItem, opts: ReworkMarkdownOptions = {}): string {
  const limit = opts.limit ?? 20
  const lines = [`### [${REWORK_SEVERITY_LABELS[item.severity]}] ${item.title}`, '', `- 规则：${item.rules.join('、')}（${item.code}）`]
  if (item.detail) lines.push(`- 说明：${item.detail}`)
  if (item.at) lines.push(`- 位置：\`${reworkLocText({ ...item.at, note: undefined }, opts)}\``)
  if (item.affected.length && !(item.affected.length === 1 && item.at && sameLoc(item.affected[0], item.at))) {
    lines.push(`- 受影响（${item.affected.length}）：`)
    for (const a of item.affected.slice(0, limit)) lines.push(`  - \`${reworkLocText(a, opts)}\``)
    if (item.affected.length > limit) lines.push(`  - …另 ${item.affected.length - limit} 处`)
  }
  lines.push('- 建议：')
  for (const a of item.actions) {
    const file = a.file ? `（${opts.modelDir ? `${opts.modelDir}/${a.file}` : a.file}）` : ''
    lines.push(`  - ${a.text}${file}`)
    if (a.snippet) lines.push('', '    ```yaml', ...a.snippet.split('\n').map(l => `    ${l}`), '    ```', '')
  }
  return lines.join('\n')
}

/** 整份清单：摘要 + 按严重度排好的各条 */
export function reworkMarkdown(list: ReworkList, title: string, opts: ReworkMarkdownOptions = {}): string {
  const head = [
    `# 返工清单：${title}`,
    '',
    `共 ${list.items.length} 条：错误 ${list.counts.error}、提醒 ${list.counts.warning}、提示 ${list.counts.info}。` +
      (opts.sourceRoot ? `源码文件路径相对 \`${opts.sourceRoot}\`。` : '') +
      (list.facts ? '' : '没有代码事实，未含违规、未证实与未描述依赖。'),
    '',
    '修正描述后运行 `npm run lint:model` 自检；按代码修正描述，不改 rules.yaml 迁就代码（加例外由架构师决定）。',
  ]
  if (!list.items.length) return [...head, '', '没有需要返工的问题。'].join('\n')
  return [...head, '', ...list.items.map(i => reworkItemMarkdown(i, opts))].join('\n\n').replace(/\n{3,}/g, '\n\n')
}

const sameLoc = (a: ReworkLoc, b: ReworkLoc) => a.in === b.in && a.file === b.file && a.line === b.line
