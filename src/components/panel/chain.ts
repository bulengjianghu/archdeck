/**
 * D-25：步骤的包含链「这一步 → 绑定的交互 → 支撑它的依赖」，缺哪一级标哪一级——
 * 未绑定交互（交互中未建模，P11）/ 交互未证实（K6）/ 经总线或通道等不判定（K5b）。只组合已有的事实（帧的绑定 S13、关系的证实 K5），不另立规则。
 */
import { moduleName, parseVia, viaLabel, type Confirmation, type Frame, type ModelIndex, type ModuleDep } from '@/model'
import { RELATION_TYPE_LABELS } from '../shared/labels'

export type ChainState = 'ok' | 'missing' | 'skipped' | 'na'

export interface ChainLink {
  state: ChainState
  text: string
  /** 交互一级：绑定的关系 */
  relation?: string
  /** 依赖一级：支撑它的模块依赖（已证实时） */
  deps?: ModuleDep[]
}

export interface StepChain {
  interaction: ChainLink
  dependency: ChainLink
}

type Fact = (Omit<Confirmation, 'deps'> & { deps: ModuleDep[] }) | null

export function stepChain(index: ModelIndex, frame: Pick<Frame, 'relation' | 'relationInferred'>, fact: Fact): StepChain {
  const name = (id: string) => moduleName(index, id)
  const r = frame.relation ? index.relations.get(frame.relation) : undefined
  if (!r) return { interaction: { state: 'missing', text: '未绑定交互（交互中未建模）' }, dependency: { state: 'na', text: '—' } }
  const interaction: ChainLink = {
    state: 'ok',
    relation: r.id,
    text: `${RELATION_TYPE_LABELS[r.type]} ${name(r.from)} → ${name(r.to)}${frame.relationInferred ? '（推断）' : ''}`,
  }
  if (!fact) return { interaction, dependency: { state: 'na', text: '没有代码事实' } }
  if (fact.status === 'confirmed') {
    const files = fact.deps.reduce((n, d) => n + d.files.length, 0)
    const port = fact.port ? `经端口 ${index.interfaces.get(fact.port)?.name ?? fact.port}：` : ''
    const ends = fact.deps.length === 1 ? `${name(fact.deps[0].from)} → ${name(fact.deps[0].to)}` : `${fact.deps.length} 条模块依赖`
    return { interaction, dependency: { state: 'ok', text: `${port}${ends} · ${files} 处`, deps: fact.deps } }
  }
  if (fact.status === 'unconfirmed') return { interaction, dependency: { state: 'missing', text: '交互未证实：两端之间没有撑着它的依赖' } }
  const via = fact.via ?? r.via
  const kind = parseVia(via)?.kind
  if (via && (kind === 'bus' || kind === 'channel'))
    return { interaction, dependency: { state: 'skipped', text: `经 ${viaLabel(via, index)}，越过导入图，不判定` } }
  if (via) return { interaction, dependency: { state: 'skipped', text: `经 ${viaLabel(via, index)}，不判定` } }
  if (fact.host) return { interaction, dependency: { state: 'skipped', text: `两端在同一组文件里（${name(fact.host)}），不判定` } }
  return { interaction, dependency: { state: 'skipped', text: '不判定（一端是外部参与者或目标态）' } }
}
