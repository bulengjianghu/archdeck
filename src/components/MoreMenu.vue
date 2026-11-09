<script setup lang="ts">
/** 「⋯ 更多」菜单（TB-5）：怎么读这张图（W-10）、快捷键（帮助的「快捷键」一节）。单击菜单外或 Esc 收起 */
import { inject, onBeforeUnmount, onMounted, ref } from 'vue'
import { OPEN_GUIDE, type GuideSection } from './shared/guide'
import ToolIcon from './shared/ToolIcon.vue'

const openGuide = inject(OPEN_GUIDE, (_section?: GuideSection) => {})
const open = ref(false)
const root = ref<HTMLElement>()
function pick(section?: 'keys') {
  open.value = false
  openGuide(section)
}
const onDoc = (e: MouseEvent) => {
  if (open.value && root.value && !root.value.contains(e.target as Node)) open.value = false
}
const onKey = (e: KeyboardEvent) => {
  if (open.value && e.key === 'Escape') {
    e.stopPropagation()
    open.value = false
  }
}
onMounted(() => {
  document.addEventListener('mousedown', onDoc)
  window.addEventListener('keydown', onKey, true)
})
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDoc)
  window.removeEventListener('keydown', onKey, true)
})
</script>

<template>
  <div ref="root" class="more">
    <button class="ib" :class="{ on: open }" title="更多：帮助、快捷键" aria-label="更多" :aria-expanded="open" aria-haspopup="true" @click="open = !open">
      <ToolIcon name="more" />
    </button>
    <section v-if="open" class="menu" role="menu" aria-label="更多">
      <button class="it" role="menuitem" @click="pick()"><span>怎么读这张图</span><span class="k">?</span></button>
      <button class="it" role="menuitem" @click="pick('keys')"><span>快捷键</span></button>
    </section>
  </div>
</template>

<style scoped>
.more {
  position: relative;
  flex: none;
}

.menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 40;
  display: flex;
  flex-direction: column;
  min-width: 180px;
  padding: 4px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 6px 24px rgb(0 0 0 / 14%);
}

.it {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  padding: 6px 10px;
  border: none;
  border-radius: 6px;
  background: none;
  text-align: left;
  font-size: 13px;
  white-space: nowrap;
}

.it:hover {
  background: var(--accent-soft);
}

.k {
  color: var(--text-3);
}
</style>
