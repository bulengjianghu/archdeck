/**
 * 读取架构描述（Node 侧，供 Vite 插件与命令行校验共用）。
 *
 * 目录约定：模型根目录（默认 model/）下每个子目录是一个项目，子目录里有 system.yaml 才算项目。
 *   model/h5player/      → 项目 h5player
 *   model/h5p-arch-desk/ → 项目 h5p-arch-desk
 * 项目目录下的 designs/<设计 ID>/ 是设计版本（ADR-0002）：design.yaml 为人拥有的元信息，r1/、r2/… 为每轮完整快照，
 * 轮次从目录发现、每轮说明在 r<N>/revision.yaml（E8，ADR-0024）；读取当前版本时跳过 designs/。
 */
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import {
  DESIGN_STATUSES,
  REVISION_FILE,
  SKETCH_REVISION,
  checkSketches,
  diffModels,
  isArchived,
  isSketchFile,
  loadModel,
  parseDesignSketches,
  revisionNumber,
  versionLabel,
} from '../src/model'
import type {
  AcceptedDeviation,
  DesignInfo,
  DesignStatus,
  ModelCommit,
  ModelIndex,
  ProjectHealth,
  ProjectSummary,
  RawFile,
  RevisionInfo,
  VersionRef,
} from '../src/model'

export type { ProjectSummary }

export const DESIGNS_DIR = 'designs'
/** 设计的草图（X1、DV-10） */
export const SKETCH_FILE = 'sketch.yaml'
/** 基线与拦截记录（ADR-0015），不属于描述 */
export const GOVERNANCE_DIR = 'governance'

/** 一份可对比的描述：当前版本，或设计的某一轮 */
export interface CompareSource {
  label: string
  dir: string
  files: RawFile[]
}

export interface ModelPayload {
  /** 项目 ID（即子目录名） */
  project: string
  /** 模型目录，相对项目根，仅用于显示 */
  dir: string
  files: RawFile[]
  /** 本项目的全部设计版本，供版本切换 */
  designs?: DesignInfo[]
  /** 改动过本项目描述的最近提交，供版本切换（E5，开发服务器附上） */
  commits?: ModelCommit[]
  /** 打开的是设计版本时给出 */
  version?: VersionRef
  /** 设计版本的对比基线：当前版本，以及上一轮（若有） */
  compare?: { current: CompareSource; previous?: CompareSource }
  /** X4：对本版本有约束力的设计草图——当前版本：已定稿、未归档的设计的；设计某一轮：本设计的 */
  sketches?: { design: string; file: RawFile }[]
  /** DV-10：草图版本的「交给 AI」指令 */
  sketchPrompt?: string
  /** X7i：草图版本（设计的草图、持久草图）的草图文件（相对项目描述目录）与读取时的指纹，编辑保存时带回比对 */
  sketch?: { file: string; hash: string }
}

/** X7i：草图文件的指纹——与 owned.json 同一算法（SHA-1）；不引治理存储，避免读取 ↔ 治理存储成环 */
export const sketchHash = (text: string): string => createHash('sha1').update(text).digest('hex')

export function isModelFile(file: string): boolean {
  return /\.(ya?ml|json)$/i.test(file)
}

export function readModelDir(dir: string, projectRoot: string): Pick<ModelPayload, 'dir' | 'files'> {
  const files: RawFile[] = []
  const walk = (cur: string) => {
    if (!fs.existsSync(cur)) return
    for (const ent of fs.readdirSync(cur, { withFileTypes: true })) {
      const full = path.join(cur, ent.name)
      // 设计版本不属于当前版本；governance/ 不属于描述；一轮的说明 revision.yaml 不属于描述（E8）
      if (ent.isDirectory() && cur === dir && (ent.name === DESIGNS_DIR || ent.name === GOVERNANCE_DIR)) continue
      if (!ent.isDirectory() && cur === dir && ent.name === REVISION_FILE) continue
      if (ent.isDirectory()) walk(full)
      else if (isModelFile(ent.name)) files.push({ path: path.relative(dir, full).split(path.sep).join('/'), text: fs.readFileSync(full, 'utf8') })
    }
  }
  walk(dir)
  files.sort((a, b) => a.path.localeCompare(b.path))
  return { dir: path.relative(projectRoot, dir) || '.', files }
}

/** 模型根目录：ARCH_MODEL_ROOT 优先，缺省为项目内 model/（ADR-0001） */
export function resolveModelRoot(projectRoot: string, env: NodeJS.ProcessEnv = process.env): string {
  return path.resolve(projectRoot, env.ARCH_MODEL_ROOT ?? 'model')
}

