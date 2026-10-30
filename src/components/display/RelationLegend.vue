<script setup lang="ts">
/**
 * 图例 · 关系（颜色通道，ADR-0018；第十七轮 R4，ADR-0056）：
 * - 类型行即开关（L45、L8）：示意 + 名称 + 勾选态，单击切换这一类的显示，关着的行淡色、常列（L47）；隐藏的类在画布角留痕计数。
 *   运行视角的类型行只读（回放不受筛选影响，L9）。示意按画布同一套样式（查询淡、委托实色）；迁移期的未分类（calls，M17）单列。
 * - 修饰的各行（机制、标签词 L35、两段 L26②、同步异步、粗细）是画布记号，只解码；「三问」「四修饰」的读法讲解在帮助（L51），
 *   组标题旁的「?」打开帮助并定位到「读一条线」。
 * - 图例按上下文显示（L47，G14）：开着的类型与修饰只列当前层次静息态画面出现的，行序按固定词表、行只显隐不重排；
 *   只出现在边界边上的类型（聚焦才画，L4）归尾部「临时可见」小节常列。
 */
import { computed, inject } from 'vue'
import { isUnclassified, RELATION_TYPES, type RelationType } from '@/model'
import { useDesk } from '@/state/inject'
import { TYPE_HINT, TYPE_LABEL, TYPE_ORDER, MECHANISM_HINTS } from './labels'
import DisplayGroup from './DisplayGroup.vue'
import LegendToggle from './LegendToggle.vue'
import LineSwatch from './LineSwatch.vue'
import { VIA_KIND_HINTS, VIA_KIND_LABELS } from '../shared/labels'
import { OPEN_GUIDE } from '../shared/guide'

const props = defineProps<{ run: boolean; open: boolean; presence: Set<string> }>()
const emit = defineEmits<{ toggle: [] }>()
const desk = useDesk()
const openGuide = inject(OPEN_GUIDE, null)

const NEUTRAL = 'var(--text-2)'
const CLASSIFIED = TYPE_ORDER.filter((t: RelationType) => !isUnclassified(t))
const UNCLASSIFIED = TYPE_ORDER.filter(isUnclassified)
/** L45：类型筛选只在交互视角（L8）；运行视角的类型行只读 */
const shown = (t: RelationType) => props.run || desk.toggles.relationTypes.includes(t)
const toggleType = (t: RelationType) => {
  const list = desk.toggles.relationTypes
  desk.setToggles({ relationTypes: list.includes(t) ? list.filter(x => x !== t) : RELATION_TYPES.filter(x => x === t || list.includes(x)) })
}
/** L47：正文的类型行——开着且静息态画出来的、或关着的（常列淡色）；只出现在边界边上的在「临时可见」 */
const mainTypes = computed(() => TYPE_ORDER.filter(t => (shown(t) ? props.presence.has(`rel:type:${t}`) : true)))
const tempTypes = computed(() => TYPE_ORDER.filter(t => shown(t) && props.presence.has(`rel:temp:type:${t}`)))
const hasTypes = computed(() => mainTypes.value.length > 0 || tempTypes.value.length > 0)
const hasModifiers = computed(() => ['rel:mech', 'rel:pill', 'rel:sync', 'rel:weight'].some(k => props.presence.has(k)))
const shownMechanisms = computed(() => MECHANISM_HINTS.filter(m => props.presence.has(`rel:tag:${m.tag}`)))
const lookOf = (t: RelationType) => ({ type: t, weight: 2 as const })
/** 示意的箭头：通知一律异步（空心），其余按同步画实心 */
const arrowOf = (t: RelationType) => (t === 'notifies' ? 'open' : 'closed')
const typeTitle = (t: RelationType) => `${TYPE_LABEL[t]} = ${TYPE_HINT[t]}${props.run ? '' : '；单击切换显示，隐藏时画布角留痕计数'}`
</script>

