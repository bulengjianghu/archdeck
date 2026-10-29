<script setup lang="ts">
/**
 * 模块树（T2–T5）：系统为根的完整模块层级。
 * - 状态 → 树：当前层次的祖先链展开并标出当前层次，选中的模块高亮、展开到它并滚到可见；
 *   运行视角下标出参与本场景的模块与当前步骤的两端；选中文件时标出其归属模块并展开到它（G14）。
 * - 树 → 意图：单击定位（N4），单击系统回根层，双击有子模块的下钻（N1、N2）；悬停本层可见的模块等同悬停画布节点。
 * 右键：「在此设计」（F-10：以该模块为挂载点新建设计，只在当前版本、不能是层）。
 * 「只看需复核」（Z3）只列含需复核模块的分支，并展开到它们。
 * 排序「描述顺序 / 按热度」（J8）：按热度时同一父模块下的子模块按热度降序、同值保持描述顺序，热度种类取「显示」面板所选（关闭时按修改热度）。
 * 展开状态、筛选与排序只属于这块界面。
 */
import { computed, nextTick, ref, watch } from 'vue'
import { heatCount, heatValue, type HeatKind } from '@/model'
import { useDesk } from '@/state/inject'
import ModuleTreeNode from './ModuleTreeNode.vue'
import SketchMenu from '../sketch/SketchMenu.vue'
import { canDesignAt, openNewDesign } from '../edit/designHere'

const desk = useDesk()
const root = ref<HTMLElement>()
const idx = computed(() => desk.index.value!)
const run = computed(() => desk.perspective.value === 'run')

/** T2：结构视角下「只看现状」开启时不列目标态模块及其后代；运行视角不受开关影响（L9） */
const hideTarget = computed(() => !run.value && desk.toggles.currentOnly)
/** Z3：「只看需复核」时只列祖先链上有需复核模块的分支 */
const onlyStale = ref(false)
const staleBranches = computed(() => new Set([...desk.review.stale.value].flatMap(id => idx.value.pathOf.get(id) ?? [])))
/** J8：排序方式；热度种类取开关所选，关闭时按修改热度 */
const sort = ref<'order' | 'heat'>('order')
const kind = computed<HeatKind>(() => (desk.toggles.heat === 'fixes' ? 'fixes' : 'changes'))
const heatOf = (id: string) => {
  const m = desk.evolution.moduleOf(id)
  return m ? heatValue(m, kind.value) : 0
}
const countOf = (id: string) => {
  const m = desk.evolution.moduleOf(id)
  return m ? heatCount(m, kind.value) : 0
}
const byHeat = computed(() => sort.value === 'heat' && desk.evolution.status.value === 'ready')
const childrenOf = (id: string) => {
  const kids = (idx.value.childrenOf.get(id) ?? []).filter(
    c => !(hideTarget.value && idx.value.modules.get(c)?.status === 'target') && !(onlyStale.value && !staleBranches.value.has(c)),
  )
  // 稳定排序：热度相同的保持描述顺序
  return byHeat.value ? [...kids].sort((a, b) => heatOf(b) - heatOf(a)) : kids
}

const selectedId = computed(() => (desk.selection.value?.kind === 'module' ? desk.selection.value.id : null))
/** T5：当前步骤两端的祖先链 */
const active = computed(() => {
  const f = desk.run.frame.value
  if (!run.value || !f) return new Set<string>()
  return new Set([f.from, f.to].flatMap(id => idx.value.pathOf.get(id) ?? []))
})
const viewNodes = computed(() => new Set(desk.view.value?.nodes.map(n => n.id) ?? []))

const expanded = ref(new Set<string>())
watch(onlyStale, on => on && (expanded.value = new Set([...expanded.value, ...staleBranches.value])))
/** T3：展开到当前层次与选中的模块 */
function reveal(id: string | null) {
  if (!id) return
  const path = idx.value.pathOf.get(id) ?? []
  const next = new Set(expanded.value)
  for (const p of id === desk.levelId.value ? path : path.slice(0, -1)) next.add(p)
  expanded.value = next
}
watch(
  () => [desk.levelId.value, selectedId.value, desk.index.value, desk.files.owners.value] as const,
  async () => {
    reveal(desk.levelId.value)
    reveal(selectedId.value)
    for (const o of desk.files.owners.value) reveal(o)
    await nextTick()
    const target = selectedId.value ?? desk.files.owners.value[0] ?? desk.levelId.value
    const row = [...(root.value?.querySelectorAll<HTMLElement>('[data-id]') ?? [])].find(el => el.dataset.id === target)
    row?.scrollIntoView?.({ block: 'nearest' })
  },
  { immediate: true },
)
function toggle(id: string) {
  const next = new Set(expanded.value)
  if (!next.delete(id)) next.add(id)
  expanded.value = next
}

