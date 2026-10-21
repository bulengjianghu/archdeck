<script setup lang="ts">
/**
 * 导航树（W-7、T1）：左侧固定栏，「模块」「文件」「步骤」三个页签。步骤页签只在运行视角出现；
 * 进入运行视角切到步骤页签，退出切回模块页签，选中文件切到文件页签。页签只属于这块界面，不进视图状态与 URL。
 */
import { ref, watch } from 'vue'
import { useDesk } from '@/state/inject'
import ModuleTree from './ModuleTree.vue'
import StepTree from './StepTree.vue'
import FileTree from './FileTree.vue'

const desk = useDesk()
type Tab = 'modules' | 'files' | 'steps'
const tab = ref<Tab>(desk.selectedFile.value ? 'files' : desk.perspective.value === 'run' ? 'steps' : 'modules')
watch(
  () => desk.perspective.value,
  p => (tab.value = p === 'run' ? 'steps' : 'modules'),
)
watch(
  () => desk.selectedFile.value,
  f => f && (tab.value = 'files'),
)
</script>

<template>
  <nav class="nav-tree">
    <header class="tabs" role="tablist">
      <button role="tab" :class="{ on: tab === 'modules' }" :aria-selected="tab === 'modules'" @click="tab = 'modules'">模块</button>
      <button role="tab" :class="{ on: tab === 'files' }" :aria-selected="tab === 'files'" @click="tab = 'files'">文件</button>
      <button
        v-if="desk.perspective.value === 'run'"
        role="tab"
        :class="{ on: tab === 'steps' }"
        :aria-selected="tab === 'steps'"
        @click="tab = 'steps'"
      >
        步骤
      </button>
    </header>
    <div class="body">
      <StepTree v-if="tab === 'steps' && desk.perspective.value === 'run'" />
      <FileTree v-else-if="tab === 'files'" />
      <ModuleTree v-else />
    </div>
  </nav>
</template>

<style scoped>
.nav-tree {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--surface);
}

.tabs {
  display: flex;
  gap: 2px;
  padding: 6px 8px 0;
  border-bottom: 1px solid var(--border);
  flex: none;
}

.tabs button {
  border: none;
  border-bottom: 2px solid transparent;
  border-radius: 0;
  background: none;
  padding: 4px 10px 6px;
  font-size: 12.5px;
  color: var(--text-2);
}

.tabs button.on {
  color: var(--accent);
  border-bottom-color: var(--accent);
  font-weight: 600;
}

.body {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: 6px 0 12px;
  font-size: 12.5px;
}
</style>
