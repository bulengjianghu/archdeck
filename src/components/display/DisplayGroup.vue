<script setup lang="ts">
/** 「显示」面板里的一组：可折叠的组标题（右侧可放组级操作，如筛选复位、代码事实开关），展开时显示内容 */
defineProps<{ title: string; open: boolean }>()
const emit = defineEmits<{ toggle: [] }>()
</script>

<template>
  <section class="group">
    <div class="group-head">
      <button class="group-btn" :aria-expanded="open" @click="emit('toggle')">
        <span class="caret">{{ open ? '▾' : '▸' }}</span
        >{{ title }}
      </button>
      <slot name="actions" />
    </div>
    <slot v-if="open" />
  </section>
</template>

<style scoped>
.group + .group {
  margin-top: 6px;
}

.group-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 22px;
}

.group-btn {
  border: none;
  background: none;
  padding: 0;
  font: inherit;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-3);
  letter-spacing: 0.5px;
}
</style>
