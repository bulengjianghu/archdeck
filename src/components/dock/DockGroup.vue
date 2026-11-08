<script setup lang="ts">
/**
 * 视图区的一组（LY-8–LY-10，ADR-0064；负责人 2026-11-08 走查修订）：第一行是标签栏（34px，不画底线），下面是活动标签的内容。
 * 标签是文字：选中为深色字 + 压在标签栏底边的 2px 下划线，未选中为灰字，不用底色胶囊。
 * 视图标签（图解、描述、核对）的内容是主语的投影、全部常驻；情境标签（时序图）跟随场景，名字带进度「时序图 · 2/8」；
 * 「核对」名字带结论「核对 ⚠2」（核对卡里要看的项数，LY-9b）。资料标签（源代码、对话、设计说明、问题）不跟随主语，
 * 预览标签斜体、双击固定（LY-8a），× 只在悬停时出现；常驻标签没有 ×（LY-9）。标签可拖（LY-10）：落在标签栏按位置插入，落在内容区放到该组末尾。
 * 「+」菜单只开资料标签（对话、问题），加进发起的这一组（LY-10a）。
 * 只读工作区状态、只发意图（desk.workspace.dispatch）。
 */
import { computed, inject, onBeforeUnmount, onMounted, ref } from 'vue'
import { useDesk } from '@/state/inject'
import { isResident, type DocRef, type Tab, type TabGroup } from '@/state/useDeskState'
import SourceView from '../source/SourceView.vue'
import ViewDoc from './ViewDoc.vue'
import { docKindView, docLabel, docTip, VIEW_LABELS, type DocKindContext } from './docKinds'
import { TAB_DRAG, noDrag } from './tabDrag'
import { checkWarnCount } from '../panel/checkRows'

const props = defineProps<{ group: TabGroup; gi: number; count: number }>()
const desk = useDesk()
const ws = desk.workspace
const active = computed(() => props.group.tabs.find(t => t.id === props.group.active) ?? null)

/** DL-5：资料标签的标签名、说明与记号查资料种类表，不写种类分支 */
const kindCtx: DocKindContext = {
  moduleName: id => (id === desk.index.value?.rootId ? desk.index.value.model.system.name : (desk.index.value?.modules.get(id)?.name ?? id)),
  scenarioName: () => desk.run.scenario.value?.name ?? null,
  noteTitle: file => desk.notes.list.value.find(n => n.file === file)?.title ?? file,
}
const label = (t: Tab) => (t.kind === 'view' ? VIEW_LABELS[t.view] : docLabel(t.doc, kindCtx))
/** LY-8：时序图（情境标签）的进度「当前步 / 本层步数」；开头为 0 */
const progress = computed(() => {
  const total = desk.run.scenarioView.value?.messages.length ?? 0
  if (!desk.playback.value || !total) return ''
  const ci = desk.run.currentIndex.value
  return `${ci === null ? 0 : ci + 1}/${total}`
})
/** LY-9b：核对标签带的结论——核对卡里「要看」的项数 */
const checkCount = computed(() => checkWarnCount(desk))
const icon = (t: Tab) => (t.kind === 'doc' ? docKindView(t.doc)?.icon : undefined)
const tip = (t: Tab) =>
  t.kind === 'view'
    ? t.view === 'sequence'
      ? `${label(t)}（情境：跟随场景，不跟随主语；常驻）`
      : `${label(t)}（视图：跟随主语；常驻）`
    : docTip(t.doc, kindCtx) + '（资料：不跟随主语）' + (t.preview ? '（预览：双击固定）' : '')
const resident = (t: Tab) => isResident(ws.state.value, t.id)
/** 新种类的正文组件 */
const bodyOf = computed(() => (active.value?.kind === 'doc' ? docKindView(active.value.doc)?.component : undefined))

