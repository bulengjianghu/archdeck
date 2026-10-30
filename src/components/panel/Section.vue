<script setup lang="ts">
/** 面板的一节；fold 时缺省折叠，单击标题展开（次要信息，§4.3 面板信息顺序） */
import { computed, inject, ref, watch, type Ref } from 'vue'

const props = defineProps<{ title: string; count?: number; fold?: boolean; /** 变化即展开（定位请求：画布单击表面元素等） */ force?: number }>()
/** 运行视角下「模块信息」整块折叠在外层 details（V6），⑤ 不再叠加内层折叠——外层展开即全展开（ADR-0050 实现要点、评审轮 1 B1） */
const unfold = inject<Ref<boolean> | null>('panelUnfold', null)
const folded = computed(() => !!props.fold && !unfold?.value)
const open = ref(!folded.value)
// 视角切换（运行 ⇄ 结构 / 交互）时折叠态跟随该视角的缺省，不残留上一次视角的展开
watch(folded, v => (open.value = !v))
watch(
  () => props.force,
  v => v && (open.value = true),
)
</script>

<template>
  <section class="section" :class="{ folded: folded && !open }">
    <h3 v-if="!folded">
      {{ title }}<span v-if="count !== undefined" class="count">{{ count }}</span>
    </h3>
    <h3 v-else>
      <button class="fold" :aria-expanded="open" @click="open = !open">
        <span class="caret">{{ open ? '▾' : '▸' }}</span> {{ title }}<span v-if="count !== undefined" class="count">{{ count }}</span>
      </button>
    </h3>
    <slot v-if="open" />
  </section>
</template>

<style scoped>
.section {
  padding: 12px 18px;
  border-top: 1px solid var(--border);
}

h3 {
  margin: 0 0 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-3);
  letter-spacing: 0.02em;
}

.folded h3 {
  margin: 0;
}

.fold {
  border: none;
  background: none;
  padding: 0;
  font: inherit;
  color: inherit;
  cursor: pointer;
}

.caret {
  display: inline-block;
  width: 1em;
}

.count {
  margin-left: 6px;
  font-weight: 500;
}
</style>