/** 项目 ID 只允许目录名安全字符，防止路径穿越 */
export function isProjectId(id: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)
}

/** 列出模型根目录下的项目 ID（有 system.yaml 的子目录），按名称排序 */
export function listProjectIds(modelRoot: string): string[] {
  if (!fs.existsSync(modelRoot)) return []
  return fs
    .readdirSync(modelRoot, { withFileTypes: true })
    .filter(e => e.isDirectory() && isProjectId(e.name) && fs.existsSync(path.join(modelRoot, e.name, 'system.yaml')))
    .map(e => e.name)
    .sort()
}

export function readProject(modelRoot: string, id: string, projectRoot: string): ModelPayload | null {
  if (!isProjectId(id) || !listProjectIds(modelRoot).includes(id)) return null
  const dir = path.join(modelRoot, id)
  const designs = listDesigns(dir)
  // X3、X4：已定稿、未归档的设计的草图约束当前版本
  const sketches = designs.filter(d => d.sketch && d.status === 'accepted').flatMap(d => designSketch(dir, d.id) ?? [])
  return { project: id, ...readModelDir(dir, projectRoot), designs, ...(sketches.length ? { sketches } : {}) }
}

/** 设计的草图文件（没有时为 null） */
export function designSketch(projectDir: string, design: string): { design: string; file: RawFile } | null {
  const file = path.join(projectDir, DESIGNS_DIR, design, SKETCH_FILE)
  if (!isProjectId(design) || !fs.existsSync(file)) return null
  return { design, file: { path: `${DESIGNS_DIR}/${design}/${SKETCH_FILE}`, text: fs.readFileSync(file, 'utf8') } }
}

// ── 设计版本 ──

/** 列出项目的设计版本（有 design.yaml 的 designs/<ID>/），按 ID 排序 */
export function listDesigns(projectDir: string): DesignInfo[] {
  const root = path.join(projectDir, DESIGNS_DIR)
  if (!fs.existsSync(root)) return []
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter(e => e.isDirectory() && isProjectId(e.name) && fs.existsSync(path.join(root, e.name, 'design.yaml')))
    .map(e => readDesignInfo(path.join(root, e.name), e.name))
    .sort((a, b) => a.id.localeCompare(b.id))
}

/** 读 design.yaml；格式问题记入 problems，不抛错 */
export function readDesignInfo(designDir: string, id: string): DesignInfo {
  const problems: string[] = []
  let raw: Record<string, unknown> = {}
  try {
    const doc = parseYaml(fs.readFileSync(path.join(designDir, 'design.yaml'), 'utf8')) as { design?: unknown } | null
    if (doc?.design && typeof doc.design === 'object') raw = doc.design as Record<string, unknown>
    else problems.push('design.yaml 缺少顶层键 design')
  } catch (e) {
    problems.push(`design.yaml 解析失败：${e instanceof Error ? e.message.split('\n')[0] : String(e)}`)
  }
  const str = (v: unknown) => (typeof v === 'string' ? v : undefined)
  if (raw.id !== undefined && raw.id !== id) problems.push(`design.id「${String(raw.id)}」与目录名「${id}」不一致，以目录名为准`)
  let status = raw.status as DesignStatus
  if (!DESIGN_STATUSES.includes(status)) {
    if (raw.status !== undefined) problems.push(`status 取值必须是 ${DESIGN_STATUSES.join(' / ')} 之一`)
    status = 'draft'
  }
  // E8：轮次从目录发现（按 N 的数字排序），说明读该轮的 revision.yaml；design.yaml 的 revisions[] 只按 id 对上 feedback（旧设计的说明照常合并）
  const listed = new Map<string, Record<string, unknown>>()
  for (const r of Array.isArray(raw.revisions) ? (raw.revisions as Record<string, unknown>[]) : []) {
    const rid = str(r?.id)
    if (!rid || !isProjectId(rid)) problems.push(`revisions 中有轮次缺少合法的 id`)
    else listed.set(rid, r)
  }
  const dirs = listRevisionDirs(designDir)
  for (const rid of listed.keys()) if (!dirs.includes(rid)) problems.push(`轮次 ${rid} 缺少快照目录 ${rid}/system.yaml，已忽略`)
  const date = (v: unknown) => str(v) ?? (v instanceof Date ? v.toISOString().slice(0, 10) : undefined)
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((q): q is string => typeof q === 'string') : undefined)
  const revisions: RevisionInfo[] = dirs.map(rid => {
    const r = listed.get(rid) ?? {}
    const note = readRevisionNote(designDir, rid)
    problems.push(...note.problems)
    const both = (['date', 'summary', 'questions'] as const).filter(k => r[k] !== undefined && note[k] !== undefined)
    if (both.length)
      problems.push(
        `轮次 ${rid} 的 ${both.join('、')} 在 design.yaml 与 ${rid}/${REVISION_FILE} 两处都写了，以 ${REVISION_FILE} 为准；design.yaml 只留 feedback（E8）`,
      )
    return {
      id: rid,
      date: note.date ?? date(r.date),
      summary: note.summary ?? str(r.summary),
      questions: note.questions ?? strings(r.questions),
      feedback: str(r.feedback),
    }
  })
  const base = raw.base && typeof raw.base === 'object' ? (raw.base as DesignInfo['base']) : undefined
  // DV-9：adr 为一个或多个路径
  const adrRaw = typeof raw.adr === 'string' ? [raw.adr] : Array.isArray(raw.adr) ? raw.adr : []
  const adr = adrRaw.filter((a): a is string => typeof a === 'string' && !!a.trim())
  if (raw.adr !== undefined && (!adr.length || adr.length !== adrRaw.length)) problems.push('adr 必须是路径字符串或路径列表')
  // X4：认可的偏差
  const accepted: AcceptedDeviation[] = []
  for (const a of Array.isArray(raw.accepted) ? (raw.accepted as Record<string, unknown>[]) : []) {
    const deviation = str(a?.deviation)
    const reason = str(a?.reason)
    if (deviation && reason) accepted.push({ deviation, reason, at: str(a.at) ?? (a.at instanceof Date ? a.at.toISOString().slice(0, 10) : undefined) })
    else problems.push('accepted 中有条目缺少 deviation 或 reason')
  }
  const sketch = fs.existsSync(path.join(designDir, SKETCH_FILE))
  return {
    id,
    name: str(raw.name) ?? id,
    status,
    goal: str(raw.goal),
    base,
    ...(adr.length ? { adr } : {}),
    revisions,
    ...(sketch ? { sketch } : {}),
    ...(accepted.length ? { accepted } : {}),
    problems,
  }
}