/** LY-10a：「+」——只开资料标签（视图标签常驻，LY-9） */
const plusOpen = ref(false)
const plusEl = ref<HTMLElement>()
const has = (id: string) => ws.state.value.groups.some(g => g.tabs.some(t => t.id === id))
const DOCS: { doc: DocRef; id: string; label: string; note: string }[] = [
  { doc: { kind: 'dialogue' }, id: 'dlg', label: '对话', note: '问 · 改' },
  { doc: { kind: 'issues' }, id: 'issues', label: '问题', note: '返工清单' },
]
const addableDocs = computed(() => DOCS.filter(d => !has(d.id) && (d.doc.kind !== 'dialogue' || !desk.version || desk.edit.active.value)))
function addDoc(doc: DocRef) {
  plusOpen.value = false
  ws.open(doc, true, props.gi)
}
const onDoc = (e: MouseEvent) => {
  if (plusOpen.value && plusEl.value && !plusEl.value.contains(e.target as Node)) plusOpen.value = false
}
onMounted(() => document.addEventListener('mousedown', onDoc))
onBeforeUnmount(() => document.removeEventListener('mousedown', onDoc))

// LY-10：拖拽——落点为标签栏中按横坐标算出的插入位置，或内容区（该组末尾）
const dragging = inject(TAB_DRAG, noDrag, true)
const bar = ref<HTMLElement>()
const dropAt = ref<number | null>(null)
function onDragStart(t: Tab, e: DragEvent) {
  dragging.value = t.id
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', t.id)
  }
}
const onDragEnd = () => {
  dragging.value = null
  dropAt.value = null
}
function indexAt(x: number): number {
  const tabs = [...(bar.value?.querySelectorAll<HTMLElement>('.tab') ?? [])]
  const i = tabs.findIndex(el => {
    const r = el.getBoundingClientRect()
    return x < r.left + r.width / 2
  })
  return i < 0 ? tabs.length : i
}
function onBarOver(e: DragEvent) {
  if (!dragging.value) return
  e.preventDefault()
  dropAt.value = indexAt(e.clientX)
}
function onBodyOver(e: DragEvent) {
  if (!dragging.value) return
  e.preventDefault()
  dropAt.value = props.group.tabs.length
}
function drop(index: number) {
  const id = dragging.value
  onDragEnd()
  if (id) ws.dispatch({ type: 'move', id, group: props.gi, index })
}
</script>

<template>
  <section class="group" :data-group="gi">
    <header
      ref="bar"
      class="tabs"
      role="tablist"
      :class="{ 'drop-end': dropAt === group.tabs.length }"
      :aria-label="count > 1 ? `视图 · ${gi === 0 ? '上' : '下'}组` : '视图'"
      @dragover="onBarOver"
      @dragleave="dropAt = null"
      @drop.prevent="drop(indexAt($event.clientX))"
    >
      <span
        v-for="(t, i) in group.tabs"
        :key="t.id"
        class="tab"
        draggable="true"
        :class="{
          on: t.id === group.active,
          preview: t.kind === 'doc' && t.preview,
          view: t.kind === 'view',
          pin: resident(t),
          dragged: dragging === t.id,
          'drop-before': dropAt === i,
        }"
        :data-doc="t.id"
        :data-view-tab="t.kind === 'view' ? t.view : undefined"
        :data-doc-tab="t.kind === 'doc' ? t.doc.kind : undefined"
        @dragstart="onDragStart(t, $event)"
        @dragend="onDragEnd"
        @dblclick="ws.dispatch({ type: 'pin', id: t.id })"
      >
        <button role="tab" class="lbl" :aria-selected="t.id === group.active" :title="tip(t)" @click="ws.dispatch({ type: 'activate', id: t.id })">
          <span v-if="icon(t)" class="kind-ic" aria-hidden="true">{{ icon(t) }}</span
          >{{ label(t) }}<span v-if="t.kind === 'view' && t.view === 'sequence' && progress" class="ctx" data-tab-progress> · {{ progress }}</span
          ><span v-if="t.kind === 'view' && t.view === 'check' && checkCount" class="cnt" data-tab-count>⚠{{ checkCount }}</span>
        </button>
        <button v-if="!resident(t)" class="x" :title="`关闭${label(t)}`" :aria-label="`关闭${label(t)}`" @click.stop="ws.dispatch({ type: 'close', id: t.id })">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" /></svg>
        </button>
      </span>
      <span ref="plusEl" class="plus-wrap">
        <button class="plus" title="添加标签" aria-label="添加标签" :aria-expanded="plusOpen" @click="plusOpen = !plusOpen">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" /></svg>
        </button>
        <span v-if="plusOpen" class="plus-menu" role="menu" aria-label="添加标签">
          <template v-if="addableDocs.length">
            <span class="mh">资料 · 不跟随主语</span>
            <button v-for="d in addableDocs" :key="d.id" role="menuitem" :data-add-doc="d.doc.kind" @click="addDoc(d.doc)">
              {{ d.label }}<span class="note">{{ d.note }}</span>
            </button>
          </template>
          <span v-if="!addableDocs.length" class="empty">全部已打开</span>
        </span>
      </span>
    </header>
    <div class="body" @dragover="onBodyOver" @drop.prevent="drop(group.tabs.length)">
      <template v-if="active">
        <ViewDoc v-if="active.kind === 'view'" :key="active.id" :view="active.view" />
        <SourceView v-else-if="active.doc.kind === 'source'" :key="active.id" :path="active.doc.path" :line="active.doc.line ?? undefined" />
        <!-- DL-5：其余种类的正文由资料种类表给出 -->
        <component :is="bodyOf" v-else-if="bodyOf" :key="active.id" :doc="active.doc" />
      </template>
    </div>
  </section>
