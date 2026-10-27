<script setup lang="ts">
/**
 * 「显示」面板 · 依赖 · 形态与档（结构视角，L16、L19、L21，ADR-0031 修订）：元素级边的四种形态记号（子类、组装、端口实现、使用）、
 * 依赖的三档浓淡（K14）与束的一句说明；三个开关——只引类型（typeOnly，B1）、只看交互使用（invokesOnly，B1）、只看未解释（uncoveredOnly，B4）——
 * 各自给出收起的束条数（desk.facts.structureDisplay 的 hidden；开关关着时给出打开后会收起的条数），另给跨界折叠的条数（B2）；
 * 「表面」一段：总是展开表面（surfaceAlways，C6）开关与元素四类记号、越过入口、界外记号的说明（L20）。
 * 开关读写显示偏好（useStructurePrefs，画布同读），不进 URL。没有代码事实时（U16）只说明允许边。
 */
import { computed } from 'vue'
import { DEP_FORMS, DEP_TIERS, ELEMENT_KINDS } from '@/model'
import { SURFACE_PORT_CAP } from '@/layout/layout'
import type { StructureFilter } from '@/state/desk/facts'
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

defineProps<{ open: boolean }>()
const emit = defineEmits<{ toggle: [] }>()
const desk = useDesk()
const sp = useStructurePrefs(desk.project)
const typeOnly = computed({ get: () => sp.prefs.value.typeOnly, set: sp.setTypeOnly })
const invokesOnly = computed({ get: () => sp.prefs.value.invokesOnly, set: sp.setInvokesOnly })
const uncoveredOnly = computed({ get: () => sp.prefs.value.uncoveredOnly, set: sp.setUncoveredOnly })
const surfaceAlways = computed({ get: () => sp.prefs.value.surfaceAlways, set: sp.setSurfaceAlways })

const facts = computed(() => desk.facts.status.value === 'ready' && !!desk.facts.structure.value?.facts)
const hint = computed(() => (desk.facts.status.value === 'ready' ? '' : FACTS_HINT[desk.facts.status.value]))

const filter = computed<StructureFilter>(() => ({
  typeOnly: typeOnly.value,
  invokesOnly: invokesOnly.value,
  uncoveredOnly: uncoveredOnly.value,
}))
/** 按某个开关的取值算收起的条数（其余开关按当前取值）；没有代码事实时为 0 */
const hiddenWith = (patch: Partial<StructureFilter>) => desk.facts.structureDisplay({ ...filter.value, ...patch })?.hidden ?? null
/** B1：只引类型的束（开关关着时收起）；一对节点一条束、按最强的一档计 */
const typeCount = computed(() => hiddenWith({ typeOnly: false })?.type ?? 0)
/** B1：只看交互使用时收起的值使用的束 */
const valueCount = computed(() => hiddenWith({ invokesOnly: true })?.value ?? 0)
/** B4：只看未解释时收起的束（有交互覆盖或已由事实解释的） */
const coveredCount = computed(() => hiddenWith({ uncoveredOnly: true })?.covered ?? 0)
/** B2：当前折叠的跨界束 */
const crossCount = computed(() => hiddenWith({})?.cross ?? 0)
</script>

