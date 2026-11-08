/**
 * 核对卡的分项（PC-6–PC-10）：各面板的核对行由这里的纯派生给出（只读 desk 的现有派生，不新算），
 * 面板渲染核对卡、视图区的「核对」标签名取同一份行的「要看」项数（LY-9b，负责人 2026-11-08 走查）——标签没激活时也要有数。
 */
import { CARRIER_ROLE_TEXT, HOT_SURFACE_MODULES, SCOPE_CATEGORIES, moduleName, stratumByKey, type CarrierSegment } from '@/model'
import type { DeskState } from '@/state/useDeskState'
import { staleText } from '../shared/explainerText'
import { EVIDENCE_LEVEL_LABELS } from '../shared/labels'
import { alignedEvidence, stepChain } from './chain'
import { checkSummary, moduleCheckRows, relationTypeLabel, rowsFromNotices, type CheckItem, type CheckRow } from './panelCheck'
import type { PanelNotice } from './panelNotices'

/** 确认行的徽标只在范围内或已有记录时出现（ReviewSection 同口径） */
export const moduleReviewInScope = (desk: DeskState, id: string) => desk.index.value!.stratumOf.get(id)?.members.length === 1 || desk.review.scope.value.has(id)

/** PC-6：模块核对卡六行 */
export function moduleCheckRowsOf(desk: DeskState, id: string): CheckRow[] {
  const idx = desk.index.value!
  const name = (x: string) => (idx.actors.get(x)?.name ?? moduleName(idx, x)) as string
  const inside = (x: string) => !!idx.pathOf.get(x)?.includes(id)
  const ready = desk.facts.status.value === 'ready'
  const detail = ready ? desk.facts.moduleDetail(id) : null
  const crossing = desk.facts.collaborations(id).flatMap(c => c.relations)
  /** 一条关系相对本模块的写法：「→ 对端（类型）」/「← 对端（类型）」 */
  const relText = (rid: string) => {
    const r = idx.relations.get(rid)!
    const out = inside(r.from)
    return `${out ? '→' : '←'} ${name(out ? r.to : r.from)}（${relationTypeLabel(r.type)}）`
  }
  /** EX-7：本模块图解的依据状态（没有图解为 null） */
  const explainer = desk.explainers.status(id)

  const d = detail
  const unconfirmed: CheckItem[] = ready ? desk.facts.isolatedOf(id).map(rid => ({ text: `${relText(rid)}：代码里两端之间没有依赖`, relation: rid })) : []
  const undescribed: CheckItem[] = d
    ? [
        ...d.undescribed.out.map(x => ({ text: `→ ${name(x)}：代码有依赖，描述没写关系`, target: 'evidence.governance' })),
        ...d.undescribed.in.map(x => ({ text: `← ${name(x)}：代码有依赖，描述没写关系`, target: 'evidence.governance' })),
      ]
    : []
  const violations: CheckItem[] = d
    ? [
        ...d.violations.out.map(v => ({ text: `→ ${name(v.other)}：${v.reason}`, target: 'evidence.governance' })),
        ...d.violations.in.map(v => ({ text: `← ${name(v.other)}：${v.reason}`, target: 'evidence.governance' })),
      ]
    : []
  const cycles: CheckItem[] = d ? d.cycles.map(c => ({ text: `模块环：${c.map(name).join(' ↔ ')}`, target: 'evidence.governance' })) : []
  if (ready && desk.facts.selectedCycle.value) cycles.push({ text: '本层环：选中的节点在本层的环里', target: 'evidence.governance' })
  const against: CheckItem[] = ready
    ? desk.facts.againstOf(id).map(a => ({
        text: `→ ${name(a.module)}：依赖比自己更易变的模块（I ${a.hit.from.toFixed(2)} → ${a.hit.to.toFixed(2)}）`,
        target: 'boundary.structure',
      }))
    : []
  const sm = ready ? desk.facts.surfaceMetricsOf(id) : null
  const surface: CheckItem[] = sm
    ? [
        ...sm.bypasses.map(f => ({ text: `越过入口：${f.from}:${f.line} → ${f.via}`, target: 'boundary.surface' })),
        ...sm.uses
          .filter(u => u.element.state === 'exported-only' && u.modules.length >= HOT_SURFACE_MODULES)
          .map(u => ({ text: `热表面未声明：${u.element.name} 被 ${u.modules.length} 个模块使用`, target: 'boundary.surface' })),
      ]
    : []
  const s = desk.facts.splitOf(id)
  const long = desk.files.linesOf(id).long
  const split: CheckItem[] = []
  if (s) {
    const to = 'evidence.split'
    if (s.noFiles) split.push({ text: '不占任何文件：代码在别的模块的文件里', target: to })
    for (const x of s.shared)
      split.push({
        text: `与 ${x.modules
          .filter(y => y !== id)
          .map(name)
          .join('、')} 共用 ${x.file}`,
        target: to,
      })
    if (s.children.noFiles.length) split.push({ text: `${s.children.noFiles.length} 个子模块不占文件`, target: to })
    for (const x of s.children.shared) split.push({ text: `子模块 ${x.modules.map(name).join('、')} 共用 ${x.file}`, target: to })
    if (s.noDeps) split.push({ text: '子模块之间有交互、没有值依赖', target: to })
    else for (const x of s.undepended) split.push({ text: `${name(x.from)} 与 ${name(x.to)} 交互却没有值依赖`, target: to })
    if (long) split.push({ text: `${long} 个文件超过 ${desk.files.maxLines.value} 行`, target: 'evidence.source' })
  }
  // ST-1（ADR-0060）：子模块超过七个却没有声明分层——与代码事实无关的描述信号，单击跳到理解卡的「怎么分」
  const childCount = (desk.index.value?.childrenOf.get(id) ?? []).length
  if (childCount > 7 && !(desk.index.value?.strata.get(id) ?? []).length)
    split.push({ text: `${childCount} 个子模块未声明分层：归纳 2–5 个有原则的层，或记一条拆分信号（ST-1）`, target: 'split', hint: true })
  const ev = desk.evolution.moduleOf(id)
  const stats = desk.evolution.stats.value
  const st = desk.review.of(id)
  return moduleCheckRows({
    facts: ready && !!d,
    noFactsReason: { loading: '代码事实读取中', design: '设计版本没有代码事实', error: '没有代码事实（源码不可用）', ready: '没有代码事实' }[
      desk.facts.status.value
    ],
    relations: crossing.length,
    unconfirmed,
    undescribed,
    violations,
    cycles,
    against,
    surfaceWidth: sm?.w ?? null,
    surface,
    split,
    evolution: ev && stats && ev.changes ? { changes: ev.changes, fixes: ev.fixes, heat: Math.round(ev.heat), days: stats.days } : null,
    review: { status: st.status, date: st.entry?.at, changes: st.diff?.count, inScope: moduleReviewInScope(desk, id) },
    ...(explainer?.stale ? { explainerStale: staleText(explainer) } : {}),
  })
}

