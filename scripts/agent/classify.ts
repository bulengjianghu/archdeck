/**
 * `arch classify`（ADR-0029 §5、§6）：给未分类（calls）的关系建议查询 / 委托，可写回描述文件。
 *
 * - 当前版本：有源码时按代码事实（文件依赖、调用点、签名、状态持有）+ 描述 + 名字分类；
 * - 设计某一轮 / 草图版本：没有代码事实（K8）；同 ID 的关系在当前版本已分类（queries / commands）的沿用，其余按描述与名字。
 *
 * 写回（--write）只改 `type` 一个值与 `description` 一个值（没有说明时补一个），不重排文件：按 YAML 语法树的位置替换原文。
 * 草图文件（intent/*.yaml、designs/<设计>/sketches/*.yaml，人拥有）只改 type；关系在草图里写了说明的，其他文件里同 ID 的说明也不改（X1：草图写了的字段以草图为准）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { isMap, isScalar, parseDocument, Scalar, type Node as YamlNode, type Pair, type YAMLMap } from 'yaml'
import {
  assignFiles,
  classifyRelation,
  governanceReport,
  interactionDescription,
  isCoreBetween,
  isSketchFile,
  isUnclassified,
  loadModel,
  moduleName,
  type Classification,
  type ClassifiedType,
  type ClassifyCode,
  type GovernanceReport,
  type ModelIndex,
  type RawFile,
} from '../../src/model'
import { DESIGNS_DIR, listDesigns, readDesignRevision, readProject, resolveModelRoot } from '../../vite/readModelDir'
import { readSourceTree } from '../../vite/readSource'
import { readCodeDeps } from '../../vite/readDeps'
import { readClassifyCode } from '../../vite/readClassifyFacts'
import { governanceDir, readBaseline } from '../../vite/governanceStore'

export interface ClassifyOptions {
  root: string
  project: string
  /** 设计 ID；给了时分类该设计的各轮与草图版本（revision 给了时只分类那一轮，`sketch` 为草图版本） */
  design?: string
  revision?: string
  /** 全部设计的全部轮次与草图版本 */
  allDesigns?: boolean
  write?: boolean
  coreOnly?: boolean
  /** 人工核对后的覆盖：关系 ID → 类型（可带依据），优先于启发式与沿用 */
  overrides?: ReadonlyMap<string, { type: ClassifiedType; why?: string }>
  env?: NodeJS.ProcessEnv
}

export interface ClassifiedRow extends Classification {
  from: string
  to: string
  core: boolean
  /** 写回时用的说明（交互口吻） */
  description: string
  /** 沿用当前版本的分类 */
  inherited?: true
  file: string
}

export interface ClassifyTarget {
  label: string
  rows: ClassifiedRow[]
  written?: { file: string; types: number; descriptions: number }[]
}

/** 一个要分类的版本：载荷文件（相对路径）与它们在磁盘上的位置 */
interface Target {
  label: string
  files: RawFile[]
  /** 载荷路径 → 绝对路径；不在表里的不写（引用桩、别的版本的草图） */
  abs: (p: string) => string | undefined
  current: boolean
}

