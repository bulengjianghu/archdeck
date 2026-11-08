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
import ScopeSummary from './ScopeSummary.vue'
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
import { usePanelJump } from './panelNotices'
import { systemCheckRowsOf } from './systemCheckRows'

const desk = useDesk()
const idx = computed(() => desk.index.value!)
const sys = computed(() => idx.value.model.system)
const top = computed(() => (idx.value.childrenOf.get(idx.value.rootId) ?? []).map(id => idx.value.modules.get(id)!))
const layered = computed(() => desk.view.value?.mode === 'layered')

// ── 核对卡（PC-10）：三行结论，条目按严重度 ──
const root = ref<HTMLElement | null>(null)
usePanelJump(root)
const f = desk.facts
const r = computed(() => f.report.value)
const rows = computed(() => systemCheckRowsOf(desk))
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
      <h2 class="subject-name">{{ sys.name }}</h2>
      <div class="badges">
        <code class="subject-id">{{ sys.id }}</code>
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
            <button class="link" :data-ref-module="m.id" @click="desk.select({ kind: 'module', id: m.id })">{{ m.name }}</button>
            <span class="muted">{{ brief(m) }}</span>
          </li>
        </ul>
      </Section>
    </PanelCard>
    <!-- LY-13：主语是系统 / 层时，核对标签先给这棵子树的汇总 -->
    <ScopeSummary :roots="[sys.id]" />
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
