<script setup lang="ts">
/**
 * 「显示」面板（W-2、ADR-0017）：画布右下角，先「设置」后「图例」。
 * - 设置：只放没有对应图例的开关——结构视角为边界节点、只看现状；运行视角为静态关系显示方式（V8），
 *   并用一行说明运行视角下舞台不受结构类开关影响（L9）。
 * - 图例：按画布上的对象分组（关系、节点、代码事实、回放），一行一项，左列为与画布同款的示意、右列为文字；
 *   既是开关又是图例的放在图例里——关系类型行点击筛选（L8），代码事实开关在组标题右侧（K9）。
 *   时序图的箭头约定不在这里，在副栏时序图标题栏的「?」里。
 * - 折叠时标题后摘要列出非默认的设置；面板展开与各组折叠按视角记在本机（运行视角默认只展开「回放」）。
 * 开关写 DeskState 的 toggles；静态关系写舞台显示（按项目记在本机，V8）。
 */
import { computed, ref, watch } from 'vue'
import { RELATION_TYPES, RUNTIME_RELATION_TYPES, type RelationType } from '@/model'
import type { StaticMode } from '@/layout/stage'
import { useDesk } from '@/state/inject'
import { useStage } from './stage/useStageDisplay'

const desk = useDesk()
const stage = useStage()
const run = computed(() => desk.perspective.value === 'run')

// ── 本机记忆：面板展开、各组折叠（按视角）──
type Group = 'rel' | 'node' | 'facts' | 'play'
const DEFAULT_GROUPS: Record<'structure' | 'run', Record<Group, boolean>> = {
  structure: { rel: true, node: true, facts: true, play: true },
  run: { rel: false, node: false, facts: true, play: true },
}
const persp = () => (desk.perspective.value === 'run' ? 'run' : 'structure')
function read<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key)
    return v === null ? fallback : (JSON.parse(v) as T)
  } catch {
    return fallback
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* 存不了就算了 */
  }
}
const OPEN_KEY = () => `h5p-arch-desk:display-open:${persp()}`
const GROUPS_KEY = () => `h5p-arch-desk:display-groups:${persp()}`
const open = ref(read(OPEN_KEY(), persp() !== 'run'))
const groups = ref({ ...DEFAULT_GROUPS[persp()], ...read(GROUPS_KEY(), {}) })
watch(desk.perspective, () => {
  open.value = read(OPEN_KEY(), persp() !== 'run')
  groups.value = { ...DEFAULT_GROUPS[persp()], ...read(GROUPS_KEY(), {}) }
})
function toggleOpen() {
  open.value = !open.value
  write(OPEN_KEY(), open.value)
}
function toggleGroup(g: Group) {
  groups.value = { ...groups.value, [g]: !groups.value[g] }
  write(GROUPS_KEY(), groups.value)
}

// ── 设置 ──
const MODES: readonly StaticMode[] = ['hide', 'dim', 'show']
const MODE_LABEL: Record<StaticMode, string> = { hide: '隐藏', dim: '淡显', show: '全显' }
const MODE_HINT: Record<StaticMode, string> = {
  hide: '只显示参与本场景的节点与走过的边',
  dim: '不参与的节点与静态边淡化显示',
  show: '全部照常显示',
}

// ── 关系类型筛选（L8）──
const LABEL: Record<RelationType, string> = {
  depends: '依赖（编译期）',
  calls: '调用（控制权转移）',
  dataflow: '数据推送',
  event: '事件',
  implements: '实现端口 / 契约',
}
/** 与 RouteEdge 一致（L10）：运行时饱和、编译期更细；运行时在前 */
const TYPE_ORDER = [...RUNTIME_RELATION_TYPES, ...RELATION_TYPES.filter(t => !RUNTIME_RELATION_TYPES.includes(t))]
const typeWidth = (t: RelationType) => (RUNTIME_RELATION_TYPES.includes(t) ? 2.5 : 1.5)
const shown = (t: RelationType) => desk.toggles.relationTypes.includes(t)
const hiddenTypes = computed(() => RELATION_TYPES.length - desk.toggles.relationTypes.length)
function toggleType(t: RelationType) {
  const list = desk.toggles.relationTypes
  desk.setToggles({ relationTypes: shown(t) ? list.filter(x => x !== t) : [...list, t] })
}
const showAllTypes = () => desk.setToggles({ relationTypes: [...RELATION_TYPES] })