/** PC-10：关系——证实（K6，经机制、同文件或端点是参与者的不判定）、承载缺段（K20） */
export function relationCheckRowsOf(desk: DeskState, id: string): CheckRow[] {
  const idx = desk.index.value!
  const name = (x: string) => moduleName(idx, x)
  const f = desk.facts.relationFact(id)
  const out: CheckRow[] = []
  if (!f) out.push({ key: 'verify', label: '证实', state: 'none', text: '没有代码事实', items: [] })
  else if (f.via || f.host || f.status === 'skipped')
    out.push({ key: 'verify', label: '证实', state: 'none', text: '不判定（经机制、同文件或端点是参与者）', items: [] })
  else if (f.status === 'unconfirmed')
    out.push({
      key: 'verify',
      label: '证实',
      state: 'bad',
      text: '未被代码证实',
      items: [
        {
          text: f.isolated ? '两端之间在代码里没有任何依赖，多半是描述写错（K6）' : '两端之间只有反向的依赖，可能经端口或注入（K6）',
          target: 'evidence.fact',
        },
      ],
    })
  else out.push({ key: 'verify', label: '证实', state: 'ok', text: '已被代码证实', items: [] })
  const c = desk.facts.carrierOf(id)
  if (c) {
    const missing = c.segments.filter(x => x.missing)
    out.push({
      key: 'carrier',
      label: '承载',
      state: missing.length ? 'bad' : 'ok',
      text: missing.length ? `${c.segments.length} 段中缺 ${missing.length} 段` : `${c.segments.length} 段齐全`,
      items: missing.map(x => ({ text: `缺段：${name(x.from)} → ${name(x.to)}`, target: 'boundary.carrier' })),
    })
  }
  return out
}

/** 层（ADR-0052）：本层在父模块分层里的度量；没有时为 null */
export function stratumMetricsOf(desk: DeskState, key: string) {
  const idx = desk.index.value
  const s = idx ? (stratumByKey(idx, key) ?? null) : null
  if (!idx || !s) return null
  return desk.facts.strataOf(s.parent).find(m => m.id === s.id) ?? null
}

