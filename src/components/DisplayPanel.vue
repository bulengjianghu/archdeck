<script setup lang="ts">
/**
 * 「显示」面板（W-2、ADR-0017）：画布右下角，画布显示设置与图例合一，开关与它的说明放在一起。
 * - 按视角只出现当前能用的开关：结构视角有边界节点、只看现状、关系类型筛选、代码事实；
 *   运行视角有静态关系显示方式（V8），结构类开关不显示，只留一行说明（L9）。
 * - 折叠时标题后摘要列出非默认的设置，筛选不会被藏起来。
 * - 展开 / 折叠按视角记在本机。
 * 开关写 DeskState 的 toggles；静态关系写舞台显示（按项目记在本机，V8）。
 */
import { computed, ref, watch } from 'vue'
import { RELATION_TYPES, type RelationType } from '@/model'
import type { StaticMode } from '@/layout/stage'
import { useDesk } from '@/state/inject'
import { useStage } from './stage/useStageDisplay'

const desk = useDesk()
const stage = useStage()
const run = computed(() => desk.perspective.value === 'run')

const OPEN_KEY = (p: string) => `h5p-arch-desk:display-open:${p}`
function readOpen(p: string): boolean {
  try {
    const v = localStorage.getItem(OPEN_KEY(p))
    return v === null ? p !== 'run' : v === '1'
  } catch {
    return p !== 'run'
  }
}
const open = ref(readOpen(desk.perspective.value))
watch(desk.perspective, p => (open.value = readOpen(p)))
function toggleOpen() {
  open.value = !open.value
  try {
    localStorage.setItem(OPEN_KEY(desk.perspective.value), open.value ? '1' : '0')
  } catch {
    /* 存不了就算了 */
  }
}

const LABEL: Record<RelationType, string> = {
  depends: '依赖（编译期）',
  calls: '调用（控制权转移）',
  dataflow: '数据推送',
  event: '事件',
  implements: '实现端口 / 契约',
}
const MODES: readonly StaticMode[] = ['hide', 'dim', 'show']
const MODE_LABEL: Record<StaticMode, string> = { hide: '隐藏', dim: '淡显', show: '全显' }
const MODE_HINT: Record<StaticMode, string> = {
  hide: '只显示参与本场景的节点与走过的边',
  dim: '不参与的节点与静态边淡化显示',
  show: '全部照常显示',
}

/** 关系类型筛选（L8）：点关系行开关该类边 */
const shown = (t: RelationType) => desk.toggles.relationTypes.includes(t)
function toggleType(t: RelationType) {
  const list = desk.toggles.relationTypes
  desk.setToggles({ relationTypes: shown(t) ? list.filter(x => x !== t) : [...list, t] })
}

/** K9：代码事实只在结构视角、有事实时可用，否则说明原因 */
const FACTS_HINT: Record<string, string> = {
  design: '设计版本不对应代码，没有代码事实',
  'no-source': '源码不在本地或构建产物不含源码，没有代码事实',
  loading: '正在提取代码依赖…',
  error: '提取代码依赖失败',
}
const factsReady = computed(() => desk.facts.status.value === 'ready')
const factsHint = computed(() => (factsReady.value ? '' : FACTS_HINT[desk.facts.status.value]))

/** 折叠时的摘要：只列非默认的设置 */
const summary = computed(() => {
  const t = desk.toggles
  if (run.value) return stage.mode.value === 'hide' ? [] : [`静态关系：${MODE_LABEL[stage.mode.value]}`]
  const hidden = RELATION_TYPES.length - t.relationTypes.length
  return [
    hidden ? `隐藏 ${hidden} 类关系` : '',
    t.showBoundaries ? '' : '无边界节点',
    t.currentOnly ? '只看现状' : '',
    t.showFacts && factsReady.value ? '代码事实' : '',
  ].filter(Boolean)
})
</script>

