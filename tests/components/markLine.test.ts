/** S18：源码预览定位到行——高亮结果里第 N 行标出 target */
import { describe, expect, it } from 'vitest'
import { markLine } from '../../src/components/source/markLine'

const HTML = '<pre class="shiki"><code><span class="line">a</span>\n<span class="line">b</span>\n<span class="line">c</span></code></pre>'

describe('S18 源码预览定位到行', () => {
  it('第 N 个 span.line 加 target，其余不变；没有目标行或越界时原样', () => {
    expect(markLine(HTML, 2)).toBe(HTML.replace('<span class="line">b', '<span class="line target">b'))
    expect(markLine(HTML, undefined)).toBe(HTML)
    expect(markLine(HTML, 9)).toBe(HTML)
  })
})
