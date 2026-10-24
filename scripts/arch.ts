/**
 * agent 接口的命令行外壳（AG-1，docs/architecture/governance.md §5）：
 *   npm run arch -- <命令> [参数] [--project <项目>] [--json]
 *
 *   projects                      项目与源码状态
 *   overview                      规模、证实、违规、环度与基线
 *   locate <文件或模块>           归属、各级职责、生效的规则、接口（Q1）
 *   check <from> <to> [--names a,b]  写前判定：to 为模块、文件或从 from 出发的导入说明符（Q2）
 *   violations [--new]            违规与基线状态
 *   cycles                        模块环、文件环与环度
 *   rescan                        重新扫描，与基线、上一次扫描比较（Q3）
 *   issues [--category <类别>]    返工清单：按根因聚合的问题、文件行号、规则编号与建议动作（Q7–Q9），默认 Markdown
 *   hotspots [--fixes] [--limit N] 热度前 N 的模块（J8；--fixes 为缺陷热度，缺省修改热度）
 *   coupling [--isolated]         时间耦合的模块对（J4）；--isolated 只列无依赖无关系的对（J6）
 *   impact <模块> [--direction in|out] [--values-only]
 *                                 影响面（K15、Q14）：传入闭包（改它牵动谁）与传出闭包（它要谁才能工作），按距离分组，附 Ca / Ce / I
 *   metrics [<模块> | --level <父模块>] [--top N] [--values-only]
 *                                 扇入 Ca、扇出 Ce 与不稳定度 I（K16、Q14）：给模块为明细，--level 为该层的子模块，缺省全系统的叶子模块；--top 按 Ca 取前 N
 *   report                        拦截报告（Q4）
 *   baseline                      生成基线 governance/baseline.json（U7，由人执行并提交）
 *   own                           登记人拥有文件的指纹 governance/owned.json（X6，人改完草图 / 规则 / 忽略清单后执行）
 *   sketch-check [--design <设计>] [--revision <轮次>]   草图核验（X4、X17）：缺省为活动草图对当前版本；给了设计时逐张报告，
 *                                 并附两个对比（相对基线、相对当前版本 / 该轮），按血缘表述
 *   sketch list <设计>            设计的各张草图（挂载点、文件、是否需要初始布局）
 *   sketch archive <设计>         归档 / 晋升（X3）：对当前版本逐张核验一致才执行；晋升连 layout 一并替换持久草图
 *   classify [--design <设计> [--revision <轮次|sketch>] | --all-designs] [--core-only] [--override <文件>] [--write]
 *                                 未分类（calls）关系的查询 / 委托建议（ADR-0029 §5）：关系、两端、建议类型、置信度与依据；
 *                                 --override 为人工核对后的覆盖（关系 ID → 类型）；--write 把类型写回描述文件、说明改为交互口吻（只改 type 与 description 两个值；草图只改 type）
 *
 * check 与 rescan 写拦截记录。出错时退出码为 2；check 为 denied 时退出码为 1。
 */
import fs from 'node:fs'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import { fileURLToPath } from 'node:url'
import { CHANGE_KINDS, CHANGE_KIND_LABELS, REWORK_CATEGORIES, RULE_LABELS, type CheckResult, type ReworkCategory, type SketchCheck } from '../src/model'
import type { DesignComparison } from './agent/service'
import { ServiceError, createService } from './agent/service'
import { printClassify, runClassify } from './agent/classify'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2).filter(a => a !== '--')
const flags = new Map<string, string | true>()
const args: string[] = []
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (!a.startsWith('--')) args.push(a)
  else if (['--project', '--names', '--category', '--limit', '--design', '--revision', '--override', '--direction', '--level', '--top'].includes(a))
    flags.set(a.slice(2), argv[++i] ?? '')
  else flags.set(a.slice(2), true)
}
const [cmd, ...rest] = args
const project = typeof flags.get('project') === 'string' ? (flags.get('project') as string) : undefined
const asJson = flags.has('json')
const svc = createService({ root, client: 'cli' })

const VERDICT: Record<string, string> = { allowed: '允许', denied: '拒绝', unconstrained: '无约束' }
const SEV: Record<string, string> = { error: '错误', warning: '提醒', info: '已认可' }
const str = (k: string) => (typeof flags.get(k) === 'string' ? (flags.get(k) as string) : undefined)

