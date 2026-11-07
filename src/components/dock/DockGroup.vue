<script setup lang="ts">
/**
 * 视图区的一组（LY-8–LY-10，ADR-0064；第二十二轮波 1 的过渡呈现，波 2 换成拖拽与「+」菜单的新标签栏）：
 * 第一行是标签栏，下面是活动标签的内容。视图标签（图解、描述、核对、时序图）的内容是主语的投影（ViewDoc）；
 * 资料标签（源代码、对话、设计说明）不跟随主语，预览标签斜体、双击固定（LY-8a）。常驻标签没有 ×（LY-9）。
 * 只读工作区状态、只发意图（desk.workspace.dispatch）。
 */
import { computed, ref } from 'vue'
import { useDesk } from '@/state/inject'
import { isResident, type Tab, type TabGroup, type ViewKind } from '@/state/useDeskState'
import SourceView from '../source/SourceView.vue'
import ViewDoc from './ViewDoc.vue'
import { docKindView, docLabel, docTip, VIEW_LABELS, type DocKindContext } from './docKinds'

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
const icon = (t: Tab) => (t.kind === 'doc' ? docKindView(t.doc)?.icon : undefined)
const tip = (t: Tab) =>
  t.kind === 'view' ? `${VIEW_LABELS[t.view]}（视图：跟随主语）` : docTip(t.doc, kindCtx) + '（资料：不跟随主语）' + (t.preview ? '（预览：双击固定）' : '')
const resident = (t: Tab) => isResident(ws.state.value, t.id)
/** 新种类的正文组件 */
const bodyOf = computed(() => (active.value?.kind === 'doc' ? docKindView(active.value.doc)?.component : undefined))

/** LY-9：「+」——加回被关掉的视图标签 */
const plusOpen = ref(false)
const addable = computed<ViewKind[]>(() =>
  (['description', 'check'] as ViewKind[]).filter(v => !ws.state.value.groups.some(g => g.tabs.some(t => t.kind === 'view' && t.view === v))),
)
function add(view: ViewKind) {
  plusOpen.value = false
  ws.dispatch({ type: 'addView', view, group: props.gi })
}
</script>

<template>
  <section class="group" :data-group="gi">
    <header class="tabs" role="tablist" :aria-label="count > 1 ? `视图 · ${gi === 0 ? '上' : '下'}组` : '视图'">
      <span
        v-for="t in group.tabs"
        :key="t.id"
        class="tab"
        :class="{ on: t.id === group.active, preview: t.kind === 'doc' && t.preview, view: t.kind === 'view' }"
        :data-doc="t.id"
        :data-view-tab="t.kind === 'view' ? t.view : undefined"
        :data-doc-tab="t.kind === 'doc' ? t.doc.kind : undefined"
        @dblclick="ws.dispatch({ type: 'pin', id: t.id })"
      >
        <button role="tab" class="lbl" :aria-selected="t.id === group.active" :title="tip(t)" @click="ws.dispatch({ type: 'activate', id: t.id })">
          <span v-if="icon(t)" class="kind-ic" aria-hidden="true">{{ icon(t) }}</span
          >{{ label(t) }}
        </button>
        <button v-if="!resident(t)" class="x" :title="`关闭${label(t)}`" :aria-label="`关闭${label(t)}`" @click.stop="ws.dispatch({ type: 'close', id: t.id })">
          ×
        </button>
      </span>
      <span class="plus-wrap">
        <button v-if="addable.length" class="plus" title="添加视图标签" aria-label="添加标签" :aria-expanded="plusOpen" @click="plusOpen = !plusOpen">+</button>
        <span v-if="plusOpen" class="plus-menu" role="menu">
          <button v-for="v in addable" :key="v" role="menuitem" :data-add-view="v" @click="add(v)">{{ VIEW_LABELS[v] }}</button>
        </span>
      </span>
      <span class="sp" />
    </header>
    <div class="body">
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

.group + .group {
  border-top: 3px solid var(--border);
}

.tabs {
  display: flex;
  align-items: flex-end;
  gap: 2px;
  height: var(--toolbar-h);
  padding: 0 6px;
  background: var(--bg);
  border-bottom: 1px solid var(--border);
  flex: none;
  overflow-x: auto;
  overflow-y: hidden;
  font-size: 12.5px;
}

.plus-wrap {
  position: relative;
  align-self: center;
}

.plus {
  border: none;
  background: none;
  width: 24px;
  height: 24px;
  color: var(--text-3);
  font-size: 15px;
}

.plus-menu {
  position: absolute;
  top: 26px;
  left: 0;
  z-index: 5;
  display: flex;
  flex-direction: column;
  min-width: 96px;
  padding: 4px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: var(--card-shadow);
}

.plus-menu button {
  border: none;
  background: none;
  text-align: left;
  padding: 4px 8px;
  border-radius: 6px;
}

.plus-menu button:hover {
  background: var(--bg);
}

.tab {
  display: inline-flex;
  align-items: center;
  flex: none;
  max-width: 220px;
  margin-bottom: -1px;
  border: 1px solid transparent;
  border-bottom: none;
  border-radius: 6px 6px 0 0;
  color: var(--text-2);
}

.tab.on {
  background: var(--surface);
  border-color: var(--border);
  color: var(--text);
}

.tab .lbl {
  border: none;
  background: none;
  padding: 5px 4px 6px 9px;
  color: inherit;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tab.on .lbl {
  font-weight: 600;
}

.tab.preview .lbl {
  font-style: italic;
}

.tab:has(.stale-chip) {
  max-width: 340px;
}

.kind-ic {
  margin-right: 4px;
  font-style: normal;
  color: var(--accent);
}

.stale-chip {
  flex: none;
  margin-left: 2px;
  padding: 0 6px;
  border-radius: 8px;
  font-size: 11px;
  line-height: 16px;
  color: var(--warning);
  background: var(--warning-soft);
  white-space: nowrap;
}

.tab .x {
  border: none;
  background: none;
  padding: 0 6px 0 2px;
  color: var(--text-3);
}

.sp {
  flex: 1;
}

.ib {
  align-self: center;
  width: 28px;
  height: 28px;
}

.body {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--surface);
}

.empty {
  margin: 0;
  padding: 30px 16px;
  text-align: center;
  color: var(--text-3);
  font-size: 12.5px;
}
</style>