/** PC-10：层——结构一行（Ca / Ce / I 与本层的向上依赖，向上依赖为提示） */
export function stratumCheckRowsOf(desk: DeskState, key: string): CheckRow[] {
  const idx = desk.index.value
  const name = (x: string) => (idx ? moduleName(idx, x) : x)
  const x = stratumMetricsOf(desk, key)
  if (!x || x.instability === null) return [{ key: 'structure', label: '结构', state: 'none', text: '没有代码事实', items: [] }]
  return [
    {
      key: 'structure',
      label: '结构',
      state: x.upward.length ? 'hint' : 'ok',
      text: `Ca ${x.ca} · Ce ${x.ce} · I ${x.instability.toFixed(2)}${x.upward.length ? ` · 向上 ${x.upward.length}` : ''}`,
      items: x.upward.map(u => ({
        text: `向上：${name(u.from)} → ${name(u.to)}${u.typeOnly ? '（只引类型）' : ''} · ${u.files} 处`,
        target: 'structure',
        hint: true,
      })),
    },
  ]
}

/** PC-10：场景——证据一行（证据文件不在源码清单中、或有步骤无证据为 ⚠） */
export function scenarioCheckRowsOf(desk: DeskState): CheckRow[] {
  const p = desk.files.payload.value
  const local = p?.status === 'local'
  const hasFile = (f: string) => p?.status === 'local' && p.files.includes(f)
  const sc = desk.run.scenario.value
  const evCounts = desk.evidence.counts.value
  const missing = local ? (sc?.evidence ?? []).filter(f => !hasFile(f)) : []
  const none = evCounts?.none ?? 0
  if (!sc?.evidence?.length && !evCounts) return [{ key: 'evidence', label: '证据', state: 'none', text: '没有写证据文件，也没有代码事实', items: [] }]
  const items = [
    ...missing.map(f => ({ text: `${f}：不在源码清单中`, target: 'boundary.evidence' })),
    ...(none ? [{ text: `${none} 步没有代码证据（S16）`, target: 'boundary.evidence' }] : []),
  ]
  return [
    {
      key: 'evidence',
      label: '证据',
      state: items.length ? 'bad' : 'ok',
      text: `证据文件 ${sc?.evidence?.length ?? 0}${evCounts ? ` · 各步无证据 ${none}` : ''}`,
      items,
    },
  ]
}

/** 步骤的代码证据与包含链（D-25）；没有代码事实时都为 null */
export function stepEvidenceOf(desk: DeskState) {
  const idx = desk.index.value!
  const f = desk.run.frame.value
  const ev = desk.evidence.step.value
  if (!f) return { shownEv: null, chain: null }
  /** S18b、K5d：步骤 → 绑定的交互 → 承载 */
  const carrier = desk.facts.stepCarrierOf(f).carrier
  return {
    /** T0-10：等级由承载判定导出，与包含链同一个词 */
    shownEv: ev ? alignedEvidence(idx, ev, carrier) : null,
    chain: ev ? stepChain(idx, f, carrier, f.relation ? desk.facts.relationFact(f.relation) : null) : null,
  }
}

export const segText = (desk: DeskState, s: CarrierSegment) =>
  CARRIER_ROLE_TEXT[s.role](s.from === '*' ? '某模块' : moduleName(desk.index.value!, s.from), moduleName(desk.index.value!, s.to))

/** PC-10：步骤——代码证据一行（无证据或承载缺段为 ⚠，不判定为 —） */
export function stepCheckRowsOf(desk: DeskState): CheckRow[] {
  const { shownEv: e, chain } = stepEvidenceOf(desk)
  if (!e) return [{ key: 'evidence', label: '代码证据', state: 'none', text: '没有代码事实', items: [] }]
  const missing = chain?.carrier.segments?.filter(sg => sg.missing) ?? []
  const items = [
    ...(e.level === 'none' ? [{ text: e.note || '代码里没找到这一步的证据', target: 'evidence.code' }] : []),
    ...missing.map(sg => ({ text: `承载缺段：${segText(desk, sg)}`, target: 'evidence.code' })),
  ]
  return [
    { key: 'evidence', label: '代码证据', state: items.length ? 'bad' : e.level === 'skipped' ? 'none' : 'ok', text: EVIDENCE_LEVEL_LABELS[e.level], items },
  ]
}

