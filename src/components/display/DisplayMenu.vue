<script setup lang="ts">
/**
 * 「显示 ▾」菜单（L49，第十七轮 R4.2，ADR-0056；Google Maps 图层菜单的做法）：工具栏上的一枚按钮，展开成下拉菜单，
 * 只放**没有画布记号的显示设置**——有记号的开关在图例行上（L45），一个开关只出现在一处。按视角只出现能用的项：
 * 交互视角为边界节点、只看现状、热度口径；结构视角另有只看交互使用、只看未解释（带收起计数，L21）、总是展开表面（L20）；
 * 运行视角只有交互关系的显示方式（V8）与一行说明（L9：舞台不受显示开关影响）。
 * 按钮旁的摘要列出非默认设置（沿用第十五轮「显示」面板折叠摘要的口径）。单击菜单外或 Esc 收起。
 * 开关读写视图状态（desk.toggles）与显示偏好（useStructurePrefs，画布同读），不进 URL。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { HEAT_KINDS, RELATION_TYPES } from '@/model'
import { useDesk } from '@/state/inject'
import { useStage } from '../stage/useStageDisplay'
import { useStructurePrefs } from './useDisplayPrefs'
import { heatControls } from './useEvolutionPrefs'
import { EVOLUTION_HINT, HEAT_HINT, HEAT_LABEL, MODES, MODE_HINT, MODE_LABEL } from './labels'
import type { StructureFilter } from '@/state/desk/facts'

const desk = useDesk()
const stage = useStage()
const sp = useStructurePrefs(desk.project)
const heat = heatControls(desk.project ?? '', desk)
const run = computed(() => desk.perspective.value === 'run')
const structure = computed(() => desk.perspective.value === 'structure')

const open = ref(false)
const root = ref<HTMLElement>()
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

// ── 结构筛选（L21：只适用于结构视角，有代码事实时）──
const facts = computed(() => desk.facts.status.value === 'ready' && !!desk.facts.structure.value?.facts)
const invokesOnly = computed({ get: () => sp.prefs.value.invokesOnly, set: sp.setInvokesOnly })
const uncoveredOnly = computed({ get: () => sp.prefs.value.uncoveredOnly, set: sp.setUncoveredOnly })
const surfaceAlways = computed({ get: () => sp.prefs.value.surfaceAlways, set: sp.setSurfaceAlways })
const filter = computed<StructureFilter>(() => ({ typeOnly: sp.prefs.value.typeOnly, invokesOnly: invokesOnly.value, uncoveredOnly: uncoveredOnly.value }))
/** 按某个开关的取值算收起的条数（其余开关按当前取值） */
const hiddenWith = (patch: Partial<StructureFilter>) => desk.facts.structureDisplay({ ...filter.value, ...patch })?.hidden ?? null
const valueCount = computed(() => hiddenWith({ invokesOnly: true })?.value ?? 0)
const coveredCount = computed(() => hiddenWith({ uncoveredOnly: true })?.covered ?? 0)

// ── 热度口径（J5、L49）：开关在图例的热度行 ──
const evoReady = computed(() => desk.evolution.status.value === 'ready')

/** L49：摘要——只列非默认的设置（第十五轮「显示」面板折叠摘要的口径） */
const summary = computed(() => {
  const t = desk.toggles
  if (run.value) return [`交互关系：${MODE_LABEL[stage.mode.value]}`]
  if (structure.value)
    return [
      t.showBoundaries ? '' : '无边界节点',
      t.currentOnly ? '只看现状' : '',
      sp.prefs.value.typeOnly ? '只引类型已显示' : '',
      invokesOnly.value ? '只看交互使用' : '',
      uncoveredOnly.value ? '只看未解释' : '',
      surfaceAlways.value ? '总是展开表面' : '',
      t.heat === 'off' ? '' : `热度：${HEAT_LABEL[t.heat]}`,
      t.coupling ? '时间耦合' : '',
    ].filter(Boolean)
  const hidden = RELATION_TYPES.length - t.relationTypes.length
  return [
    hidden ? `隐藏 ${hidden} 类关系` : '',
    t.showBoundaries ? '' : '无边界节点',
    t.currentOnly ? '只看现状' : '',
    t.showFacts || desk.facts.status.value !== 'ready' ? '' : '代码事实已关',
    t.heat === 'off' ? '' : `热度：${HEAT_LABEL[t.heat]}`,
    t.coupling ? '时间耦合' : '',
    t.assembly ? '组装' : '',
  ].filter(Boolean)
})
</script>

