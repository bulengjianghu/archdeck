<script setup lang="ts">
/**
 * 模块树（T2–T5）：系统为根的完整模块层级。
 * - 状态 → 树：当前层次的祖先链展开并标出当前层次，选中的模块高亮、展开到它并滚到可见；
 *   运行视角下标出参与本场景的模块与当前步骤的两端；选中文件时标出其归属模块并展开到它（G14）。
 * - 树 → 意图：单击定位（N4），单击系统回根层，双击有子模块的下钻（N1、N2）；悬停本层可见的模块等同悬停画布节点。
 * 展开状态只属于这块界面。
 */
import { computed, nextTick, ref, watch } from 'vue'
import { useDesk } from '@/state/inject'
import ModuleTreeNode from './ModuleTreeNode.vue'

const desk = useDesk()
const root = ref<HTMLElement>()
const idx = computed(() => desk.index.value!)
const run = computed(() => desk.perspective.value === 'run')

/** T2：结构视角下「只看现状」开启时不列目标态模块及其后代；运行视角不受开关影响（L9） */
const hideTarget = computed(() => !run.value && desk.toggles.currentOnly)
const childrenOf = (id: string) =>
  (idx.value.childrenOf.get(id) ?? []).filter(c => !(hideTarget.value && idx.value.modules.get(c)?.status === 'target'))

const selectedId = computed(() => (desk.selection.value?.kind === 'module' ? desk.selection.value.id : null))
/** T5：当前步骤两端的祖先链 */
const active = computed(() => {
  const f = desk.frame.value
  if (!run.value || !f) return new Set<string>()
  return new Set([f.from, f.to].flatMap(id => idx.value.pathOf.get(id) ?? []))
})
const viewNodes = computed(() => new Set(desk.view.value?.nodes.map(n => n.id) ?? []))

const expanded = ref(new Set<string>())
/** T3：展开到当前层次与选中的模块 */
function reveal(id: string | null) {
  if (!id) return
  const path = idx.value.pathOf.get(id) ?? []
  const next = new Set(expanded.value)
  for (const p of id === desk.levelId.value ? path : path.slice(0, -1)) next.add(p)
  expanded.value = next
}
watch(
  () => [desk.levelId.value, selectedId.value, desk.index.value, desk.fileOwners.value] as const,
  async () => {
    reveal(desk.levelId.value)
    reveal(selectedId.value)
    for (const o of desk.fileOwners.value) reveal(o)
    await nextTick()
    const target = selectedId.value ?? desk.fileOwners.value[0] ?? desk.levelId.value
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
  participants: run.value ? desk.participants.value : new Set<string>(),
  active: active.value,
  fileOwners: new Set(desk.fileOwners.value),
}))

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
</script>

<template>
  <ul ref="root" class="tree" role="tree" @mouseleave="hover(null)">
    <ModuleTreeNode :id="idx.rootId" :depth="0" :ctx="ctx" @pick="pick" @drill="drill" @toggle="toggle" @hover="hover" />
  </ul>
</template>

<style scoped>
.tree {
  list-style: none;
  margin: 0;
  padding: 0;
}
</style>
