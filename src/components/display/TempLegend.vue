<script setup lang="ts">
/**
 * 图例 · 脚注「临时可见」（L47 修订，ADR-0058）：静息态不出现、悬停 / 选中 / 回放才出现的记号，整张图例只收在这一个缺省折叠的脚注里——
 * 它们此刻不在画面上，出现时悬停释义（L50）会在用到的地方解码，所以正文不列、脚注备查；折叠态只写一句「另有 N 种记号」。
 * 条目按视角：
 * - 交互：只在边界边（L4）或核心跨层边（O4）上出现的关系类型；承载缺段（L22，代码事实开时）；时间耦合的波浪线（F7、L44，开时）。
 * - 结构：选中束承载的交互实线（L22）；表面展开的元素四类与「+N」（L20、ADR-0036）；收起与例外的计数——跨界折叠（B2）、例外照画（L42）、
 *   环按组、另直连（L38）；表面 W 与越过入口（L20、C3）、界外；逆稳定（U17）；共用件折叠（O13）；波浪线（开时）。
 * - 运行：回放的记号（P10、P11、P15、F6）——当前步骤、已走过的步骤、当前端点、经上层、未建模、分支预览。
 * 选中与变淡（L25、L27）三个视角都列、排最后。条目文字取自 labels 的同一份词表（C1）。
 */
import { computed, ref } from 'vue'
import { ELEMENT_KINDS, type RelationType } from '@/model'
import { SURFACE_PORT_CAP } from '@/layout/layout'
import { useDesk } from '@/state/inject'
import LineSwatch from './LineSwatch.vue'
import { useStructurePrefs } from './useDisplayPrefs'
import {
  COUPLE_ISOLATED_TEXT,
  COUPLE_TEXT,
  ELEMENT_KIND_HINT,
  ELEMENT_KIND_LABEL,
  ELEMENT_KIND_MARK,
  FACT_TAG_HINT,
  SHARED_TEXT,
  TYPE_HINT,
  TYPE_LABEL,
  TYPE_ORDER,
  UNMODELED_TEXT,
  UPPER_TEXT,
} from './labels'

const props = defineProps<{ run: boolean; structure: boolean; presence: Set<string> }>()
const desk = useDesk()
const sp = useStructurePrefs(desk.project)
const NEUTRAL = 'var(--text-2)'
const open = ref(false)

const factsReady = computed(() => desk.facts.status.value === 'ready')
const interaction = computed(() => !props.run && !props.structure)
/** 只在边界边 / 核心跨层边上出现的类型（legend.ts 的 rel:temp:type: 键） */
const tempTypes = computed<RelationType[]>(() => (props.structure ? [] : TYPE_ORDER.filter(t => props.presence.has(`rel:temp:type:${t}`))))
const gap = computed(() => interaction.value && factsReady.value && !!desk.toggles.showFacts)
const couple = computed(() => !props.run && desk.evolution.status.value === 'ready' && !!desk.toggles.coupling)
const has = (k: string) => props.structure && props.presence.has(k)
const structFacts = computed(() => props.structure && factsReady.value)
const crossCount = computed(() =>
  props.structure
    ? (desk.facts.structureDisplay({ typeOnly: sp.prefs.value.typeOnly, invokesOnly: sp.prefs.value.invokesOnly, uncoveredOnly: sp.prefs.value.uncoveredOnly })
        ?.hidden.cross ?? 0)
    : 0,
)
const lookOf = (t: RelationType) => ({ type: t, weight: 2 as const })
const arrowOf = (t: RelationType) => (t === 'notifies' ? 'open' : 'closed')
const gapText = FACT_TAG_HINT.find(t => t.tag === '缺段')!.text

/** 行数 = 下面模板里会渲染出来的 .item 数（折叠时也要报数，所以按条件算，不数 DOM） */
const count = computed(() => {
  let n = tempTypes.value.length + (gap.value ? 1 : 0) + (couple.value ? 1 : 0)
  if (props.structure) {
    n += 1 // 承载的交互实线
    if (structFacts.value) n += 2 // 元素四类、+N
    for (const k of [
      'struct:fold:cross',
      'struct:fold:exceptions',
      'struct:fold:cycle',
      'struct:fold:direct',
      'struct:surface:w',
      'struct:surface:bypass',
      'rule:against',
      'metric:shared',
    ])
      if (props.presence.has(k)) n += 1
  }
  if (props.run) n += 7
  return n + 2 // 选中、变淡
})
const title = computed(() => `${props.run ? '回放' : '悬停'} / 选中时另有 ${count.value} 种记号`)
</script>

