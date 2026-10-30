/** 单测只用到 jsdom 的这一点：在独立窗口里执行图解 iframe 文档的脚本（EX-3 的桥接脚本） */
declare module 'jsdom' {
  export class JSDOM {
    constructor(html: string, options?: { runScripts?: 'dangerously' | 'outside-only' })
    readonly window: Window & typeof globalThis
  }
}
