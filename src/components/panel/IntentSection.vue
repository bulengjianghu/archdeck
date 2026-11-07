<script setup lang="ts">
/**
 * 根层面板的「意图」清单（SK-4、X4；ADR-0059 起是核对卡的折叠清单，带计数）：每张活动草图一行——谁、持久 / 归档、一致或偏差计数与「查看偏差」（打开「问题」资料标签，LY-4a）。
 * 活动草图 = 持久草图 + 对本版本有约束力的设计草图；草图版本自己是尺子，没有这一节。
 * 偏差怎么判（缺模块、封闭子树多出子模块、字段不一致为错误；关系与接口没有对应为提醒，可在设计面板认可）是讲解，在标题悬停（PC-13）。
 */
import { computed } from 'vue'
import { useDesk } from '@/state/inject'
import Section from './Section.vue'

const desk = useDesk()
const checks = computed(() => desk.intent.checks.value)
const who = (c: { sketch: string; design?: string }) => (c.design ? `设计「${c.design}」的草图` : `持久草图「${c.sketch}」`)
const open = (c: { counts: { error: number; warning: number } }) => c.counts.error + c.counts.warning
const HINT = '草图是架构师的意图：缺模块、封闭子树多出子模块、字段不一致为错误；关系与接口没有对应为提醒，可在设计面板认可'
</script>

<template>
  <Section v-if="checks.length" title="意图（草图）" :count="checks.length" fold data-sec="intent">
    <ul class="plain sketches" :title="HINT">
      <li v-for="c in checks" :key="`${c.design ?? ''}:${c.sketch}`" class="sketch" :class="{ bad: c.counts.error, warn: !c.counts.error && c.counts.warning }">
        <span class="who">{{ who(c) }}</span>
        <span class="life muted">{{ c.lifetime === 'persistent' ? '持久' : '实现一致后归档' }}{{ c.supersedes ? ` · 替换 ${c.supersedes}` : '' }}</span>
        <span v-if="open(c)" class="devs" :title="`错误 ${c.counts.error} · 提醒 ${c.counts.warning}${c.counts.info ? ` · 已认可 ${c.counts.info}` : ''}`">
          偏差 {{ open(c) }}
        </span>
        <span v-else class="ok">一致{{ c.counts.info ? `（已认可 ${c.counts.info}）` : '' }}</span>
        <button v-if="open(c)" class="link" @click="desk.workspace.open({ kind: 'issues' }, true)">查看偏差</button>
      </li>
    </ul>
  </Section>
</template>

<style scoped>
.sketch {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px;
  padding: 3px 0;
  font-size: 13px;
}

.life {
  font-size: 11.5px;
}

.devs {
  font-weight: 600;
  color: var(--warning);
}

.sketch.bad .devs {
  color: var(--danger);
}

.ok {
  color: var(--diff-added);
}
</style>