function printChecks(r: { target: string; checks: SketchCheck[]; compare?: { baseline?: DesignComparison; current: DesignComparison; base?: string } }) {
  console.log(`核验对象：${r.target}`)
  if (!r.checks.length) console.log('  没有活动草图')
  for (const c of r.checks) {
    const who = c.design ? `设计「${c.design}」挂在「${c.mount ?? '?'}」上的草图` : `持久草图「${c.sketch}」（挂在「${c.mount ?? '?'}」）`
    console.log(
      `\n${who}（${c.lifetime}${c.supersedes ? `，替换 ${c.supersedes}` : ''}）：${c.consistent ? '一致' : `偏差 ${c.counts.error + c.counts.warning}`}（错误 ${c.counts.error} · 提醒 ${c.counts.warning} · 已认可 ${c.counts.info}）`,
    )
    for (const d of c.deviations) console.log(`  ${SEV[d.severity]}  ${d.key}  ${d.message}${d.accepted ? `（已认可：${d.accepted.reason}）` : ''}`)
  }
  const show = (title: string, cmp: DesignComparison | undefined) => {
    if (!cmp) return
    const counts = CHANGE_KINDS.filter(k => cmp.counts[k]).map(k => `${CHANGE_KIND_LABELS[k]} ${cmp.counts[k]}`)
    console.log(`\n${title}（全设计）：${counts.length ? counts.join(' · ') : '没有变化'}${cmp.pending ? ` · 待重连 ${cmp.pending}` : ''}`)
    for (const s of cmp.sketches) {
      if (!s.changes.length && !s.pending.length) continue
      console.log(`  挂在「${s.mount}」上（本张）：`)
      for (const x of s.changes) console.log(`    ${x.message}`)
      for (const id of s.pending) console.log(`    待重连：关系「${id}」`)
    }
  }
  show(`相对基线${r.compare?.base ? ` ${r.compare.base.slice(0, 7)}` : ''}`, r.compare?.baseline)
  show(`相对${r.target}`, r.compare?.current)
}

function printCheck(r: CheckResult & { external?: string }) {
  console.log(`判定：${VERDICT[r.verdict]}（${r.verdict}）`)
  for (const n of r.notes) console.log(`  · ${n}`)
  for (const c of r.checks) {
    console.log(`\n  ${c.from} → ${c.to}${c.via && c.via !== c.to ? `（经由 ${c.via}）` : ''}：${VERDICT[c.verdict]}`)
    for (const h of c.hits)
      console.log(`    ${h.allowed ? '已豁免' : '违反'} ${RULE_LABELS[h.kind]}：${h.reason}${h.allowed ? `（例外理由：${h.allowed}）` : ''}`)
    if (c.cycle.createsOrGrows) console.log(`    会${c.cycle.before ? `把模块环从 ${c.cycle.before} 个扩大到` : '形成'} ${c.cycle.after} 个模块的环`)
    console.log(c.describedBy.length ? `    已有关系覆盖：${c.describedBy.join('、')}` : '    描述中没有覆盖它的关系：如确需新增依赖，请补关系')
  }
  for (const t of r.targets) {
    console.log(`\n  目标「${t.name}」（${t.id}）：${t.responsibility ?? '（无职责说明）'}`)
    if (t.entry) console.log(`    入口：${t.entry}`)
    for (const e of t.rules.exposes) console.log(`    访问面（${e.module}）：${e.exposes.map(x => (x === 'entry' ? `入口 ${e.entry ?? '无'}` : x)).join('、')}`)
    if (t.interfaces.length) console.log(`    接口：${t.interfaces.map(i => i.name).join('、')}`)
  }
}

const I_BAND: Record<string, string> = { stable: '稳定', balanced: '居中', unstable: '易变' }
type MetricsRow = { id: string; name: string; ca: number; ce: number; instability: number | null; band: string | null }
const metricsText = (m: MetricsRow) => `Ca ${m.ca} · Ce ${m.ce} · I ${m.instability ?? '—'}${m.band ? `（${I_BAND[m.band]}）` : ''}`

