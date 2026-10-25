/**
 * D-25、S18b（第八轮改为元素级，裁决 T0-10）：步骤的包含链「这一步 → 交互（承载判定词）→ 承载段（文件:行）」，只保留这一条链；
 * 「代码证据」一节的等级由承载判定导出，两处永远同一个词——齐全 ↔ 按名字匹配、已证实（模块级）↔ 按模块依赖、无承载 ↔ 无证据、外部承载 ↔ 不判定
 * （缺段 ↔ 按模块依赖：有段在、有段缺，不标「?」）；承载齐全时候选调用点取承载段的文件依赖。时序图消息上的「?」按同一口径（无承载才标）。
 * 没有承载（参与者、目标态、同宿主、端口 / 总线未指明、没有代码事实）时回到步骤证据（S16）与关系的证实（K5）给出的不判定说明。
 * 只组合已有的事实（帧的绑定 S13、承载 K5d、证据 S16），不另立规则。
 */
import {
  CARRIER_ROLE_TEXT,
  CARRIER_TEMPLATE_LABELS,
  CARRIER_VERDICT_LABELS,
  moduleName,
  parseVia,
  viaLabel,
  type Carrier,
  type CarrierSegment,
  type CarrierVerdict,
  type Confirmation,
  type EvidenceLevel,
  type FileDep,
  type Frame,
  type ModelIndex,
  type ModuleDep,
  type StepEvidence,
} from '@/model'
import { RELATION_TYPE_LABELS } from '../shared/labels'

export type ChainState = 'ok' | 'missing' | 'skipped' | 'na'

export interface ChainLink {
  state: ChainState
  text: string
  /** 交互一级：绑定的关系 */
  relation?: string
  /** 交互一级：承载判定词（有承载时） */
  verdict?: string
}

export interface StepChain {
  interaction: ChainLink
  /** 承载一级：判定与各段（有承载时 segments 为承载段） */
  carrier: ChainLink & { segments?: CarrierSegment[] }
}

type Fact = (Omit<Confirmation, 'deps'> & { deps: ModuleDep[] }) | null

/** T0-10：承载判定 → 证据等级 */
export const VERDICT_LEVEL: Readonly<Record<CarrierVerdict, EvidenceLevel>> = {
  complete: 'name',
  'module-level': 'module',
  partial: 'module',
  none: 'none',
  external: 'skipped',
}

/** 一帧的证据等级：有承载时由承载判定导出，否则为步骤证据（S16）的等级 */
export const alignedLevel = (level: EvidenceLevel, carrier: Carrier | null | undefined): EvidenceLevel => (carrier ? VERDICT_LEVEL[carrier.verdict] : level)

/** 承载段的文件依赖（去重，按段的顺序） */
export function carrierFiles(carrier: Carrier): FileDep[] {
  const seen = new Set<string>()
  const out: FileDep[] = []
  for (const s of carrier.segments)
    for (const f of s.edge?.files ?? []) {
      const k = `${f.from}:${f.line}:${f.to}:${f.via}`
      if (seen.has(k)) continue
      seen.add(k)
      out.push(f)
    }
  return out
}

/** 缺的段（「A → B的订阅操作」之类） */
export const missingText = (index: ModelIndex, carrier: Carrier) =>
  carrier.segments
    .filter(s => s.missing)
    .map(s => CARRIER_ROLE_TEXT[s.role](s.from === '*' ? '某模块' : moduleName(index, s.from), moduleName(index, s.to)))
    .join('、')

export function stepChain(index: ModelIndex, frame: Pick<Frame, 'relation' | 'relationInferred'>, carrier: Carrier | null, fact: Fact): StepChain {
  const name = (id: string) => moduleName(index, id)
  const r = frame.relation ? index.relations.get(frame.relation) : undefined
  if (!r) return { interaction: { state: 'missing', text: '未绑定交互（交互中未建模）' }, carrier: { state: 'na', text: '—' } }
  const interaction: ChainLink = {
    state: 'ok',
    relation: r.id,
    text: `${RELATION_TYPE_LABELS[r.type]} ${name(r.from)} → ${name(r.to)}${frame.relationInferred ? '（推断）' : ''}`,
    ...(carrier ? { verdict: CARRIER_VERDICT_LABELS[carrier.verdict] } : {}),
  }
  if (carrier) {
    const t = CARRIER_TEMPLATE_LABELS[carrier.template]
    const v = carrier.verdict
    const state: ChainState = v === 'complete' || v === 'module-level' ? 'ok' : v === 'external' ? 'skipped' : 'missing'
    const text =
      v === 'complete'
        ? `${t}：各段都接到元素`
        : v === 'module-level'
          ? `${t}：元素对不上，按模块依赖`
          : v === 'partial'
            ? `${t}：缺 ${missingText(index, carrier)}`
            : v === 'none'
              ? `${t}：一段都没有，两端之间没有撑着它的依赖`
              : '外部承载：通道没写契约模块，不判定'
    return { interaction, carrier: { state, text, segments: carrier.segments } }
  }
  if (!fact) return { interaction, carrier: { state: 'na', text: '没有代码事实' } }
  // 承载还没算出（入口导出读取中等）时按 K5 回退
  if (fact.status === 'confirmed') {
    const files = fact.deps.reduce((n, d) => n + d.files.length, 0)
    return { interaction, carrier: { state: 'ok', text: `已证实（模块级）：${fact.deps.length} 条模块依赖 · ${files} 处` } }
  }
  if (fact.status === 'unconfirmed') return { interaction, carrier: { state: 'missing', text: '交互未证实：两端之间没有撑着它的依赖' } }
  const via = fact.via ?? r.via
  const kind = parseVia(via)?.kind
  if (via && (kind === 'port' || kind === 'bus') && !parseVia(via)?.target)
    return { interaction, carrier: { state: 'skipped', text: `经 ${viaLabel(via, index)}（未指明），不判定` } }
  if (via) return { interaction, carrier: { state: 'skipped', text: `经 ${viaLabel(via, index)}，不判定` } }
  if (fact.host) return { interaction, carrier: { state: 'skipped', text: `两端在同一组文件里（${name(fact.host)}），不判定` } }
  return { interaction, carrier: { state: 'skipped', text: '不判定（一端是外部参与者或目标态）' } }
}

