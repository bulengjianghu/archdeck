<script setup lang="ts">
/**
 * 系统面板（V15、PC-10，ADR-0053；第十八轮走查修订 ADR-0059）：头部（ID / 系统）之下——
 * 理解：简介（定位一句 + 核心原则一句）、分层或顶层模块（每个一句话）；
 * 核对：三行结论——证实（未证实 + 未解释，与模块同口径）、治理（违规新增在前、存量在后、模块环；端口孤立、共用件、可收紧基线为条目）、
 * 确认（系统的确认状态 · 核心模块已确认 N / M）；条目只写信号与数字，口径进悬停（PC-7）。清单全部折叠带计数、为 0 不出现（V15c）、按严重度排：
 * 违规、模块环、端口与查询副作用、共用件、未证实的关系、未解释的交互（GovernanceSection）、意图、演化、规模与来源（含代码事实的库存数：
 * 文件依赖、模块依赖、端口、子类、组装、外部依赖——这些不是健康度，PC-13 准入三问）、拦截记录、自上次确认以来的改动、确认。
 * G22 的源码落后提醒是页面级胶囊，不进面板。
 */
import { computed, ref } from 'vue'
import { useDesk } from '@/state/inject'
import Markdown from './Markdown.vue'
import Section from './Section.vue'
import DesignSection from './DesignSection.vue'
import CommitSection from './CommitSection.vue'
import GovernanceSection from './GovernanceSection.vue'
import EvolutionSection from './EvolutionSection.vue'
import IntentSection from './IntentSection.vue'
import ReviewSection from './ReviewSection.vue'
import PanelCard from './PanelCard.vue'
import CheckCard from './CheckCard.vue'
import { summaryOf } from '@/model'
import { usePanelJump, type PanelNotice } from './panelNotices'
import { rowsFromNotices, type CheckRow } from './panelCheck'

const desk = useDesk()
const idx = computed(() => desk.index.value!)
const sys = computed(() => idx.value.model.system)
const top = computed(() => (idx.value.childrenOf.get(idx.value.rootId) ?? []).map(id => idx.value.modules.get(id)!))
const layered = computed(() => desk.view.value?.mode === 'layered')

// ── 核对卡（PC-10）：三行结论，条目按严重度 ──
const root = ref<HTMLElement | null>(null)
usePanelJump(root)
const f = desk.facts
const review = computed(() => desk.review.of(sys.value.id))
/** Z5：核心模块的确认计数，与项目卡片同一口径 */
const rc = computed(() => desk.review.counts.value)
const r = computed(() => f.report.value)
/** 没有代码事实的原因（K8）；加载中的措辞与模块核对卡同文（ModuleCheck），E2E 以它为代码事实就绪的屏障 */
const REASON: Record<string, string> = { design: '设计版本与历史提交不对应当前代码，没有代码事实（K8）', loading: '代码事实读取中' }
const noFacts = computed(() => (f.error.value ? `没有代码事实：${f.error.value}` : (REASON[f.status.value] ?? '没有代码事实')))

const liveCycles = computed(() => (r.value?.moduleCycles ?? []).filter(c => !c.tolerated).length)
const liveFileCycles = computed(() => (r.value?.fileCycles ?? []).filter(c => !c.tolerated).length)
/** 计入门禁的违规（不含已豁免）；有基线时新增是决定下一步的数 */
const counted = computed(() => (r.value?.violations ?? []).filter(v => v.status !== 'allowed').length)
const newCount = computed(() => (r.value?.baseline ? r.value.gate.newViolations : counted.value))
const confirm = computed(() => {
  const list = [...(r.value?.relations.values() ?? [])].filter(c => c.status !== 'skipped')
  return { total: list.length, unconfirmed: list.filter(c => c.status === 'unconfirmed').length }
})
const portProblems = computed(() => f.portProblems.value)
const noImplementer = computed(() => portProblems.value.filter(i => i.code === 'port.no-implementer').length)
const noUser = computed(() => portProblems.value.filter(i => i.code === 'port.no-user').length)
const sideEffects = computed(() => desk.issues.value.filter(i => i.code === 'query.side-effect').length)
const unclassified = computed(() => f.unclassified.value)
const shared = computed(() => desk.evolution.shared.value)
const suggestions = computed(() => r.value?.sharedSuggestions.length ?? 0)

