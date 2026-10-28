<script setup lang="ts">
/**
 * 「显示」面板的设置块（W-2、L45，第十五轮 G13）：开关与筛选一律在这里、按对象分组——
 * 边界与现状；结构视角为结构筛选与表面（L21、L20，开关行带收起计数）；交互视角为关系筛选（L8）、代码事实与组装（K9、O12）；
 * 结构 / 交互视角另有演化（J5）；运行视角只有交互关系显示方式（V8）与一行说明（L9：舞台不受显示开关影响）。
 * 开关行互指它控制的画布记号（如「只引类型（点线）」）；图例组的组标题旁标注对应开关（ RelationLegend 等组件）。
 * 开关读写视图状态（desk.toggles）与显示偏好（useStructurePrefs，画布同读），不进 URL。
 */
import { computed } from 'vue'
import { HEAT_KINDS, RELATION_TYPES, type HeatKind, type RelationType } from '@/model'
import { useDesk } from '@/state/inject'
import { useStage } from '../stage/useStageDisplay'
import LineSwatch from './LineSwatch.vue'
import { useStructurePrefs } from './useDisplayPrefs'
import { MODES, MODE_HINT, MODE_LABEL, TYPE_HINT, TYPE_LABEL, TYPE_ORDER, EVOLUTION_HINT, FACTS_HINT, HEAT_HINT, HEAT_LABEL } from './labels'
import type { StructureFilter } from '@/state/desk/facts'

defineProps<{ run: boolean; structure: boolean; editing: boolean }>()
const desk = useDesk()
const stage = useStage()
const sp = useStructurePrefs(desk.project)
const typeOnly = computed({ get: () => sp.prefs.value.typeOnly, set: sp.setTypeOnly })
const invokesOnly = computed({ get: () => sp.prefs.value.invokesOnly, set: sp.setInvokesOnly })
const uncoveredOnly = computed({ get: () => sp.prefs.value.uncoveredOnly, set: sp.setUncoveredOnly })
const surfaceAlways = computed({ get: () => sp.prefs.value.surfaceAlways, set: sp.setSurfaceAlways })

const facts = computed(() => desk.facts.status.value === 'ready' && !!desk.facts.structure.value?.facts)
const factsHint = computed(() => (desk.facts.status.value === 'ready' ? '' : FACTS_HINT[desk.facts.status.value]))

const filter = computed<StructureFilter>(() => ({
  typeOnly: typeOnly.value,
  invokesOnly: invokesOnly.value,
  uncoveredOnly: uncoveredOnly.value,
}))
/** 按某个开关的取值算收起的条数（其余开关按当前取值）；没有代码事实时为 0 */
const hiddenWith = (patch: Partial<StructureFilter>) => desk.facts.structureDisplay({ ...filter.value, ...patch })?.hidden ?? null
/** L21②：只引类型的束（开关关着时收起）；一对节点一条束、按最强的一档计 */
const typeCount = computed(() => hiddenWith({ typeOnly: false })?.type ?? 0)
/** L21②：只看交互使用时收起的值使用的束 */
const valueCount = computed(() => hiddenWith({ invokesOnly: true })?.value ?? 0)
/** L21⑤：只看未解释时收起的束（有交互覆盖或已由事实解释的） */
const coveredCount = computed(() => hiddenWith({ uncoveredOnly: true })?.covered ?? 0)

// ── 关系筛选（L8：只适用于交互视角）──
const shown = (t: RelationType) => desk.toggles.relationTypes.includes(t)
const hiddenTypes = computed(() => RELATION_TYPES.length - desk.toggles.relationTypes.length)
const toggleType = (t: RelationType) => {
  const list = desk.toggles.relationTypes
  desk.setToggles({ relationTypes: shown(t) ? list.filter(x => x !== t) : [...list, t] })
}
const showAllTypes = () => desk.setToggles({ relationTypes: [...RELATION_TYPES] })
const lookOf = (t: RelationType) => ({ type: t, weight: 2 as const })

// ── 代码事实与组装（K9、O12：只适用于交互视角）──
const ready = computed(() => desk.facts.status.value === 'ready')

// ── 演化（J5）──
const evoReady = computed(() => desk.evolution.status.value === 'ready')
const evoHint = computed(() => {
  if (evoReady.value) return ''
  const st = desk.evolution.status.value
  return st === 'error' && desk.evolution.error.value ? `${EVOLUTION_HINT.error}：${desk.evolution.error.value}` : EVOLUTION_HINT[st]
})
const HEAT_OPTIONS: readonly ('off' | HeatKind)[] = ['off', ...HEAT_KINDS]
const setHeat = (h: 'off' | HeatKind) => desk.setToggles({ heat: h })
const stats = computed(() => desk.evolution.stats.value)
</script>

