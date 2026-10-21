<script setup lang="ts">
/** 项目列表主页：列出模型根目录下的全部项目，点击进入该项目的架构视图；卡片下只列推进中的设计版本，已归档的只注明个数（DV-6） */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { DESIGN_STATUS_LABELS, isArchived, type ProjectSummary } from '@/model'

const projects = ref<ProjectSummary[]>([])
const status = ref<'loading' | 'ready' | 'error'>('loading')
const error = ref('')

async function load() {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}projects.json`, { cache: 'no-store' })
    if (!res.ok) throw new Error(`读取项目列表失败：HTTP ${res.status}`)
    projects.value = await res.json()
    status.value = 'ready'
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
    status.value = 'error'
  }
}

// 开发态：任一项目的描述变化后刷新摘要
const onChanged = () => void load()
onMounted(() => {
  void load()
  import.meta.hot?.on('arch-model:changed', onChanged)
})
onBeforeUnmount(() => import.meta.hot?.off('arch-model:changed', onChanged))

const activeDesigns = (p: ProjectSummary) => (p.designs ?? []).filter(d => !isArchived(d.status))
const archivedCount = (p: ProjectSummary) => (p.designs ?? []).filter(d => isArchived(d.status)).length

const shortCommit = (c?: string) => (c && /^[0-9a-f]{12,}$/i.test(c) ? c.slice(0, 8) : c)
</script>

<template>
  <div class="home">
    <header class="hero">
      <h1>架构台</h1>
      <p class="muted">按层次查看项目的模块、职责、接口与模块间关系。选择一个项目进入它的架构视图。</p>
    </header>

    <p v-if="status === 'loading'" class="muted center">正在读取项目列表…</p>
    <div v-else-if="status === 'error'" class="center">
      <p class="err">{{ error }}</p>
      <button @click="load">重试</button>
    </div>
    <p v-else-if="projects.length === 0" class="muted center">
      模型目录下还没有项目。在 <code>model/&lt;项目&gt;/system.yaml</code> 声明一个项目即可出现在这里。
    </p>

    <ul v-else class="grid">
      <li v-for="p in projects" :key="p.id">
        <RouterLink class="card" :to="`/p/${encodeURIComponent(p.id)}`">
          <div class="title">
            <h2>{{ p.name }}</h2>
            <code class="id">{{ p.id }}</code>
          </div>
          <p class="desc">{{ p.description || '（未填写简介）' }}</p>

          <div v-if="p.top.length" class="layers">
            <span class="label">{{ p.layered ? `${p.top.length} 层` : `${p.top.length} 个顶层模块` }}</span>
            <span v-for="t in p.top" :key="t.id" class="layer" :title="t.abstraction">{{ t.name }}</span>
          </div>

          <dl class="counts">
            <div>
              <dt>模块</dt>
              <dd>{{ p.counts.modules }}</dd>
            </div>
            <div>
              <dt>关系</dt>
              <dd>{{ p.counts.relations }}</dd>
            </div>
            <div>
              <dt>接口</dt>
              <dd>{{ p.counts.interfaces }}</dd>
            </div>
            <div>
              <dt>数据结构</dt>
              <dd>{{ p.counts.dataStructures }}</dd>
            </div>
            <div v-if="p.counts.scenarios">
              <dt>场景</dt>
              <dd>{{ p.counts.scenarios }}</dd>
            </div>
          </dl>

          <footer class="meta">
            <span v-if="p.source?.commit"
              >基于 <code>{{ shortCommit(p.source.commit) }}</code></span
            >
            <span v-if="p.source?.generatedAt">· {{ p.source.generatedAt }}</span>
            <span v-if="p.errors" class="bad">{{ p.errors }} 个错误</span>
            <span v-if="p.warnings" class="warn">{{ p.warnings }} 个提醒</span>
            <span class="open">打开 →</span>
          </footer>
        </RouterLink>
        <ul v-if="activeDesigns(p).length" class="designs" aria-label="设计版本">
          <li v-for="d in activeDesigns(p)" :key="d.id">
            <RouterLink
              v-if="d.revisions.length"
              class="design"
              :to="`/p/${encodeURIComponent(p.id)}/d/${encodeURIComponent(d.id)}/${encodeURIComponent(d.revisions[d.revisions.length - 1].id)}`"
            >
              <span class="tag">设计</span>
              <span class="dname">{{ d.name }}</span>
              <span class="dstatus" :class="d.status">{{ DESIGN_STATUS_LABELS[d.status] }}</span>
              <span class="drev">{{ d.revisions[d.revisions.length - 1].id }} · 共 {{ d.revisions.length }} 轮</span>
              <span class="open">打开 →</span>
            </RouterLink>
            <span v-else class="design broken">设计 {{ d.name }}：{{ d.problems[0] }}</span>
          </li>
        </ul>
        <p v-if="archivedCount(p)" class="archived muted">已归档 {{ archivedCount(p) }} 个设计（已实现或已放弃），可在项目视图的版本切换中查看</p>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.home {
  max-width: 1120px;
  margin: 0 auto;
  padding: 40px 24px 64px;
}

.hero h1 {
  margin: 0;
  font-size: 26px;
}

.hero p {
  margin: 6px 0 28px;
}

.archived {
  margin: 6px 4px 0;
  font-size: 12px;
}

.center {
  text-align: center;
  margin-top: 64px;
}

.err {
  color: var(--danger);
}

.grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 420px), 1fr));
  gap: 16px;
}

.grid > li {
  display: flex;
  flex-direction: column;
}

.card {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100%;
  padding: 18px 20px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  color: inherit;
  text-decoration: none;
  transition: border-color 0.15s;
}

.card:hover,
.card:focus-visible {
  border-color: var(--accent);
  outline: none;
}

.title {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.title h2 {
  margin: 0;
  font-size: 18px;
}

.id {
  font-size: 12px;
  color: var(--text-3);
}

.desc {
  margin: 0;
  color: var(--text-2);
  font-size: 13px;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  white-space: pre-line;
}

.layers {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.layers .label {
  font-size: 12px;
  color: var(--text-3);
  margin-right: 2px;
}

.layer {
  font-size: 12px;
  padding: 1px 8px;
  border-radius: 10px;
  background: var(--layer-bg);
  border: 1px solid var(--layer-border);
}

.counts {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  margin: 0;
}

.counts div {
  background: var(--surface-2);
  border-radius: 8px;
  padding: 6px 10px;
}

.counts dt {
  font-size: 11px;
  color: var(--text-3);
}

.counts dd {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}

.meta {
  margin-top: auto;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-3);
}

.bad {
  color: var(--danger);
}

.warn {
  color: var(--warning);
}

.open {
  margin-left: auto;
  color: var(--accent);
}
.designs {
  list-style: none;
  margin: -6px 0 0;
  padding: 10px 12px 6px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-top: none;
  border-radius: 0 0 12px 12px;
}

.design {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  border-radius: 6px;
  font-size: 13px;
  color: inherit;
  text-decoration: none;
}

.design:hover {
  background: var(--diff-changed-soft);
}

.design .tag {
  font-size: 11px;
  font-weight: 600;
  color: var(--diff-changed);
  border: 1px solid var(--diff-changed);
  border-radius: 4px;
  padding: 0 5px;
}

.dname {
  font-weight: 600;
}

.dstatus {
  font-size: 11px;
  padding: 0 7px;
  border-radius: 10px;
  border: 1px solid var(--border);
  color: var(--text-2);
}

.dstatus.accepted,
.dstatus.implemented {
  color: var(--diff-added);
  border-color: var(--diff-added);
}

.drev {
  font-size: 12px;
  color: var(--text-3);
}

.design .open {
  margin-left: auto;
  font-size: 12px;
}

.design.broken {
  color: var(--danger);
  font-size: 12px;
}
</style>
