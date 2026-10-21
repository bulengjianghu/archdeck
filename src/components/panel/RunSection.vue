<script setup lang="ts">
/**
 * 运行信息（V6、D-11）：运行视角下选中模块、关系、视图边、参与者时面板顶部的一节，回答「在这次流程中做了什么」——
 * 本场景中参与的步骤（单击指向，标出离进度最近的一步）、在本层收发的消息、用到的接口与数据；
 * 模块与参与者可在画布上显示它在本层节点的结构关系（V9）。
 */
import { computed } from 'vue'
import { useDesk } from '@/state/inject'
import Section from './Section.vue'
import RevealButton from './RevealButton.vue'
import { frameText } from './runText'

const desk = useDesk()
const p = computed(() => desk.run.participation.value)
const idx = computed(() => desk.index.value!)
const ROLE = { from: '发出', to: '收到', internal: '内部', traverse: '经过' } as const
/** V9：选中的模块 / 参与者在本层对应的视图节点（自身、边界节点或所在的子模块） */
const revealNodes = computed(() => {
  const s = desk.selection.value
  const view = desk.view.value
  if (!s || !view || (s.kind !== 'module' && s.kind !== 'actor')) return []
  const has = new Set(view.nodes.map(n => n.id))
  if (s.kind === 'actor') return has.has(s.id) ? [s.id] : []
  for (const id of [...(idx.value.pathOf.get(s.id) ?? [])].reverse()) {
    if (has.has(id)) return [id]
    if (has.has(`boundary:${id}`)) return [`boundary:${id}`]
  }
  return []
})
const nameOf = (kind: 'if' | 'ds', id: string) => (kind === 'if' ? idx.value.interfaces.get(id)?.name : idx.value.dataStructures.get(id)?.name) ?? id
</script>

<template>
  <Section v-if="p" :title="`在「${desk.run.scenario.value?.name}」中`" :count="p.frames.length">
    <p v-if="!p.frames.length" class="muted">没有参与这个场景已走出的路径。</p>
    <ol v-else class="steps">
      <li v-for="x in p.frames" :key="x.frameId" :class="{ nearest: x.frameId === p.nearest, current: x.frameId === desk.playback.value?.frameId }">
        <span class="role">{{ ROLE[x.role] }}</span>
        <button class="link" @click="desk.seek(x.frameId)">{{ frameText(idx, desk.run.plan.value!.frames.get(x.frameId)!) }}</button>
        <span v-if="x.frameId === p.nearest" class="badge accent">离进度最近</span>
      </li>
    </ol>
    <div class="meta muted">本层可见消息：{{ p.messages.length ? p.messages.map(m => `第 ${m + 1} 步`).join('、') : '无' }}</div>
    <div v-if="p.interfaces.length" class="meta"><span class="muted">接口</span> <code v-for="i in p.interfaces" :key="i" class="chip">{{ nameOf('if', i) }}</code></div>
    <div v-if="p.dataStructures.length" class="meta"><span class="muted">数据</span> <code v-for="d in p.dataStructures" :key="d" class="chip">{{ nameOf('ds', d) }}</code></div>
    <RevealButton :nodes="revealNodes" class="meta" />
  </Section>
</template>

<style scoped>
.steps {
  margin: 0;
  padding-left: 1.4em;
  font-size: 12.5px;
}

.steps li {
  padding: 1px 0;
}

.steps li.current {
  font-weight: 700;
}

.role {
  display: inline-block;
  min-width: 2.5em;
  color: var(--text-3);
  font-size: 11.5px;
}

.meta {
  margin-top: 6px;
  font-size: 12.5px;
}

.chip {
  margin-left: 6px;
}
</style>