// ── 代码事实（K9）──
const FACTS_HINT: Record<string, string> = {
  design: '设计版本与历史提交不对应当前代码，没有代码事实',
  loading: '正在提取代码依赖…',
  error: '读取源码或提取代码依赖失败',
}
const factsReady = computed(() => desk.facts.status.value === 'ready')
const factsHint = computed(() => (factsReady.value ? '' : FACTS_HINT[desk.facts.status.value]))

/** 折叠时的摘要：只列非默认的设置 */
const summary = computed(() => {
  const t = desk.toggles
  if (run.value) return stage.mode.value === 'hide' ? [] : [`静态关系：${MODE_LABEL[stage.mode.value]}`]
  return [
    hiddenTypes.value ? `隐藏 ${hiddenTypes.value} 类关系` : '',
    t.showBoundaries ? '' : '无边界节点',
    t.currentOnly ? '只看现状' : '',
    t.showFacts || !factsReady.value ? '' : '代码事实已关',
  ].filter(Boolean)
})
</script>

<template>
  <div class="display" role="region" aria-label="显示">
    <button class="head-btn" :aria-expanded="open" @click="toggleOpen">
      <span class="title">显示</span><span class="caret">{{ open ? '▾' : '▸' }}</span>
      <span v-if="!open && summary.length" class="summary">{{ summary.join(' · ') }}</span>
    </button>

    <div v-if="open" class="body">
      <!-- 设置：只放没有图例的开关 -->
      <section class="settings">
        <div v-if="!run" class="setting">
          <label class="check"><input v-model="desk.toggles.showBoundaries" type="checkbox" /> 边界节点</label>
          <label class="check"><input v-model="desk.toggles.currentOnly" type="checkbox" /> 只看现状</label>
        </div>
        <template v-else>
          <div class="setting" role="group" aria-label="静态关系">
            <span class="setting-label">静态关系</span>
            <span class="segmented">
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
            </span>
          </div>
          <div class="info" title="运行视角下舞台不受边界节点、只看现状、关系类型筛选与代码事实影响；退出场景后恢复">ⓘ 场景中显示全部节点与关系类型</div>
        </template>
      </section>

      <!-- 图例 -->
      <section class="group">
        <div class="group-head">
          <button class="group-btn" :aria-expanded="groups.rel" @click="toggleGroup('rel')">
            <span class="caret">{{ groups.rel ? '▾' : '▸' }}</span
            >关系
          </button>
          <template v-if="!run && groups.rel">
            <button v-if="hiddenTypes" class="link" @click="showAllTypes">全部显示</button>
            <span v-else class="aside-note">点击筛选</span>
          </template>
        </div>
        <template v-if="groups.rel">
          <div v-if="!run" role="group" aria-label="关系类型筛选">
            <button
              v-for="t in TYPE_ORDER"
              :key="t"
              class="item type"
              :class="{ off: !shown(t) }"
              :aria-pressed="shown(t)"
              :title="shown(t) ? '点击隐藏这类关系' : '点击显示这类关系'"
              @click="toggleType(t)"
            >
              <svg class="sw" viewBox="0 0 28 10">
                <line x1="1" y1="5" x2="27" y2="5" :stroke="shown(t) ? `var(--rel-${t})` : 'var(--text-3)'" :stroke-width="typeWidth(t)" />
              </svg>
              <span>{{ LABEL[t] }}</span>
            </button>
          </div>
          <template v-else>
            <div v-for="t in TYPE_ORDER" :key="t" class="item">
              <svg class="sw" viewBox="0 0 28 10">
                <line x1="1" y1="5" x2="27" y2="5" :stroke="`var(--rel-${t})`" :stroke-width="typeWidth(t)" />
              </svg>
              <span>{{ LABEL[t] }}</span>
            </div>
          </template>
          <div class="item">
            <svg class="sw" viewBox="0 0 28 10">
              <line x1="1" y1="3" x2="27" y2="3" stroke="var(--text-2)" stroke-width="1.5" />
              <line x1="1" y1="8" x2="27" y2="8" stroke="var(--text-2)" stroke-width="1.5" stroke-dasharray="6 4" />
            </svg>
            <span>实线 = 已证实，虚线 = 未证实</span>
          </div>
          <div class="item">
            <svg class="sw" viewBox="0 0 28 10">
              <line x1="1" y1="3" x2="10" y2="3" stroke="var(--text-2)" stroke-width="1.5" />
              <path d="M8,0 L13,3 L8,6 Z" fill="var(--text-2)" />
              <line x1="15" y1="3" x2="25" y2="3" stroke="var(--text-2)" stroke-width="1.5" />
              <path d="M22,0.5 L26.5,3 L22,5.5" fill="none" stroke="var(--text-2)" stroke-width="1.2" />
            </svg>
            <span>箭头实心 = 同步，空心 = 异步</span>
          </div>
          <div class="item">
            <svg class="sw" viewBox="0 0 28 10">
              <line x1="1" y1="5" x2="20" y2="5" stroke="var(--rel-implements)" stroke-width="1.5" />
              <path d="M20,1.5 L26.5,5 L20,8.5 Z" fill="var(--surface)" stroke="var(--rel-implements)" stroke-width="1.2" />
            </svg>
            <span>空心三角 = 实现端口 / 契约</span>
          </div>
          <div class="item">
            <svg class="sw" viewBox="0 0 28 10">
              <line x1="1" y1="5" x2="17" y2="5" stroke="var(--text-2)" stroke-width="3.5" />
              <rect x="17.5" y="1" width="10" height="8" rx="4" fill="var(--surface)" stroke="var(--border-strong)" />
            </svg>
            <span>线越粗 = 聚合的关系越多（×N）</span>
          </div>
        </template>
      </section>

      <section class="group">
        <div class="group-head">
          <button class="group-btn" :aria-expanded="groups.node" @click="toggleGroup('node')">
            <span class="caret">{{ groups.node ? '▾' : '▸' }}</span
            >节点
          </button>
        </div>
        <div v-if="groups.node" class="item inline">
          <span><span class="box" />模块</span>
          <span><span class="box stack" />可下钻</span>
          <span><span class="box dashed" />目标态 / 外部</span>
        </div>
      </section>

      <section v-if="!run" class="group">
        <div class="group-head">
          <button class="group-btn" :aria-expanded="groups.facts" @click="toggleGroup('facts')">
            <span class="caret">{{ groups.facts ? '▾' : '▸' }}</span
            >代码事实
          </button>
          <label class="switch facts" :class="{ off: !factsReady }" :title="factsHint || '在图上叠加代码事实：关系是否被代码证实、未描述的依赖、违规与环'">
            <input v-model="desk.toggles.showFacts" type="checkbox" role="switch" :disabled="!factsReady" aria-label="代码事实" />
          </label>
        </div>
        <template v-if="groups.facts">
          <div v-if="!factsReady" class="item muted">{{ factsHint }}</div>
          <div v-else-if="!desk.toggles.showFacts" class="item muted">打开后在图上叠加代码证实、未描述依赖、违规与环</div>
          <template v-else>
            <div class="item">
              <svg class="sw" viewBox="0 0 28 10"><line x1="1" y1="5" x2="27" y2="5" stroke="var(--text-2)" stroke-width="1.5" /></svg>
              <span>实线 = 已证实（不加标记）</span>
            </div>
            <div class="item">
              <svg class="sw" viewBox="0 0 28 10">
                <line x1="1" y1="5" x2="20" y2="5" stroke="var(--text-2)" stroke-width="1.5" stroke-dasharray="6 4" />
                <text x="22" y="9" class="q">?</text>
              </svg>
              <span>虚线 + ? = 未证实（含部分证实）</span>
            </div>
            <div class="item">
              <span class="sw"><span class="cycle">↻N</span></span
              ><span>本层的环</span>
            </div>
            <div class="item">
              <svg class="sw" viewBox="0 0 28 10">
                <line x1="1" y1="5" x2="27" y2="5" stroke="var(--edge-code)" stroke-width="2" stroke-dasharray="0.5 4.5" stroke-linecap="round" />
              </svg>
              <span>点线 = 代码有、描述无（未描述的依赖）</span>
            </div>
            <div class="item">
              <svg class="sw" viewBox="0 0 28 10">
                <line x1="1" y1="5" x2="27" y2="5" stroke="var(--danger)" stroke-width="7" stroke-opacity="0.3" stroke-linecap="round" />
                <line x1="1" y1="5" x2="27" y2="5" stroke="var(--danger)" stroke-width="2" stroke-dasharray="0.5 4.5" stroke-linecap="round" />
              </svg>
              <span>违规（红色点线；关系边加红晕）</span>
            </div>
          </template>
        </template>
      </section>

      <section v-else class="group">
        <div class="group-head">
          <button class="group-btn" :aria-expanded="groups.play" @click="toggleGroup('play')">
            <span class="caret">{{ groups.play ? '▾' : '▸' }}</span
            >回放
          </button>
        </div>
        <template v-if="groups.play">
          <div class="item">
            <svg class="sw" viewBox="0 0 28 10">
              <line class="flow" x1="1" y1="5" x2="27" y2="5" stroke="var(--accent)" stroke-width="3" stroke-dasharray="6 4" />
            </svg>
            <span>当前步骤（沿消息方向流动）</span>
          </div>
          <div class="item">
            <span class="sw"><span class="badge">3</span></span
            ><span>已走过的步骤</span>
          </div>
          <div class="item">
            <span class="sw"><span class="badge muted">3</span></span
            ><span>其余已走的步骤（选中某步时）</span>
          </div>
          <div class="item">
            <span class="sw"><span class="box active" /></span><span>当前端点 / 内部活动</span>
          </div>
          <div class="item">
            <svg class="sw" viewBox="0 0 28 10"><line x1="1" y1="5" x2="27" y2="5" stroke="var(--rel-calls)" stroke-width="2" stroke-dasharray="6 4" /></svg>
            <span>经由上层关系（类型色虚线，本层没有它的边）</span>
          </div>
          <div class="item">
            <svg class="sw" viewBox="0 0 28 10"><line x1="1" y1="5" x2="27" y2="5" stroke="var(--danger)" stroke-width="2" stroke-dasharray="5 5" /></svg>
            <span>结构中未建模</span>
          </div>
          <div class="item">
            <svg class="sw" viewBox="0 0 28 10"><line x1="1" y1="5" x2="27" y2="5" stroke="var(--warning)" stroke-width="2" stroke-dasharray="6 4" /></svg>
            <span>分支预览</span>
          </div>
        </template>
      </section>
    </div>
  </div>
