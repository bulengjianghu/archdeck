<script setup lang="ts">
import { computed } from 'vue'
import { useDesk } from '@/state/inject'
import Markdown from './Markdown.vue'
import Section from './Section.vue'
import DesignSection from './DesignSection.vue'
import CommitSection from './CommitSection.vue'
import GovernanceSection from './GovernanceSection.vue'
import EvolutionSection from './EvolutionSection.vue'
import IntentSection from './IntentSection.vue'
import ReviewSection from './ReviewSection.vue'

const desk = useDesk()
const idx = computed(() => desk.index.value!)
const sys = computed(() => idx.value.model.system)
const top = computed(() => (idx.value.childrenOf.get(idx.value.rootId) ?? []).map(id => idx.value.modules.get(id)!))
const layered = computed(() => desk.view.value?.mode === 'layered')
</script>

<template>
  <div class="system-panel">
    <DesignSection v-if="desk.versions.design.value && (desk.versions.revision.value || desk.versions.sketch)" />
    <CommitSection v-else-if="desk.versions.commit.value" />
    <header class="head" :class="{ 'after-design': !!desk.versions.design.value || !!desk.versions.commit.value }">
      <h2>{{ sys.name }}</h2>
      <div class="badges">
        <code>{{ sys.id }}</code>
        <span class="badge">系统</span>
        <ReviewSection :id="sys.id" part="badge" />
      </div>
    </header>
    <!-- 先答做什么（ADR-0042）：简介置顶——定位一句 + 核心原则一句；系统也能确认（Z7） -->
    <Section title="简介">
      <Markdown v-if="sys.description" :text="sys.description" />
      <p v-else class="muted">未填写（system.description：定位一句、核心原则一句）</p>
    </Section>
    <ReviewSection :id="sys.id" part="diff" />
    <ReviewSection :id="sys.id" part="confirm" />
    <GovernanceSection part="summary" />
    <IntentSection />
    <Section :title="layered ? '分层' : '顶层模块'" :count="top.length">
      <ul class="plain">
        <li v-for="m in top" :key="m.id" class="top">
          <button class="link" @click="desk.select({ kind: 'module', id: m.id })">{{ m.name }}</button>
          <span class="muted">{{ m.abstraction ?? m.responsibility }}</span>
        </li>
      </ul>
    </Section>
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
    <GovernanceSection part="detail" />
    <EvolutionSection />
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