export function runClassify(opts: ClassifyOptions): ClassifyTarget[] {
  const env = opts.env ?? process.env
  const modelRoot = resolveModelRoot(opts.root, env)
  const projectDir = path.join(modelRoot, opts.project)
  const current = readProject(modelRoot, opts.project, opts.root)
  if (!current) throw new Error(`项目不存在：${opts.project}`)
  const targets: Target[] = []
  if (!opts.design && !opts.allDesigns)
    targets.push({ label: `${opts.project} 当前版本`, files: current.files, abs: p => path.join(projectDir, p), current: true })
  const designs = listDesigns(projectDir).filter(d => opts.allDesigns || d.id === opts.design)
  if (opts.design && !designs.length) throw new Error(`设计不存在：${opts.design}`)
  for (const d of designs) {
    const designDir = path.join(projectDir, DESIGNS_DIR, d.id)
    const revs = [...d.revisions.map(r => r.id), ...(d.sketch ? ['sketch'] : [])].filter(r => !opts.revision || r === opts.revision)
    for (const r of revs) {
      const payload = readDesignRevision(modelRoot, opts.project, d.id, r, opts.root)
      if (!payload) continue
      const abs = r === 'sketch' ? (p: string) => (p.startsWith('sketches/') ? path.join(designDir, p) : undefined) : (p: string) => path.join(designDir, r, p)
      targets.push({ label: `${opts.project} / ${d.id} / ${r}`, files: payload.files, abs, current: false })
    }
  }
  // 设计各轮沿用当前版本的分类（同 ID 的关系）
  const reference = loadModel(current.files).index
  const out: ClassifyTarget[] = []
  for (const t of targets) {
    const { index } = loadModel(t.files)
    let report: GovernanceReport | null = null
    let code: ClassifyCode | undefined
    if (t.current) {
      const tree = readSourceTree(modelRoot, opts.project, opts.root, env)
      if (tree?.status === 'local') {
        const own = assignFiles(index, tree.files, index.model.sourceIgnore)
        const deps = readCodeDeps(tree.root, tree.files, tree.packages)
        report = governanceReport(index, own, tree, deps, readBaseline(governanceDir(modelRoot, opts.project)))
        code = readClassifyCode(tree.root, tree.files, tree.packages, deps.deps, own.direct)
      }
    }
    const rows: ClassifiedRow[] = []
    for (const r of [...index.relations.values()].sort((a, b) => a.seq - b.seq)) {
      if (!isUnclassified(r.type)) continue
      const core = isCoreBetween(index, r)
      if (opts.coreOnly && !core) continue
      const ref = t.current ? undefined : reference.relations.get(r.id)
      let c: Classification
      let inherited = false
      const o = opts.overrides?.get(r.id)
      if (o) {
        const h = classifyRelation(index, report, r, code)
        c = {
          ...h,
          type: o.type,
          confidence: 'high',
          reasons: [
            `人工核对：${o.why ?? (o.type === 'queries' ? '取结果、无副作用' : '交出一件事，被调方拥有后果')}`,
            ...(h.type !== o.type ? [`（启发式原建议 ${h.type}）`] : []),
            ...h.reasons,
          ],
        }
      } else if (ref && (ref.type === 'queries' || ref.type === 'commands')) {
        c = {
          relation: r.id,
          type: ref.type,
          confidence: 'high',
          score: { queries: 0, commands: 0 },
          reasons: [`沿用当前版本的分类（${ref.type}${ref.from !== r.from || ref.to !== r.to ? `；当前版本两端为 ${ref.from} → ${ref.to}` : ''}）`],
        }
        inherited = true
      } else c = classifyRelation(index, report, r, code)
      rows.push({
        ...c,
        from: r.from,
        to: r.to,
        core,
        description: interactionDescription(index, r, c.type, c.summary),
        ...(inherited ? { inherited: true as const } : {}),
        file: r.src.file,
      })
    }
    const result: ClassifyTarget = { label: t.label, rows }
    if (opts.write && rows.length) result.written = writeBack(t, index, rows)
    out.push(result)
  }
  return out
}

// ── 写回 ──

interface Edit {
  start: number
  end: number
  text: string
}