function printImpact(r: ReturnType<typeof svc.impact>) {
  console.log(`影响面：${r.name}（${r.module}）${r.valuesOnly ? '，只看值依赖' : ''}${r.inCycle ? '，在模块环中' : ''}`)
  console.log(`  ${metricsText(r.metrics)}`)
  const side = (title: string, s: NonNullable<typeof r.incoming>) => {
    console.log(`\n${title}：${s.modules} 个模块 · ${s.files} 个文件`)
    for (const g of s.byDistance) console.log(`  距离 ${g.distance}（${g.modules.length}）：${g.modules.map(m => `${m.id}${m.inCycle ? '⟳' : ''}`).join('、')}`)
  }
  if (r.incoming) side('传入（改它会牵动）', r.incoming)
  if (r.outgoing) side('传出（它要这些才能工作）', r.outgoing)
}

function printMetrics(r: ReturnType<typeof svc.metrics>) {
  if (r.kind === 'module') {
    console.log(`${r.module.name}（${r.module.id}）：${metricsText(r.module)}${r.valuesOnly ? '（只看值依赖）' : ''}`)
    console.log(`  依赖它最多的：${r.topDependents.map(x => `${x.id} ×${x.files}`).join('、') || '无'}`)
    console.log(`  它依赖最多的：${r.topDependencies.map(x => `${x.id} ×${x.files}`).join('、') || '无'}`)
    return
  }
  console.log(`${r.scope}：${r.modules.length} / ${r.total}${r.valuesOnly ? '（只看值依赖）' : ''}`)
  for (const m of r.modules) console.log(`  ${m.id}（${m.name}）  ${metricsText(m)}`)
}

