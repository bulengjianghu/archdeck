<script setup lang="ts">
import { computed } from 'vue'
import { useDesk } from '@/state/inject'
import { moduleName } from '@/model'

const desk = useDesk()
const crumbs = computed(() => {
  const idx = desk.index.value
  if (!idx) return []
  return desk.levelPath.value.map(id => ({ id, name: moduleName(idx, id) }))
})
</script>

<template>
  <nav class="crumbs" aria-label="当前层次">
    <template v-for="(c, i) in crumbs" :key="c.id">
      <span v-if="i > 0" class="sep">/</span>
      <button v-if="i < crumbs.length - 1" class="crumb" @click="desk.goTo(c.id, { kind: 'module', id: crumbs[i + 1].id })">{{ c.name }}</button>
      <span v-else class="crumb current">{{ c.name }}</span>
    </template>
  </nav>
</template>

<style scoped>
.crumbs {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  flex: 0 1 auto;
  overflow: hidden;
  white-space: nowrap;
}

.crumb {
  border: none;
  background: none;
  padding: 2px 4px;
  color: var(--accent);
  font-size: 14px;
}

.crumb:hover {
  text-decoration: underline;
}

.crumb.current {
  color: var(--text);
  font-weight: 600;
}

.sep {
  color: var(--text-3);
}
</style>