</template>

<style scoped>
.display {
  position: absolute;
  right: 12px;
  bottom: 12px;
  z-index: 5;
  display: flex;
  flex-direction: column;
  min-width: 236px;
  max-width: 300px;
  max-height: calc(100% - 24px);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font-size: 12px;
  color: var(--text);
}

button {
  font: inherit;
}

.head-btn {
  flex: none;
  display: flex;
  align-items: baseline;
  gap: 4px;
  border: none;
  background: none;
  padding: 5px 10px;
  text-align: left;
  color: var(--text-2);
}

.head-btn .title {
  font-weight: 600;
}

.caret {
  display: inline-block;
  width: 12px;
  font-size: 12px;
  line-height: 1;
  color: var(--text-3);
}

.summary {
  margin-left: 4px;
  color: var(--warning);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.body {
  overflow-y: auto;
  padding: 0 10px 8px;
}

/* ── 设置 ── */
.settings {
  padding-bottom: 8px;
  margin-bottom: 4px;
  border-bottom: 1px solid var(--border);
}

.setting {
  display: flex;
  align-items: center;
  gap: 14px;
  min-height: 24px;
}

.setting-label {
  color: var(--text-2);
  white-space: nowrap;
}

.check {
  display: flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
  color: var(--text-2);
}

.segmented {
  display: inline-flex;
  margin-left: -6px;
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
}

.segmented button {
  border: none;
  border-radius: 0;
  background: none;
  padding: 1px 10px;
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

.info {
  margin-top: 2px;
  font-size: 11.5px;
  color: var(--text-3);
  cursor: help;
}

/* ── 图例分组 ── */
.group + .group {
  margin-top: 6px;
}

.group-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 22px;
}

.group-btn {
  border: none;
  background: none;
  padding: 0;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-3);
  letter-spacing: 0.5px;
}

