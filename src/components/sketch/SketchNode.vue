<script setup lang="ts">
/**
 * 草图画布的节点（present.sketch，F-20–F-28）：本层模块、由关系派生的引用节点（X22：紧凑的一行「名字 + ID」，淡色虚线、只读、不可拖，
 * 在所属层的引用列里，列放不下时整列缩小；按挂载点深度折叠，标折叠进来的关系条数，05 裁决 4）、框线（X22：系统框、中心区即挂载点框、
 * 带层名的引用列，不接收指针；拖出中心区时系统框高亮「松手 = 升级」）、根草图里的层带（X21：横向带，带头可编辑名称与 abstraction，
 * 标带内模块数与超七，「＋ 模块」「删层」；带身不接收指针，框选与双击新建落到画布上）。
 * 句柄：中心的两个隐藏句柄给直线边定位；模块与引用节点右侧的蓝色小圆点拖出连线（F-21）。
 * 拖到别的节点上时目标高亮「放下 = 降级为其子模块」（层带为「放下 = 移入这一层」，F-26）；图上标出变更时右上角角标（新 / 改 / 合 / 拆 / 移）。
 */
import { computed, inject, ref, watch } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import type { SketchNodeData } from '@/layout/layout'
import { useDesk } from '@/state/inject'
import { CHANGE_BADGES } from './labels'
import { SKETCH_ACTIONS } from './actions'

const props = defineProps<{ data: SketchNodeData & { drop?: boolean } }>()
const badge = computed(() => (props.data.change ? CHANGE_BADGES[props.data.change] : null))
const desk = useDesk()
const actions = inject(SKETCH_ACTIONS, null)

// ── 层带头：名称与 abstraction 失焦提交一步（值未变不提交，X7g）──
const name = ref('')
const abstraction = ref('')
watch(
  () => [props.data.name, props.data.abstraction] as const,
  ([n, a]) => {
    name.value = n
    abstraction.value = a ?? ''
  },
  { immediate: true },
)
function report(r: { ok: boolean; reason?: string }) {
  if (!r.ok) actions?.notify(r.reason ?? '做不成')
}
function commitName() {
  const v = name.value.trim()
  if (!v) name.value = props.data.name
  else if (v !== props.data.name) report(desk.edit.updateModule(props.data.id, { name: v }))
}
function commitAbstraction() {
  const v = abstraction.value.trim()
  if (v !== (props.data.abstraction ?? '')) report(desk.edit.updateModule(props.data.id, { abstraction: v || undefined }))
}
const select = () => desk.select({ kind: 'module', id: props.data.id })
const blur = (ev: KeyboardEvent) => (ev.target as HTMLElement).blur()
/** X22：引用列放不下时整列缩小——内容按原大排版再整体缩放 */
const scaled = computed(() => {
  const k = props.data.scale ?? 1
  return k === 1 ? {} : { width: `${100 / k}%`, height: `${100 / k}%`, transform: `scale(${k})`, transformOrigin: '0 0' }
})
</script>