function run(): number {
  switch (cmd) {
    case 'projects':
      return out(svc.projects())
    case 'overview':
      return out(svc.overview(project))
    case 'locate':
      need(1, '<文件或模块>')
      return out(svc.locate(rest[0], project))
    case 'check': {
      need(2, '<from> <to>')
      const names = typeof flags.get('names') === 'string' ? (flags.get('names') as string).split(',').filter(Boolean) : []
      const r = svc.check(rest[0], rest[1], project, names)
      if (asJson) console.log(JSON.stringify(r, null, 2))
      else printCheck(r)
      return r.verdict === 'denied' ? 1 : 0
    }
    case 'violations':
      return out(svc.violations(project, flags.has('new')))
    case 'cycles':
      return out(svc.cycles(project))
    case 'rescan':
      return out(svc.rescan(project))
    case 'issues': {
      const c = flags.get('category')
      if (c !== undefined && !(REWORK_CATEGORIES as readonly unknown[]).includes(c)) throw new ServiceError(`类别只能是 ${REWORK_CATEGORIES.join(' / ')}`)
      const r = svc.issues(project, c as ReworkCategory | undefined)
      console.log(asJson ? JSON.stringify(r.list, null, 2) : r.markdown)
      return 0
    }
    case 'hotspots': {
      const limit = typeof flags.get('limit') === 'string' ? Number(flags.get('limit')) : 10
      return out(svc.hotspots(project, flags.has('fixes') ? 'fixes' : 'changes', Number.isFinite(limit) && limit > 0 ? limit : 10))
    }
    case 'coupling':
      return out(svc.coupling(project, flags.has('isolated')))
    case 'impact': {
      need(1, '<模块> [--direction in|out] [--values-only]')
      const d = str('direction')
      if (d !== undefined && d !== 'in' && d !== 'out') throw new ServiceError('--direction 只能是 in / out')
      const r = svc.impact(rest[0], project, { direction: d, valuesOnly: flags.has('values-only') })
      if (asJson) console.log(JSON.stringify(r, null, 2))
      else printImpact(r)
      return 0
    }
    case 'metrics': {
      const top = str('top') !== undefined ? Number(str('top')) : undefined
      if (top !== undefined && !(Number.isInteger(top) && top > 0)) throw new ServiceError('--top 须为正整数')
      const r = svc.metrics(project, { module: rest[0], level: str('level'), top, valuesOnly: flags.has('values-only') })
      if (asJson) console.log(JSON.stringify(r, null, 2))
      else printMetrics(r)
      return 0
    }
    case 'report':
      return out(svc.report(project))
    case 'sketch-check': {
      const r = svc.sketchCheck(project, str('design'), str('revision'))
      if (asJson) console.log(JSON.stringify(r, null, 2))
      else printChecks(r)
      return r.checks.some(c => c.counts.error) ? 1 : 0
    }
    case 'sketch': {
      if (rest[0] === 'list' && rest[1]) return out(svc.designSketches(project, rest[1]))
      if (rest[0] !== 'archive' || !rest[1]) throw new ServiceError('用法：npm run arch -- sketch archive <设计> | sketch list <设计>')
      const r = svc.sketchArchive(project, rest[1])
      if (asJson) console.log(JSON.stringify(r, null, 2))
      else {
        console.log(
          r.outcome === 'promote'
            ? `已晋升：草图（连 layout）替换了 ${(r.promotedAll ?? [r.promoted]).join('、')}；设计「${rest[1]}」状态改为 implemented（${r.file}）`
            : `已归档：设计「${rest[1]}」状态改为 implemented（${r.file}）`,
        )
        if (r.reviewed) console.log(`确认记录 ${r.reviewed.count} 条已写入 ${r.reviewed.file}（来源 sketch:${rest[1]}）`)
      }
      return 0
    }
    case 'classify': {
      if (!project)
        throw new ServiceError('用法：npm run arch -- classify --project <项目> [--design <设计> [--revision <轮次>] | --all-designs] [--core-only] [--write]')
      const r = runClassify({
        root,
        project,
        design: str('design'),
        revision: str('revision'),
        allDesigns: flags.has('all-designs'),
        write: flags.has('write'),
        coreOnly: flags.has('core-only'),
        overrides: readOverrides(str('override')),
      })
      if (asJson) console.log(JSON.stringify(r, null, 2))
      else printClassify(r)
      return 0
    }
    case 'own': {
      const r = svc.own(project)
      console.log(`已写入 ${r.file}：${r.files.length} 个人拥有的文件（${r.files.join('、')}）`)
      console.log('此后 lint:model 对这些文件的改动报错 owned.changed；人改完再运行一次本命令。')
      return 0
    }
    case 'baseline': {
      const b = svc.baseline(project)
      console.log(
        `已写入 ${b.file}：${b.violations} 条违规，环度 模块 ${b.cyclicity.modules} / 文件 ${b.cyclicity.files}${b.commit ? `，源码提交 ${b.commit.slice(0, 8)}` : ''}`,
      )
      console.log('请评审后提交这个文件；此后 lint:model 只允许违规与环度不增加。')
      return 0
    }
    default:
      console.error(
        '用法：npm run arch -- <projects|overview|locate|check|violations|cycles|rescan|issues|hotspots|coupling|impact|metrics|report|baseline|own|sketch-check|sketch|classify> [参数] [--project <项目>] [--json]',
      )
      return 2
  }
}

/** classify --override <文件>：YAML 映射「关系 ID: queries | commands」或「关系 ID: { type, why }」 */
function readOverrides(file: string | undefined) {
  if (!file) return undefined
  const raw = (parseYaml(fs.readFileSync(path.resolve(process.cwd(), file), 'utf8')) ?? {}) as Record<string, string | { type: string; why?: string }>
  const out = new Map<string, { type: 'queries' | 'commands'; why?: string }>()
  for (const [id, v] of Object.entries(raw)) {
    const o = typeof v === 'string' ? { type: v } : v
    if (o.type !== 'queries' && o.type !== 'commands') throw new ServiceError(`覆盖文件里「${id}」的类型只能是 queries / commands`)
    out.set(id, { type: o.type, ...(o.why ? { why: o.why } : {}) })
  }
  return out
}

function need(n: number, usage: string) {
  if (rest.length < n) throw new ServiceError(`用法：npm run arch -- ${cmd} ${usage}`)
}

function out(value: unknown): number {
  console.log(JSON.stringify(value, null, 2))
  return 0
}

// 用 exitCode 而不是 exit()：输出接管道时 exit() 会截断还没写完的 stdout
try {
  process.exitCode = run()
} catch (e) {
  console.error(e instanceof ServiceError ? e.message : e)
  process.exitCode = 2
}