/** 审核轮 2 B1：③ 的计数是治理信号（声明的规则对代码事实，含基线内的已知），不是门禁红——口径进悬停，不占行 */
const violationNote = computed(() => {
  const x = r.value
  if (!x) return ''
  const allowed = x.violations.length - counted.value
  return `声明的架构规则对代码事实的违规（U2–U6）：计入门禁 ${counted.value} 条（新增 ${x.gate.newViolations} · 已知 ${x.gate.knownViolations}）${allowed ? `，已豁免 ${allowed}` : ''}；门禁卡的是基线外的新增（U8），返工清单的 info 级提示（K24 层符合性）不在此计数`
})
/** 治理行的悬停：口径、基线、环度（Q10：绝对值与趋势进悬停） */
const govTitle = computed(() => {
  const x = r.value
  if (!x) return undefined
  const b = x.baseline
  const baseline = b
    ? `基线 ${b.createdAt.slice(0, 10)}${b.commit ? ` ${b.commit.slice(0, 8)}` : ''}：${b.violations.length} 条${x.gate.resolved ? `，已消除 ${x.gate.resolved} 条、可收紧（npm run arch -- baseline，由人执行）` : ''}`
    : '无基线：暂不卡门禁（U8）；npm run arch -- baseline 生成，由人执行'
  const cyc = `环度：模块 ${x.cyclicity.modules} · 文件 ${x.cyclicity.files}${b ? `（基线 ${b.cyclicity.modules} · ${b.cyclicity.files}）` : ''}；文件环 ${liveFileCycles.value} 个`
  return [violationNote.value, baseline, cyc].join('\n')
})

