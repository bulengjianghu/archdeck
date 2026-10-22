<script setup lang="ts">
/** 面板的一节；fold 时缺省折叠，单击标题展开（次要信息，§4.3 面板信息顺序） */
import { ref } from 'vue'

const props = defineProps<{ title: string; count?: number; fold?: boolean }>()
const open = ref(!props.fold)
</script>

<template>
  <section class="section" :class="{ folded: fold && !open }">
    <h3 v-if="!fold">
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