.aside-note {
  font-size: 11px;
  color: var(--text-3);
}

.link {
  border: none;
  background: none;
  padding: 0;
  font-size: 11px;
  color: var(--accent);
}

/* 一行一项：左列示意固定宽，右列文字 */
.item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 22px;
  line-height: 1.35;
  text-align: left;
  color: var(--text);
}

.item.muted {
  color: var(--text-3);
  font-size: 11.5px;
}

.item.inline {
  gap: 12px;
}

.item.inline > span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  white-space: nowrap;
}

.sw {
  flex: none;
  width: 28px;
  height: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  overflow: visible;
}

.q {
  font-size: 10px;
  font-weight: 700;
  fill: var(--warning);
}

.type {
  border: none;
  background: none;
  padding: 0 4px;
  margin: 0 -4px;
  width: calc(100% + 8px);
  border-radius: 4px;
}

.type:hover {
  background: var(--surface-2);
}

.type.off > span {
  color: var(--text-3);
}

/* ── 示意 ── */
.box {
  display: inline-block;
  width: 16px;
  height: 11px;
  border: 1.5px solid var(--border-strong);
  border-radius: 3px;
}

.box.stack {
  box-shadow:
    2px 2px 0 -1px var(--surface),
    2px 2px 0 0 var(--border-strong);
}