/** S16 + T0-10：步骤面板「代码证据」一节的等级、说明与候选调用点（有承载时由承载导出） */
export interface AlignedEvidence {
  level: EvidenceLevel
  note: string
  candidates: FileDep[]
  total: number
}

export function alignedEvidence(index: ModelIndex, ev: StepEvidence, carrier: Carrier | null): AlignedEvidence {
  const own = 'candidates' in ev ? { candidates: ev.candidates, total: ev.total } : { candidates: [], total: 0 }
  if (!carrier) return { level: ev.level, note: evidenceNote(index, ev), ...own }
  const files = carrierFiles(carrier)
  const level = VERDICT_LEVEL[carrier.verdict]
  const seg = { candidates: files, total: files.length }
  switch (carrier.verdict) {
    case 'complete': {
      const els = [...new Set(carrier.segments.flatMap(s => (s.edge?.element ? [s.edge.element.name] : [])))]
      const note = ev.level === 'name' && ev.name ? `导入名含接口名「${ev.name}」` : `承载各段都接到元素${els.length ? `「${els.join('、')}」` : ''}`
      return { level, note, ...seg }
    }
    case 'module-level':
      return { level, note: '承载按模块依赖回退：元素对不上（默认导出、整模块导入、越过入口等）', ...(own.candidates.length ? own : seg) }
    case 'partial':
      return { level, note: `承载缺段：缺 ${missingText(index, carrier)}`, ...seg }
    case 'none':
      return {
        level,
        note: '无承载：两端之间在代码里没有撑着这条交互的依赖；检查接口名或两端 codeRefs，确实经注入 / 回调传递的给关系写 via',
        candidates: [],
        total: 0,
      }
    default:
      return { level, note: '外部承载：通道没写契约模块（channel:<名>@<模块 ID>），静态导入核不了', candidates: [], total: 0 }
  }
}

/** S16：没有承载时的说明（原口径） */
function evidenceNote(index: ModelIndex, e: StepEvidence): string {
  if (e.level === 'none') return '两端之间在代码里没有任何依赖：检查接口名或两端 codeRefs；确实经注入 / 回调传递的给关系写 via'
  if (e.level === 'name') return `导入名含接口名「${e.name}」`
  if (e.level !== 'skipped') return e.name ? `导入名里没有接口名「${e.name}」，列出两端之间的依赖` : '步骤没有接口，列出两端之间的依赖'
  if (e.reason === 'actor') return '一端是外部参与者'
  if (e.reason === 'via') return `关系经 ${viaLabel(e.via!, index)} 传递，静态导入证实不了`
  if (e.reason === 'target') return '一端是目标态模块，尚未落地'
  return e.host ? `两端在同一组文件里（${moduleName(index, e.host)}）` : '两端在同一组文件里'
}

/** S17 + T0-10：一组帧（时序图一条可见消息）的证据等级——各帧按承载对齐后取最弱（有一帧无承载即「?」） */
const WEAKEST: readonly EvidenceLevel[] = ['none', 'module', 'name', 'skipped']
export function alignedMessageLevel(
  frameIds: readonly string[],
  levels: ReadonlyMap<string, EvidenceLevel>,
  carrierOfFrame: (frameId: string) => Carrier | null,
): EvidenceLevel | undefined {
  const got = new Set(frameIds.flatMap(id => (levels.has(id) ? [alignedLevel(levels.get(id)!, carrierOfFrame(id))] : [])))
  return WEAKEST.find(l => got.has(l))
}
