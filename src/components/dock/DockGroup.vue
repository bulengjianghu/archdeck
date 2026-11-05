<script setup lang="ts">
/**
 * 资料区的一组（WS-4–WS-7）：第一行是标签栏（与工具栏同高），下面是活动标签的内容。
 * 预览标签标题斜体，双击固定；单击组内即聚焦该组（新资料进焦点组）。上组的标签栏右端有 ⊟ 分屏（分屏后按下态，再按取消）与 × 关闭全部（TB-10）。
 * 只读工作区状态、只发意图（desk.workspace.dispatch）。
 */
import { computed } from 'vue'
import { useDesk } from '@/state/inject'
import type { DocGroup, DocTab } from '@/state/useDeskState'
import SourceView from '../source/SourceView.vue'
import SequenceDoc from './SequenceDoc.vue'
import ModuleDoc from './ModuleDoc.vue'
import StepPanel from '../panel/StepPanel.vue'
import RunSection from '../panel/RunSection.vue'
import ScenarioPanel from '../panel/ScenarioPanel.vue'
import { staleText } from '../shared/explainerText'
import ToolIcon from '../shared/ToolIcon.vue'

const props = defineProps<{ group: DocGroup; gi: number; count: number; focused: boolean }>()
const desk = useDesk()
const ws = desk.workspace
const active = computed(() => props.group.tabs.find(t => t.id === props.group.active) ?? null)

function label(t: DocTab): string {
  const d = t.doc
  if (d.kind === 'sequence') return `时序图${desk.run.scenario.value ? ` · ${desk.run.scenario.value.name}` : ''}`
  if (d.kind === 'source') return `源代码 · ${d.path.split('/').pop()}`
  if (d.kind === 'facts') return explainerName(d.module)
  return explainerName(d.module)
}
/** EX-3：图解标签名取模块名（系统根取系统名），前面的 ▣ 表明种类 */
const explainerName = (id: string) => (id === desk.index.value?.rootId ? desk.index.value.model.system.name : (desk.index.value?.modules.get(id)?.name ?? id))
/** EX-7：图解依据过期时标在标题后 */
const stale = (t: DocTab) => {
  const st = t.doc.kind === 'explainer' ? desk.explainers.status(t.doc.module) : null
  return st?.stale ? staleText(st) : null
}
/** Q4'（round20/01 §6）：运行视角右栏 = 时序图 + 步骤节——选中步骤显示步骤详情，选中其他对象显示「这次流程里它做了什么」（V6 新家） */
const stepSel = computed(() => desk.selected.value?.kind === 'step')
const scSel = computed(() => desk.selected.value?.kind === 'scenario')
const runSel = computed(() => {
  const k = desk.selected.value?.kind
  return k === 'module' || k === 'relation' || k === 'edge' || k === 'actor' || k === 'port'
})
const tip = (t: DocTab) =>
  (t.doc.kind === 'source' ? t.doc.path : t.doc.kind === 'explainer' ? `图解 · ${label(t)}` : t.doc.kind === 'facts' ? `理解页 · ${label(t)}` : label(t)) +
  (stale(t) ? `（${stale(t)}）` : '') +
  (t.preview ? '（预览：双击固定）' : '')
</script>

<template>
  <section class="group" :class="{ focused: focused && count > 1 }" :data-group="gi" @pointerdown="ws.dispatch({ type: 'focusGroup', group: gi })">
    <header class="tabs" role="tablist" :aria-label="count > 1 ? `资料 · ${gi === 0 ? '上' : '下'}组` : '资料'">
      <span
        v-for="t in group.tabs"
        :key="t.id"
        class="tab"
        :class="{ on: t.id === group.active, preview: t.preview }"
        :data-doc="t.id"
        @dblclick="ws.dispatch({ type: 'pin', group: gi, id: t.id })"
      >
        <button role="tab" class="lbl" :aria-selected="t.id === group.active" :title="tip(t)" @click="ws.dispatch({ type: 'activate', group: gi, id: t.id })">
          <span v-if="t.doc.kind === 'explainer' || t.doc.kind === 'facts'" class="kind-ic" aria-hidden="true">▣</span>{{ label(t) }}
        </button>
        <span v-if="stale(t)" class="stale-chip" data-testid="tab-stale">{{ stale(t) }}</span>
        <button class="x" :title="`关闭${label(t)}`" :aria-label="`关闭${label(t)}`" @click.stop="ws.dispatch({ type: 'close', group: gi, id: t.id })">
          ×
        </button>
      </span>
      <span class="sp" />
      <!-- TB-10：这一组资料自己的操作——⊟ 分屏（分屏后为按下态，再按取消）、× 关闭全部 -->
      <template v-if="gi === 0">
        <button
          v-if="count === 1"
          class="ib"
          title="上下分屏：之后打开的资料放进下组"
          aria-label="上下分屏"
          :disabled="!group.tabs.length"
          @click="ws.dispatch({ type: 'split' })"
        >
          <ToolIcon name="split" />
        </button>
        <button v-else class="ib on" title="取消分屏：下组的标签并回上组" aria-label="取消分屏" @click="ws.dispatch({ type: 'unsplit' })">
          <ToolIcon name="split" />
        </button>
        <button class="ib close-all" title="关闭全部资料（资料区随之消失）" aria-label="关闭资料区" @click="ws.dispatch({ type: 'closeDock' })">
          <ToolIcon name="close" />
        </button>
      </template>
    </header>
    <div class="body">
      <template v-if="active">
        <SourceView v-if="active.doc.kind === 'source'" :key="active.id" :path="active.doc.path" :line="active.doc.line ?? undefined" />
        <template v-else-if="active.doc.kind === 'sequence'">
          <template v-if="desk.perspective.value === 'run'">
            <SequenceDoc class="seq" />
            <!-- V6 新家（round20/01 §6）：这次怎么走（时序图）与这一步 / 这个对象在流程里做了什么（步骤节）同栏 -->
            <div class="step-side" data-testid="dock-step-side">
              <StepPanel v-if="stepSel" :key="`step:${desk.selected.value!.id}`" />
              <ScenarioPanel v-else-if="scSel" :key="`sc:${desk.selected.value!.id}`" />
              <RunSection v-else-if="runSel" :key="`run:${desk.selected.value?.id ?? ''}`" />
            </div>
          </template>
          <p v-else class="empty">没有打开的场景</p>
        </template>
        <!-- 第二十轮读先方案：辅助栏的一页 = 事实卡（架构台渲染）+ 故事（有图解才有）。exp 与 fact 两种标签同一渲染，事实卡在页顶 -->
        <ModuleDoc v-else :key="active.id" :module="active.doc.module" :with-story="active.doc.kind === 'explainer'" />
      </template>
      <p v-else class="empty">从场景、文件或面板里的「预览」打开一份资料，放进这一组</p>
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

.focused .tabs {
  box-shadow: inset 0 2px 0 var(--accent);
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

/* Q4'：步骤节钉在时序图下方，不把回放参照挤走 */
.seq {
  flex: 1 1 auto;
  min-height: 0;
}

.step-side {
  flex: none;
  max-height: 45%;
  overflow: auto;
  border-top: 1px solid var(--border);
  padding: 8px 10px;
  background: var(--surface);
}
</style>