<template>
  <DisplayGroup title="关系" :open="open" @toggle="emit('toggle')">
    <template #actions>
      <button
        v-if="openGuide"
        class="help"
        title="怎么读一条线：三问定类型、四修饰（帮助 · 怎么读这张图）"
        aria-label="怎么读一条线"
        @click="openGuide('read-line')"
      >
        ?
      </button>
    </template>
    <div v-if="!hasTypes" class="item muted">本层没有画出来的关系</div>
    <template v-else>
      <div class="type-list">
        <template v-for="sec in [CLASSIFIED, UNCLASSIFIED]" :key="sec.join()">
          <div v-if="sec === UNCLASSIFIED && sec.some(t => mainTypes.includes(t))" class="section-label">迁移期</div>
          <template v-for="t in sec" :key="t">
            <div v-if="run" v-show="mainTypes.includes(t)" class="item" :data-type="t" :title="typeTitle(t)">
              <span class="sw"><LineSwatch :look="lookOf(t)" :arrow="arrowOf(t)" :width="36" /></span>
              <span
                >{{ TYPE_LABEL[t] }}<span class="hint"> = {{ TYPE_HINT[t] }}</span></span
              >
            </div>
            <LegendToggle
              v-else
              v-show="mainTypes.includes(t)"
              :on="shown(t)"
              :label="TYPE_LABEL[t]"
              :title="typeTitle(t)"
              :data-type="t"
              @toggle="toggleType(t)"
            >
              <template #swatch><LineSwatch :look="lookOf(t)" :arrow="arrowOf(t)" :width="36" /></template>
              = {{ TYPE_HINT[t] }}
            </LegendToggle>
          </template>
        </template>
      </div>

      <template v-if="hasModifiers">
        <div class="section-label">修饰</div>
        <div v-if="presence.has('rel:mech')" class="reading-row">
          <span class="dim">机制</span>
          <span class="pair" :title="VIA_KIND_HINTS.direct"><LineSwatch :color="NEUTRAL" :width="22" arrow="closed" />{{ VIA_KIND_LABELS.direct }}</span>
          <span v-if="presence.has('rel:pair:port')" class="pair" :title="`${VIA_KIND_HINTS.port}；标签与入口的插座并存（L12）`"
            ><LineSwatch :color="NEUTRAL" :width="26" arrow="closed" socket /><span class="tag">端口</span></span
          >
        </div>
        <div v-if="shownMechanisms.length" class="reading-row mech-tags" data-testid="legend-mechanisms">
          <span class="dim">标签</span>
          <span v-for="m in shownMechanisms" :key="m.tag" class="tag" :title="m.text">{{ m.tag }}</span>
        </div>
        <div v-if="presence.has('rel:pill')" class="reading-row" data-testid="legend-pill">
          <span class="dim">两段</span>
          <span
            class="pair"
            title="异常段（×N、把手与违规、向上、未证实……）警示色在前，修饰段（机制、混合、经上层）中性在后；标签至多两个，其余「+k」、悬停列出（L26②）"
            ><span class="tag warn">×5 · 未证实 2</span><span class="tag">端口 1 · +1</span></span
          >
        </div>
        <div v-if="presence.has('rel:sync')" class="reading-row">
          <span class="dim">同步</span>
          <span class="pair"><LineSwatch :color="NEUTRAL" :width="18" arrow="closed" />同步</span>
          <span v-if="presence.has('rel:pair:async')" class="pair"><LineSwatch :color="NEUTRAL" :width="18" arrow="open" />异步</span>
          <span v-if="presence.has('rel:pair:mixed')" class="pair" title="束内同步与异步不一致（L23）；via 不一致由机制标签的条数表达"
            ><span class="tag">混合</span></span
          >
        </div>
        <div v-if="presence.has('rel:weight')" class="reading-row">
          <span class="dim">粗细</span>
          <span class="pair"><LineSwatch :color="NEUTRAL" :width="16" :look="{ weight: 1 }" />1 条</span>
          <span class="pair"><LineSwatch :color="NEUTRAL" :width="16" :look="{ weight: 2 }" />2–4</span>
          <span class="pair"><LineSwatch :color="NEUTRAL" :width="22" :look="{ weight: 3 }" pill />≥5 · ×N</span>
        </div>
      </template>

      <!-- L47：临时可见——聚焦边界节点（L4）或核心模块（O4）才画出来的关系类型，常列、不随出现显隐 -->
      <div v-if="tempTypes.length" class="section-label">临时可见 · 聚焦才画出</div>
      <div v-for="t in tempTypes" :key="`temp-${t}`" class="item" :data-type="t">
        <span class="sw"><LineSwatch :look="lookOf(t)" :arrow="arrowOf(t)" :width="36" /></span>
        <span
          >{{ TYPE_LABEL[t] }}<span class="hint"> = {{ TYPE_HINT[t] }}；只连到边界节点或核心跨层，悬停 / 选中一端时画出</span></span
        >
      </div>
    </template>
  </DisplayGroup>
</template>

<style scoped>
/* L24：标签位文字的示意（与画布 ×N 标签同样式） */
.tag {
  display: inline-block;
  margin-right: 3px;
  padding: 0 5px;
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  font-size: 11px;
  line-height: 15px;
  color: var(--text-2);
  background: var(--surface);
}

/* L26②：异常段警示色 */
.tag.warn {
  border-color: var(--warning);
  color: var(--warning);
}

.mech-tags {
  flex-wrap: wrap;
  row-gap: 3px;
}

/* 带箭头的类型示意比通用示意列宽一些，线不被箭头吃掉 */
.type-list :deep(.sw) {
  width: 36px;
}

.hint {
  color: var(--text-3);
}

.reading-row {
  display: flex;
  font-size: 11.5px;
  color: var(--text-2);
  align-items: center;
  gap: 10px;
  min-height: 20px;
  white-space: nowrap;
}

.reading-row .dim {
  width: 24px;
  flex: none;
  font-size: 11px;
  color: var(--text-3);
}

.pair {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.help {
  width: 16px;
  height: 16px;
  padding: 0;
  border: 1px solid var(--border-strong);
  border-radius: 50%;
  background: none;
  font-size: 10.5px;
  line-height: 14px;
  color: var(--text-3);
}

.help:hover {
  color: var(--accent);
  border-color: var(--accent);
}
</style>