<template>
  <div
    v-if="data.kind === 'layer'"
    class="sk-band"
    :class="{ selected: data.selected, drop: data.drop, over: data.over }"
    :data-band="data.id"
    :title="`${data.name}（${data.id}）`"
  >
    <Handle id="t" type="target" :position="Position.Top" class="sk-center" :connectable="false" />
    <Handle id="c" type="source" :position="Position.Bottom" class="sk-center" :connectable="false" />
    <div class="band-head nodrag nopan" @click="select">
      <div class="band-title">
        <span class="tag-inline">层</span>
        <input v-model="name" class="band-name" name="band-name" :aria-label="`层名称（${data.id}）`" @blur="commitName" @keydown.enter="blur" />
        <span v-if="badge" class="badge static" :class="data.change" :title="badge.title">{{ badge.text }}</span>
      </div>
      <textarea
        v-model="abstraction"
        class="band-abs"
        name="band-abstraction"
        rows="2"
        placeholder="这一层的抽象原则…"
        :aria-label="`层的抽象原则（${data.id}）`"
        @blur="commitAbstraction"
      />
      <div class="band-foot">
        <span class="band-count" :title="data.over ? '超过 7 个，考虑归并（X13）' : '带内模块数'"
          >{{ data.count ?? 0 }} 个<template v-if="data.over"> · 考虑归并</template></span
        >
        <button class="mini" title="在这一层新建模块（也可双击带内空白）" @click.stop="actions?.addIn(data.id, { x: $event.clientX, y: $event.clientY })">
          ＋ 模块
        </button>
        <button class="mini danger" title="删除这一层（连同带内模块）" @click.stop="actions?.removeLayer(data.id)">删层</button>
      </div>
    </div>
    <span v-if="data.drop" class="drop-hint band-drop">放下 = 移入这一层</span>
  </div>
  <div v-else-if="data.kind === 'frame'" class="sk-frame" :class="[data.frame, { drop: data.drop }]" :data-frame="data.frame">
    <span class="frame-label"
      >{{ data.name }}<span v-if="data.tag" class="frame-tag">{{ data.tag }}</span></span
    >
    <span v-if="data.drop" class="drop-hint frame-drop">松手 = 升级到上一层</span>
  </div>
  <div
    v-else-if="data.kind === 'reference'"
    class="sk-ref"
    :class="{ selected: data.selected }"
    :data-side="data.side"
    :title="`${data.name}（${data.id}）${data.members ? `\n折叠显示：${data.members.join('、')}` : ''}${(data.relations ?? 0) > 1 ? `\n${data.relations} 条关系` : ''}`"
  >
    <Handle id="t" type="target" :position="Position.Top" class="sk-center" :connectable="true" />
    <Handle id="c" type="source" :position="Position.Bottom" class="sk-center" :connectable="false" />
    <div class="ref-body" :style="scaled">
      <strong class="name">{{ data.name }}</strong>
      <code class="id">{{ data.id }}</code>
      <span v-if="(data.relations ?? 0) > 1" class="ref-count">×{{ data.relations }}</span>
    </div>
    <Handle
      id="out"
      type="source"
      :position="data.side === 'right' ? Position.Left : Position.Right"
      class="sk-out nodrag"
      :connectable="true"
      title="拖到本层模块上建关系"
    />
  </div>
  <div
    v-else
    class="sk-node"
    :class="[data.kind, { selected: data.selected, drop: data.drop, core: data.role === 'core', shelf: data.shelf }]"
    :title="`${data.name}（${data.id}）${data.shelf ? '\n共用件：收在本层框底部的共用件架（SK-22）' : ''}`"
  >
    <Handle id="t" type="target" :position="Position.Top" class="sk-center" :connectable="true" />
    <Handle id="c" type="source" :position="Position.Bottom" class="sk-center" :connectable="false" />
    <strong class="name">{{ data.name }}<span v-if="data.role === 'core'" class="star" title="核心">★</span></strong>
    <code class="id">{{ data.id }}</code>
    <span v-if="data.deeper" class="deeper" title="有下一层：双击进入">›</span>
    <span v-if="badge" class="badge" :class="data.change" :title="badge.title">{{ badge.text }}</span>
    <span v-if="data.drop" class="drop-hint">放下 = 降级为其子模块</span>
    <Handle id="out" type="source" :position="Position.Right" class="sk-out nodrag" :connectable="true" title="拖到另一个节点上建关系" />
    <div v-if="data.ports?.length" class="sk-ports">
      <span
        v-for="p in data.ports"
        :key="p.id"
        class="sk-port nodrag"
        :class="{ orphan: !p.implementers }"
        :data-port="p.id"
        :title="`端口「${p.name}」：实现者 ${p.implementers}——从模块的连线柄拖到这里 = 声明它实现这个端口（X24）`"
      >
        <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 1 A4 4 0 0 0 2 9" /></svg>{{ p.name }} · {{ p.implementers }}
        <Handle :id="`port:${p.id}`" type="target" :position="Position.Top" class="sk-port-handle" :connectable="true" />
      </span>
    </div>
  </div>