const PLAIN_UNSAFE_FLOW = /[,[\]{}#]|: |^[-?:!&*|>'"%@`\s]|\s$|^$/
const PLAIN_UNSAFE_BLOCK = /: | #|^[-?:!&*|>'"%@`[\]{},#\s]|\s$|^$/

/** 说明值的写法：原来带引号的保持引号；原来是纯量且新值不需要引号时写纯量；否则双引号 */
function scalarText(value: string, flow: boolean, style?: Scalar.Type): string {
  if (style === Scalar.QUOTE_SINGLE) return `'${value.replace(/'/g, "''")}'`
  if (style === Scalar.QUOTE_DOUBLE) return JSON.stringify(value)
  return (flow ? PLAIN_UNSAFE_FLOW : PLAIN_UNSAFE_BLOCK).test(value) || /^(true|false|null|~|[-+]?\d)/i.test(value) ? JSON.stringify(value) : value
}

const pairOf = (m: YAMLMap, key: string) => m.items.find(p => isScalar(p.key) && p.key.value === key) as Pair<YamlNode, YamlNode> | undefined

function walkMaps(n: unknown, visit: (m: YAMLMap) => void) {
  if (!n || typeof n !== 'object') return
  if (isMap(n)) {
    visit(n)
    for (const p of n.items) walkMaps(p.value, visit)
  } else if ('items' in (n as { items?: unknown[] }) && Array.isArray((n as { items: unknown[] }).items))
    for (const x of (n as { items: unknown[] }).items) walkMaps(x, visit)
}

/** 一个文件里的改写：id → 新类型与（可选的）新说明 */
export function rewriteRelations(
  text: string,
  edits: ReadonlyMap<string, { type: ClassifiedType; description?: string }>,
): { text: string; types: number; descriptions: number } {
  const doc = parseDocument(text)
  const out: Edit[] = []
  let types = 0
  let descriptions = 0
  walkMaps(doc.contents, m => {
    const id = pairOf(m, 'id')?.value
    const type = pairOf(m, 'type')?.value
    if (!isScalar(id) || !isScalar(type) || !pairOf(m, 'from') || !pairOf(m, 'to')) return
    const e = edits.get(String(id.value))
    if (!e || type.value !== 'calls' || !type.range) return
    out.push({ start: type.range[0], end: type.range[1], text: e.type })
    types++
    if (e.description === undefined) return
    const dp = pairOf(m, 'description')
    const flow = !!m.flow
    if (dp && isScalar(dp.value) && dp.value.range) {
      if (dp.value.value === e.description) return
      const style = dp.value.type
      const block = style === Scalar.BLOCK_FOLDED || style === Scalar.BLOCK_LITERAL
      out.push({ start: dp.value.range[0], end: dp.value.range[1], text: scalarText(e.description, flow, block ? Scalar.QUOTE_DOUBLE : style) })
      // 块纯量的结束位置含末尾换行：补回
      if (block && text[dp.value.range[1] - 1] === '\n') out[out.length - 1].text += '\n'
      descriptions++
    } else if (!dp) {
      if (flow && m.range) {
        let j = text.lastIndexOf('}', m.range[1])
        while (j > 0 && /[ \t]/.test(text[j - 1])) j--
        out.push({ start: j, end: j, text: `, description: ${scalarText(e.description, true)}` })
      } else {
        const tp = pairOf(m, 'type')!
        const keyStart = (tp.key as Scalar).range![0]
        const lineStart = text.lastIndexOf('\n', keyStart) + 1
        const indent = text.slice(lineStart, keyStart).replace(/[^ ]/g, ' ')
        const eol = text.indexOf('\n', type.range[1])
        const at = eol < 0 ? text.length : eol
        out.push({ start: at, end: at, text: `\n${indent}description: ${scalarText(e.description, false)}` })
      }
      descriptions++
    }
  })
  out.sort((a, b) => b.start - a.start)
  let s = text
  for (const e of out) s = s.slice(0, e.start) + e.text + s.slice(e.end)
  return { text: s, types, descriptions }
}

function writeBack(t: Target, index: ModelIndex, rows: readonly ClassifiedRow[]): { file: string; types: number; descriptions: number }[] {
  // 草图里写了说明的关系：说明以草图为准，哪里都不改
  const sketchDescribed = new Set<string>()
  for (const f of t.files) {
    if (!isSketchFile(f.path)) continue
    walkMaps(parseDocument(f.text).contents, m => {
      const id = pairOf(m, 'id')?.value
      if (isScalar(id) && pairOf(m, 'from') && pairOf(m, 'description')) sketchDescribed.add(String(id.value))
    })
  }
  const written: { file: string; types: number; descriptions: number }[] = []
  for (const f of t.files) {
    const abs = t.abs(f.path)
    if (!abs || !fs.existsSync(abs)) continue
    const sketch = isSketchFile(f.path) || f.path.startsWith('sketches/')
    const edits = new Map(
      rows.map(r => [r.relation, { type: r.type, ...(sketch || sketchDescribed.has(r.relation) ? {} : { description: r.description }) }] as const),
    )
    const before = fs.readFileSync(abs, 'utf8')
    const r = rewriteRelations(before, edits)
    if (r.types || r.descriptions) {
      fs.writeFileSync(abs, r.text)
      written.push({ file: abs, types: r.types, descriptions: r.descriptions })
    }
  }
  void index
  return written
}

/** 命令行输出 */
export function printClassify(results: readonly ClassifyTarget[], index?: ModelIndex): void {
  for (const t of results) {
    const q = t.rows.filter(r => r.type === 'queries').length
    const conf = (c: string) => t.rows.filter(r => r.confidence === c).length
    console.log(
      `\n${t.label}：未分类 ${t.rows.length} 条 → 查询 ${q} · 委托 ${t.rows.length - q}（置信度 高 ${conf('high')} · 中 ${conf('medium')} · 低 ${conf('low')}）`,
    )
    for (const r of t.rows) {
      const name = (id: string) => (index ? moduleName(index, id) : id)
      console.log(
        `  ${r.relation}  ${name(r.from)} → ${name(r.to)}${r.core ? '  [核心之间]' : ''}  ⇒ ${r.type}（${r.confidence}；查询 ${r.score.queries} / 委托 ${r.score.commands}）${r.factOnly ? `  [只有${r.factOnly === 'extends' ? '继承' : '组装'}]` : ''}`,
      )
      for (const why of r.reasons) console.log(`      · ${why}`)
    }
    for (const w of t.written ?? []) console.log(`  已写回 ${w.file}：类型 ${w.types} 处、说明 ${w.descriptions} 处`)
  }
}
