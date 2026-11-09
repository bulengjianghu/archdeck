/**
 * 对话里的机制图块（第二十一轮波 4 T4.0）：块的形状（DL-40）、检查（DL-41：合格 / 脚本 / 外链 / 不存在的模块 / 尺寸）、
 * data-arch 解析（DL-42）、存为设计说明的围栏块往返（DL-43）、上下文包的输出约定（DL-40）。
 */
import { describe, expect, it } from 'vitest'
import {
  buildContextPack,
  checkDiagram,
  diagramFence,
  diagramModules,
  diagramSvgReasons,
  explainerIssues,
  knownModule,
  loadModel,
  parseBlock,
  parseEventLine,
  splitNoteDiagrams,
  DIAGRAM_LIMITS,
} from '../../src/model'

const YAML = `
system: { id: s, name: 系统, description: 测机制图 }
modules:
  - id: p
    name: 父模块
    children:
      - { id: p.a, name: 甲 }
      - { id: p.b, name: 乙 }
`
const { index } = loadModel([{ path: 'modules/m.yaml', text: YAML }])
const known = knownModule(index)

const svg = (body: string, attrs = 'viewBox="0 0 400 160"') => `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`
const GOOD = svg(
  '<g data-arch="p.a"><rect x="10" y="40" width="120" height="60" fill="none" stroke="currentColor"/><text x="70" y="75">甲</text></g>' +
    '<path d="M130 70 H260" stroke="currentColor" marker-end="url(#arrow)"/><defs><marker id="arrow"><path d="M0 0 L6 3 L0 6z"/></marker></defs>' +
    '<g data-arch="p.b"><rect x="260" y="40" width="120" height="60"/></g><use href="#arrow"/>',
)

describe('DL-40 机制图块的形状', () => {
  it('要有 svg 与 caption 两个非空文字，多出键整轮拒绝；内容不在协议里判', () => {
    expect(parseBlock({ kind: 'diagram', svg: GOOD, caption: ' 拆分后怎么运作 ' })).toEqual({ ok: true, value: { kind: 'diagram', svg: GOOD, caption: '拆分后怎么运作' } })
    expect(parseBlock({ kind: 'diagram', svg: '<svg><script/></svg>', caption: 'x' })).toMatchObject({ ok: true })
    expect(parseBlock({ kind: 'diagram', svg: GOOD })).toMatchObject({ ok: false, error: expect.stringContaining('caption') })
    expect(parseBlock({ kind: 'diagram', svg: '', caption: 'x' })).toMatchObject({ ok: false })
    expect(parseBlock({ kind: 'diagram', svg: GOOD, caption: 'x', html: '<p>' })).toMatchObject({ ok: false, error: expect.stringContaining('html') })
    expect(parseEventLine(JSON.stringify({ type: 'block', block: { kind: 'diagram', svg: GOOD, caption: 'c' } }))).toMatchObject({ ok: true })
  })
})

describe('DL-41 图块的检查', () => {
  it('合格：自包含 SVG、只有页内片段引用、尺寸合适、data-arch 都在描述里——给出引用的模块', () => {
    expect(checkDiagram({ svg: GOOD }, known)).toEqual({ ok: true, modules: ['p.a', 'p.b'] })
    // 系统根也算存在（EX-8 同口径）
    expect(checkDiagram({ svg: svg('<g data-arch="s"/>') }, known)).toMatchObject({ ok: true })
    // data:image 内联图片可以
    expect(checkDiagram({ svg: svg('<image href="data:image/png;base64,AAAA" width="10" height="10"/>') }, known)).toMatchObject({ ok: true })
  })

  it('不合格一：含脚本（<script>、on… 事件属性、javascript:）', () => {
    const r = checkDiagram({ svg: svg('<script>alert(1)</script><rect onclick="x()"/><a href="javascript:x()"/>') }, known)
    expect(r.ok).toBe(false)
    const reasons = (r as { reasons: string[] }).reasons.join('\n')
    expect(reasons).toContain('<script>')
    expect(reasons).toContain('事件属性')
    expect(reasons).toContain('javascript:')
  })

  it('不合格二之一：不带引号的属性值也查（协调者 17 收紧）', () => {
    const r = checkDiagram({ svg: svg('<image href=https://evil.example/u.png width="10" height="10"/><use xlink:href=#ok/>') }, known)
    expect(r.ok).toBe(false)
    const reasons = (r as { reasons: string[] }).reasons
    expect(reasons.some(x => x.includes('https://evil.example/u.png'))).toBe(true)
    expect(reasons.some(x => x.includes('#ok'))).toBe(false)
  })

  it('不合格二：外部资源（外链 href、样式 url()、@import、foreignObject）', () => {
    const r = checkDiagram(
      {
        svg: svg(
          '<image href="https://evil.example/x.png"/><style>@import "a.css"; .x{fill:url(https://e.example/p)}</style><foreignObject><div/></foreignObject><rect fill="url(#ok)"/>',
        ),
      },
      known,
    )
    expect(r.ok).toBe(false)
    const reasons = (r as { reasons: string[] }).reasons
    expect(reasons.some(x => x.includes('https://evil.example/x.png'))).toBe(true)
    expect(reasons.some(x => x.includes('@import'))).toBe(true)
    expect(reasons.some(x => x.includes('url(https://e.example/p)'))).toBe(true)
    expect(reasons.some(x => x.includes('foreignObject'))).toBe(true)
    expect(reasons.some(x => x.includes('#ok'))).toBe(false)
  })

  it('不合格三：data-arch 指向的模块不存在（复用图解的 unknownArchRefs）；草图里按当前张查', () => {
    const r = checkDiagram({ svg: svg('<g data-arch="p.a"/><g data-arch="ghost"/><g data-arch="ghost"/>') }, known)
    expect(r).toEqual({ ok: false, reasons: ['data-arch 指向的模块不存在：ghost'] })
    // 草图里：known 换成当前张（挂载点与它画着的框）
    const sheet = new Set(['p', 'p.session'])
    expect(checkDiagram({ svg: svg('<g data-arch="p.session"/>') }, id => sheet.has(id))).toMatchObject({ ok: true })
    expect(checkDiagram({ svg: svg('<g data-arch="p.a"/>') }, id => sheet.has(id))).toMatchObject({ ok: false })
  })

  it('形状与尺寸：前后有别的内容、没有 viewBox、太宽、太扁、太大', () => {
    expect(diagramSvgReasons(`<p>说明</p>${GOOD}`)[0]).toContain('自包含')
    expect(diagramSvgReasons(svg('', 'width="300"')).join()).toContain('viewBox')
    expect(diagramSvgReasons(svg('', 'viewBox="0 0 900 300"')).join()).toContain('太宽')
    expect(diagramSvgReasons(svg('', 'viewBox="0 0 900 300" width="100%"')).join()).toContain('太宽')
    expect(diagramSvgReasons(svg('', 'viewBox="0 0 1200 300" width="600"'))).toEqual([])
    expect(diagramSvgReasons(svg('', 'viewBox="0 0 600 100"')).join()).toContain('宽高比')
    expect(diagramSvgReasons(svg(`<desc>${'x'.repeat(DIAGRAM_LIMITS.bytes)}</desc>`)).join()).toContain('太大')
  })

  it('图块不是描述：同一份 SVG 放进描述目录以外不产生任何图解问题（不进 lint:model）', () => {
    expect(explainerIssues(index)).toEqual([])
  })
})