</template>

<style scoped>
/* X24：端口记号骑在模块顶边的后半（同 L13），整块是连线的落点 */
.sk-ports {
  position: absolute;
  top: -9px;
  left: 50%;
  right: 4px;
  display: flex;
  gap: 3px;
  justify-content: flex-end;
  pointer-events: none;
}

.sk-port {
  position: relative;
  pointer-events: auto;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  max-width: 100%;
  height: 16px;
  padding: 0 5px 0 3px;
  font-size: 10px;
  line-height: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text-2);
  background: var(--surface);
  border: 1px solid var(--border-strong, var(--border));
  border-radius: 8px;
}

.sk-port.orphan {
  border-color: var(--warning);
}

.sk-port svg path {
  fill: none;
  stroke: var(--rel-commands, var(--accent));
  stroke-width: 1.6;
}

/* 句柄铺满记号、不可见：落在记号上即连到端口 */
.sk-port :deep(.sk-port-handle) {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  transform: none;
  border: none;
  border-radius: 8px;
  background: transparent;
  opacity: 0;
}

.sk-frame {
  position: relative;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  border: 1.5px dashed var(--border-strong, var(--border));
  border-radius: 14px;
  pointer-events: none;
}

.sk-frame.center {
  border-style: solid;
  border-color: var(--border-strong, var(--border));
  background: color-mix(in srgb, var(--surface) 70%, transparent);
}

.sk-frame.column {
  border: 1px dashed var(--border);
  border-radius: 10px;
  background: color-mix(in srgb, var(--surface-2) 35%, transparent);
}

.sk-frame.shelf {
  border: 1px dashed var(--border);
  border-radius: 8px;
  background: color-mix(in srgb, var(--surface-2) 50%, transparent);
}

.sk-frame.shelf .frame-label {
  top: 50%;
  left: 6px;
  transform: translateY(-50%);
  background: transparent;
}

.sk-frame.drop {
  border: 2px dashed var(--warning);
  background: color-mix(in srgb, var(--warning-soft) 40%, transparent);
}

.frame-label {
  position: absolute;
  top: -10px;
  left: 16px;
  padding: 0 6px;
  font-size: 11px;
  color: var(--text-3);
  background: var(--bg);
  white-space: nowrap;
}

.sk-frame.center .frame-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-2);
}

.sk-frame.column .frame-label {
  left: 10px;
  font-size: 10.5px;
}

.frame-tag {
  margin-left: 4px;
  padding: 0 4px;
  border: 1px solid var(--border);
  border-radius: 4px;
  font-size: 10px;
}

.frame-drop {
  top: 6px;
  bottom: auto;
  left: auto;
  right: 16px;
}

.sk-ref {
  position: relative;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  border: 1px dashed var(--border-strong, var(--border));
  border-radius: 6px;
  background: var(--surface-2);
  color: var(--text-3);
  cursor: pointer;
}

.sk-ref.selected {
  border-style: solid;
  border-color: var(--accent);
  color: var(--text-2);
}

.ref-body {
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 8px;
  overflow: hidden;
  font-size: 11.5px;
}

.ref-body .name {
  flex: 0 1 auto;
  font-size: 11.5px;
  font-weight: 500;
}

.ref-body .id {
  flex: 1 1 0;
  min-width: 0;
  font-size: 10px;
}

.ref-count {
  flex: none;
  font-size: 10px;
}

/* 引用节点的连线柄只在悬停时显示（列里不堆满蓝点） */
.sk-ref .sk-out {
  opacity: 0;
}

.sk-ref:hover .sk-out {
  opacity: 1;
}

.sk-band {
  position: relative;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  border: 1.5px solid var(--border);
  border-radius: 10px;
  background: color-mix(in srgb, var(--surface-2) 45%, transparent);
  pointer-events: none;
}

.sk-band.selected {
  border-color: var(--accent);
}

.sk-band.drop {
  outline: 2px dashed var(--warning);
  outline-offset: 2px;
  background: color-mix(in srgb, var(--warning-soft) 50%, transparent);
}