/** 代码依赖 / 依赖边（K10）：这对节点之间的违规提示 */
export function depNoticesOf(desk: DeskState): PanelNotice[] {
  const violations = desk.facts.selectedDep.value?.detail?.violations ?? []
  return violations.length
    ? [
        {
          key: 'violations',
          label: '违规',
          count: violations.length,
          target: 'evidence.violations',
          to: '违规',
          // 与模块面板同口径（审核轮 2 B1）：治理信号，不是门禁红（U8），不含返工清单 info 级（K24）
          note: '这对节点之间声明的架构规则违规（U2–U6），含基线内的已知违规；门禁卡的是基线外的新增（U8），返工清单的 info 级提示（K24 层符合性）不在此计数',
        },
      ]
    : []
}

/** PC-10：代码依赖——治理一行（违规） */
export const depCheckRowsOf = (desk: DeskState): CheckRow[] =>
  rowsFromNotices(depNoticesOf(desk), [{ key: 'governance', label: '治理', notices: ['violations'], ok: '没有违规' }])

/** LY-13d：子树汇总卡的「要看」项数（违规、环、未证实、未归属、需复核之和）；读取中为 null */
export function scopeTotalOf(desk: DeskState, roots: readonly string[]): number | null {
  const scope = desk.reworkScope(roots)
  return scope ? SCOPE_CATEGORIES.reduce((n, c) => n + scope.counts[c], 0) : null
}

/** 面板按选中分派的对象（V2，ADR-0012）：回放中步骤 / 场景；无选中时为当前父模块，根层为系统（N13）。Panel 与核对计数共用 */
export type PanelTarget = {
  kind: 'step' | 'scenario' | 'module' | 'relation' | 'edge' | 'actor' | 'file' | 'dep' | 'couple' | 'port' | 'cycle' | 'stratum' | 'system'
  id: string
} | null

export function panelTargetOf(desk: DeskState): PanelTarget {
  const idx = desk.index.value
  const s = desk.selected.value
  if (!idx) return null
  if (s?.kind === 'step') return desk.run.frame.value ? { kind: 'step', id: s.id } : null
  if (s?.kind === 'scenario') return { kind: 'scenario', id: s.id }
  if (s?.kind === 'module' && idx.modules.has(s.id)) return { kind: 'module', id: s.id }
  if (s?.kind === 'relation' && idx.relations.has(s.id)) return { kind: 'relation', id: s.id }
  if (s?.kind === 'edge') return { kind: 'edge', id: s.id }
  if (s?.kind === 'actor' && idx.actors.has(s.id)) return { kind: 'actor', id: s.id }
  if (s?.kind === 'file') return { kind: 'file', id: s.id }
  if (s?.kind === 'dep') return { kind: 'dep', id: s.id }
  if (s?.kind === 'couple') return { kind: 'couple', id: s.id }
  if (s?.kind === 'port') return { kind: 'port', id: s.id }
  if (s?.kind === 'cycle') return { kind: 'cycle', id: s.id }
  if (s?.kind === 'stratum') return { kind: 'stratum', id: s.id }
  const level = desk.levelId.value
  return level && level !== idx.rootId ? { kind: 'module', id: level } : { kind: 'system', id: idx.rootId }
}

/**
 * LY-9b（负责人 2026-11-08 走查）：「核对」标签名带的数——核对标签里各卡卡头「要看」的项数之和：
 * 核对卡为 ⚠ 的分项数（checkSummary.warn），子树汇总卡为五类计数之和（LY-13d）。草图编辑、没有核对卡的主语为 0。
 */
export function checkWarnCount(desk: DeskState): number {
  if (desk.edit.active.value || (desk.droppedSelection.value && desk.viewpoint.value === 'structure')) return 0
  const t = panelTargetOf(desk)
  const idx = desk.index.value
  if (!t || !idx) return 0
  const warn = (rows: CheckRow[]) => checkSummary(rows).warn
  const scope = (roots: readonly string[]) => scopeTotalOf(desk, roots) ?? 0
  switch (t.kind) {
    case 'system':
      return scope([t.id])
    case 'module':
      return (idx.stratumOf.get(t.id)?.members.length === 1 ? scope([t.id]) : 0) + warn(moduleCheckRowsOf(desk, t.id))
    case 'stratum':
      return scope(stratumByKey(idx, t.id)?.members ?? []) + warn(stratumCheckRowsOf(desk, t.id))
    case 'relation':
      return warn(relationCheckRowsOf(desk, t.id))
    case 'dep':
      return warn(depCheckRowsOf(desk))
    case 'scenario':
      return warn(scenarioCheckRowsOf(desk))
    case 'step':
      return warn(stepCheckRowsOf(desk))
    default:
      return 0
  }
}
