/**
 * G14（L47）：图例的出现集合——「显示」面板图例的每一组只列「当前视角 + 当前层次的静息态画面出现的记号」，
 * 没出现的记号行不列；组结构与行序按固定词表（各图例组件持有），行只显隐、不重排；
 * 静息态不出现、聚焦 / 悬停 / 回放才出现的临时记号归各组尾部固定的「临时可见」小节常列（reviews/r3.md 的 G14 补充口径），不在这里算。
 *
 * 出现集合只从现有视图派生数据算（层次视图的边与节点、K9 的本层投影、O12 的组装投影、J5 的演化投影、structureDisplay 的束），
 * 一处派生（本文件的唯一 computed），图例组件不再各自判断；没有代码事实等加载态按空集合处理，组件显示既有的 muted 说明。
 *
 * 静息态口径：无悬停、无选中展开。边界边聚焦才画（L4）、核心跨层边悬停 / 选中才画（O4）、共用件的边悬停 / 选中才画（O10）——
 * 前两者不计入出现集合，只出现在它们上面的关系类型单列 `rel:temp:type:` 键（图例「临时可见」小节用，避免悬停时行闪变）。
 */
import { computed, type ComputedRef, type Ref, type ShallowRef } from 'vue'
import { mechanismOf, type LevelView, type ModelIndex, type ViewEdge } from '@/model'
import type { ViewState } from '../transition'
import type { FactsDerivations, StructureFilter } from './facts'
import type { EvolutionDerivations } from './evolution'

export type LegendPresence = ComputedRef<Set<string>>

export interface LegendInputs {
  state: ShallowRef<ViewState>
  index: ShallowRef<ModelIndex | null>
  view: ComputedRef<LevelView | null>
  facts: FactsDerivations
  evolution: EvolutionDerivations
  /** B1：结构视角的显示偏好（画布同读同一份，structureDisplay 按它过滤） */
  filter: Ref<Readonly<StructureFilter>>
}

const boundaryEnd = (e: ViewEdge) => e.from.startsWith('boundary:') || e.to.startsWith('boundary:')

/** 三问的答案类型（ADR-0029 §3）：问题出现 = 它的任一答案类型出现在画面上 */
const QUESTION_TYPES: readonly (readonly string[])[] = [['queries'], ['commands', 'notifies'], ['streams']]

