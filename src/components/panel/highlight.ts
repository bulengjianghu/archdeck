/**
 * 代码高亮：明暗两套主题，语法首次使用时按需加载。
 * 签名与类型定义用 TypeScript；源代码预览按扩展名对应的语言（G17），不认识的语言返回 null，由调用方显示纯文本。
 */
import type { HighlighterCore, LanguageInput } from 'shiki/core'

let highlighter: Promise<HighlighterCore> | undefined

const LANGS: Record<string, () => LanguageInput> = {
  typescript: () => import('@shikijs/langs/typescript'),
  tsx: () => import('@shikijs/langs/tsx'),
  javascript: () => import('@shikijs/langs/javascript'),
  jsx: () => import('@shikijs/langs/jsx'),
  vue: () => import('@shikijs/langs/vue'),
  json: () => import('@shikijs/langs/json'),
  yaml: () => import('@shikijs/langs/yaml'),
  markdown: () => import('@shikijs/langs/markdown'),
  css: () => import('@shikijs/langs/css'),
  scss: () => import('@shikijs/langs/scss'),
  html: () => import('@shikijs/langs/html'),
  shellscript: () => import('@shikijs/langs/shellscript'),
}

function core(): Promise<HighlighterCore> {
  highlighter ??= (async () => {
    const [{ createHighlighterCore }, { createJavaScriptRegexEngine }] = await Promise.all([import('shiki/core'), import('shiki/engine/javascript')])
    return createHighlighterCore({
      themes: [import('@shikijs/themes/github-light'), import('@shikijs/themes/github-dark')],
      langs: [LANGS.typescript()],
      engine: createJavaScriptRegexEngine(),
    })
  })()
  return highlighter
}

export const canHighlight = (lang: string) => lang in LANGS

/** 按语言高亮；不认识的语言返回 null */
export async function highlightCode(code: string, lang: string): Promise<string | null> {
  if (!canHighlight(lang)) return null
  const h = await core()
  if (!h.getLoadedLanguages().includes(lang)) await h.loadLanguage(LANGS[lang]())
  return h.codeToHtml(code, { lang, themes: { light: 'github-light', dark: 'github-dark' } })
}

export async function highlightTs(code: string): Promise<string> {
  return (await highlightCode(code, 'typescript'))!
}
