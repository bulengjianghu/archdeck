/**
 * E2E 全局准备：各 spec 并行时都会经页面写指纹 governance/owned.json 与拦截记录 ledger.jsonl（各自只撤销自己的那部分，
 * 但 updatedAt 等先后写的痕迹分不清是谁的）。这里在整轮开始前留快照、全部结束后原样写回，跑完 git status 干净。
 */
import fs from 'node:fs'
import path from 'node:path'

const GOV = path.resolve(import.meta.dirname, '../model/h5p-arch-desk/governance')
const FILES = ['owned.json', 'ledger.jsonl'].map(f => path.join(GOV, f))

export default function globalSetup() {
  // G9（CLAUDE.md §4）：worktree 里缺环境变量是假红——代码事实读不到（source.missing），相关用例全红；打显眼的警告，别让人去修用例
  for (const [k, hint] of [
    ['ARCH_WORKSPACE_ROOT', '被描述项目（h5player 等）的源码读不到'],
    ['ARCH_SOURCE_ROOT_H5P_ARCH_DESK', '本项目自身的代码事实会读到主检出而不是这个 worktree'],
  ] as const) {
    if (!process.env[k]) console.warn(`\n⚠ 缺环境变量 ${k}：${hint}，代码事实类用例将假红。按 CLAUDE.md §4 设好两个环境变量再跑。\n`)
  }
  const snapshot = new Map(FILES.map(f => [f, fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null]))
  return () => {
    for (const [f, text] of snapshot) {
      if (text === null) fs.rmSync(f, { force: true })
      else fs.writeFileSync(f, text)
    }
  }
}
