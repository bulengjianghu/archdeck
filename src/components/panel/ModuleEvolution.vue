<script setup lang="ts">
/** 模块面板的「演化」一节（HS-4，J2–J4，J7）：修改与缺陷次数、热度、窗口；最近 10 次提交；时间耦合的对端模块及次数（标有无依赖 / 关系） */
import { computed } from 'vue'
import { useDesk } from '@/state/inject'
import { moduleName } from '@/model'
import Section from './Section.vue'
import CommitList from './CommitList.vue'

const props = defineProps<{ id: string }>()
const desk = useDesk()
const e = desk.evolution
const m = computed(() => e.moduleOf(props.id))
const stats = computed(() => e.stats.value)
const pairs = computed(() => e.couplingsFor(props.id))
const name = (id: string) => (desk.index.value ? moduleName(desk.index.value, id) : id)
const other = (c: { a: string; b: string }) => (c.a === props.id ? c.b : c.a)
const files = computed(() => new Set(desk.files.filesOf(props.id)))
</script>

<template>
  <!-- G11 V15c：⑤ 证据与细节默认折叠带计数，count（修改次数）为 0 不显示节（「没有演化事实」的原因随节隐藏） -->
  <Section v-if="m && stats && m.changes" title="演化" fold :count="m.changes">
    <dl class="kv">
      <dt>修改</dt>
      <dd>
        {{ m.changes }} 次<span class="muted">（近 {{ stats.days }} 天，热度 {{ Math.round(m.heat) }}）</span>
      </dd>
      <dt>缺陷修复</dt>
      <dd>
        {{ m.fixes }} 次<span class="muted">（热度 {{ Math.round(m.fixHeat) }}）</span>
      </dd>
      <dt>当前行数</dt>
      <dd>{{ m.lines }}</dd>
    </dl>
    <div v-if="m.commits.length" class="block">
      <h4>最近 {{ Math.min(10, m.commits.length) }} 次提交</h4>
      <CommitList :hashes="m.commits" :limit="10" :module-files="files" />
    </div>
    <div v-if="pairs.length" class="block">
      <h4>时间耦合</h4>
      <ul class="plain">
        <li v-for="c in pairs" :key="c.id">
          <button class="link" @click="desk.select({ kind: 'couple', id: c.id })">{{ name(other(c)) }}</button>
          <span class="muted"> 同提交 ×{{ c.shared }}</span>
          <span v-if="!c.dependency && !c.relation" class="tag" title="两端之间没有模块依赖也没有描述关系">无依赖无关系</span>
          <span v-else class="muted small">（{{ [c.dependency ? '有依赖' : '', c.relation ? '有关系' : ''].filter(Boolean).join('、') }}）</span>
        </li>
      </ul>
    </div>
  </Section>
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

.block {
  margin-top: 8px;
}

h4 {
  margin: 0 0 2px;
  font-size: 12px;
  font-weight: 600;
}

li {
  padding: 2px 0;
}

.tag {
  margin-left: 6px;
  font-size: 10.5px;
  padding: 0 5px;
  border-radius: 8px;
  background: var(--warning-soft);
  color: var(--warning);
}

.small {
  font-size: 11.5px;
}
</style>
