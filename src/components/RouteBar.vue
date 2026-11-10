<script setup lang="ts">
/**
 * 路线总览（F6f）：常驻显示路径上依次经过的分支点与所选条件，以及截止处待选的分支点；每项可下拉改选（F6e）。
 * 改选丢弃了其后的选择时，提示丢弃的个数数秒。
 */
import { onBeforeUnmount, ref } from 'vue'
import { useDesk } from '@/state/inject'

const desk = useDesk()
const notice = ref('')
let timer: ReturnType<typeof setTimeout> | undefined

function choose(pointId: string, e: Event) {
  const option = Number((e.target as HTMLSelectElement).value)
  if (!Number.isInteger(option) || option < 0) return
  const dropped = desk.chooseBranch(pointId, option)
  clearTimeout(timer)
  notice.value = dropped ? `已重置其后 ${dropped} 个分支选择` : ''
  if (dropped) timer = setTimeout(() => (notice.value = ''), 4000)
}
onBeforeUnmount(() => clearTimeout(timer))
</script>

<template>
  <div v-if="desk.run.route.value.length" class="route" role="group" aria-label="路线">
    <span class="title">路线</span>
    <label v-for="(r, i) in desk.run.route.value" :key="r.pointId" class="item" :class="{ pending: r.chosen === null }">
      <span class="no">{{ i + 1 }}</span>
      <select :value="r.chosen ?? -1" :title="r.chosen === null ? '待选：选一支后继续' : '改走另一支'" @change="choose(r.pointId, $event)">
        <option v-if="r.chosen === null" :value="-1" disabled>待选</option>
        <option v-for="(w, k) in r.when" :key="k" :value="k">{{ w }}</option>
      </select>
    </label>
    <span v-if="notice" class="notice">{{ notice }}</span>
  </div>
</template>

<style scoped>
.route {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  font-size: 12px;
}

.title {
  color: var(--text-3);
  font-weight: 600;
}

.item {
  display: flex;
  align-items: center;
  gap: 3px;
}

.no {
  font-size: 10.5px;
  font-weight: 700;
  color: var(--text-3);
}

select {
  max-width: 180px;
  font-size: 12px;
  padding: 1px 4px;
}

.pending select {
  border-color: var(--warning);
  color: var(--warning);
}

.notice {
  color: var(--warning);
}
</style>
