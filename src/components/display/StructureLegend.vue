<script setup lang="ts">
/**
 * 「显示」面板 · 依赖 · 形态与档（结构视角，L16、L19、L21，ADR-0031 修订）：元素级边的四种形态记号（子类、组装、端口实现、使用）、
 * 醒目度（L43：例外深色加宽、骨架安静）与依赖的档（只引类型点线，K14）、束的一句说明；收起与例外的计数——跨界折叠（B2）、
 * 例外照画、环按组（L42）、「另直连」（L38）。只引类型 / 只看交互使用 / 只看未解释 / 总是展开表面四个开关（带收起计数）
 * 在设置块的「结构筛选与表面」组（L45，第十五轮 G13 迁出），组标题旁互指；「表面」一段：表面元素四类记号、越过入口、界外记号的说明（L20）。
 * 没有代码事实时（U16）只说明允许边。
 * - 图例按上下文显示（L47，G14）：只列本层静息态画出来的形态、档与收起计数（出现集合由 state/desk/legend 一处派生，
 *   与画布同一份 structureDisplay 过滤）；行序按固定词表、行只显隐不重排。表面元素四类与「+N」是表面展开（选中 / 悬停）才出现的
 *   临时记号（L20、ADR-0036）——归尾部「临时可见」小节常列，不随出现显隐。
 */
import { computed } from 'vue'
import { DEP_FORMS, DEP_TIERS, ELEMENT_KINDS } from '@/model'
import { SURFACE_PORT_CAP } from '@/layout/layout'
import { useDesk } from '@/state/inject'
import DisplayGroup from './DisplayGroup.vue'
import StructureSwatch from './StructureSwatch.vue'
import { useStructurePrefs } from './useDisplayPrefs'
import {
  BUNDLE_TEXT,
  DEP_FORM_HINT,
  DEP_FORM_LABEL,
  DEP_TIER_HINT,
  DEP_TIER_LABEL,
  ELEMENT_KIND_HINT,
  ELEMENT_KIND_LABEL,
  ELEMENT_KIND_MARK,
  FACTS_HINT,
} from './labels'

defineProps<{ open: boolean; presence: Set<string> }>()
const emit = defineEmits<{ toggle: [] }>()
const desk = useDesk()
const sp = useStructurePrefs(desk.project)

const facts = computed(() => desk.facts.status.value === 'ready' && !!desk.facts.structure.value?.facts)
const hint = computed(() => (desk.facts.status.value === 'ready' ? '' : FACTS_HINT[desk.facts.status.value]))

/** B2：当前折叠的跨界束（按当前的结构筛选取值） */
const crossCount = computed(
  () =>
    desk.facts.structureDisplay({
      typeOnly: sp.prefs.value.typeOnly,
      invokesOnly: sp.prefs.value.invokesOnly,
      uncoveredOnly: sp.prefs.value.uncoveredOnly,
    })?.hidden.cross ?? 0,
)
</script>

