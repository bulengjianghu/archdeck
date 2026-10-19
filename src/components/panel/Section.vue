<script setup lang="ts">
defineProps<{ title: string; count?: number }>()
</script>

<template>
  <section class="section">
    <h3>
      {{ title }}<span v-if="count !== undefined" class="count">{{ count }}</span>
    </h3>
    <slot />
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

.count {
  margin-left: 6px;
  font-weight: 500;
}
</style>