const notices = computed<PanelNotice[]>(() => {
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
  if (shared.value?.reverse) out.push({ key: 'sharedReverse', label: '共用件反向依赖', count: shared.value.reverse, target: 'governance.shared', to: '共用件' })
  if (x.undescribed.length)
    out.push({ key: 'undescribed', label: '未解释的交互', count: x.undescribed.length, target: 'governance.undescribed', to: '未解释的交互' })
  if (confirm.value.unconfirmed)
    out.push({ key: 'unconfirmed', label: '未证实', count: confirm.value.unconfirmed, target: 'verify.unconfirmed', to: '未证实的关系' })
  if (noImplementer.value)
    out.push({ key: 'ports', label: '端口无实现者', count: noImplementer.value, target: 'governance.ports', to: '端口', note: '声明了端口却没有实现者（U14）' })
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

const verifyOk = computed(() => (confirm.value.total ? `${confirm.value.total} 条关系全部被代码证实` : '没有可证实的关系'))
const verifyText = computed(() => {
  const parts: string[] = []
  if (confirm.value.unconfirmed) parts.push(`${confirm.value.total} 条关系中 ${confirm.value.unconfirmed} 条未证实`)
  if (r.value?.undescribed.length) parts.push(`${r.value.undescribed.length} 处未解释的交互`)
  return parts.length ? parts.join(' · ') : verifyOk.value
})
const govText = computed(() => {
  const x = r.value
  if (!x) return ''
  const v = x.baseline ? `违规 新增 ${x.gate.newViolations} · 存量 ${counted.value}` : `违规 ${counted.value}（无基线）`
  return `${v} · 模块环 ${liveCycles.value}`
})
/** 确认行：系统自己的确认状态（徽标）· 核心模块的确认覆盖（Z5）；需复核为提示级 */
const reviewRow = computed<CheckRow>(() => {
  const st = review.value
  const core = `核心模块已确认 ${rc.value.reviewed} / ${rc.value.scope}${rc.value.stale ? ` · 需复核 ${rc.value.stale}` : ''}`
  const staleItem = rc.value.stale ? [{ text: `核心模块需复核 ${rc.value.stale}`, hint: true, title: '确认后描述改了的核心模块；在各模块的核对卡里复核' }] : []
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
const rows = computed<CheckRow[]>(() => [
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
])
const brief = (m: { summary?: string; responsibility?: string; abstraction?: string }) => summaryOf(m)?.text ?? m.abstraction ?? ''

// ── 规模与来源：描述的规模 + 代码事实的库存数（不是健康度，PC-13） ──
const portCount = computed(() => [...(desk.index.value?.interfaces.keys() ?? [])].filter(id => f.portOf(id)?.isPort).length)
const externals = computed(() =>
  Object.entries(r.value?.external ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8),
)
const fileDepsTitle = computed(() => {
  const x = r.value
  if (!x) return ''
  return [x.skipped ? `一端未归属或已忽略 ${x.skipped} 条不计` : '', x.conflicted.length ? `因归属冲突未计入 ${x.conflicted.length} 条` : '']
    .filter(Boolean)
    .join('；')
})
const ledger = computed(() => f.ledger.value)
</script>

<template>
  <div ref="root" class="system-panel">
    <DesignSection v-if="desk.versions.design.value && (desk.versions.revision.value || desk.versions.sketch)" />
    <CommitSection v-else-if="desk.versions.commit.value" />
    <!-- ① 头部 -->
    <header class="head id-card" :class="{ 'after-design': !!desk.versions.design.value || !!desk.versions.commit.value }" data-sec="head">
      <h2>{{ sys.name }}</h2>
      <div class="badges">
        <code>{{ sys.id }}</code>
        <span class="badge">系统</span>
      </div>
    </header>
    <PanelCard kind="understand" title="理解" closed-summary>
      <Section title="简介" data-sec="purpose">
        <Markdown v-if="sys.description" :text="sys.description" />
        <p v-else class="muted">未填写（system.description：定位一句、核心原则一句）</p>
      </Section>
      <Section :title="layered ? '分层' : '顶层模块'" :count="top.length" data-sec="boundary.top">
        <ul class="plain">
          <li v-for="m in top" :key="m.id" class="top">
            <button class="link" @click="desk.select({ kind: 'module', id: m.id })">{{ m.name }}</button>
            <span class="muted">{{ brief(m) }}</span>
          </li>
        </ul>
      </Section>
    </PanelCard>
    <CheckCard :rows="rows">
      <template #row-review="{ row }">
        <ReviewSection :id="sys.id" part="badge" /><span> · {{ row.text }}</span>
      </template>
      <GovernanceSection />
      <IntentSection />
      <EvolutionSection fold />
      <Section title="规模与来源" fold data-sec="scale">
        <dl v-if="sys.source" class="kv">
          <template v-if="sys.source.repo"
            ><dt>仓库</dt>
            <dd>{{ sys.source.repo }}</dd></template
          >
          <template v-if="sys.source.commit"
            ><dt>提交</dt>
            <dd>
              <code>{{ sys.source.commit }}</code>
            </dd></template
          >
          <template v-if="sys.source.generatedAt"
            ><dt>生成时间</dt>
            <dd>{{ sys.source.generatedAt }}</dd></template
          >
        </dl>
        <p v-else class="muted">未记录（system.source）</p>
        <div class="sub">描述</div>
        <dl class="kv">
          <dt>{{ layered ? '层' : '顶层模块' }}</dt>
          <dd>{{ top.length }}</dd>
          <dt>模块</dt>
          <dd>{{ idx.modules.size }}</dd>
          <dt>关系</dt>
          <dd>{{ idx.relations.size }}</dd>
          <dt>接口</dt>
          <dd>{{ idx.interfaces.size }}</dd>
          <dt>数据结构</dt>
          <dd>{{ idx.dataStructures.size }}</dd>
        </dl>
        <template v-if="r">
          <div class="sub">代码事实</div>
          <dl class="kv" data-testid="facts-scale">
            <dt>文件依赖</dt>
            <dd :title="fileDepsTitle">{{ r.fileDeps }}</dd>
            <dt>模块依赖</dt>
            <dd>{{ r.moduleDeps.size }}</dd>
            <dt>端口</dt>
            <dd data-testid="port-health" title="端口：被 via: port: 引用、或有实现者的接口（K11）">{{ portCount }}</dd>
            <dt>子类</dt>
            <dd>{{ r.subclasses.length }}</dd>
            <dt>组装</dt>
            <dd title="子类与组装是代码事实，不是关系（K12、K13）">
              {{ r.assembly.length }}<span class="muted">（组装根 {{ r.assemblyRoots.length }}）</span>
            </dd>
            <template v-if="externals.length">
              <dt>外部依赖</dt>
              <dd class="ext" title="按导入次数，列前 8">
                <span v-for="[pkg, n] in externals" :key="pkg">{{ pkg }} {{ n }}</span>
              </dd>
            </template>
          </dl>
        </template>
      </Section>
      <Section v-if="ledger && (ledger.checks || ledger.rescans)" title="拦截记录（agent 接口）" :count="ledger.checks" fold data-sec="ledger">
        <dl class="kv">
          <dt>写前判定</dt>
          <dd>
            {{ ledger.checks }} 次：拒绝 {{ ledger.byVerdict.denied }} · 允许 {{ ledger.byVerdict.allowed }} · 无约束 {{ ledger.byVerdict.unconstrained }}
          </dd>
          <dt>按规则拒绝</dt>
          <dd>
            层 {{ ledger.deniedByRule.layer }} · 白名单 {{ ledger.deniedByRule.deps }} · 访问面 {{ ledger.deniedByRule.exposes }}；会成环
            {{ ledger.cycleFlags }}
          </dd>
          <template v-if="ledger.first && ledger.last">
            <dt>重新扫描</dt>
            <dd>
              {{ ledger.rescans }} 次：违规 {{ ledger.first.violations }} → {{ ledger.last.violations }}，模块环度 {{ ledger.first.cyclicity.modules }} →
              {{ ledger.last.cyclicity.modules }}
            </dd>
          </template>
        </dl>
      </Section>
      <div data-sec="review.diff">
        <ReviewSection :id="sys.id" part="diff" fold />
      </div>
      <ReviewSection :id="sys.id" part="confirm" fold />
    </CheckCard>
    <footer class="src muted">描述目录：{{ desk.modelDir.value }}</footer>
  </div>
</template>

<style scoped>
.kv {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 2px 14px;
  margin: 0;
  font-size: 13px;
}

.kv dt {
  color: var(--text-3);
}

.kv dd {
  margin: 0;
}

.sub {
  margin: 8px 0 2px;
  font-size: 12px;
  color: var(--text-3);
}

.ext {
  display: flex;
  flex-wrap: wrap;
  gap: 2px 10px;
  font-size: 12px;
}

.top {
  display: flex;
  flex-direction: column;
  padding: 3px 0;
}

.top .muted {
  font-size: 12px;
}
</style>

<style scoped>
.head.after-design {
  border-top: 6px solid var(--surface-2);
}
</style>
