<script setup lang="ts">
/**
 * 项目标题区（TB-6；第二十二轮 LY-2）：侧栏页头 44px（含 1px 底线，与画布页头、主语条底线对齐），项目名一行带 ▾、其下一行灰字是版本；
 * 单击展开项目菜单——
 * 版本（VersionSwitcher 的下拉，数据与行为原样）、编辑骨架、新建设计（当前版本时）、所有项目。单击菜单外或 Esc 收起。
 * 「对项目做什么」都在这里（C6），工具栏不再放它们。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useDesk } from '@/state/inject'
import VersionSwitcher from './VersionSwitcher.vue'
import { openNewDesign } from './edit/designHere'

const desk = useDesk()
const router = useRouter()
const open = ref(false)
const root = ref<HTMLElement>()
/** 系统名；加载完成前为项目 ID */
const name = computed(() => desk.index.value?.model.system.name ?? desk.project ?? '')
/** 版本一行：当前版本带描述对齐的提交（短），其余版本写种类与名字 */
const versionLine = computed(() => {
  const v = desk.version
  if (!v) {
    const c = desk.index.value?.model.system.source?.commit
    return `当前版本${c ? ` · ${c.slice(0, 8)}` : ''}`
  }
  if ('commit' in v) return `提交 · ${v.commit.slice(0, 8)}`
  if ('intent' in v) return `持久草图 · ${v.intent}`
  return `设计 · ${v.design} · ${v.revision}`
})
const canSkeleton = computed(() => !desk.version && desk.edit.lookup.intentIds.value.includes('skeleton'))

function run(fn: () => void) {
  open.value = false
  fn()
}
const editSkeleton = () => run(() => void router.push({ name: 'intent', params: { project: desk.project!, intent: 'skeleton' } }))
const newDesign = () => run(() => openNewDesign())
const allProjects = () => run(() => void router.push('/'))

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
  <div ref="root" class="project-head" data-head="sidebar">
    <button class="project-btn" :class="{ on: open }" :title="name" :aria-expanded="open" aria-haspopup="true" aria-label="项目菜单" @click="open = !open">
      <span class="lines"
        ><span class="name">{{ name }}<span class="caret" aria-hidden="true"> ▾</span></span
        ><span class="ver" data-testid="project-version">{{ versionLine }}</span></span
      >
    </button>
    <section v-show="open" class="menu project-menu" role="menu" aria-label="项目">
      <template v-if="desk.status.value === 'ready'">
        <div class="lbl">版本</div>
        <div class="version-row"><VersionSwitcher @switched="open = false" /></div>
        <template v-if="!desk.version">
          <div class="sep" />
          <button v-if="canSkeleton" class="it" role="menuitem" title="打开骨架（持久草图）并进入编辑态（E-1）" @click="editSkeleton">编辑骨架</button>
          <button class="it" role="menuitem" title="新建设计：画草图，AI 按它展开各轮（SK-10）" @click="newDesign">新建设计</button>
        </template>
        <div class="sep" />
      </template>
      <button class="it" role="menuitem" title="返回项目列表" @click="allProjects">所有项目</button>
    </section>
  </div>
</template>

<style scoped>
.project-head {
  position: relative;
  display: flex;
  align-items: center;
  box-sizing: border-box;
  height: var(--head-h, 44px);
  padding: 0 8px;
  border-bottom: 1px solid var(--border);
  flex: none;
  min-width: 0;
}

.project-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  min-width: 0;
  padding: 4px 6px;
  border: none;
  border-radius: 6px;
  background: none;
  font-size: 13.5px;
  font-weight: 600;
  text-align: left;
}

.project-btn:hover,
.project-btn.on {
  background: var(--bg);
}

.lines {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  min-width: 0;
  line-height: 1.25;
}

.ver {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--mono);
  font-size: 11px;
  font-weight: 400;
  color: var(--text-3);
}

.name {
  max-width: 100%;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.caret {
  flex: none;
  color: var(--text-3);
  font-weight: 400;
}

.menu {
  position: absolute;
  top: calc(100% - 2px);
  left: 8px;
  z-index: 40;
  display: flex;
  flex-direction: column;
  width: 260px;
  padding: 4px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 6px 24px rgb(0 0 0 / 14%);
}

.lbl {
  padding: 4px 10px 2px;
  font-size: 11px;
  color: var(--text-3);
}

.version-row {
  padding: 2px 6px 4px;
}

.it {
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

.sep {
  height: 1px;
  margin: 4px 6px;
  background: var(--border);
}
</style>
