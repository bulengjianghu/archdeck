/** S18：在高亮结果里标出目标行——第 N 个 `span.line` 加 `target`（行号从 1 起）；没有目标行或行号越界时原样返回 */
export function markLine(html: string, line: number | undefined): string {
  if (!line) return html
  let k = 0
  return html.replace(/<span class="line"/g, m => (++k === line ? '<span class="line target"' : m))
}
