<script setup lang="ts">
/**
 * 属性栏的一张卡片（PC-1、PC-2，ADR-0053）：卡头单击收起 / 展开，收起时也给结论（summary）；
 * open 是缺省展开态（核对卡由「有没有 ⚠ 行」推出，代码事实晚到时随之更新），用户单击卡头后以用户的为准；
 * 换选中时面板整体重建，展开态不跨选中保持（V15）。注入 panelUnfold 为真时（单测）全部展开。
 * 卡头「小号粗标题 ▾」、结论靠右，没有底色与分隔线（CD-5）；卡片外观与间距由属性列统一给（CD-1、CD-2，Panel）。
 */
import { computed, inject, ref, watch, type Ref } from 'vue'
import { RUN_FIRST } from './related'

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
/** V6：运行视角下理解卡的首节是运行信息（由分派注入） */
const runFirst = inject(RUN_FIRST, null)
const run = computed(() => (props.kind === 'understand' ? (runFirst?.value ?? null) : null))
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
        <span class="card-title">{{ title }}</span>
        <span class="caret">{{ isOpen ? '▾' : '▸' }}</span>
        <span v-if="summary && !(closedSummary && isOpen)" class="card-sum" :class="{ warn }">{{ summary }}</span>
      </button>
    </h3>
    <div v-if="isOpen" class="card-body">
      <component :is="run" v-if="run" class="run-first" />
      <slot />
    </div>
  </section>
</template>

<style scoped>
.card-head {
  margin: 0;
}

.card-toggle {
  display: flex;
  align-items: baseline;
  gap: 5px;
  width: 100%;
  padding: 6px 13px 1px;
  font: inherit;
  font-size: 12.5px;
  color: var(--text-2);
  text-align: left;
  background: none;
  border: 0;
  border-radius: var(--card-radius) var(--card-radius) 0 0;
  cursor: pointer;
}

.card.closed .card-toggle {
  padding-bottom: 6px;
  border-radius: var(--card-radius);
}

.card-title {
  flex: none;
  font-weight: 600;
}

.caret {
  flex: none;
  font-size: 11px;
  color: var(--text-3);
}

.card-sum {
  margin-left: auto;
  min-width: 0;
  overflow: hidden;
  font-size: 12px;
  color: var(--text-3);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.card-sum.warn {
  color: var(--warning);
}

/* 卡内正文行高 1.5（原型 1.55）：卡片版式多了身份卡一行与卡间距，首屏守（L46）靠行高收回 */
.card-body {
  padding: 0 13px 10px;
  line-height: 1.5;
}

.run-first {
  margin: 0 -13px 6px;
}
</style>
