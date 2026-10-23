<script setup lang="ts">
/**
 * 导航树（W-7、T1）：左侧固定栏，「模块」「文件」「步骤」「问题」四个页签。步骤页签只在运行视角出现；
 * 进入运行视角切到步骤页签，退出切回模块页签，选中文件切到文件页签；画布的问题角标切到问题页签（W-6）。
 * 页签只属于这块界面，不进视图状态与 URL。
 */
import { computed, watch } from 'vue'
import { useDesk } from '@/state/inject'
import { useNavTab } from '../shared/navTab'
import ModuleTree from './ModuleTree.vue'
import StepTree from './StepTree.vue'
import FileTree from './FileTree.vue'
import IssueList from './IssueList.vue'
import SketchTree from '../sketch/SketchTree.vue'

const desk = useDesk()
const tab = useNavTab(desk.files.selected.value ? 'files' : desk.perspective.value === 'run' ? 'steps' : 'modules')
/** 问题页签的计数：错误与提醒（提示不计） */
const issueCount = computed(() => (desk.rework.value ? desk.rework.value.counts.error + desk.rework.value.counts.warning : 0))
watch(
  () => desk.perspective.value,
  p => (tab.value = p === 'run' ? 'steps' : 'modules'),
)
watch(
  () => desk.files.selected.value,
  f => f && (tab.value = 'files'),
)
</script>

<template>
  <nav class="nav-tree">
    <header class="tabs" role="tablist">
      <button role="tab" :class="{ on: tab === 'modules' }" :aria-selected="tab === 'modules'" @click="tab = 'modules'">模块</button>
      <button role="tab" :class="{ on: tab === 'files' }" :aria-selected="tab === 'files'" @click="tab = 'files'">文件</button>
      <button v-if="desk.perspective.value === 'run'" role="tab" :class="{ on: tab === 'steps' }" :aria-selected="tab === 'steps'" @click="tab = 'steps'">
        步骤
      </button>
      <button role="tab" class="issues-tab" :class="{ on: tab === 'issues' }" :aria-selected="tab === 'issues'" @click="tab = 'issues'">
        问题<span v-if="issueCount" class="count" :class="{ bad: desk.rework.value?.counts.error }">{{ issueCount }}</span>
      </button>
    </header>
    <div class="body">
      <IssueList v-if="tab === 'issues'" />
      <StepTree v-else-if="tab === 'steps' && desk.perspective.value === 'run'" />
      <FileTree v-else-if="tab === 'files'" />
      <SketchTree v-else-if="desk.edit.active.value" />
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

.count {
  margin-left: 4px;
  padding: 0 5px;
  border-radius: 8px;
  font-size: 11px;
  background: var(--warning-soft);
  color: var(--warning);
}

.count.bad {
  background: var(--danger-soft);
  color: var(--danger);
}

.body {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: 6px 0 12px;
  font-size: 12.5px;
}
</style>