.band-head {
  position: absolute;
  top: 6px;
  bottom: 6px;
  left: 6px;
  width: 196px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 4px 8px;
  border-right: 1px solid var(--border);
  pointer-events: auto;
  cursor: default;
  font-size: 12px;
}

.band-title {
  display: flex;
  align-items: center;
  gap: 4px;
}

.tag-inline {
  padding: 0 4px;
  font-size: 10px;
  border-radius: 4px;
  border: 1px solid var(--border);
  color: var(--text-3);
}

.band-name {
  flex: 1;
  min-width: 0;
  font-weight: 600;
  font-size: 13px;
  border: 1px solid transparent;
  background: transparent;
  padding: 1px 3px;
}

.band-name:hover,
.band-name:focus,
.band-abs:hover,
.band-abs:focus {
  border-color: var(--border);
  background: var(--surface);
}

.band-abs {
  resize: none;
  font-size: 11px;
  color: var(--text-2);
  border: 1px solid transparent;
  background: transparent;
  padding: 1px 3px;
  line-height: 1.35;
}

.band-foot {
  display: flex;
  align-items: center;
  gap: 4px;
}

.band-count {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text-3);
  font-size: 11px;
}

.sk-band.over .band-count {
  color: var(--warning);
  font-weight: 600;
}

.mini {
  font-size: 10.5px;
  padding: 0 5px;
}

.mini.danger {
  color: var(--danger);
}

.band-drop {
  left: 216px;
  bottom: 4px;
}

.badge.static {
  position: static;
}

.sk-node {
  position: relative;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
  padding: 6px 12px;
  border: 1.5px solid var(--border-strong, var(--border));
  border-radius: 8px;
  background: var(--surface);
  font-size: 12.5px;
  cursor: grab;
}

.sk-node.layer {
  background: var(--surface-2);
  border-style: solid;
  border-color: var(--text-3);
}

.sk-node.core {
  border-width: 2px;
  border-color: var(--accent);
}

.sk-node.core .name {
  font-size: 14px;
}

/* SK-22：共用件架上的紧凑块——只显示名称 */
.sk-node.shelf {
  padding: 2px 8px;
  justify-content: center;
  background: var(--surface-2);
  border-width: 1px;
  border-color: var(--border);
  border-radius: 6px;
}

.sk-node.shelf .id,
.sk-node.shelf .deeper {
  display: none;
}

.sk-node.shelf .name {
  font-size: 12px;
  color: var(--text-2);
}

.sk-node.selected {
  box-shadow: 0 0 0 3px var(--accent-soft);
  border-color: var(--accent);
}

.sk-node.drop {
  outline: 2px dashed var(--warning);
  outline-offset: 4px;
}

.name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}

.star {
  margin-left: 4px;
  color: var(--accent);
}

.id {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10.5px;
  color: var(--text-3);
}

.deeper {
  position: absolute;
  right: 18px;
  bottom: 4px;
  color: var(--text-3);
  font-weight: 700;
}

.badge {
  position: absolute;
  top: -9px;
  right: -9px;
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  display: grid;
  place-items: center;
  border-radius: 9px;
  font-size: 11px;
  font-weight: 700;
  color: #fff;
  background: var(--diff-changed);
}

.badge.added {
  background: var(--diff-added);
}

.badge.merged,
.badge.split {
  background: var(--accent);
}

.badge.moved {
  background: var(--warning);
}

.drop-hint {
  position: absolute;
  bottom: -22px;
  left: 0;
  white-space: nowrap;
  font-size: 11px;
  color: var(--warning);
}

.sk-center {
  top: 50% !important;
  left: 50% !important;
  opacity: 0;
  pointer-events: none;
  width: 1px !important;
  height: 1px !important;
  min-width: 0 !important;
  min-height: 0 !important;
  border: none !important;
}

.sk-out {
  width: 10px !important;
  height: 10px !important;
  border: 2px solid var(--surface) !important;
  background: var(--accent) !important;
  cursor: crosshair;
}
</style>
