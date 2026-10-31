<script setup lang="ts">
/**
 * 面包屑（N7，TB-7）：画布标题行的第一项，「根层 / … / 当前层次」——以「根层」开头（悬停写系统名），项目名只在导航顶部出现一次（C1）；
 * 中间各级单击返回并选中刚离开的那一级，当前层次粗体。草图画布下不出现（草图的面包屑在信息条身份区，#15）。回项目列表在项目菜单（TB-6）。
 */
import { computed } from 'vue'
import { useDesk } from '@/state/inject'
import { moduleName } from '@/model'

const desk = useDesk()
const crumbs = computed(() => {
  const idx = desk.index.value
  if (!idx || desk.edit.active.value) return []
  return desk.levelPath.value.map((id, i) => ({
    id,
    name: i === 0 ? '根层' : moduleName(idx, id),
    title: i === 0 ? `根层：${moduleName(idx, id)}` : undefined,
  }))
})
</script>

<template>
  <nav v-if="crumbs.length" class="crumbs" aria-label="当前层次">
    <template v-for="(c, i) in crumbs" :key="c.id">
      <span v-if="i > 0" class="sep">/</span>
      <button v-if="i < crumbs.length - 1" class="crumb" :title="c.title" @click="desk.goTo(c.id, { kind: 'module', id: crumbs[i + 1].id })">
        {{ c.name }}
      </button>
      <span v-else class="crumb current" :title="c.title">{{ c.name }}</span>
    </template>
  </nav>
</template>

<style scoped>
.crumbs {
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  white-space: nowrap;
  font-size: 14px;
}

.crumb {
  border: none;
  background: none;
  padding: 1px 3px;
  color: var(--accent);
  font-size: 14px;
  white-space: nowrap;
}

.crumb:hover {
  text-decoration: underline;
}

.crumb.current {
  color: var(--text);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
}

.crumb.current:hover {
  text-decoration: none;
}

.sep {
  color: var(--text-3);
}
</style>