/** E8：设计目录下的轮次——含 system.yaml 的 r<N>/，按 N 的数字排序（r10 在 r9 之后） */
export function listRevisionDirs(designDir: string): string[] {
  if (!fs.existsSync(designDir)) return []
  return fs
    .readdirSync(designDir, { withFileTypes: true })
    .filter(e => e.isDirectory() && revisionNumber(e.name) !== null && fs.existsSync(path.join(designDir, e.name, 'system.yaml')))
    .map(e => e.name)
    .sort((a, b) => revisionNumber(a)! - revisionNumber(b)!)
}

/** E8：一轮的说明 r<N>/revision.yaml（AI 拥有，顶层键 revision：date、summary、questions）；没有文件时为空 */
export function readRevisionNote(designDir: string, revision: string): { date?: string; summary?: string; questions?: string[]; problems: string[] } {
  const file = path.join(designDir, revision, REVISION_FILE)
  if (!fs.existsSync(file)) return { problems: [] }
  try {
    const doc = parseYaml(fs.readFileSync(file, 'utf8')) as { revision?: Record<string, unknown> } | null
    const r = doc?.revision
    if (!r || typeof r !== 'object') return { problems: [`${revision}/${REVISION_FILE} 缺少顶层键 revision`] }
    const extra = Object.keys(r).filter(k => !['date', 'summary', 'questions'].includes(k))
    return {
      ...(typeof r.date === 'string' ? { date: r.date } : r.date instanceof Date ? { date: r.date.toISOString().slice(0, 10) } : {}),
      ...(typeof r.summary === 'string' ? { summary: r.summary } : {}),
      ...(Array.isArray(r.questions) ? { questions: r.questions.filter((q): q is string => typeof q === 'string') } : {}),
      problems: extra.length ? [`${revision}/${REVISION_FILE} 不认识的字段：${extra.join('、')}`] : [],
    }
  } catch (e) {
    return { problems: [`${revision}/${REVISION_FILE} 解析失败：${e instanceof Error ? e.message.split('\n')[0] : String(e)}`] }
  }
}