const ctx = computed(() => ({
  index: idx.value,
  childrenOf,
  expanded: expanded.value,
  levelId: desk.levelId.value,
  selectedId: selectedId.value,
  participants: run.value ? desk.run.participants.value : new Set<string>(),
  active: active.value,
  fileOwners: new Set(desk.files.owners.value),
  stale: desk.review.stale.value,
  reviewed: new Set([...desk.review.states.value].filter(([, s]) => s.status === 'reviewed').map(([id]) => id)),
  heatCount: byHeat.value ? countOf : null,
}))

/** ADR-0052：分组标题单击选中层（V2） */
function pickStratum(key: string) {
  desk.select({ kind: 'stratum', id: key })
}

function pick(id: string) {
  if (id === idx.value.rootId) desk.goTo(id, null)
  else desk.revealModule(id)
}
function drill(id: string) {
  if (childrenOf(id).length) desk.drillInto(id)
}
function hover(id: string | null) {
  desk.setHover(id && viewNodes.value.has(id) ? id : null)
}
/** F-10：右键菜单 */
const menu = ref<{ x: number; y: number; id: string } | null>(null)
function onMenu(id: string, ev: MouseEvent) {
  if (desk.version || id === idx.value.rootId) return
  menu.value = { x: ev.clientX, y: ev.clientY, id }
}
function onChoose(key: string) {
  const id = menu.value?.id
  menu.value = null
  if (key === 'design' && id) openNewDesign(id)
}
</script>

<template>
  <div class="module-tree">
    <div v-if="!run" class="sort" role="group" aria-label="模块排序">
      <span class="sort-label">排序</span>
      <span class="segmented">
        <button :class="{ on: sort === 'order' }" :aria-pressed="sort === 'order'" @click="sort = 'order'">描述顺序</button>
        <button
          :class="{ on: sort === 'heat' }"
          :aria-pressed="sort === 'heat'"
          :disabled="desk.evolution.status.value !== 'ready'"
          :title="desk.evolution.status.value === 'ready' ? `按${kind === 'fixes' ? '缺陷' : '修改'}热度降序（同一父模块下）` : '没有演化事实'"
          @click="sort = 'heat'"
        >
          按热度
        </button>
      </span>
    </div>
    <div v-if="desk.review.stale.value.size || onlyStale" class="tools">
      <label><input v-model="onlyStale" type="checkbox" /> 只看需复核</label>
      <span class="warn">需复核 {{ desk.review.stale.value.size }}</span>
    </div>
    <ul ref="root" class="tree" role="tree" @mouseleave="hover(null)">
      <ModuleTreeNode
        :id="idx.rootId"
        :depth="0"
        :ctx="ctx"
        @pick="pick"
        @drill="drill"
        @toggle="toggle"
        @hover="hover"
        @menu="onMenu"
        @stratum="pickStratum"
      />
    </ul>
    <SketchMenu
      v-if="menu"
      :x="menu.x"
      :y="menu.y"
      :items="[{ key: 'design', label: '在此设计', disabled: !canDesignAt(desk, menu.id) }]"
      @choose="onChoose"
      @close="menu = null"
    />
  </div>
</template>

<style scoped>
.tree {
  list-style: none;
  margin: 0;
  padding: 0;
}

.tools {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 2px 10px 6px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 4px;
  font-size: 11.5px;
}

.tools .warn {
  color: var(--warning);
}

.sort {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px 6px;
  font-size: 11.5px;
  color: var(--text-3);
}

.segmented {
  display: inline-flex;
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
}

.segmented button {
  border: none;
  border-radius: 0;
  background: none;
  padding: 0 8px;
  font: inherit;
  color: var(--text-2);
  white-space: nowrap;
}

.segmented button + button {
  border-left: 1px solid var(--border);
}

.segmented button.on {
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 600;
}

.segmented button:disabled {
  opacity: 0.5;
}
</style>
