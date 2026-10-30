<script setup lang="ts">
/**
 * 耦合线的面板（J7；V15、PC-10，ADR-0053）：头部（两端、时间耦合与同提交徽标）之下——
 * 理解：耦合（同提交、占比、有无依赖 / 关系；历史刷新或层次变化后本层已没有这对耦合时为空态说明）；核对：共同的提交（折叠带计数）。
 */
import { computed } from 'vue'
import { useDesk } from '@/state/inject'
import { moduleName } from '@/model'
import Section from './Section.vue'
import CommitList from './CommitList.vue'
import PanelCard from './PanelCard.vue'
import CheckCard from './CheckCard.vue'

const desk = useDesk()
const sel = computed(() => desk.evolution.selectedCouple.value)
const name = (id: string) => (desk.index.value ? moduleName(desk.index.value, id) : id)
const pct = (r: number) => `${Math.round(r * 100)}%`
const c = computed(() => sel.value?.coupling ?? null)
</script>

<template>
  <div class="couple-panel">
    <header class="head" data-sec="head">
      <h2 v-if="sel">
        <button class="link" @click="desk.revealModule(sel.a)">{{ name(sel.a) }}</button> ~
        <button class="link" @click="desk.revealModule(sel.b)">{{ name(sel.b) }}</button>
      </h2>
      <div class="badges">
        <span class="badge">时间耦合</span>
        <span v-if="c" class="badge">同提交 ×{{ c.shared }}</span>
        <span v-if="c && !c.dependency && !c.relation" class="badge warn" title="两端之间没有模块依赖也没有描述关系：代码事实看不见的耦合">无依赖无关系</span>
      </div>
    </header>
    <Section v-if="!sel || !c" title="说明" data-sec="purpose">
      <p class="muted">这对模块现在不是时间耦合（历史已刷新，或阈值已变化）。</p>
    </Section>
    <template v-else>
      <PanelCard kind="understand" title="理解" :summary="`同提交 ×${c.shared}`">
        <Section title="耦合" data-sec="boundary.coupling">
          <dl class="kv">
            <dt>同提交</dt>
            <dd>{{ c.shared }} 次（近 {{ desk.evolution.stats.value?.days }} 天）</dd>
            <dt>占比</dt>
            <dd>{{ name(c.a) }} 的 {{ pct(c.ratioA) }} · {{ name(c.b) }} 的 {{ pct(c.ratioB) }}</dd>
            <dt>模块依赖</dt>
            <dd :class="c.dependency ? '' : 'muted'">{{ c.dependency ? '有（任一方向）' : '无' }}</dd>
            <dt>描述关系</dt>
            <dd :class="c.relation ? '' : 'muted'">{{ c.relation ? '有（任一方向）' : '无' }}</dd>
            <dt v-if="!sel.line">本层</dt>
            <dd v-if="!sel.line" class="muted">这对模块在当前层次没有耦合线（两端投到同一节点，或时间耦合未开启）</dd>
          </dl>
          <p v-if="!c.dependency && !c.relation" class="hint muted">
            两端总是一起改，代码里却没有依赖、描述里也没有关系：检查是否存在未描述的运行时关系（事件、注入、约定），或是否应合并 / 拆分。
          </p>
        </Section>
      </PanelCard>
      <CheckCard :rows="[]" :empty="`共同的提交 ${c.commits.length}`">
        <Section title="共同的提交" :count="c.commits.length" fold data-sec="evidence.commits">
          <CommitList :hashes="c.commits" :limit="10" />
        </Section>
      </CheckCard>
    </template>
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

.hint {
  margin: 8px 0 0;
  font-size: 12px;
}
</style>