<template>
  <DisplayGroup title="依赖 · 形态与档" :open="open" @toggle="emit('toggle')">
    <template v-if="facts">
      <div v-for="f in DEP_FORMS" :key="f" class="item" :data-form="f">
        <span class="sw kind"><StructureSwatch :kind="f" /></span>
        <span
          >{{ DEP_FORM_LABEL[f] }}<span class="hint"> = {{ DEP_FORM_HINT[f] }}</span></span
        >
      </div>
      <div class="section-label">依赖的档 · 浓淡</div>
      <div v-for="t in DEP_TIERS" :key="t" class="item" :class="{ muted: t === 'type' && !typeOnly }">
        <span class="sw kind"><StructureSwatch :tier="t" /></span>
        <span
          >{{ DEP_TIER_LABEL[t] }}<span class="hint"> = {{ DEP_TIER_HINT[t] }}</span></span
        >
      </div>
      <div class="item bundle" data-testid="bundle-note">
        <span class="sw kind"><span class="chip">×N 元素</span></span>
        <span>{{ BUNDLE_TEXT }}</span>
      </div>

      <div class="section-label">收起与过滤 · 都带计数</div>
      <label class="item toggle" title="只引类型的束缺省收起；打开后以浅色画出">
        <span class="sw kind"
          ><span class="switch"><input v-model="typeOnly" type="checkbox" role="switch" aria-label="只引类型" /></span
        ></span>
        <span data-testid="type-only-count"
          ><b>只引类型</b> · <template v-if="!typeOnly">本层只引类型的束 {{ typeCount }} 条已收起</template
          ><template v-else>本层只引类型的束 {{ typeCount }} 条已显示</template><span class="hint type-count-note">；一对节点一条束、按最强的一档计</span></span
        >
      </label>
      <label class="item toggle" title="只画交互使用档的束，值使用也收起（聚焦时用）">
        <span class="sw kind"
          ><span class="switch"><input v-model="invokesOnly" type="checkbox" role="switch" aria-label="只看交互使用" /></span
        ></span>
        <span data-testid="value-count"
          ><b>只看交互使用</b> · <template v-if="invokesOnly">值使用的束 {{ valueCount }} 条已收起</template
          ><template v-else
            ><span class="hint">打开后收起值使用的束 {{ valueCount }} 条</span></template
          ></span
        >
      </label>
      <label class="item toggle" title="只画未解释的束：既没有交互覆盖、形态也不是端口实现 / 子类 / 组装（查缺口用）">
        <span class="sw kind"
          ><span class="switch"><input v-model="uncoveredOnly" type="checkbox" role="switch" aria-label="只看未解释" /></span
        ></span>
        <span data-testid="uncovered-count"
          ><b>只看未解释</b> · <template v-if="uncoveredOnly">已解释的束 {{ coveredCount }} 条已收起</template
          ><template v-else
            ><span class="hint">打开后收起已解释的束 {{ coveredCount }} 条</span></template
          ><span class="hint">；未解释 = 既无交互覆盖、形态也不是端口实现 / 子类 / 组装</span></span
        >
      </label>
      <div class="item" data-testid="cross-count">
        <span class="sw kind"><span class="chip">界外</span></span>
        <span
          >跨界折叠：一端是边界节点的束 {{ crossCount }} 条折叠进节点朝外一侧的「界外 入 · 出」记号，悬停或选中一端时画出<span class="hint"
            >；违规、环上、逆稳定的束不论开关照画</span
          ></span
        >
      </div>

      <div class="section-label">表面 · 入口导出与声明接口</div>
      <label class="item toggle" title="本层全部模块展开表面元素（缺省只在选中模块时展开）">
        <span class="sw kind"
          ><span class="switch"><input v-model="surfaceAlways" type="checkbox" role="switch" aria-label="总是展开表面" /></span
        ></span>
        <span><b>总是展开表面</b><span class="hint"> · 关着时选中模块展开它的表面；选中束只聚焦，元素在面板看</span></span>
      </label>
      <div class="item">
        <span class="sw kind"><span class="chip">表面 W</span></span>
        <span>节点角标：被外部引用的不同元素数（与「入 · 出」同一行）</span>
      </div>
      <div class="item inline elements" aria-label="表面元素四类">
        <span v-for="k in ELEMENT_KINDS" :key="k" :title="ELEMENT_KIND_HINT[k]"
          ><span class="el-mark" :data-kind="k">{{ ELEMENT_KIND_MARK[k] }}</span
          >{{ ELEMENT_KIND_LABEL[k] }}</span
        >
      </div>
      <div class="item" data-testid="surface-cap">
        <span class="sw kind"><span class="chip">+N 个元素</span></span>
        <span>一个节点最多画 {{ SURFACE_PORT_CAP }} 个元素（本层用得最多的、交互接到的优先），其余在面板「表面」一节</span>
      </div>
      <div class="item">
        <span class="sw kind"><span class="chip bypass">越过入口</span></span>
        <span>深层导入（不经入口）的边接到模块本体并带越过记号；建议经入口访问或把符号提升到入口</span>
      </div>
      <div class="item">
        <span class="sw kind"><span class="chip">界外 入 2 · 出 1</span></span>
        <span>折叠的跨界束计数，悬停列出目标</span>
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
.sw.kind {
  width: 54px;
  justify-content: flex-start;
}

.hint {
  color: var(--text-3);
}

.toggle {
  cursor: pointer;
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
