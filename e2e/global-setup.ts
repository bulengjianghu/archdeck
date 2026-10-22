/**
 * E2E 全局准备：各 spec 并行时都会经页面写指纹 governance/owned.json 与拦截记录 ledger.jsonl（各自只撤销自己的那部分，
 * 但 updatedAt 等先后写的痕迹分不清是谁的）。这里在整轮开始前留快照、全部结束后原样写回，跑完 git status 干净。
 */
import fs from 'node:fs'
import path from 'node:path'

const GOV = path.resolve(import.meta.dirname, '../model/h5p-arch-desk/governance')
const FILES = ['owned.json', 'ledger.jsonl'].map(f => path.join(GOV, f))

export default function globalSetup() {
  const snapshot = new Map(FILES.map(f => [f, fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null]))
  return () => {
    for (const [f, text] of snapshot) {
      if (text === null) fs.rmSync(f, { force: true })
      else fs.writeFileSync(f, text)
    }
  }
}