describe('DL-42 data-arch 解析', () => {
  it('按出现顺序去重；嵌套与单双引号都认', () => {
    expect(diagramModules(svg(`<g data-arch='p.b'><g data-arch="p.a"/></g><text data-arch="p.b">乙</text>`))).toEqual(['p.b', 'p.a'])
    expect(diagramModules(svg('<rect/>'))).toEqual([])
  })
})

describe('DL-43 存为设计说明的围栏块', () => {
  it('写成 ```arch-diagram <说明> 围栏；切回文字段与图段，往返不变', () => {
    const fence = diagramFence({ svg: `\n${GOOD}\n`, caption: '拆分后\n怎么运作' })
    expect(fence.split('\n')[0]).toBe('```arch-diagram 拆分后 怎么运作')
    const text = `第一段。\n> 甲：按序施用\n\n${fence}\n\n${diagramFence({ svg: GOOD, caption: '第二张' })}\n\n尾段`
    expect(splitNoteDiagrams(text)).toEqual([
      { kind: 'text', text: '第一段。\n> 甲：按序施用' },
      { kind: 'diagram', svg: GOOD, caption: '拆分后 怎么运作' },
      { kind: 'diagram', svg: GOOD, caption: '第二张' },
      { kind: 'text', text: '尾段' },
    ])
    // 再写一遍得到同样的围栏
    const [, d] = splitNoteDiagrams(text) as [unknown, { svg: string; caption: string }]
    expect(diagramFence(d)).toBe(fence)
    // 没有图段时原样一段
    expect(splitNoteDiagrams('只有文字\n```js\nx\n```')).toEqual([{ kind: 'text', text: '只有文字\n```js\nx\n```' }])
  })
})

describe('DL-40 上下文包的输出约定', () => {
  it('「问」与「改」写明机制图块、什么时候画与一行完整示例（示例本身是一行合法事件，图过检查）；「重讲」不带', () => {
    for (const mode of ['ask', 'edit'] as const) {
      const pack = buildContextPack(index, { project: 's', anchor: { kind: 'module', module: 'p' }, mode, text: '画一张图' })
      const out = pack.output.join('\n')
      expect(out).toContain('"kind":"diagram"')
      expect(out).toContain('拆分 / 合并之后怎么运作')
      const line = pack.output.find(x => x.startsWith('示例（一行）：{"type":"block","block":{"kind":"diagram"'))!
      const ev = parseEventLine(line.replace('示例（一行）：', '').replace('<模块 ID>', 'p.a'))
      expect(ev).toMatchObject({ ok: true, value: { type: 'block', block: { kind: 'diagram' } } })
      const b = (ev as { value: { block: { svg: string } } }).value.block
      expect(checkDiagram(b, known)).toEqual({ ok: true, modules: ['p.a'] })
    }
    const re = buildContextPack(index, { project: 's', anchor: { kind: 'module', module: 'p' }, mode: 'renarrate', text: 'x' })
    expect(re.output.join('\n')).not.toContain('"kind":"diagram"')
  })
})