<template>
  <div class="display" role="region" aria-label="显示">
    <button class="toggle" :aria-expanded="open" @click="toggleOpen">
      显示 {{ open ? '▾' : '▸' }}<span v-if="!open && summary.length" class="summary">· {{ summary.join(' · ') }}</span>
    </button>
    <div v-if="open" class="body">
      <p v-if="run" class="row muted note">运行视角下舞台显示全部节点与关系（L9），退出场景后恢复</p>

      <section>
        <div class="row head">节点</div>
        <div v-if="!run" class="row">
          <label class="check"><input v-model="desk.toggles.showBoundaries" type="checkbox" /> 边界节点</label>
          <label class="check"><input v-model="desk.toggles.currentOnly" type="checkbox" /> 只看现状</label>
        </div>
        <div class="row"><span class="box" /> 模块 <span class="box stack" /> 可下钻 <span class="box dashed" /> 目标态 / 外部</div>
      </section>

      <section>
        <div class="row head">关系</div>
        <div v-if="!run" class="types" role="group" aria-label="关系类型筛选" title="点击显示 / 隐藏该类关系">
          <button v-for="t in RELATION_TYPES" :key="t" class="row type" :class="{ off: !shown(t) }" :aria-pressed="shown(t)" @click="toggleType(t)">
            <span class="rel-chip" :class="`rel-${t}`">{{ LABEL[t] }}</span>
          </button>
        </div>
        <template v-else>
          <div v-for="t in RELATION_TYPES" :key="t" class="row">
            <span class="rel-chip" :class="`rel-${t}`">{{ LABEL[t] }}</span>
          </div>
          <div class="row static-mode" role="group" aria-label="静态关系">
            <span class="muted">静态关系</span>
            <button
              v-for="m in MODES"
              :key="m"
              :class="{ on: stage.mode.value === m }"
              :aria-pressed="stage.mode.value === m"
              :title="MODE_HINT[m]"
              @click="stage.setMode(m)"
            >
              {{ MODE_LABEL[m] }}
            </button>
          </div>
        </template>
        <div class="row muted">线越粗 = 聚合的关系越多；点划线 = 异步</div>
      </section>

      <section v-if="!run">
        <label
          class="row head check facts"
          :class="{ off: !factsReady }"
          :title="factsHint || '在图上叠加代码事实：关系是否被代码证实、未描述的依赖、违规与环'"
        >
          <input v-model="desk.toggles.showFacts" type="checkbox" :disabled="!factsReady" /> 代码事实
        </label>
        <div v-if="!factsReady" class="row muted">{{ factsHint }}</div>
        <template v-else-if="desk.facts.level.value">
          <div class="row">✓ 关系已被代码证实 · ? 未证实 · ◐ 部分证实 · <span class="cycle">↻ N</span> 本层的环</div>
          <div class="row"><span class="line code" /> 未描述的代码依赖 <span class="line code bad" /> 违规（红色描边的关系边同理）</div>
        </template>
      </section>

      <section v-else>
        <div class="row head">回放</div>
        <div class="row"><span class="flow" /> 当前步骤（沿消息方向流动） <span class="num">3</span> 已走过的步骤</div>
        <div class="row"><span class="box active" /> 当前端点 / 内部活动 <span class="line unmodeled" /> 结构中未建模</div>
        <div class="row"><span class="line upper" /> 经由上层关系（关系建在上层，本层没有它的边）</div>
        <div class="row"><span class="line preview" /> 分支预览 · 时序图：实线实心箭头 = 同步，虚线开放箭头 = 异步，点线 = 返回</div>
        <div class="row muted">灰色 = 选中步骤时其余已走的步骤</div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.types {
  display: flex;
  flex-direction: column;
  margin: 0 -4px;
}

.type {
  width: 100%;
  border: none;
  background: none;
  padding: 0 4px;
  border-radius: 4px;
  font-size: 12px;
  text-align: left;
}

.type:hover {
  background: var(--surface-2);
}

.type.off {
  opacity: 0.35;
  text-decoration: line-through;
}

.summary {
  margin-left: 6px;
  color: var(--warning);
}

section + section {
  margin-top: 4px;
  padding-top: 2px;
  border-top: 1px solid var(--border);
}

.note {
  margin: 0;
  line-height: 1.5;
  padding: 2px 0 4px;
}

.check {
  display: flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
}

.row .check + .check {
  margin-left: 10px;
}

.facts.off {
  opacity: 0.5;
}

.static-mode {
  gap: 2px;
}

.static-mode .muted {
  margin-right: 4px;
}

.static-mode button {
  font-size: 12px;
  padding: 0 8px;
}

.static-mode button.on {
  background: var(--accent-soft);
  color: var(--accent);
  border-color: var(--accent);
}

.head {
  margin-top: 4px;
  font-weight: 600;
  color: var(--text-2);
}

.flow,
.line {
  display: inline-block;
  width: 22px;
  height: 0;
  vertical-align: middle;
  border-top: 3px dashed var(--accent);
}

.line.unmodeled {
  border-top: 2px dashed var(--danger);
}

.line.code {
  border-top: 2px dashed var(--text-3);
}

.line.code.bad {
  border-top-color: var(--danger);
}

.cycle {
  white-space: nowrap;
  padding: 0 5px;
  font-size: 11px;
  color: var(--danger);
  border: 1px solid var(--danger);
  border-radius: 8px;
}

.line.upper {
  border-top: 2px solid var(--rel-calls);
}

.line.preview {
  border-top: 2px dashed var(--warning);
}

.num {
  display: inline-block;
  min-width: 16px;
  font-size: 10px;
  font-weight: 700;
  text-align: center;
  color: var(--accent);
  border: 1px solid var(--accent);
  border-radius: 8px;
}

.box.active {
  box-shadow: 0 0 0 2px var(--accent);
}

.display {
  position: absolute;
  right: 12px;
  bottom: 12px;
  z-index: 5;
  display: flex;
  flex-direction: column;
  max-height: calc(100% - 24px);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font-size: 12px;
  max-width: 300px;
}

.toggle {
  border: none;
  background: none;
  font-size: 12px;
  color: var(--text-2);
  padding: 4px 10px;
  flex: none;
  text-align: left;
}

.body {
  padding: 0 10px 8px;
  overflow-y: auto;
}

.row {
  display: flex;
  align-items: center;
  gap: 6px;
  line-height: 1.9;
}

.box {
  display: inline-block;
  width: 14px;
  height: 10px;
  border: 1.5px solid var(--border-strong);
  border-radius: 3px;
  margin-left: 4px;
}

.box.stack {
  box-shadow:
    2px 2px 0 -1px var(--surface),
    2px 2px 0 0 var(--border-strong);
}

.box.dashed {
  border-style: dashed;
}
</style>