<template>
  <section class="settings" aria-label="设置">
    <div class="block-label">设置</div>
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
      <div class="group-label">边界与现状</div>
      <label class="check" title="边界节点：排在父模块框与系统框之间的虚线框（L4）"
        ><input v-model="desk.toggles.showBoundaries" type="checkbox" aria-label="边界节点" /> 边界节点<span class="hint">（虚线框）</span></label
      >
      <label class="check" title="status 为目标态的模块及其后代不显示（L7）；隐藏时画布角留痕计数"
        ><input v-model="desk.toggles.currentOnly" type="checkbox" aria-label="只看现状" /> 只看现状<span class="hint">（隐藏虚线框的目标态）</span></label
      >

      <template v-if="structure">
        <template v-if="facts">
          <div class="group-label">结构筛选与表面</div>
          <label class="check" title="只引类型的束缺省收起；打开后以浅色点线画出">
            <input v-model="typeOnly" type="checkbox" role="switch" aria-label="只引类型" />
            <span data-testid="type-only-count"
              >只引类型<span class="hint">（点线）</span> · <template v-if="!typeOnly">{{ typeCount }} 条已收起</template
              ><template v-else>{{ typeCount }} 条已显示</template></span
            >
          </label>
          <label class="check" title="只画交互使用档的束，值使用也收起（聚焦时用）">
            <input v-model="invokesOnly" type="checkbox" role="switch" aria-label="只看交互使用" />
            <span data-testid="value-count"
              >只看交互使用 · <template v-if="invokesOnly">值使用的束 {{ valueCount }} 条已收起</template
              ><template v-else
                ><span class="hint">打开后收起值使用的束 {{ valueCount }} 条</span></template
              ></span
            >
          </label>
          <label class="check" title="只画未解释的束：既没有交互覆盖、形态也不是端口实现 / 子类 / 组装（查缺口用）">
            <input v-model="uncoveredOnly" type="checkbox" role="switch" aria-label="只看未解释" />
            <span data-testid="uncovered-count"
              >只看未解释 · <template v-if="uncoveredOnly">已解释的束 {{ coveredCount }} 条已收起</template
              ><template v-else
                ><span class="hint">打开后收起已解释的束 {{ coveredCount }} 条</span></template
              ></span
            >
          </label>
          <label class="check" title="本层全部模块展开表面元素（缺省只在选中模块时展开）">
            <input v-model="surfaceAlways" type="checkbox" role="switch" aria-label="总是展开表面" />
            <span>总是展开表面<span class="hint">（节点上边右的表面点阵）</span></span>
          </label>
        </template>
      </template>
      <template v-else-if="!editing">
        <div class="group-label">
          关系筛选<span class="aside-note">隐藏的类在画布角留痕</span>
          <button v-if="hiddenTypes" class="link" @click="showAllTypes">全部显示</button>
        </div>
        <label v-for="t in TYPE_ORDER" :key="t" class="check type-check" :title="`${TYPE_LABEL[t]} = ${TYPE_HINT[t]}；隐藏时画布角留痕计数`">
          <input type="checkbox" :checked="shown(t)" :aria-label="`关系类型：${TYPE_LABEL[t]}`" @change="toggleType(t)" />
          <span class="sw"><LineSwatch :look="lookOf(t)" :arrow="t === 'notifies' ? 'open' : 'closed'" :width="28" /></span>
          <span
            >{{ TYPE_LABEL[t] }}<span class="hint"> = {{ TYPE_HINT[t] }}</span></span
          >
        </label>

        <div class="group-label">代码事实与组装</div>
        <label class="check" :class="{ off: !ready }" :title="factsHint || '在图上叠加代码事实：关系是否被代码证实、未解释的交互、违规与环'">
          <input v-model="desk.toggles.showFacts" type="checkbox" role="switch" :disabled="!ready" aria-label="代码事实" />
          <span>代码事实<span class="hint">（异常标签与叠加线）</span></span>
        </label>
        <label class="check" :class="{ off: !ready }" :title="factsHint || '叠加组装事实：谁 new / 工厂创建 / 注册了谁（K13），并标出组装根'">
          <input v-model="desk.toggles.assembly" type="checkbox" role="switch" :disabled="!ready" aria-label="组装" />
          <span>组装<span class="hint">（虚线 + 实心菱形）</span></span>
        </label>
        <div v-if="!ready" class="info">{{ factsHint }}</div>
      </template>

      <template v-if="!editing">
        <div class="group-label">演化</div>
        <div v-if="!evoReady" class="info">{{ evoHint }}</div>
        <template v-else>
          <div class="setting" role="group" aria-label="热度">
            <span class="setting-label">热度</span>
            <span class="segmented">
              <button
                v-for="h in HEAT_OPTIONS"
                :key="h"
                :class="{ on: desk.toggles.heat === h }"
                :aria-pressed="desk.toggles.heat === h"
                :title="HEAT_HINT[h]"
                @click="setHeat(h)"
              >
                {{ HEAT_LABEL[h] }}
              </button>
            </span>
          </div>
          <label class="check" title="本层总是一起改的模块之间画波浪线（不进布局，悬停或选中一端时画出）"
            ><input v-model="desk.toggles.coupling" type="checkbox" aria-label="时间耦合" /> 时间耦合<span class="hint">（波浪线）</span>
            <span v-if="stats" class="hint">近 {{ stats.days }} 天 · {{ stats.commits }} 次提交</span></label
          >
        </template>
      </template>
    </template>
  </section>
</template>

<style scoped>
.settings {
  padding-bottom: 8px;
  margin-bottom: 4px;
  border-bottom: 1px solid var(--border);
}

.block-label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.5px;
  color: var(--text-3);
  min-height: 22px;
  display: flex;
  align-items: center;
}

.group-label {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 4px 0 0;
  font-size: 11px;
  color: var(--text-3);
}

.aside-note {
  font-weight: 400;
  color: var(--text-3);
}

.link {
  border: none;
  background: none;
  padding: 0;
  font: inherit;
  font-size: 11px;
  color: var(--accent);
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
  min-height: 22px;
  cursor: pointer;
}

.check.off {
  opacity: 0.5;
}

.check.off input:disabled {
  cursor: not-allowed;
}

.type-check .sw {
  flex: none;
  width: 28px;
  height: 10px;
  display: inline-flex;
  align-items: center;
}

.hint {
  color: var(--text-3);
  white-space: nowrap;
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
