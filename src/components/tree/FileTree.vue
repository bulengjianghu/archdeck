<script setup lang="ts">
/**
 * 文件树（SR-1、SR-2、G13）：被描述项目的源码目录树。
 * - 状态 → 树：选中模块时其文件高亮、所在目录标点并展开到第一个文件；选中文件时该行高亮、展开到它并滚到可见；
 *   文件标出未归属、归属冲突、已忽略。
 * - 树 → 意图：单击文件即选中（G16）；单击目录展开 / 折叠。页面只读，不提供忽略操作（ADR-0007）。
 * 展开状态与「只看未归属」只属于这块界面。
 */
import { computed, nextTick, ref, watch } from 'vue'
import { useDesk } from '@/state/inject'
import { moduleName } from '@/model'
import SourceStatus from '../source/SourceStatus.vue'
import FileTreeNode from './FileTreeNode.vue'
import type { FileTreeContext } from './types'

const desk = useDesk()
const root = ref<HTMLElement>()
const onlyUnowned = ref(false)
const onlyLong = ref(false)
const expanded = ref(new Set<string>())

const own = computed(() => desk.files.ownership.value)
const tree = computed(() => desk.files.tree.value)
const local = computed(() => (desk.files.payload.value?.status === 'local' ? desk.files.payload.value : null))
const hits = computed(() => desk.files.moduleFiles.value)
const selectedModule = computed(() => (desk.selection.value?.kind === 'module' ? desk.selection.value.id : null))

const dirsOf = (file: string) => {
  const parts = file.split('/').slice(0, -1)
  return parts.map((_, i) => parts.slice(0, i + 1).join('/'))
}
/** 含高亮文件的目录 */
const hitDirs = computed(() => new Set([...hits.value].flatMap(dirsOf)))

function expandTo(file: string | undefined) {
  if (!file) return
  const next = new Set(expanded.value)
  for (const d of dirsOf(file)) next.add(d)
  expanded.value = next
}
async function scrollTo(file: string | undefined) {
  await nextTick()
  const row = [...(root.value?.querySelectorAll<HTMLElement>('[data-path]') ?? [])].find(el => el.dataset.path === file)
  row?.scrollIntoView?.({ block: 'nearest' })
}
watch(
  () => [desk.files.selected.value, tree.value] as const,
  ([f]) => {
    if (!f) return
    expandTo(f)
    void scrollTo(f)
  },
  { immediate: true },
)
watch(
  () => [selectedModule.value, tree.value] as const,
  () => {
    const first = [...hits.value].sort()[0]
    expandTo(first)
    void scrollTo(first)
  },
  { immediate: true },
)
function toggle(path: string) {
  const next = new Set(expanded.value)
  if (!next.delete(path)) next.add(path)
  expanded.value = next
}

const ctx = computed<FileTreeContext>(() => ({
  expanded: new Set([
    ...expanded.value,
    ...(onlyUnowned.value ? (own.value?.unowned ?? []).flatMap(dirsOf) : []),
    ...(onlyLong.value ? longFiles.value.flatMap(dirsOf) : []),
  ]),
  selected: desk.files.selected.value,
  hits: hits.value,
  hitDirs: hitDirs.value,
  unowned: new Set(own.value?.unowned ?? []),
  conflicts: new Set(own.value?.conflicts ?? []),
  ignored: own.value?.ignored ?? new Set(),
  onlyUnowned: onlyUnowned.value,
  lines: desk.files.lines.value,
  maxLines: desk.files.maxLines.value,
  onlyLong: onlyLong.value,
}))
/** 「只看超长」时展开到全部超长文件 */
const longFiles = computed(() => Object.keys(desk.files.lines.value).filter(f => desk.files.lines.value[f] > desk.files.maxLines.value))
</script>

<template>
  <div ref="root" class="file-tree">
    <SourceStatus v-if="!local" />
    <template v-else-if="tree && own">
      <header class="head">
        <div class="root" :title="local.root">{{ local.root }}</div>
        <div class="stats">
          <span>{{ local.files.length }} 个文件</span>
          <span v-if="own.unowned.length" class="warn">未归属 {{ own.unowned.length }}</span>
          <span v-if="own.conflicts.length" class="warn">冲突 {{ own.conflicts.length }}</span>
          <span v-if="own.ignored.size" class="muted">忽略 {{ own.ignored.size }}</span>
          <span v-if="tree.long" class="bad">超长 {{ tree.long }}（&gt; {{ desk.files.maxLines.value }} 行）</span>
        </div>
        <div class="tools">
          <label><input v-model="onlyUnowned" type="checkbox" /> 只看未归属</label>
          <label><input v-model="onlyLong" type="checkbox" /> 只看超长</label>
          <button class="small" title="重新列出源码文件" @click="desk.files.refresh()">刷新</button>
        </div>
        <div v-if="selectedModule" class="hint">
          {{ moduleName(desk.index.value!, selectedModule) }}：{{ hits.size }} 个文件
        </div>
      </header>
      <ul class="tree" role="tree">
        <FileTreeNode :dir="tree" :depth="0" :ctx="ctx" @pick="desk.selectFile" @toggle="toggle" />
      </ul>
    </template>
  </div>
</template>

<style scoped>
.head {
  padding: 2px 10px 6px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 4px;
  font-size: 11.5px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.root {
  color: var(--text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  direction: rtl;
  text-align: left;
}

.stats,
.tools {
  display: flex;
  gap: 8px;
  align-items: center;
}

.tools button {
  margin-left: auto;
  font-size: 11px;
  padding: 0 6px;
}

.warn {
  color: var(--warning);
}

.bad {
  color: var(--danger);
}

.hint {
  color: var(--accent);
}

.tree {
  list-style: none;
  margin: 0;
  padding: 0;
}
</style>
