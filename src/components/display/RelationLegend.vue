<script setup lang="ts">
/**
 * 「显示」面板 · 关系（颜色通道，ADR-0018 / ADR-0017 第三轮），按「三问四修饰」组织（ADR-0029 §3）：
 * - 三问：三个判断题定类型，每个答案落到一类；类型行是**纯图例**（L45：一行不兼两职），示意按画布同一套样式（查询淡、委托实色）；
 *   类型筛选在设置块的「关系筛选」组（L8），隐藏的类型在画布角留痕计数。
 * - 迁移期的未分类（calls，M17）单列一行，中性灰。
 * - 「四修饰」是读完类型再读的修饰：机制写在标签位（L35，ADR-0041：回调、端口、总线、注入、跨进程、路由、事件、通道、拉取，中性色；端口另在目标端画插座 L12；直接不写）、
 *   异步（空心箭头），与粗细（聚合条数）、标签位的两段（异常警示色在前、修饰中性在后，至多两个标签、其余「+k」）一起放在浅底卡片里、中性色示意、不可点击。
 * 线型（实线 = 交互、虚线 = 依赖，ADR-0035）在「共享」组讲；代码事实写在标签位，在「代码事实 · 标签」组讲。
 * - 图例按上下文显示（L47，G14）：只列当前层次静息态画面出现的关系类型与修饰（出现集合由 state/desk/legend 一处派生），
 *   行序按固定词表、行只显隐不重排；只出现在边界边上的类型（聚焦才画，L4）归尾部「临时可见」小节常列。
 */
import { computed } from 'vue'
import { isUnclassified, type RelationType } from '@/model'
import { TYPE_HINT, TYPE_LABEL, TYPE_ORDER } from './labels'
import DisplayGroup from './DisplayGroup.vue'
import LineSwatch from './LineSwatch.vue'
import { THREE_QUESTIONS, VIA_KIND_HINTS, VIA_KIND_LABELS } from '../shared/labels'
import { MECHANISM_HINTS } from './labels'

const props = defineProps<{ run: boolean; open: boolean; presence: Set<string> }>()
const emit = defineEmits<{ toggle: [] }>()

const NEUTRAL = 'var(--text-2)'
const CLASSIFIED = TYPE_ORDER.filter((t: RelationType) => !isUnclassified(t))
const UNCLASSIFIED = TYPE_ORDER.filter(isUnclassified)
/** L47：静息态画出来的类型（行在正文）与只在边界边上出现的类型（聚焦才画，行在「临时可见」） */
const shownTypes = computed(() => TYPE_ORDER.filter(t => props.presence.has(`rel:type:${t}`)))
const tempTypes = computed(() => TYPE_ORDER.filter(t => props.presence.has(`rel:temp:type:${t}`)))
const hasTypes = computed(() => shownTypes.value.length > 0 || tempTypes.value.length > 0)
const shownMechanisms = computed(() => MECHANISM_HINTS.filter(m => props.presence.has(`rel:tag:${m.tag}`)))
const lookOf = (t: RelationType) => ({ type: t, weight: 2 as const })
/** 示意的箭头：通知一律异步（空心），其余按同步画实心 */
const arrowOf = (t: RelationType) => (t === 'notifies' ? 'open' : 'closed')
</script>

<template>
  <DisplayGroup title="关系 · 三问四修饰" :open="open" @toggle="emit('toggle')">
    <template v-if="!run" #actions>
      <span class="aside-note">筛选在设置 · 关系筛选</span>
    </template>
    <div v-if="!hasTypes" class="item muted">本层没有画出来的关系</div>
    <template v-else>
      <ol v-if="presence.has('rel:q1') || presence.has('rel:q2') || presence.has('rel:q3')" class="questions" aria-label="三问定类型">
        <li v-for="(x, i) in THREE_QUESTIONS" v-show="presence.has(`rel:q${i + 1}`)" :key="i">
          <span class="q">{{ x.q }}</span>
          <span v-for="(a, k) in x.answers" :key="a.type" class="answer"
            >{{ k ? '；' : '' }}{{ a.a }} → <b :class="`rel-${a.type}`">{{ TYPE_LABEL[a.type] }}</b></span
          >
        </li>
      </ol>
      <div class="type-list">
        <template v-for="sec in [CLASSIFIED, UNCLASSIFIED]" :key="sec.join()">
          <div v-if="sec === UNCLASSIFIED && sec.some(t => shownTypes.includes(t))" class="section">迁移期</div>
          <div v-for="t in sec" v-show="shownTypes.includes(t)" :key="t" class="item" :data-type="t">
            <span class="sw"><LineSwatch :look="lookOf(t)" :arrow="arrowOf(t)" :width="36" /></span>
            <span
              >{{ TYPE_LABEL[t] }}<span class="hint"> = {{ TYPE_HINT[t] }}</span></span
            >
          </div>
        </template>
      </div>

      <div class="reading" aria-label="四修饰">
        <div class="reading-title">四修饰 · 读完类型再读，适用于任意类型</div>
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
      </div>

      <!-- L47：临时可见——聚焦边界节点（L4）或核心模块（O4）才画出来的关系类型，常列、不随出现显隐 -->
      <div v-if="tempTypes.length" class="section-label">临时可见 · 聚焦才画出</div>
      <div v-for="t in tempTypes" :key="t" class="item" :data-type="t">
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
.type-list .sw {
  width: 36px;
}

.hint {
  color: var(--text-3);
}

.questions {
  margin: 0 0 4px;
  padding-left: 16px;
  font-size: 11.5px;
  color: var(--text-2);
}

.questions li {
  line-height: 1.6;
}

.questions .q {
  margin-right: 4px;
}

.questions b {
  font-weight: 600;
  color: var(--rel);
}

.section {
  margin-top: 2px;
  font-size: 10.5px;
  color: var(--text-3);
}

.reading {
  margin-top: 6px;
  padding: 5px 8px 6px;
  background: var(--surface-2);
  border-radius: 6px;
  color: var(--text-2);
  font-size: 11.5px;
}

.reading-title {
  margin-bottom: 2px;
  font-size: 10.5px;
  color: var(--text-3);
}

.reading-row {
  display: flex;
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

.aside-note {
  font-size: 11px;
  color: var(--text-3);
}
</style>
