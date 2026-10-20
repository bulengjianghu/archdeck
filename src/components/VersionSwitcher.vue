<script setup lang="ts">
/** 版本切换：当前版本（由代码生成）或某个设计版本的某一轮（ADR-0002）。切换时保留层次与选中 */
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useDesk } from '@/state/inject'
import { DESIGN_STATUS_LABELS } from '@/model/design'

const desk = useDesk()
const route = useRoute()
const router = useRouter()

const value = computed(() => (desk.version ? `${desk.version.design}/${desk.version.revision}` : ''))

function onChange(e: Event) {
  const v = (e.target as HTMLSelectElement).value
  const project = desk.project!
  const [design, revision] = v.split('/')
  const query = route.query
  void router.push(v ? { name: 'design', params: { project, design, revision }, query } : { name: 'project', params: { project }, query })
}
</script>

<template>
  <label v-if="desk.project && desk.designs.value.length" class="version" :class="{ design: !!desk.version }">
    <span class="sr">版本</span>
    <select :value="value" aria-label="切换版本" @change="onChange">
      <option value="">当前版本（代码）</option>
      <optgroup v-for="d in desk.designs.value" :key="d.id" :label="`设计 · ${d.name}（${DESIGN_STATUS_LABELS[d.status]}）`">
        <option v-for="(r, i) in [...d.revisions].reverse()" :key="r.id" :value="`${d.id}/${r.id}`" :title="r.date">
          {{ d.name }} · {{ r.id }}{{ i === 0 ? '（最新）' : '' }}
        </option>
      </optgroup>
    </select>
  </label>
</template>

<style scoped>
.version select {
  max-width: 260px;
  font-size: 12.5px;
  padding: 3px 6px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text);
}

.version.design select {
  border-color: var(--diff-changed);
  background: var(--diff-changed-soft);
  font-weight: 600;
}

.sr {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}
</style>
