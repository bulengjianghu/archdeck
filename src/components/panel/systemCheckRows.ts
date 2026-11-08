/**
 * 系统的核对行（PC-10）：证实、治理两行（条目按严重度）与确认一行。从系统面板抽出，系统面板与「核对」标签名（LY-9b）共用。
 */
import type { DeskState } from '@/state/useDeskState'
import { rowsFromNotices, type CheckRow } from './panelCheck'
import type { PanelNotice } from './panelNotices'

/** 惰性求值一次（函数体内的派生互相引用，写法同 computed） */
const lazy = <T>(fn: () => T): { readonly value: T } => {
  let done = false
  let v: T
  return {
    get value() {
      if (!done) {
        v = fn()
        done = true
      }
      return v
    },
  }
}

/** 系统自己的确认 · 核心模块的确认覆盖（Z5） */
export function systemCheckRowsOf(desk: DeskState): CheckRow[] {
  const f = desk.facts
  const review = lazy(() => desk.review.of(desk.index.value!.model.system.id))
  /** Z5：核心模块的确认计数，与项目卡片同一口径 */
  const rc = lazy(() => desk.review.counts.value)
  const r = lazy(() => f.report.value)
  /** 没有代码事实的原因（K8）；加载中的措辞与模块核对卡同文（ModuleCheck），E2E 以它为代码事实就绪的屏障 */
  const REASON: Record<string, string> = { design: '设计版本与历史提交不对应当前代码，没有代码事实（K8）', loading: '代码事实读取中' }
  const noFacts = lazy(() => (f.error.value ? `没有代码事实：${f.error.value}` : (REASON[f.status.value] ?? '没有代码事实')))

  const liveCycles = lazy(() => (r.value?.moduleCycles ?? []).filter(c => !c.tolerated).length)
  const liveFileCycles = lazy(() => (r.value?.fileCycles ?? []).filter(c => !c.tolerated).length)
  /** 计入门禁的违规（不含已豁免）；有基线时新增是决定下一步的数 */
  const counted = lazy(() => (r.value?.violations ?? []).filter(v => v.status !== 'allowed').length)
  const newCount = lazy(() => (r.value?.baseline ? r.value.gate.newViolations : counted.value))
  const confirm = lazy(() => {
    const list = [...(r.value?.relations.values() ?? [])].filter(c => c.status !== 'skipped')
    return { total: list.length, unconfirmed: list.filter(c => c.status === 'unconfirmed').length }
  })
  const portProblems = lazy(() => f.portProblems.value)
  const noImplementer = lazy(() => portProblems.value.filter(i => i.code === 'port.no-implementer').length)
  const noUser = lazy(() => portProblems.value.filter(i => i.code === 'port.no-user').length)
  const sideEffects = lazy(() => desk.issues.value.filter(i => i.code === 'query.side-effect').length)
  const unclassified = lazy(() => f.unclassified.value)
  const shared = lazy(() => desk.evolution.shared.value)
  const suggestions = lazy(() => r.value?.sharedSuggestions.length ?? 0)

  /** 审核轮 2 B1：③ 的计数是治理信号（声明的规则对代码事实，含基线内的已知），不是门禁红——口径进悬停，不占行 */
  const violationNote = lazy(() => {
    const x = r.value
    if (!x) return ''
    const allowed = x.violations.length - counted.value
    return `声明的架构规则对代码事实的违规（U2–U6）：计入门禁 ${counted.value} 条（新增 ${x.gate.newViolations} · 已知 ${x.gate.knownViolations}）${allowed ? `，已豁免 ${allowed}` : ''}；门禁卡的是基线外的新增（U8），返工清单的 info 级提示（K24 层符合性）不在此计数`
  })
  /** 治理行的悬停：口径、基线、环度（Q10：绝对值与趋势进悬停） */
  const govTitle = lazy(() => {
    const x = r.value
    if (!x) return undefined
    const b = x.baseline
    const baseline = b
      ? `基线 ${b.createdAt.slice(0, 10)}${b.commit ? ` ${b.commit.slice(0, 8)}` : ''}：${b.violations.length} 条${x.gate.resolved ? `，已消除 ${x.gate.resolved} 条、可收紧（npm run arch -- baseline，由人执行）` : ''}`
      : '无基线：暂不卡门禁（U8）；npm run arch -- baseline 生成，由人执行'
    const cyc = `环度：模块 ${x.cyclicity.modules} · 文件 ${x.cyclicity.files}${b ? `（基线 ${b.cyclicity.modules} · ${b.cyclicity.files}）` : ''}；文件环 ${liveFileCycles.value} 个`
    return [violationNote.value, baseline, cyc].join('\n')
  })

  const notices = lazy<PanelNotice[]>(() => {
    const x = r.value
    if (!x) return []
    const out: PanelNotice[] = []
    if (newCount.value)
      out.push({
        key: 'violations',
        label: x.baseline ? '新增违规' : '违规',
        count: newCount.value,
        target: 'governance.violations',
        to: '违规',
        note: violationNote.value,
      })
    else if (counted.value)
      out.push({
        key: 'violations',
        label: '存量违规',
        count: counted.value,
        target: 'governance.violations',
        to: '违规',
        hint: true,
        note: `基线内的已知违规（治理信号，不卡门禁，审核轮 2 B1）；${violationNote.value}`,
      })
    if (liveCycles.value) out.push({ key: 'cycles', label: '模块环', count: liveCycles.value, target: 'governance.cycles', to: '模块环' })
    if (shared.value?.reverse)
      out.push({ key: 'sharedReverse', label: '共用件反向依赖', count: shared.value.reverse, target: 'governance.shared', to: '共用件' })
    if (x.undescribed.length)
      out.push({ key: 'undescribed', label: '未解释的交互', count: x.undescribed.length, target: 'governance.undescribed', to: '未解释的交互' })
    if (confirm.value.unconfirmed)
      out.push({ key: 'unconfirmed', label: '未证实', count: confirm.value.unconfirmed, target: 'verify.unconfirmed', to: '未证实的关系' })
    if (noImplementer.value)
      out.push({
        key: 'ports',
        label: '端口无实现者',
        count: noImplementer.value,
        target: 'governance.ports',
        to: '端口',
        note: '声明了端口却没有实现者（U14）',
      })
    if (noUser.value)
      out.push({
        key: 'ports',
        label: '端口无使用者',
        count: noUser.value,
        target: 'governance.ports',
        to: '端口',
        hint: true,
        note: '有实现者、系统内没有使用者：对外端口时是常态，否则确认端口是否多余（U14）',
      })
    if (unclassified.value.core)
      out.push({
        key: 'unclassified',
        label: '核心之间未分类',
        count: unclassified.value.core,
        target: '',
        to: '',
        hint: true,
        note: `迁移期的 calls 关系（M17）共 ${unclassified.value.all} 条，核心模块之间的 ${unclassified.value.core} 条要先按三问定类型`,
      })
    if (sideEffects.value)
      out.push({
        key: 'sideEffects',
        label: '查询副作用',
        count: sideEffects.value,
        target: 'governance.ports',
        to: '查询副作用',
        hint: true,
        note: '查询的场景闭包里有委托或通知（U13）',
      })
    if (suggestions.value)
      out.push({
        key: 'sharedOver',
        label: '疑似共用件',
        count: suggestions.value,
        target: 'governance.shared',
        to: '共用件',
        hint: true,
        note: '入度广、没有运行时出边、不在场景路径上、名字像工具模块（U11），认可后收进共用件架',
      })
    if (shared.value?.over)
      out.push({
        key: 'sharedOver',
        label: '共用件体量超阈值',
        count: 1,
        target: 'governance.shared',
        to: '共用件',
        hint: true,
        text: '共用件体量超阈值',
        note: `行数占比阈值 ${Math.round(shared.value.limits.lines * 100)}%、修改占比阈值 ${Math.round(shared.value.limits.changes * 100)}%（Q13）`,
      })
    if (x.baseline && x.gate.resolved)
      out.push({
        key: 'baselineSlack',
        label: '已消除',
        count: x.gate.resolved,
        target: 'governance.violations',
        to: '违规',
        hint: true,
        text: `已消除 ${x.gate.resolved} 条，可收紧基线`,
        note: '基线里已不存在的违规条数；收紧基线由人执行 npm run arch -- baseline（U7）',
      })
    return out
  })

  const verifyOk = lazy(() => (confirm.value.total ? `${confirm.value.total} 条关系全部被代码证实` : '没有可证实的关系'))
  const verifyText = lazy(() => {
    const parts: string[] = []
    if (confirm.value.unconfirmed) parts.push(`${confirm.value.total} 条关系中 ${confirm.value.unconfirmed} 条未证实`)
    if (r.value?.undescribed.length) parts.push(`${r.value.undescribed.length} 处未解释的交互`)
    return parts.length ? parts.join(' · ') : verifyOk.value
  })
  const govText = lazy(() => {
    const x = r.value
    if (!x) return ''
    const v = x.baseline ? `违规 新增 ${x.gate.newViolations} · 存量 ${counted.value}` : `违规 ${counted.value}（无基线）`
    return `${v} · 模块环 ${liveCycles.value}`
  })
  /** 确认行：系统自己的确认状态（徽标）· 核心模块的确认覆盖（Z5）；需复核为提示级 */
  const reviewRow = lazy<CheckRow>(() => {
    const st = review.value
    const core = `核心模块已确认 ${rc.value.reviewed} / ${rc.value.scope}${rc.value.stale ? ` · 需复核 ${rc.value.stale}` : ''}`
    const staleItem = rc.value.stale
      ? [{ text: `核心模块需复核 ${rc.value.stale}`, hint: true, title: '确认后描述改了的核心模块；在各模块的核对卡里复核' }]
      : []
    if (st.status === 'stale') {
      const n = st.diff?.count || 1
      return {
        key: 'review',
        label: '确认',
        state: 'bad',
        text: `${n} 处改动 · ${core}`,
        items: [{ text: `自上次确认以来 ${n} 处改动`, target: 'review.diff' }, ...staleItem],
      }
    }
    return { key: 'review', label: '确认', state: rc.value.stale ? 'hint' : st.status === 'reviewed' ? 'ok' : 'none', text: core, items: staleItem }
  })
  return [
    ...rowsFromNotices(notices.value, [
      {
        key: 'verify',
        label: '证实',
        notices: ['unconfirmed', 'undescribed', 'unclassified'],
        text: verifyText.value,
        ...(r.value ? { ok: verifyOk.value } : { none: noFacts.value }),
      },
      {
        key: 'governance',
        label: '治理',
        notices: ['violations', 'cycles', 'sharedReverse', 'ports', 'sideEffects', 'sharedOver', 'baselineSlack'],
        text: govText.value,
        title: govTitle.value,
        ...(r.value ? { ok: govText.value } : { none: noFacts.value }),
      },
    ]),
    reviewRow.value,
  ]
}
