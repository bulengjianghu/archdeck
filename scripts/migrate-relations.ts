/**
 * 关系类型迁移（M12、ADR-0022）：把描述里的旧名改为新名——
 *   event → notifies，并翻转 from / to（箭头改为控制流方向：发布者 → 订阅者）
 *   dataflow → streams
 *
 *   npm run migrate:relations                 迁移模型根目录（默认 model/）下的全部项目
 *   npm run migrate:relations -- <项目目录>   只迁移指定目录
 *   加 --dry 只列出、不写文件
 *
 * 含设计版本各轮（designs/<设计>/<轮次>/）：别名删除后它们仍要能打开。
 * 只替换这几个值在原文中的字符，注释、引号与排版原样保留（vite/migrateRelations.ts）。
 * description 里有方向字样的条目列出供人工核对（翻转后「订阅 / 发布 / →」之类的句子可能要改顺）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { listProjectIds, resolveModelRoot } from '../vite/readModelDir'
import { migrateText, type Review } from '../vite/migrateRelations'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2).filter(a => a !== '--')
const dry = args.includes('--dry')
const arg = args.find(a => !a.startsWith('--'))
const modelRoot = resolveModelRoot(root)
const projectDirs = arg ? [path.resolve(process.cwd(), arg)] : listProjectIds(modelRoot).map(id => path.join(modelRoot, id))

function yamlFiles(dir: string): string[] {
  const out: string[] = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...yamlFiles(p))
    else if (/\.ya?ml$/i.test(e.name)) out.push(p)
  }
  return out.sort()
}

function main() {
  let flipped = 0
  let renamed = 0
  const reviews: Review[] = []
  for (const dir of projectDirs) {
    let pf = 0
    let pr = 0
    for (const file of yamlFiles(dir)) {
      const r = migrateText(fs.readFileSync(file, 'utf8'))
      if (!r) continue
      const rel = path.relative(root, file)
      if (!dry) fs.writeFileSync(file, r.text)
      pf += r.flipped.length
      pr += r.renamed.length
      reviews.push(...r.review.map(x => ({ ...x, file: rel })))
      console.log(`  ${rel}  event→notifies ${r.flipped.length}（已翻转）  dataflow→streams ${r.renamed.length}`)
    }
    console.log(`${path.relative(root, dir)}：翻转 ${pf} 条，改名 ${pr} 条`)
    flipped += pf
    renamed += pr
  }
  if (reviews.length) {
    console.log(`\n需人工核对的说明（${reviews.length} 条，翻转后方向字样可能要改顺）：`)
    for (const x of reviews) console.log(`  ${x.file}:${x.line}  ${x.id}  ${x.description.replace(/\s+/g, ' ')}`)
  }
  console.log(`\n合计：翻转 ${flipped} 条，改名 ${renamed} 条${dry ? '（--dry，未写文件）' : ''}`)
}

main()