export function createLegendPresence(inputs: LegendInputs): LegendPresence {
  return computed(() => {
    const set = new Set<string>()
    const v = inputs.view.value
    const idx = inputs.index.value
    if (!v || !idx) return set
    const st = inputs.state.value
    const t = st.toggles
    const structure = st.mode === 'structure' && !st.playback
    const lf = inputs.facts.level.value
    // ── 静息态画出的交互边（边界边聚焦才画，不在内；回放舞台缺省淡显，同一集合）──
    const restEdges = v.edges.filter(e => !boundaryEnd(e))
    const boundaryEdges = v.edges.filter(boundaryEnd)

    if (!structure) {
      // 关系 · 三问四修饰：类型行（筛选已由层次投影做掉，出现在集合里的就是画出来的）
      for (const e of restEdges) set.add(`rel:type:${e.type}`)
      for (const e of boundaryEdges) if (!set.has(`rel:type:${e.type}`)) set.add(`rel:temp:type:${e.type}`)
      // O4：核心跨层边（分层总览）默认隐藏、悬停或选中核心模块时显示——只出现在这些边上的类型同入「临时可见」
      for (const e of v.coreEdges ?? []) if (!set.has(`rel:type:${e.type}`)) set.add(`rel:temp:type:${e.type}`)
      QUESTION_TYPES.forEach((types, i) => {
        if (types.some(x => set.has(`rel:type:${x}`))) set.add(`rel:q${i + 1}`)
      })
      // 四修饰：机制（经端口）、机制标签词表、两段、同步异步、粗细——逐边扫描
      const upward = new Map(inputs.facts.upward.value.filter(u => u.relations.length).map(u => [u.edge, u.relations]))
      let port = false
      let pill = false
      let weight = false
      let mixed = false
      let async = false
      for (const e of restEdges) {
        weight ||= e.relationIds.length > 1
        mixed ||= e.mode === 'mixed'
        async ||= e.mode === 'async'
        const rels = e.relationIds.map(id => idx.relations.get(id)).filter(x => x != null)
        port ||= rels.some(r => mechanismOf(r!) === '端口')
        for (const r of rels) {
          const m = mechanismOf(r!)
          if (m) set.add(`rel:tag:${m}`)
        }
        const up = upward.get(e.id)?.length ?? 0
        const unc =
          (lf?.unconfirmed && e.relationIds.some(id => lf.unconfirmed!.has(id))) ||
          lf?.edgeFacts.get(e.id) === 'unconfirmed' ||
          lf?.edgeFacts.get(e.id) === 'partial'
            ? 1
            : 0
        const violated = lf?.violatedEdges.has(e.id) ? 1 : 0
        // L26②：两段示意出现 = 有边的标签位同时有异常段与修饰段（或聚合出 ×N 再叠标签）
        const parts = up + unc + violated + rels.filter(r => mechanismOf(r!) != null).length + (e.mode === 'mixed' ? 1 : 0)
        pill ||= parts >= 2 || (e.relationIds.length > 1 && parts >= 1)
      }
      if (restEdges.length) {
        set.add('rel:mech')
        if (port) set.add('rel:pair:port')
        if (pill) set.add('rel:pill')
        set.add('rel:sync')
        if (async) set.add('rel:pair:async')
        if (mixed) set.add('rel:pair:mixed')
        if (weight) set.add('rel:weight')
      }
    }

    // ── 节点：可下钻与目标态 / 外部按本层节点算（模块框有节点就有）──
    if (v.nodes.length) {
      set.add('node:module')
      if (v.nodes.some(n => n.hasChildren)) set.add('node:drill')
      if (v.nodes.some(n => n.id.startsWith('boundary:') || idx.modules.get(n.moduleId)?.status === 'target')) set.add('node:outer')
    }

    // ── 代码事实 · 标签（交互视角、K9 投影；回放不叠加 → lf 为 null → 空集合）──
    if (lf) {
      if (restEdges.some(e => lf.violatedEdges.has(e.id)) || lf.overlays.some(o => o.violations > 0)) set.add('facts:tag:违规')
      if (lf.overlays.some(o => o.undescribed > 0)) set.add('facts:tag:未解释')
      if (
        restEdges.some(
          e =>
            lf.edgeFacts.get(e.id) === 'unconfirmed' ||
            lf.edgeFacts.get(e.id) === 'partial' ||
            (lf.unconfirmed != null && e.relationIds.some(id => lf.unconfirmed!.has(id))),
        )
      )
        set.add('facts:tag:未证实')
      if (lf.cycles.size) set.add('facts:cycle')
    }

    // ── 组装（O12 投影；开关关闭或回放为 null → 空集合，组件显示既有的「已关闭」说明）──
    const asm = inputs.facts.assembly.value
    if (asm) {
      if (asm.overlays.length) set.add('asm:line')
      if (asm.roots.size) set.add('asm:root')
    }

    // ── 演化（J5）：热度角标常显按本层投影；波浪线是聚焦才画的临时记号，不进出现集合 ──
    const evo = inputs.evolution.level.value
    if (t.heat !== 'off' && evo && evo.heat.size) set.add('evo:heat')

    // 环编号在交互与结构视角都常显（Y4、T0 裁决 3：本层的环常显；回放没有 K9 → lf 为 null → 不列）
    if (lf?.cycles.size) set.add('shared:cycle')
    // ── 结构视角：出现集合从 structureDisplay（画布同一份过滤）的束算 ──
    if (structure) {
      const f = inputs.filter.value
      const disp = inputs.facts.structureDisplay({ typeOnly: f.typeOnly, invokesOnly: f.invokesOnly, uncoveredOnly: f.uncoveredOnly })
      if (disp) {
        let exception = false
        let skeleton = false
        let bypass = false
        let weight = false
        for (const b of disp.shown) {
          for (const form of b.forms) set.add(`struct:form:${form}`)
          set.add(`struct:tier:${b.tier}`)
          set.add('struct:bundle')
          const odd = disp.anomalies.has(b.id) || disp.upward.has(b.id)
          exception ||= odd
          skeleton ||= !odd
          bypass ||= b.bypass > 0
          weight ||= b.edges.length > 1
        }
        if (exception) set.add('struct:salience:exception')
        if (skeleton) set.add('struct:salience:skeleton')
        if (disp.hidden.cross > 0 || disp.cross.size) set.add('struct:fold:cross')
        if (disp.anomalies.size || disp.upward.size) set.add('struct:fold:exceptions')
        if (disp.cycleHidden.size) set.add('struct:fold:cycle')
        if (disp.direct.size || disp.hidden.reducible > 0) set.add('struct:fold:direct')
        if (bypass) set.add('struct:surface:bypass')
        if (weight) set.add('shared:width')
        if (disp.shown.length) {
          set.add('shared:dashed')
          set.add('shared:label')
        }
        // 规则叠加：只标违规——有违规束才有红晕行；逆稳定是浅色提示
        for (const b of disp.shown) {
          if (b.ruling.verdict === 'violation') {
            set.add('rule:violation')
            set.add('shared:violation')
          } else set.add('rule:allowed')
          if (b.againstStability) set.add('rule:against')
        }
        // K16 / L17 / L20①：角标行按本层节点的角标数据——「入 · 出」与色条要有度数（ca + ce > 0），「表面 W」另要有入口（W 不给），
        // 条件与画布 structureNodeMarks 同一口径（structure.ts：actor / more 不带，共用件与层不带 W）
        const metrics = inputs.facts.metrics.value
        const marked = v.nodes.filter(n => {
          if (n.role === 'actor' || n.role === 'more') return false
          const m = metrics?.get(n.moduleId)
          return !!m && m.ca + m.ce > 0
        })
        if (marked.length) {
          set.add('metric:fan')
          set.add('metric:bands')
        }
        if (marked.some(n => n.role !== 'shared' && n.role !== 'layer' && metrics?.get(n.moduleId)?.w != null)) set.add('struct:surface:w')
        if (v.nodes.some(n => n.sharedCount)) set.add('metric:shared')
      }
    } else {
      // 交互 / 回放的共享通道：违规红晕、线宽、线型、标签位（环编号在上面按 lf 统一算；回放没有 K9 → 虚线不列）
      if (restEdges.some(e => lf?.violatedEdges.has(e.id))) set.add('shared:violation')
      if (restEdges.some(e => e.relationIds.length > 1)) set.add('shared:width')
      if (restEdges.length) {
        set.add('shared:solid')
        set.add('shared:label')
      }
      if (lf?.overlays.length) set.add('shared:dashed')
    }
    if (set.has('evo:heat') || (t.coupling && evo && evo.couplings.length)) set.add('shared:evolution')
    return set
  })
}
