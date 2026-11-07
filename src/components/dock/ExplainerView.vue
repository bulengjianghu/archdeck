<script setup lang="ts">
/**
 * 「图解」标签（LY-13、LY-14，ADR-0064）：只放讲解，不放事实（事实在「描述」）。
 * 系统 / 模块有讲解就显示它（ExplainerDoc：↑ ↓ 导航、「基于旧描述」胶囊、沙箱 iframe）；
 * 没有讲解的主语给空态：说清缺什么、怎么补，列出所属模块或两端模块里有图解的链接，以及「到描述看事实 ›」（LY-13c）。
 */
import { computed } from 'vue'
import { useDesk } from '@/state/inject'
import { moduleName } from '@/model'
import ExplainerDoc from './ExplainerDoc.vue'
import { explainerLinks } from './explainerLinks'

const desk = useDesk()
const idx = computed(() => desk.index.value)
const subject = computed(() => desk.subject.value)
/** 自己有讲解时讲解的模块（系统取根） */
const own = computed(() => {
  const s = subject.value
  const i = idx.value
  if (!s || !i) return null
  const id = s.kind === 'system' ? i.rootId : s.kind === 'module' ? s.id : null
  return id && desk.explainers.has(id) ? id : null
})
const links = computed(() => {
  const s = subject.value
  const i = idx.value
  if (!s || !i || own.value) return { why: '', modules: [] as string[] }
  return explainerLinks(i, s, {
    has: id => desk.explainers.has(id),
    frame: desk.run.frame.value,
    fileOwners: desk.files.owners.value,
  })
})
const name = (id: string) => (idx.value ? moduleName(idx.value, id) : id)
</script>

<template>
  <ExplainerDoc v-if="own" :key="own" :module="own" />
  <div v-else class="explainer-empty" data-testid="explainer-empty">
    <p class="lead">这个主语没有图解</p>
    <p class="why">{{ links.why }}</p>
    <ul v-if="links.modules.length" class="links">
      <li v-for="m in links.modules" :key="m">
        <button class="link" :data-ref-module="m" data-testid="explainer-link" @click="desk.readExplainer(m)">看「{{ name(m) }}」的图解 ›</button>
      </li>
    </ul>
    <button class="link facts" data-testid="to-description" @click="desk.workspace.showView('description')">到描述看事实 ›</button>
  </div>
</template>

<style scoped>
.explainer-empty {
  padding: 24px 20px;
  font-size: 13px;
  color: var(--text-2);
}

.lead {
  margin: 0 0 6px;
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}

.why {
  margin: 0 0 12px;
  max-width: 60ch;
}

.links {
  list-style: none;
  margin: 0 0 12px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.link {
  padding: 0;
  border: none;
  background: none;
  color: var(--accent);
  font-size: 13px;
  text-align: left;
}

.link:hover {
  text-decoration: underline;
}
</style>
