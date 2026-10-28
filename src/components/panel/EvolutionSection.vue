<script setup lang="ts">
/** 系统面板的「演化」一节（HS-4，J6、J8）：窗口与提交数、热度前 10（按当前热度种类，只列有直接归属文件的模块）、无依赖的时间耦合对 */
import { computed } from 'vue'
import { useDesk } from '@/state/inject'
import { moduleName, type HeatKind } from '@/model'
import Section from './Section.vue'

/** G11 V14c：系统面板 ⑤ 的演化与模块层同规——默认折叠带计数（G11 波 0b 改 fold） */
defineProps<{ fold?: boolean }>()

const desk = useDesk()
const e = desk.evolution
const stats = computed(() => e.stats.value)
const kind = computed<HeatKind>(() => (desk.toggles.heat === 'fixes' ? 'fixes' : 'changes'))
const top = computed(() => e.hotspotsOf(kind.value, 10))
const name = (id: string) => (desk.index.value ? moduleName(desk.index.value, id) : id)
const REASON: Record<string, string> = {
  design: '设计版本与历史提交不对应当前代码，没有演化事实。',
  loading: '正在读取 git 历史…',
}
</script>

<template>
  <Section title="演化（git 历史）" :count="stats ? top.length || undefined : undefined" :fold="fold" class="evo-sec">
    <p v-if="!stats" class="muted">{{ e.error.value ? `没有演化事实：${e.error.value}` : REASON[e.status.value] }}</p>
    <p v-else-if="e.history.value?.note" class="muted">{{ e.history.value.note }}。</p>
    <template v-else>
      <p class="muted window">
        近 {{ stats.days }} 天：{{ stats.commits }} 次提交触及源码，其中缺陷修复 {{ stats.fixes }} 次；时间耦合 {{ stats.couplings.length }} 对（含上级并集）
      </p>
      <div class="block">
        <h4>{{ kind === 'fixes' ? '缺陷' : '修改' }}热度前 {{ top.length }}</h4>
        <ol v-if="top.length" class="top">
          <li v-for="m in top" :key="m.id">
            <button class="link" @click="desk.revealModule(m.id)">{{ name(m.id) }}</button>
            <span class="muted">
              {{ kind === 'fixes' ? m.fixes : m.changes }} 次 · {{ m.lines }} 行 · 热度 {{ Math.round(kind === 'fixes' ? m.fixHeat : m.heat) }}</span
            >
          </li>
        </ol>
        <p v-else class="muted">窗口内没有触及已归属文件的{{ kind === 'fixes' ? '缺陷修复' : '' }}提交</p>
      </div>
      <div class="block">
        <h4>
          无依赖无关系的时间耦合（只列最具体的对）<span class="count">{{ e.isolated.value.length }}</span>
        </h4>
        <ul v-if="e.isolated.value.length" class="plain">
          <li v-for="c in e.isolated.value" :key="c.id" class="pair">
            <button class="link" @click="desk.select({ kind: 'couple', id: c.id })">{{ name(c.a) }} ~ {{ name(c.b) }}</button>
            <span class="muted"> 同提交 ×{{ c.shared }}</span>
          </li>
        </ul>
        <p v-else class="muted">没有：所有时间耦合的两端之间都有依赖或关系</p>
      </div>
    </template>
  </Section>
</template>

<style scoped>
.window {
  margin: 0 0 6px;
  font-size: 12px;
}

.block + .block {
  margin-top: 8px;
}

h4 {
  margin: 0 0 2px;
  font-size: 12px;
  font-weight: 600;
}

.count {
  margin-left: 6px;
  font-weight: 500;
  color: var(--text-3);
}

.top {
  margin: 0;
  padding-left: 1.4em;
  font-size: 13px;
}

.top li,
.pair {
  padding: 2px 0;
}
</style>
