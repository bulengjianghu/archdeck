/** 代码高亮：只加载 TypeScript 语法与明暗两套主题，首次使用时按需加载 */
import type { HighlighterCore } from 'shiki/core'

let highlighter: Promise<HighlighterCore> | undefined

export async function highlightTs(code: string): Promise<string> {
  highlighter ??= (async () => {
    const [{ createHighlighterCore }, { createJavaScriptRegexEngine }] = await Promise.all([
      import('shiki/core'),
      import('shiki/engine/javascript'),
    ])
    return createHighlighterCore({
      themes: [import('@shikijs/themes/github-light'), import('@shikijs/themes/github-dark')],
      langs: [import('@shikijs/langs/typescript')],
      engine: createJavaScriptRegexEngine(),
    })
  })()
  const h = await highlighter
  return h.codeToHtml(code, { lang: 'typescript', themes: { light: 'github-light', dark: 'github-dark' } })
}