/** 读设计版本的某一轮，附带对比基线（当前版本与上一轮）与本设计的草图；轮次为 sketch 时读草图版本（DV-10）；不存在返回 null */
export function readDesignRevision(
  modelRoot: string,
  project: string,
  design: string,
  revision: string,
  projectRoot: string,
  opts: SketchVersionOptions = {},
): ModelPayload | null {
  if (revision === SKETCH_REVISION) return readSketchVersion(modelRoot, project, design, projectRoot, projectRoot, opts)
  const current = readProject(modelRoot, project, projectRoot)
  if (!current || !isProjectId(design) || !isProjectId(revision)) return null
  const info = current.designs?.find(d => d.id === design)
  const at = info?.revisions.findIndex(r => r.id === revision) ?? -1
  if (!info || at < 0) return null
  const designDir = path.join(modelRoot, project, DESIGNS_DIR, design)
  const prev = info.revisions[at - 1]
  const sketch = designSketch(path.join(modelRoot, project), design)
  return {
    project,
    ...readModelDir(path.join(designDir, revision), projectRoot),
    designs: current.designs,
    version: { design, revision },
    compare: {
      current: { label: '当前版本', dir: current.dir, files: current.files },
      ...(prev ? { previous: { label: versionLabel(info, prev.id), ...readModelDir(path.join(designDir, prev.id), projectRoot) } } : {}),
    },
    ...(sketch ? { sketches: [sketch] } : {}),
  }
}

/**
 * DV-10：草图作为版本——文件 = 当前版本的 system.yaml + 持久草图（intent/）+ 该设计的 sketch.yaml，对比基线为当前版本；
 * 附「交给 AI」的指令（草图全文 + 04 §5「按草图扩展」，docsRoot 缺省为本包根目录）。没有草图时返回 null。
 */
export interface SketchVersionOptions {
  /** L-2：草图文件在上一次提交时的内容（相对项目描述目录的路径 → 文本；没有提交过为 null），「交给 AI」据此附改动摘要；开发服务器经 git 读取 */
  committed?: (projectDir: string, rel: string) => string | null
}

export function readSketchVersion(
  modelRoot: string,
  project: string,
  design: string,
  projectRoot: string,
  docsRoot = projectRoot,
  opts: SketchVersionOptions = {},
): ModelPayload | null {
  const current = readProject(modelRoot, project, projectRoot)
  const projectDir = path.join(modelRoot, project)
  const sketch = current && designSketch(projectDir, design)
  if (!current || !sketch) return null
  const designDir = path.join(projectDir, DESIGNS_DIR, design)
  const base = current.files.filter(f => f.path === 'system.yaml' || isSketchFile(f.path))
  const changes = opts.committed ? sketchChanges(base, SKETCH_FILE, opts.committed(projectDir, sketch.file.path), sketch.file.text) : ''
  return {
    project,
    dir: path.relative(projectRoot, designDir) || '.',
    files: [...base, { ...sketch.file, path: SKETCH_FILE }],
    designs: current.designs,
    version: { design, revision: SKETCH_REVISION },
    compare: { current: { label: '当前版本', dir: current.dir, files: current.files } },
    sketchPrompt: sketchPrompt(design, sketch.file.text, docsRoot, changes),
    sketch: { file: sketch.file.path, hash: sketchHash(sketch.file.text) },
  }
}

/** 持久草图版本（ADR-0024）：system.yaml + intent/**，对比基线为当前版本；附该草图文件的指纹（编辑骨架用） */
export function readIntentVersion(modelRoot: string, project: string, sketchId: string, projectRoot: string): ModelPayload | null {
  const current = readProject(modelRoot, project, projectRoot)
  const rel = `intent/${sketchId}.yaml`
  const file = current?.files.find(f => f.path === rel)
  if (!current || !isProjectId(sketchId) || !file) return null
  return {
    project,
    dir: current.dir,
    files: current.files.filter(f => f.path === 'system.yaml' || isSketchFile(f.path)),
    designs: current.designs,
    version: { intent: sketchId },
    compare: { current: { label: '当前版本', dir: current.dir, files: current.files } },
    sketch: { file: rel, hash: sketchHash(file.text) },
  }
}

/** L-2：草图相对上一次提交的改动摘要（新增 / 修改 / 删除了哪些实体）；没有改动时为空串 */
export function sketchChanges(base: readonly RawFile[], path: string, before: string | null, after: string): string {
  const empty = 'sketch: { id: base, modules: [] }\n'
  const at = (text: string) => loadModel([...base, { path, text }]).index
  const diff = diffModels(at(before ?? empty), at(after))
  if (!diff.changes.length) return ''
  const KIND = { added: '新增', changed: '修改', removed: '删除' } as const
  const ENTITY: Record<string, string> = { module: '模块', relation: '关系', interface: '接口', dataStructure: '数据结构' }
  return diff.changes
    .map(
      c =>
        `- ${KIND[c.kind]}${ENTITY[c.entity] ?? c.entity}「${c.id}」${c.name && c.name !== c.id ? `（${c.name}）` : ''}${c.fields?.length ? `：${c.fields.join('、')}` : ''}`,
    )
    .join('\n')
}

