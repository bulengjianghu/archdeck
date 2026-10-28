<script setup lang="ts">
/**
 * 系统面板（G11 五段骨架，ADR-0050、V15；与模块面板同一段序——「同类节跨面板同位」）：
 * ① 头部（ID / 系统 / 确认徽标）② 简介 ③ 需要注意（系统级：确认过期、违规、环、未解释的交互；G22 的源码落后提醒是页面级信息条，不进面板）
 * ④ 顶层模块 / 分层 ⑤ 生成来源与规模、意图、治理（健康度摘要与明细）、演化（改 fold，与模块层同规）、确认。
 * 健康度指标的分组裁剪与拦截记录 / 外部依赖折叠属波 2（G12），本波不动 GovernanceSection 内部。
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
import NoticeSection from './NoticeSection.vue'
import { usePanelJump, type PanelNotice } from './panelNotices'

const desk = useDesk()
const idx = computed(() => desk.index.value!)
const sys = computed(() => idx.value.model.system)
const top = computed(() => (idx.value.childrenOf.get(idx.value.rootId) ?? []).map(id => idx.value.modules.get(id)!))
const layered = computed(() => desk.view.value?.mode === 'layered')

// ── ③ 需要注意（V15b）：确认过期 + 治理类计数；全部无异常整段不出现 ──
const root = ref<HTMLElement | null>(null)
usePanelJump(root)
const review = computed(() => desk.review.of(sys.value.id))
const r = computed(() => desk.facts.report.value)
const liveCycles = computed(() => (r.value?.moduleCycles ?? []).filter(c => !c.tolerated).length)
const notices = computed<PanelNotice[]>(() => {
  const out: PanelNotice[] = []
  if (r.value) {
    if (r.value.violations.length) out.push({ key: 'violations', label: '违规', count: r.value.violations.length, target: 'governance.detail', to: '治理' })
    if (liveCycles.value) out.push({ key: 'cycles', label: '模块环', count: liveCycles.value, target: 'governance.detail', to: '治理' })
    if (r.value.undescribed.length)
      out.push({ key: 'undescribed', label: '未解释的交互', count: r.value.undescribed.length, target: 'governance.detail', to: '治理' })
  }
  if (review.value.status === 'stale')
    out.push({ key: 'stale', label: '确认过期', count: review.value.diff?.count || 1, target: 'review.diff', to: '自上次确认以来的改动' })
  return out
})
</script>

<template>
  <div ref="root" class="system-panel">
    <DesignSection v-if="desk.versions.design.value && (desk.versions.revision.value || desk.versions.sketch)" />
    <CommitSection v-else-if="desk.versions.commit.value" />
    <!-- ① 头部 -->
    <header class="head" :class="{ 'after-design': !!desk.versions.design.value || !!desk.versions.commit.value }" data-sec="head">
      <h2>{{ sys.name }}</h2>
      <div class="badges">
        <code>{{ sys.id }}</code>
        <span class="badge">系统</span>
        <ReviewSection :id="sys.id" part="badge" />
      </div>
    </header>
    <!-- ② 作用：简介置顶——定位一句 + 核心原则一句；系统也能确认（Z7） -->
    <Section title="简介" data-sec="purpose">
      <Markdown v-if="sys.description" :text="sys.description" />
      <p v-else class="muted">未填写（system.description：定位一句、核心原则一句）</p>
    </Section>
    <!-- ③ 需要注意 -->
    <NoticeSection :notices="notices" />
    <!-- ④ 边界：顶层模块 / 分层 -->
    <Section :title="layered ? '分层' : '顶层模块'" :count="top.length" data-sec="boundary.top">
      <ul class="plain">
        <li v-for="m in top" :key="m.id" class="top">
          <button class="link" @click="desk.select({ kind: 'module', id: m.id })">{{ m.name }}</button>
          <span class="muted">{{ m.abstraction ?? m.responsibility }}</span>
        </li>
      </ul>
    </Section>
    <!-- ⑤ 证据与细节：生成来源与规模、意图、治理（摘要 + 明细）、演化（fold）、确认 -->
    <Section title="生成来源与规模">
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
      <div class="sub">规模</div>
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
    </Section>
    <IntentSection />
    <GovernanceSection part="summary" />
    <div data-sec="governance.detail">
      <GovernanceSection part="detail" />
    </div>
    <EvolutionSection fold />
    <div data-sec="review.diff">
      <ReviewSection :id="sys.id" part="diff" fold />
    </div>
    <ReviewSection :id="sys.id" part="confirm" fold />
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
