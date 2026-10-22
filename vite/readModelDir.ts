/**
 * 读取架构描述（Node 侧，供 Vite 插件与命令行校验共用）。
 *
 * 目录约定：模型根目录（默认 model/）下每个子目录是一个项目，子目录里有 system.yaml 才算项目。
 *   model/h5player/      → 项目 h5player
 *   model/h5p-arch-desk/ → 项目 h5p-arch-desk
 * 项目目录下的 designs/<设计 ID>/ 是设计版本（ADR-0002）：design.yaml 为元信息，r1/、r2/… 为每轮完整快照；
 * 读取当前版本时跳过 designs/。
 */
import fs from 'node:fs'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import { DESIGN_STATUSES, loadModel, versionLabel } from '../src/model'
import type { DesignInfo, DesignStatus, ProjectHealth, ProjectSummary, RawFile, RevisionInfo, VersionRef } from '../src/model'

export type { ProjectSummary }

export const DESIGNS_DIR = 'designs'
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
  /** 打开的是设计版本时给出 */
  version?: VersionRef
  /** 设计版本的对比基线：当前版本，以及上一轮（若有） */
  compare?: { current: CompareSource; previous?: CompareSource }
}

export function isModelFile(file: string): boolean {
  return /\.(ya?ml|json)$/i.test(file)
}

export function readModelDir(dir: string, projectRoot: string): Pick<ModelPayload, 'dir' | 'files'> {
  const files: RawFile[] = []
  const walk = (cur: string) => {
    if (!fs.existsSync(cur)) return
    for (const ent of fs.readdirSync(cur, { withFileTypes: true })) {
      const full = path.join(cur, ent.name)
      // 设计版本不属于当前版本；governance/ 不属于描述
      if (ent.isDirectory() && cur === dir && (ent.name === DESIGNS_DIR || ent.name === GOVERNANCE_DIR)) continue
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
  return { project: id, ...readModelDir(dir, projectRoot), designs: listDesigns(dir) }
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
  const revisions: RevisionInfo[] = []
  for (const r of Array.isArray(raw.revisions) ? (raw.revisions as Record<string, unknown>[]) : []) {
    const rid = str(r?.id)
    if (!rid || !isProjectId(rid)) {
      problems.push(`revisions 中有轮次缺少合法的 id`)
      continue
    }
    if (!fs.existsSync(path.join(designDir, rid, 'system.yaml'))) {
      problems.push(`轮次 ${rid} 缺少快照目录 ${rid}/system.yaml，已忽略`)
      continue
    }
    revisions.push({
      id: rid,
      date: str(r.date) ?? (r.date instanceof Date ? r.date.toISOString().slice(0, 10) : undefined),
      summary: str(r.summary),
      questions: Array.isArray(r.questions) ? r.questions.filter((q): q is string => typeof q === 'string') : undefined,
      feedback: str(r.feedback),
    })
  }
  if (revisions.length === 0) problems.push('没有可打开的轮次（revisions 为空或快照目录缺失）')
  const base = raw.base && typeof raw.base === 'object' ? (raw.base as DesignInfo['base']) : undefined
  return { id, name: str(raw.name) ?? id, status, goal: str(raw.goal), base, revisions, problems }
}

/** 读设计版本的某一轮，附带对比基线（当前版本与上一轮）；不存在返回 null */
export function readDesignRevision(modelRoot: string, project: string, design: string, revision: string, projectRoot: string): ModelPayload | null {
  const current = readProject(modelRoot, project, projectRoot)
  if (!current || !isProjectId(design) || !isProjectId(revision)) return null
  const info = current.designs?.find(d => d.id === design)
  const at = info?.revisions.findIndex(r => r.id === revision) ?? -1
  if (!info || at < 0) return null
  const designDir = path.join(modelRoot, project, DESIGNS_DIR, design)
  const prev = info.revisions[at - 1]
  return {
    project,
    ...readModelDir(path.join(designDir, revision), projectRoot),
    designs: current.designs,
    version: { design, revision },
    compare: {
      current: { label: '当前版本', dir: current.dir, files: current.files },
      ...(prev ? { previous: { label: versionLabel(info, prev.id), ...readModelDir(path.join(designDir, prev.id), projectRoot) } } : {}),
    },
  }
}

/** 项目列表页用的摘要：直接跑一遍模型层，统计规模与问题数；健康度（Q10）由调用方另算后附上 */
export function summarizeProject(payload: ModelPayload, health?: ProjectHealth): ProjectSummary {
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
    designs: payload.designs ?? [],
  }
}

/** health：按项目算健康度（开发服务器传 readHealth；读源码与代码事实不属于描述读取） */
export function listProjects(modelRoot: string, projectRoot: string, health?: (payload: ModelPayload) => ProjectHealth): ProjectSummary[] {
  return listProjectIds(modelRoot).map(id => {
    const payload = readProject(modelRoot, id, projectRoot)!
    return summarizeProject(payload, health?.(payload))
  })
}