/** DV-10：「交给 AI」的指令——草图全文 + 04 §5「按草图扩展」一节（从本包 docs 截取；读不到时只给草图） */
export function sketchPrompt(design: string, sketchText: string, docsRoot: string, changes = ''): string {
  let section = ''
  try {
    const doc = fs.readFileSync(path.join(docsRoot, 'docs', '04-description-format.md'), 'utf8')
    const m = /^### 按草图扩展\n([\s\S]*?)(?=^#{1,3} |(?![\s\S]))/m.exec(doc)
    section = m ? m[1].trim() : ''
  } catch {
    section = ''
  }
  return [
    `# 按草图扩展：设计「${design}」`,
    '',
    `请在当前版本上起草设计 \`${design}\` 的下一轮（没有轮次时为 r1）：把当前版本整份复制为新一轮，按下面的草图扩展，草图是约束、不是建议。`,
    '',
    `## 草图（designs/${design}/sketch.yaml）`,
    '',
    '```yaml',
    sketchText.trimEnd(),
    '```',
    '',
    ...(changes ? ['## 本次改动（草图相对上一次提交）', '', changes, ''] : []),
    '## 规范（docs/04-description-format.md §5「按草图扩展」）',
    '',
    section || '（读不到 docs/04-description-format.md，请按 04 §5「按草图扩展」一节执行）',
    '',
  ].join('\n')
}

/** X4：有草图的设计的偏差计数——未归档的对最新一轮核验（已定稿的对当前版本），卡片标「偏差 N」 */
function designDeviations(modelRoot: string, project: string, current: ModelIndex, d: DesignInfo, projectRoot: string): DesignInfo['deviations'] | undefined {
  const dir = path.join(modelRoot, project)
  const sketch = d.sketch && !isArchived(d.status) ? designSketch(dir, d.id) : null
  if (!sketch) return undefined
  const last = d.revisions[d.revisions.length - 1]
  const target = d.status === 'accepted' || !last ? current : loadModel(readModelDir(path.join(dir, DESIGNS_DIR, d.id, last.id), projectRoot).files).index
  const check = checkSketches(target, parseDesignSketches([sketch]), new Map([[d.id, d.accepted ?? []]])).find(c => c.design === d.id)
  return check ? { errors: check.counts.error, warnings: check.counts.warning } : undefined
}

/** 项目列表页用的摘要：直接跑一遍模型层，统计规模与问题数；健康度（Q10）由调用方另算后附上；有草图的设计附偏差计数（X4） */
export function summarizeProject(payload: ModelPayload, health?: ProjectHealth, ctx?: { modelRoot: string; projectRoot: string }): ProjectSummary {
  const { index, issues } = loadModel(payload.files)
  const sys = index.model.system
  const top = (index.childrenOf.get(index.rootId) ?? []).map(id => index.modules.get(id)!)
  return {
    id: payload.project,
    name: sys.name,
    description: sys.description,
    source: sys.source,
    dir: payload.dir,
    layered: top.length > 0 && top.every(m => m.kind === 'layer'),
    top: top.map(m => ({ id: m.id, name: m.name, abstraction: m.abstraction })),
    counts: {
      modules: index.modules.size,
      relations: index.relations.size,
      interfaces: index.interfaces.size,
      dataStructures: index.dataStructures.size,
      actors: index.actors.size,
      scenarios: index.scenarios.size,
    },
    errors: issues.filter(i => i.severity === 'error').length,
    warnings: issues.filter(i => i.severity === 'warning').length,
    ...(health ? { health } : {}),
    designs: (payload.designs ?? []).map(d => {
      const deviations = ctx ? designDeviations(ctx.modelRoot, payload.project, index, d, ctx.projectRoot) : undefined
      return deviations ? { ...d, deviations } : d
    }),
  }
}

/** health：按项目算健康度（开发服务器传 readHealth；读源码与代码事实不属于描述读取） */
export function listProjects(modelRoot: string, projectRoot: string, health?: (payload: ModelPayload) => ProjectHealth): ProjectSummary[] {
  return listProjectIds(modelRoot).map(id => {
    const payload = readProject(modelRoot, id, projectRoot)!
    return summarizeProject(payload, health?.(payload), { modelRoot, projectRoot })
  })
}