<template>
  <section class="sec foot" aria-label="临时可见">
    <button type="button" class="foot-btn" :aria-expanded="open" data-testid="legend-temp" @click="open = !open">
      <span class="caret">{{ open ? '▾' : '▸' }}</span
      >{{ title }}
    </button>
    <div v-if="open" class="foot-body" aria-label="临时可见的记号">
      <!-- 交互：边界边 / 核心跨层边上的类型（L4、O4） -->
      <div v-for="t in tempTypes" :key="`temp-${t}`" class="item" :data-type="t">
        <span class="sw"><LineSwatch :look="lookOf(t)" :arrow="arrowOf(t)" :width="36" /></span>
        <span
          >{{ TYPE_LABEL[t] }}<span class="hint"> = {{ TYPE_HINT[t] }}；只连到边界节点或核心跨层，悬停 / 选中一端时画出</span></span
        >
      </div>
      <!-- 交互：承载缺段（L22） -->
      <div v-if="gap" class="item" data-testid="carrier-legend" data-tag="缺段">
        <span class="sw tag"><span class="tag-pill warn">缺段</span></span>
        <span
          >{{ gapText }}<span class="inline-sw"><LineSwatch :look="{ temp: 'carrier-gap' }" arrow="open" /></span>（承载叠加：关系面板「承载」一节列各段）</span
        >
      </div>
      <!-- 时间耦合的波浪线（F7、L44） -->
      <div v-if="couple" class="item" data-testid="legend-couple">
        <span class="sw"><LineSwatch :look="{ temp: 'couple' }" pill /></span>
        <span>{{ COUPLE_TEXT }}；{{ COUPLE_ISOLATED_TEXT }}</span>
      </div>

      <template v-if="structure">
        <!-- L22：选中束承载的交互 -->
        <div class="item">
          <span class="sw"><LineSwatch :color="NEUTRAL" arrow="closed" /></span>
          <span>{{ SHARED_TEXT.solid }}（选中一条束时画出它承载的交互）</span>
        </div>
        <!-- L20、ADR-0036：表面展开（选中 / 悬停）才出现的元素记号 -->
        <template v-if="structFacts">
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
              {{ SURFACE_PORT_CAP }} 个点，其余收进「+N」、清单在面板「表面」一节</span
            >
          </div>
        </template>
        <!-- 收起与例外：画布角与节点上只有计数，线悬停 / 选中才画出 -->
        <div v-if="has('struct:fold:cross')" class="item" data-testid="cross-count">
          <span class="sw kind"><span class="chip">界外</span></span>
          <span>跨界折叠：一端是边界节点的束 {{ crossCount }} 条折叠进节点朝外一侧的「界外 入 · 出」记号，悬停或选中一端时画出；违规、向上、逆稳定的照画</span>
        </div>
        <div v-if="has('struct:fold:exceptions')" class="item" data-testid="legend-exceptions">
          <span class="sw kind"><span class="chip warn">向上</span></span>
          <span>例外照画：违规、向上（依赖违背依赖深度或声明的层）、逆稳定、未解释；只是未解释、另一端在框外或共用件架上的仍折叠计数（L42）</span>
        </div>
        <div v-if="has('struct:fold:cycle')" class="item" data-testid="legend-cycle">
          <span class="sw kind"><span class="chip warn">↻ N</span></span>
          <span>环按组：环内的依赖静息态只计数（画布角「环内 N 条已收起」），单击节点上的环编号选中环组时画出</span>
        </div>
        <div v-if="has('struct:fold:direct')" class="item" data-testid="legend-direct">
          <span class="sw kind"><span class="chip">另直连 N</span></span>
          <span>可由别的路径推出的依赖（传递约简）静息态不画，依赖方节点下边右计数，悬停或选中节点时画出</span>
        </div>
        <div v-if="has('struct:surface:w')" class="item" data-testid="legend-surface-w">
          <span class="sw kind"><span class="chip">表面 W</span></span>
          <span>节点角标：被外部引用的不同元素数（与「入 · 出」同一行）；「总是展开表面」在工具栏「显示 ▾」</span>
        </div>
        <div v-if="has('struct:surface:bypass')" class="item" data-testid="legend-bypass">
          <span class="sw kind"><span class="chip bypass">越过入口</span></span>
          <span>深层导入（不经入口）的边接到模块本体并带越过记号；建议经入口访问或把符号提升到入口</span>
        </div>
        <div v-if="has('rule:against')" class="item" data-testid="legend-against">
          <span class="sw kind"><span class="chip">逆稳定</span></span>
          <span>提示：稳定的模块依赖了更易变的（只提示，不计违规）</span>
        </div>
        <div v-if="has('metric:shared')" class="item" data-testid="legend-shared-fold">
          <span class="sw kind"><span class="chip">共用 ×N</span></span>
          <span>共用件折叠：与架上共用件之间的依赖默认不画、角标计数，悬停或选中画出；反向、违规、在环的照画</span>
        </div>
      </template>

      <template v-if="run">
        <!-- 回放（P10、P11、P15、F6）：都是交互，实线（L18），经上层与未建模写在标签位（L26） -->
        <div class="item">
          <span class="sw"><LineSwatch flow /></span>
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
          <span class="sw"><LineSwatch :look="{ type: 'calls', temp: 'upper', weight: 2 }" /></span>
          <span>{{ UPPER_TEXT }}</span>
        </div>
        <div class="item">
          <span class="sw"><LineSwatch :look="{ temp: 'unmodeled' }" /></span>
          <span>{{ UNMODELED_TEXT }}</span>
        </div>
        <div class="item">
          <span class="sw"><LineSwatch :look="{ play: 'preview', weight: 2 }" /></span>
          <span>分支预览（实线、半透明）</span>
        </div>
      </template>

      <!-- L25、L27：选中与变淡，三个视角同义 -->
      <div class="item" data-shared="select">
        <span class="sw"><span class="box active" /></span>
        <span>{{ SHARED_TEXT.select }}</span>
      </div>
      <div class="item" data-shared="dim">
        <span class="sw"><span class="box faded" /></span>
        <span>{{ SHARED_TEXT.dim }}</span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.foot-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  padding: 2px 0;
  border: none;
  background: none;
  font: inherit;
  font-size: 11px;
  color: var(--text-3);
  text-align: left;
  cursor: pointer;
}

.foot-btn:hover {
  color: var(--text-2);
}

.caret {
  width: 10px;
  flex: none;
}

.foot-body {
  margin-top: 2px;
}

.foot-body .item {
  font-size: 11.5px;
  color: var(--text-2);
}

.hint {
  color: var(--text-3);
}

.sw.tag {
  width: auto;
  min-width: 28px;
}

.sw.kind {
  width: 54px;
  justify-content: flex-start;
}

.inline-sw {
  display: inline-flex;
  margin-left: 4px;
  vertical-align: middle;
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
</style>