<template>
  <DisplayGroup title="依赖 · 形态与档" :open="open" @toggle="emit('toggle')">
    <template #actions>
      <span class="aside-note">开关在设置 · 结构筛选与表面</span>
    </template>
    <template v-if="facts">
      <div v-for="f in DEP_FORMS" v-show="presence.has(`struct:form:${f}`)" :key="f" class="item" :data-form="f">
        <span class="sw kind"><StructureSwatch :kind="f" /></span>
        <span
          >{{ DEP_FORM_LABEL[f] }}<span class="hint"> = {{ DEP_FORM_HINT[f] }}</span></span
        >
      </div>
      <template v-if="presence.has('struct:salience:exception') || presence.has('struct:salience:skeleton')">
        <div class="section-label">醒目度 · 跟信息量走</div>
        <div v-if="presence.has('struct:salience:exception')" class="item" data-testid="legend-salience-exception">
          <span class="sw kind"><StructureSwatch exception /></span>
          <span>例外（违规、向上、逆稳定、未解释）：深色、加宽，最先看到</span>
        </div>
        <div v-if="presence.has('struct:salience:skeleton')" class="item" data-testid="legend-salience-skeleton">
          <span class="sw kind"><StructureSwatch /></span>
          <span>骨架（其余画出来的依赖）：安静的中灰，线宽 = 条数；聚焦时其余变淡</span>
        </div>
      </template>
      <template v-if="DEP_TIERS.some(t => presence.has(`struct:tier:${t}`))">
        <div class="section-label">依赖的档</div>
        <div v-for="t in DEP_TIERS" v-show="presence.has(`struct:tier:${t}`)" :key="t" class="item" :data-tier="t">
          <span class="sw kind"><StructureSwatch :tier="t" /></span>
          <span
            >{{ DEP_TIER_LABEL[t]
            }}<span class="hint">
              = {{ DEP_TIER_HINT[t] }}{{ t === 'type' ? '；点线，缺省收起（设置 · 结构筛选与表面）' : '；画布上与另一档同画，悬停与面板写明' }}</span
            ></span
          >
        </div>
      </template>
      <div v-if="presence.has('struct:bundle')" class="item bundle" data-testid="bundle-note">
        <span class="sw kind"><span class="chip">×N 元素</span></span>
        <span>{{ BUNDLE_TEXT }}</span>
      </div>

      <template
        v-if="
          presence.has('struct:fold:cross') || presence.has('struct:fold:exceptions') || presence.has('struct:fold:cycle') || presence.has('struct:fold:direct')
        "
      >
        <div class="section-label">收起与例外 · 都带计数</div>
        <div v-if="presence.has('struct:fold:cross')" class="item" data-testid="cross-count">
          <span class="sw kind"><span class="chip">界外</span></span>
          <span
            >跨界折叠：一端是边界节点的束 {{ crossCount }} 条折叠进节点朝外一侧的「界外 入 · 出」记号，悬停或选中一端时画出<span class="hint"
              >；违规、向上、逆稳定的束不论开关照画</span
            ></span
          >
        </div>
        <div v-if="presence.has('struct:fold:exceptions')" class="item" data-testid="legend-exceptions">
          <span class="sw kind"><span class="chip warn">向上</span></span>
          <span
            >例外照画：违规、向上（依赖违背算出的层）、逆稳定、未解释；只是未解释、另一端在框外或共用件架上的仍折叠计数<span class="hint">（L42）</span></span
          >
        </div>
        <div v-if="presence.has('struct:fold:cycle')" class="item" data-testid="legend-cycle">
          <span class="sw kind"><span class="chip warn">↻ N</span></span>
          <span>环按组：环内的依赖静息态只计数（画布角「环内 N 条已收起」），单击节点上的环编号选中环组时画出</span>
        </div>
        <div v-if="presence.has('struct:fold:direct')" class="item" data-testid="legend-direct">
          <span class="sw kind"><span class="chip">另直连 N</span></span>
          <span>可由别的路径推出的依赖（传递约简）静息态不画，依赖方节点下边右计数，悬停或选中节点时画出</span>
        </div>
      </template>

      <template v-if="presence.has('struct:surface:w') || presence.has('struct:surface:bypass')">
        <div class="section-label">表面 · 入口导出与声明接口</div>
        <div v-if="presence.has('struct:surface:w')" class="item">
          <span class="sw kind"><span class="chip">表面 W</span></span>
          <span>节点角标：被外部引用的不同元素数（与「入 · 出」同一行）；开关「总是展开表面」在设置 · 结构筛选与表面</span>
        </div>
        <div v-if="presence.has('struct:surface:bypass')" class="item">
          <span class="sw kind"><span class="chip bypass">越过入口</span></span>
          <span>深层导入（不经入口）的边接到模块本体并带越过记号；建议经入口访问或把符号提升到入口</span>
        </div>
        <div v-if="presence.has('struct:fold:cross')" class="item">
          <span class="sw kind"><span class="chip">界外 入 2 · 出 1</span></span>
          <span>折叠的跨界束计数，悬停列出目标</span>
        </div>
      </template>
      <!-- L47：临时可见——表面展开（选中 / 悬停，L20、ADR-0036）才出现的元素记号，常列、不随出现显隐 -->
      <div class="section-label">临时可见 · 展开表面的节点上出现</div>
      <div class="item inline elements" aria-label="表面元素四类">
        <span v-for="k in ELEMENT_KINDS" :key="k" :title="ELEMENT_KIND_HINT[k]"
          ><span class="el-mark" :data-kind="k">{{ ELEMENT_KIND_MARK[k] }}</span
          >{{ ELEMENT_KIND_LABEL[k] }}</span
        >
      </div>
      <div class="item" data-testid="surface-cap">
        <span class="sw kind"><span class="chip">+N</span></span>
        <span
          >展开的表面是一排点：线在节点前分叉、各带小箭头指到自己的点，悬停点看名字与使用者；一个节点最多
          {{ SURFACE_PORT_CAP }} 个点（本层用得最多的、交互接到的优先），其余收进「+N」、清单在面板「表面」一节；节点不随展开移动（L20②，ADR-0036）</span
        >
      </div>
    </template>
    <template v-else>
      <div class="item muted">{{ hint || '没有代码事实' }}</div>
      <div class="item">
        <span class="sw kind"><StructureSwatch kind="allowed" /></span>
        <span>浅虚线 = 规则允许的依赖（mayDependOn）；没有代码事实，只画允许依赖</span>
      </div>
    </template>
  </DisplayGroup>
</template>

<style scoped>
.chip.warn {
  color: var(--danger);
  border-color: var(--danger);
}

.sw.kind {
  width: 54px;
  justify-content: flex-start;
}

.hint {
  color: var(--text-3);
}

.aside-note {
  font-size: 11px;
  font-weight: 400;
  color: var(--text-3);
}

.bypass {
  border-style: dashed;
  color: var(--warning);
}

.elements {
  flex-wrap: wrap;
  gap: 4px 12px;
}

.el-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  font-size: 10px;
  line-height: 1;
  color: var(--text-2);
  border: 1px solid var(--border-strong);
  border-radius: 3px;
}

.el-mark[data-kind='port'] {
  border-radius: 50%;
}
</style>
