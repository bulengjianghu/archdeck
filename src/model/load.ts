/**
 * Loader：解析 YAML / JSON（同一解析器，S8）、按 JSON Schema 检查单文件格式、把多个文件合并成一个模型。
 *
 * 单文件格式不合法时整份文件跳过并报错；跨文件的引用完整性交给 validate.ts。
 */
import Ajv, { type ErrorObject } from 'ajv'
import { LineCounter, parseDocument, type Document } from 'yaml'
import schema from '../../schema/arch-file.schema.json'
import type {
  ActorEntity,
  ArchFileDef,
  ArchModel,
  DataStructureEntity,
  InterfaceEntity,
  Issue,
  ModuleDef,
  ModuleEntity,
  RawFile,
  RelationEntity,
  ScenarioEntity,
  SourceLoc,
  Step,
  StepDef,
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
  const actors: ActorEntity[] = []
  const scenarios: ScenarioEntity[] = []
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
    data.actors?.forEach((x, i) => actors.push({ ...x, seq: seq++, src: locate(['actors', i]) }))
    const pushScenario = (def: NonNullable<ArchFileDef['scenario']>, path: (string | number)[]) => {
      const { steps, ...rest } = def
      scenarios.push({ ...rest, steps: normalizeSteps(steps, [...path, 'steps'], '', locate), seq: seq++, src: locate(path) })
    }
    if (data.scenario) pushScenario(data.scenario, ['scenario'])
    data.scenarios?.forEach((x, i) => pushScenario(x, ['scenarios', i]))
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

  return { model: { system, modules, relations, interfaces, dataStructures, actors, scenarios }, issues }
}

/** 步骤树规整为 Step：记录路径（F2）与出处，payload 规整为数组 */
function normalizeSteps(defs: StepDef[], yamlPath: (string | number)[], prefix: string, locate: ParsedFile['locate']): Step[] {
  return defs.map((def, i) => {
    const at = [...yamlPath, i]
    const path = prefix ? `${prefix}.${i}` : String(i)
    const src = locate(at)
    if ('call' in def || 'async' in def || 'return' in def) {
      const kind = 'call' in def ? 'call' : 'async' in def ? 'async' : 'return'
      const raw = 'call' in def ? def.call : 'async' in def ? def.async : def.return
      const payload = raw.payload === undefined ? [] : Array.isArray(raw.payload) ? raw.payload : [raw.payload]
      return { kind, path, src, msg: { ...raw, payload } }
    }
    if ('alt' in def) {
      return {
        kind: 'alt',
        path,
        src,
        branches: def.alt.map((b, k) => ({ when: b.when, steps: normalizeSteps(b.steps, [...at, 'alt', k, 'steps'], `${path}.alt${k}`, locate) })),
      }
    }
    if ('loop' in def) return { kind: 'loop', path, src, while: def.loop.while, steps: normalizeSteps(def.loop.steps, [...at, 'loop', 'steps'], `${path}.loop`, locate) }
    if ('par' in def) {
      return { kind: 'par', path, src, branches: def.par.map((b, k) => ({ steps: normalizeSteps(b.steps, [...at, 'par', k, 'steps'], `${path}.par${k}`, locate) })) }
    }
    return { kind: 'ref', path, src, scenario: def.ref }
  })
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

/**
 * oneOf 等组合关键字会对同一位置报出多条错误，每个位置只保留最有用的一条；
 * 嵌套结构（步骤树）中，深处已有错误时不再报它外层各候选分支的失败
 */
function dedupeErrors(errors: ErrorObject[]): ErrorObject[] {
  const byPath = new Map<string, ErrorObject>()
  for (const e of errors) {
    const prev = byPath.get(e.instancePath)
    if (!prev || prev.keyword === 'oneOf') byPath.set(e.instancePath, e)
  }
  const paths = [...byPath.keys()]
  return [...byPath.values()].filter(e => !paths.some(p => p.startsWith(`${e.instancePath}/`)))
}

const STEP_KEYS = ['call', 'async', 'return', 'alt', 'loop', 'par', 'ref']

function describeSchemaError(err: ErrorObject): string {
  const where = err.instancePath || '(文件顶层)'
  switch (err.keyword) {
    case 'additionalProperties':
      return `${where} 不认识的字段「${(err.params as { additionalProperty: string }).additionalProperty}」`
    case 'required':
      if (/\/steps\/\d+$/.test(err.instancePath) && STEP_KEYS.includes((err.params as { missingProperty: string }).missingProperty)) return `${where} 步骤必须是 call / async / return / alt / loop / par / ref 之一（每个步骤只写一个键）`
      return `${where} 缺少必填字段「${(err.params as { missingProperty: string }).missingProperty}」`
    case 'enum':
      return `${where} 取值必须是 ${(err.params as { allowedValues: unknown[] }).allowedValues.join(' / ')} 之一`
    case 'pattern':
      return `${where} ID 只能包含字母、数字和 . _ : -，且以字母或数字开头`
    default:
      return `${where} ${err.message ?? err.keyword}`
  }
}