</template>

<style scoped>
.group {
  flex: 1 1 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

/* 标签栏不画底线（视图区只有主语条那一条横线），选中标签的下划线压在栏的底边 */
.tabs {
  position: relative;
  flex: none;
  box-sizing: border-box;
  height: 34px;
  display: flex;
  align-items: stretch;
  gap: 16px;
  padding: 0 8px 0 16px;
  background: var(--surface);
  font-size: 12.5px;
}

.tabs.drop-end > .plus-wrap::before {
  content: '';
  position: absolute;
  left: -9px;
  top: 8px;
  bottom: 8px;
  width: 2px;
  border-radius: 2px;
  background: var(--accent);
}

.tab {
  position: relative;
  display: inline-flex;
  align-items: center;
  flex: 0 1 auto;
  min-width: 0;
  max-width: 220px;
  color: var(--text-3);
  user-select: none;
}

.tab:hover {
  color: var(--text);
}

.tab.on {
  color: var(--text);
}

.tab.on::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 2px;
  border-radius: 2px;
  background: var(--text);
}

.tab.dragged {
  opacity: 0.35;
}

.tab.drop-before::before {
  content: '';
  position: absolute;
  left: -9px;
  top: 8px;
  bottom: 8px;
  width: 2px;
  border-radius: 2px;
  background: var(--accent);
}

.tab .lbl {
  border: none;
  background: none;
  padding: 0 1px;
  height: 100%;
  color: inherit;
  font-size: 12.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}

.tab.preview .lbl {
  font-style: italic;
}

.tab .ctx {
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}

.tab .cnt {
  margin-left: 4px;
  color: var(--warning);
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
}

.kind-ic {
  margin-right: 4px;
  font-style: normal;
  color: var(--accent);
}

/* 资料标签的 × 只在悬停时出现 */
.tab .x {
  flex: none;
  width: 16px;
  height: 16px;
  margin: 0 -4px 0 4px;
  display: grid;
  place-items: center;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: none;
  color: var(--text-3);
  opacity: 0;
}

.tab:hover .x,
.tab .x:focus-visible {
  opacity: 0.7;
}

.tab .x:hover {
  opacity: 1;
  background: var(--border);
}

.tab .x svg,
.plus svg {
  width: 12px;
  height: 12px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
}

.plus-wrap {
  position: relative;
  flex: none;
  margin-left: auto;
  align-self: center;
}

.plus {
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: none;
  color: var(--text-3);
}

.plus:hover,
.plus[aria-expanded='true'] {
  background: var(--surface-2);
  color: var(--text);
}

.plus svg {
  width: 14px;
  height: 14px;
}

.plus-menu {
  position: absolute;
  top: 30px;
  right: 0;
  z-index: 30;
  display: flex;
  flex-direction: column;
  min-width: 180px;
  padding: 4px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 9px;
  box-shadow: 0 8px 24px rgb(0 0 0 / 10%);
}

.plus-menu .mh {
  padding: 6px 8px 2px;
  font-size: 11px;
  color: var(--text-3);
}

.plus-menu button {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 5px 8px;
  border: none;
  border-radius: 6px;
  background: none;
  text-align: left;
  font-size: 12.5px;
}

.plus-menu button:hover {
  background: var(--surface-2);
}

.plus-menu .note {
  color: var(--text-3);
  font-size: 11.5px;
}

.plus-menu .empty {
  padding: 6px 8px;
  font-size: 12px;
  color: var(--text-3);
}

.body {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--surface);
}
</style>