<template>
  <div ref="root" class="display-menu">
    <button
      class="menu-btn"
      :class="{ on: open }"
      :aria-expanded="open"
      aria-haspopup="true"
      :title="`显示设置（没有画布记号的开关；有记号的开关在图例上）${summary.length ? `\n非默认：${summary.join(' · ')}` : ''}`"
      @click="open = !open"
    >
      显示 ▾<span v-if="summary.length" class="summary" data-testid="display-summary">{{ summary.join(' · ') }}</span>
    </button>
    <section v-if="open" class="menu" role="menu" aria-label="显示">
      <template v-if="run">
        <div class="setting" role="group" aria-label="交互关系">
          <span class="setting-label">交互关系</span>
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
      <template v-else>
        <div class="group-label">节点</div>
        <label class="check" title="边界节点：排在父模块框与系统框之间的虚线框（L4）"
          ><input v-model="desk.toggles.showBoundaries" type="checkbox" aria-label="边界节点" /> 边界节点</label
        >
        <label class="check" title="status 为目标态的模块及其后代不显示（L7）；隐藏时画布角留痕计数"
          ><input v-model="desk.toggles.currentOnly" type="checkbox" aria-label="只看现状" /> 只看现状<span class="hint">（隐藏目标态）</span></label
        >

        <template v-if="structure && facts">
          <div class="group-label">结构筛选与表面</div>
          <label class="check" title="只画交互使用档的束，值使用也收起（聚焦时用）；收起时画布角留痕计数">
            <input v-model="invokesOnly" type="checkbox" role="switch" aria-label="只看交互使用" />
            <span data-testid="value-count"
              >只看交互使用 · <template v-if="invokesOnly">值使用的束 {{ valueCount }} 条已收起</template
              ><span v-else class="hint">打开后收起值使用的束 {{ valueCount }} 条</span></span
            >
          </label>
          <label class="check" title="只画未解释的束：既没有交互覆盖、形态也不是端口实现 / 子类 / 组装（查缺口用）；收起时画布角留痕计数">
            <input v-model="uncoveredOnly" type="checkbox" role="switch" aria-label="只看未解释" />
            <span data-testid="uncovered-count"
              >只看未解释 · <template v-if="uncoveredOnly">已解释的束 {{ coveredCount }} 条已收起</template
              ><span v-else class="hint">打开后收起已解释的束 {{ coveredCount }} 条</span></span
            >
          </label>
          <label class="check" title="本层全部模块展开表面元素（缺省只在选中模块时展开）">
            <input v-model="surfaceAlways" type="checkbox" role="switch" aria-label="总是展开表面" />
            <span>总是展开表面</span>
          </label>
        </template>

        <div class="group-label">演化</div>
        <div v-if="!evoReady" class="info">{{ EVOLUTION_HINT[desk.evolution.status.value] }}</div>
        <div v-else class="setting" role="group" aria-label="热度口径">
          <span class="setting-label">热度口径</span>
          <span class="segmented">
            <button
              v-for="h in HEAT_KINDS"
              :key="h"
              :class="{ on: heat.kind.value === h }"
              :aria-pressed="heat.kind.value === h"
              :title="`${HEAT_HINT[h]}${desk.toggles.heat === 'off' ? '；热度的开关在图例的「演化热度」行' : ''}`"
              @click="heat.choose(h)"
            >
              {{ HEAT_LABEL[h] }}
            </button>
          </span>
        </div>
      </template>
    </section>
  </div>
</template>

<style scoped>
.display-menu {
  position: relative;
  min-width: 0;
}

.menu-btn {
  font-size: 12px;
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  max-width: 100%;
  overflow: hidden;
  white-space: nowrap;
}

.menu-btn.on {
  background: var(--accent-soft);
  color: var(--accent);
  border-color: var(--accent);
}

.summary {
  min-width: 0;
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 11.5px;
  color: var(--warning);
}

.menu {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 30;
  min-width: 240px;
  padding: 6px 12px 10px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: 0 8px 24px rgb(0 0 0 / 12%);
  font-size: 12px;
  color: var(--text);
}

.group-label {
  margin: 6px 0 2px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-3);
}

.setting {
  display: flex;
  align-items: center;
  gap: 14px;
  min-height: 26px;
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
  min-height: 24px;
  cursor: pointer;
}

.hint {
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
  padding: 1px 10px;
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

.info {
  margin: 2px 0;
  font-size: 11.5px;
  color: var(--text-3);
  cursor: help;
}
</style>