.box.dashed {
  border-style: dashed;
}

.box.active {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-soft);
}

.badge {
  min-width: 16px;
  height: 16px;
  padding: 0 3px;
  border-radius: 8px;
  border: 1px solid var(--accent);
  color: var(--accent);
  font-size: 10px;
  font-weight: 700;
  line-height: 14px;
  text-align: center;
}

.badge.muted {
  border-color: var(--border-strong);
  color: var(--text-3);
}

.cycle {
  padding: 0 4px;
  font-size: 10px;
  line-height: 14px;
  color: var(--danger);
  border: 1px solid var(--danger);
  border-radius: 7px;
  white-space: nowrap;
}

.flow {
  animation: flow 0.9s linear infinite;
}

@keyframes flow {
  to {
    stroke-dashoffset: -20;
  }
}

/* 组标题右侧的开关 */
.switch {
  display: inline-flex;
}

.switch input {
  appearance: none;
  position: relative;
  width: 26px;
  height: 14px;
  margin: 0;
  border-radius: 7px;
  background: var(--border-strong);
  cursor: pointer;
  transition: background 0.15s;
}

.switch input::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--surface);
  transition: transform 0.15s;
}

.switch input:checked {
  background: var(--accent);
}

.switch input:checked::after {
  transform: translateX(12px);
}

.switch.off {
  opacity: 0.5;
}

.switch input:disabled {
  cursor: not-allowed;
}
</style>
