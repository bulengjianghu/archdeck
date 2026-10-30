<script setup lang="ts">
/**
 * 属性栏的一张卡片（PC-1、PC-2，ADR-0053）：卡头单击收起 / 展开，收起时也给结论（summary）；
 * open 是缺省展开态（核对卡由「有没有 ⚠ 行」推出，代码事实晚到时随之更新），用户单击卡头后以用户的为准；
 * 换选中时面板整体重建，展开态不跨选中保持（V15）。注入 panelUnfold 为真时（单测）全部展开。
 */
import { computed, inject, ref, watch, type Ref } from 'vue'

const props = withDefaults(
  defineProps<{
    kind: 'understand' | 'check' | 'related'
    title: string
    summary?: string
    warn?: boolean
    /** 缺省展开态 */
    open?: boolean
    /** 结论只在收起时显示（理解卡：展开时卡内第一行就是它，C1） */
    closedSummary?: boolean
    /** 变化即展开（定位请求） */
    force?: number
  }>(),
  { open: true, summary: undefined, force: undefined },
)
const unfold = inject<Ref<boolean> | null>('panelUnfold', null)
const user = ref<boolean | null>(null)
const isOpen = computed(() => !!unfold?.value || (user.value ?? props.open))
watch(
  () => props.force,
  v => v && (user.value = true),
)
</script>

<template>
  <section class="card" :class="[`card-${kind}`, { closed: !isOpen }]" :data-card="kind">
    <h3 class="card-head">
      <button class="card-toggle" :aria-expanded="isOpen" @click="user = !isOpen">
        <span class="caret">{{ isOpen ? '▾' : '▸' }}</span>
        <span class="card-title">{{ title }}</span>
        <span v-if="summary && !(closedSummary && isOpen)" class="card-sum" :class="{ warn }">{{ summary }}</span>
      </button>
    </h3>
    <div v-if="isOpen" class="card-body">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.card {
  margin: 6px 6px 0;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
}

.card-head {
  margin: 0;
}

.card-toggle {
  display: flex;
  align-items: baseline;
  gap: 6px;
  width: 100%;
  padding: 5px 12px;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-2);
  text-align: left;
  background: none;
  border: 0;
  cursor: pointer;
}

.caret {
  flex: none;
  width: 0.9em;
  color: var(--text-3);
}

.card-title {
  flex: none;
}

.card-sum {
  margin-left: auto;
  min-width: 0;
  overflow: hidden;
  font-weight: 400;
  font-size: 11.5px;
  color: var(--text-3);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.card-sum.warn {
  color: var(--warning);
}

.card-body {
  padding: 0 12px 10px;
}
</style>
