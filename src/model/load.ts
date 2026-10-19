/**
 * Loader：解析 YAML、按 JSON Schema 检查单文件格式、把多个文件合并成一个模型。
 *
 * 单文件格式不合法时整份文件跳过并报错；跨文件的引用完整性交给 validate.ts。
 */
import Ajv, { type ErrorObject } from 'ajv'
import { LineCounter, parseDocument, type Document } from 'yaml'
import schema from '../../schema/arch-file.schema.json'
import type {
  ArchFileDef,
  ArchModel,
  DataStructureEntity,
  InterfaceEntity,
  Issue,
  ModuleDef,
  ModuleEntity,
  RawFile,
  RelationEntity,
  SourceLoc,
  SystemDef,
} from './types'

/** 未声明 system 时使用的默认根 */
export const DEFAULT_SYSTEM: SystemDef = { id: 'system', name: '系统' }

const ajv = new Ajv({ allErrors: true, strict: false })
const validateFile = ajv.compile<ArchFileDef>(schema)

export interface LoadResult {
  model: ArchModel
  issues: Issue[]
}

export function load(files: readonly RawFile[]): LoadResult {
  const issues: Issue[] = []
  const systems: { def: SystemDef; src: SourceLoc }[] = []
  const modules: ModuleEntity[] = []
  const relations: RelationEntity[] = []
  const interfaces: InterfaceEntity[] = []
  const dataStructures: DataStructureEntity[] = []
  let seq = 0

  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path))
  for (const file of sorted) {
    const parsed = parseFile(file, issues)
    if (!parsed) continue
    const { data, locate } = parsed

    if (data.system) systems.push({ def: data.system, src: locate(['system']) })

    const pushModule = (def: ModuleDef, parentId: string | undefined, path: (string | number)[], nested: boolean) => {
      const { children, parent, ...rest } = def
      if (nested && parent !== undefined) {
        issues.push({
          severity: 'warning',
          code: 'nested-parent-ignored',
          message: `模块 ${def.id} 是内联子模块，其 parent 字段被忽略（父模块由嵌套位置决定）`,
          ...locate([...path, 'parent']),
        })
      }
      // parentId 为 undefined 表示挂在系统根下，合并完成后再回填
      modules.push({ ...rest, parentId: (nested ? parentId : parent) as string, seq: seq++, src: locate(path) })
      children?.forEach((child, i) => pushModule(child, def.id, [...path, 'children', i], true))
    }
    if (data.module) pushModule(data.module, undefined, ['module'], false)
    data.modules?.forEach((m, i) => pushModule(m, undefined, ['modules', i], false))

    data.relations?.forEach((r, i) => {
      const payload = r.payload === undefined ? [] : Array.isArray(r.payload) ? r.payload : [r.payload]
      relations.push({ ...r, payload, seq: seq++, src: locate(['relations', i]) })
    })
    data.interfaces?.forEach((x, i) => interfaces.push({ ...x, src: locate(['interfaces', i]) }))
    data.dataStructures?.forEach((x, i) => dataStructures.push({ ...x, src: locate(['dataStructures', i]) }))
  }

  let system = DEFAULT_SYSTEM
  if (systems.length === 0) {
    issues.push({ severity: 'warning', code: 'missing-system', message: `没有文件声明 system，使用默认根「${DEFAULT_SYSTEM.name}」` })
  } else {
    system = systems[0].def
    for (const extra of systems.slice(1)) {
      issues.push({ severity: 'error', code: 'duplicate-system', message: `system 只能声明一次，已在 ${systems[0].src.file} 声明`, ...extra.src })
    }
  }
  for (const m of modules) if (m.parentId === undefined) m.parentId = system.id

  return { model: { system, modules, relations, interfaces, dataStructures }, issues }
}

interface ParsedFile {
  data: ArchFileDef
  locate: (path: (string | number)[]) => SourceLoc
}

function parseFile(file: RawFile, issues: Issue[]): ParsedFile | null {
  const lineCounter = new LineCounter()
  const doc = parseDocument(file.text, { lineCounter, prettyErrors: false })
  if (doc.errors.length > 0) {
    for (const err of doc.errors) {
      issues.push({
        severity: 'error',
        code: 'yaml-syntax',
        message: `YAML 语法错误：${err.message.split('\n')[0]}`,
        file: file.path,
        line: lineCounter.linePos(err.pos[0]).line,
      })
    }
    return null
  }
  const data = doc.toJS() as unknown
  if (data === null || data === undefined) return null

  const locate = makeLocator(file.path, doc, lineCounter)
  if (!validateFile(data)) {
    for (const err of dedupeErrors(validateFile.errors ?? [])) {
      const path = err.instancePath.split('/').slice(1).map(seg => (/^\d+$/.test(seg) ? Number(seg) : seg))
      issues.push({ severity: 'error', code: 'schema', message: `格式错误：${describeSchemaError(err)}（整份文件已跳过）`, ...locate(path) })
    }
    return null
  }
  return { data, locate }
}

function makeLocator(file: string, doc: Document, lineCounter: LineCounter) {
  return (path: (string | number)[]): SourceLoc => {
    const node = doc.getIn(path, true) as { range?: [number, number, number] } | undefined
    const offset = node?.range?.[0]
    return { file, path: path.join('.'), line: offset === undefined ? undefined : lineCounter.linePos(offset).line }
  }
}

/** oneOf 等组合关键字会对同一位置报出多条错误，每个位置只保留最有用的一条 */
function dedupeErrors(errors: ErrorObject[]): ErrorObject[] {
  const byPath = new Map<string, ErrorObject>()
  for (const e of errors) {
    const prev = byPath.get(e.instancePath)
    if (!prev || prev.keyword === 'oneOf') byPath.set(e.instancePath, e)
  }
  return [...byPath.values()]
}

function describeSchemaError(err: ErrorObject): string {
  const where = err.instancePath || '(文件顶层)'
  switch (err.keyword) {
    case 'additionalProperties':
      return `${where} 不认识的字段「${(err.params as { additionalProperty: string }).additionalProperty}」`
    case 'required':
      return `${where} 缺少必填字段「${(err.params as { missingProperty: string }).missingProperty}」`
    case 'enum':
      return `${where} 取值必须是 ${(err.params as { allowedValues: unknown[] }).allowedValues.join(' / ')} 之一`
    case 'pattern':
      return `${where} ID 只能包含字母、数字和 . _ : -，且以字母或数字开头`
    default:
      return `${where} ${err.message ?? err.keyword}`
  }
}
