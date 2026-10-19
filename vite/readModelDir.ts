/**
 * 读取架构描述（Node 侧，供 Vite 插件与命令行校验共用）。
 *
 * 目录约定：模型根目录（默认 model/）下每个子目录是一个项目，子目录里有 system.yaml 才算项目。
 *   model/h5player/      → 项目 h5player
 *   model/h5p-arch-desk/ → 项目 h5p-arch-desk
 */
import fs from 'node:fs'
import path from 'node:path'
import { loadModel } from '../src/model'
import type { RawFile } from '../src/model/types'
import type { ProjectSummary } from '../src/model/project-summary'

export type { ProjectSummary }

export interface ModelPayload {
  /** 项目 ID（即子目录名） */
  project: string
  /** 模型目录，相对项目根，仅用于显示 */
  dir: string
  files: RawFile[]
}

export function isModelFile(file: string): boolean {
  return /\.ya?ml$/i.test(file)
}

export function readModelDir(dir: string, projectRoot: string): Omit<ModelPayload, 'project'> {
  const files: RawFile[] = []
  const walk = (cur: string) => {
    if (!fs.existsSync(cur)) return
    for (const ent of fs.readdirSync(cur, { withFileTypes: true })) {
      const full = path.join(cur, ent.name)
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
  return { project: id, ...readModelDir(path.join(modelRoot, id), projectRoot) }
}

/** 项目列表页用的摘要：直接跑一遍模型层，统计规模与问题数 */
export function summarizeProject(payload: ModelPayload): ProjectSummary {
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
    },
    errors: issues.filter(i => i.severity === 'error').length,
    warnings: issues.filter(i => i.severity === 'warning').length,
  }
}

export function listProjects(modelRoot: string, projectRoot: string): ProjectSummary[] {
  return listProjectIds(modelRoot).map(id => summarizeProject(readProject(modelRoot, id, projectRoot)!))
}
