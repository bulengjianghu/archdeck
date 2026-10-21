<script setup lang="ts">
/** 文件树的一个目录及其内容（递归）；根目录不画自己那一行。只画，意图交给 FileTree。文件带行数、超长标红，目录带行数合计与超长数（G21） */
import { computed } from 'vue'
import { isLong, type DirNode } from '@/model'
import type { FileTreeContext } from './types'

defineOptions({ name: 'FileTreeNode' })
const props = defineProps<{ dir: DirNode; depth: number; ctx: FileTreeContext }>()
const emit = defineEmits<{ pick: [path: string]; toggle: [path: string] }>()

const isRoot = computed(() => props.dir.path === '')
const open = computed(() => isRoot.value || props.ctx.expanded.has(props.dir.path))
const childDepth = computed(() => (isRoot.value ? 0 : props.depth + 1))
const long = (f: string) => isLong(props.ctx.lines[f], props.ctx.maxLines)
const dirs = computed(() => props.dir.dirs.filter(d => (!props.ctx.onlyUnowned || d.unowned > 0) && (!props.ctx.onlyLong || d.long > 0)))
const files = computed(() => props.dir.files.filter(f => (!props.ctx.onlyUnowned || props.ctx.unowned.has(f)) && (!props.ctx.onlyLong || long(f))))
/** 行数显示：千以上用 k */
const fmt = (n: number) => (n >= 10000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))
const base = (f: string) => f.slice(f.lastIndexOf('/') + 1)
const pad = (d: number) => ({ paddingLeft: `${8 + d * 14}px` })
</script>

<template>
  <li v-if="!isRoot" role="treeitem" :aria-expanded="open">
    <div
      class="row dir"
      :data-dir="dir.path"
      :style="pad(depth)"
      :class="{ hit: ctx.hitDirs.has(dir.path), ignored: dir.ignored }"
      :title="dir.ignored ? `${dir.path}：内部文件全部已忽略` : dir.path"
      @click="emit('toggle', dir.path)"
    >
      <span class="caret">{{ open ? '▾' : '▸' }}</span>
      <span class="name">{{ dir.name }}</span>
      <span class="count">{{ dir.count }}</span>
      <span v-if="dir.unowned" class="count warn" :title="`${dir.unowned} 个未归属文件`">!{{ dir.unowned }}</span>
      <span v-if="dir.lines" class="lines" :title="`${dir.lines} 行`">{{ fmt(dir.lines) }}</span>
      <span v-if="dir.long" class="lines long" :title="`${dir.long} 个文件超过 ${ctx.maxLines} 行`">长{{ dir.long }}</span>
    </div>
    <ul v-if="open" role="group">
      <FileTreeNode v-for="d in dirs" :key="d.path" :dir="d" :depth="childDepth" :ctx="ctx" @pick="p => emit('pick', p)" @toggle="p => emit('toggle', p)" />
      <li v-for="f in files" :key="f" role="treeitem" :aria-selected="ctx.selected === f">
        <div
          class="row file"
          :data-path="f"
          :style="pad(childDepth)"
          :class="{
            selected: ctx.selected === f,
            hit: ctx.hits.has(f),
            unowned: ctx.unowned.has(f),
            conflict: ctx.conflicts.has(f),
            ignored: ctx.ignored.has(f),
          }"
          :title="ctx.unowned.has(f) ? `${f}：未归属任何模块` : ctx.conflicts.has(f) ? `${f}：归属冲突` : ctx.ignored.has(f) ? `${f}：已忽略` : f"
          @click="emit('pick', f)"
        >
          <span class="caret" />
          <span class="name">{{ base(f) }}</span>
          <span v-if="ctx.unowned.has(f)" class="tag warn">未归属</span>
          <span v-else-if="ctx.conflicts.has(f)" class="tag warn">冲突</span>
          <span v-if="ctx.lines[f] !== undefined" class="lines" :class="{ long: long(f) }">{{ ctx.lines[f] }}</span>
        </div>
      </li>
    </ul>
  </li>
  <template v-else>
    <FileTreeNode v-for="d in dirs" :key="d.path" :dir="d" :depth="0" :ctx="ctx" @pick="p => emit('pick', p)" @toggle="p => emit('toggle', p)" />
    <li v-for="f in files" :key="f" role="treeitem" :aria-selected="ctx.selected === f">
      <div
        class="row file"
        :data-path="f"
        :style="pad(0)"
        :class="{
          selected: ctx.selected === f,
          hit: ctx.hits.has(f),
          unowned: ctx.unowned.has(f),
          conflict: ctx.conflicts.has(f),
          ignored: ctx.ignored.has(f),
        }"
        @click="emit('pick', f)"
      >
        <span class="caret" />
        <span class="name">{{ f }}</span>
        <span v-if="ctx.unowned.has(f)" class="tag warn">未归属</span>
        <span v-else-if="ctx.conflicts.has(f)" class="tag warn">冲突</span>
        <span v-if="ctx.lines[f] !== undefined" class="lines" :class="{ long: long(f) }">{{ ctx.lines[f] }}</span>
      </div>
    </li>
  </template>
</template>

<style scoped>
ul {
  list-style: none;
  margin: 0;
  padding: 0;
}

.row {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 1px 8px;
  cursor: pointer;
  white-space: nowrap;
  border-left: 2px solid transparent;
}

.row:hover {
  background: var(--surface-2);
}

.caret {
  flex: none;
  width: 16px;
  color: var(--text-3);
  font-size: 11px;
  text-align: center;
}

.name {
  overflow: hidden;
  text-overflow: ellipsis;
}

.count {
  flex: none;
  font-size: 10.5px;
  color: var(--text-3);
}

.lines {
  flex: none;
  margin-left: auto;
  padding-left: 6px;
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
  color: var(--text-3);
}

.lines + .lines {
  margin-left: 0;
}

.lines.long {
  color: var(--danger);
  font-weight: 600;
}

.tag {
  flex: none;
  font-size: 10.5px;
  border-radius: 4px;
  padding: 0 4px;
}

.warn {
  color: var(--warning);
}

.tag.warn {
  background: var(--warning-soft);
}

.dir.hit > .name::after {
  content: ' ●';
  font-size: 8px;
  vertical-align: middle;
  color: var(--accent);
}

.file.hit {
  background: var(--accent-soft);
}

.file.selected {
  background: var(--accent-soft);
  border-left-color: var(--accent);
  font-weight: 600;
}

.dir.ignored > .name,
.dir.ignored > .count,
.file.ignored > .name {
  color: var(--text-3);
}

.file.unowned > .name {
  color: var(--warning);
}
</style>
