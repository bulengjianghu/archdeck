<script setup lang="ts">
/**
 * 导航树「问题」页签（W-6）：返工清单（Q7、Q8）按严重度排序，可按严重度、类别筛选（类别与命令行 `issues --category` 同一枚举）；
 * 展开一条看根因所在、受影响位置与建议动作，
 * 可定位到关系 / 文件 / 模块，「复制给 agent」把这一条（或整份清单）的 Markdown 指令放进剪贴板（Q9）。
 */
import { computed, ref } from 'vue'
import { useDesk } from '@/state/inject'
import {
  REWORK_CATEGORIES,
  REWORK_CATEGORY_LABELS,
  REWORK_SEVERITY_LABELS,
  type ReworkCategory,
  type ReworkItem,
  type ReworkLoc,
  type ReworkSeverity,
} from '@/model'

const desk = useDesk()
const list = computed(() => desk.rework.value)
const filter = ref<ReworkSeverity | 'all'>('all')
const category = ref<ReworkCategory | 'all'>('all')
const shown = computed(() =>
  (list.value?.items ?? []).filter(i => (filter.value === 'all' || i.severity === filter.value) && (category.value === 'all' || i.category === category.value)),
)
const open = ref(new Set<string>())
const copied = ref<string | null>(null)
/** 展开后最多列出的受影响位置 */
const LIMIT = 50

function toggle(id: string) {
  const next = new Set(open.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  open.value = next
}

const inSource = (loc: ReworkLoc) => loc.in === 'source' && hasFile(loc.file)
const hasFile = (f: string) => {
  const p = desk.files.payload.value
  return p?.status === 'local' && p.files.includes(f)
}
const where = (loc: ReworkLoc) => `${loc.in === 'description' ? `${desk.modelDir.value}/` : ''}${loc.file}${loc.line ? `:${loc.line}` : ''}`

/** 定位：关系 → 跳到关系；文件 → 选中文件；否则跳到第一个模块 */
function canLocate(i: ReworkItem): boolean {
  const idx = desk.index.value
  if (!idx) return false
  const t = i.target
  return (!!t.relation && idx.relations.has(t.relation)) || (!!t.file && hasFile(t.file)) || !!t.modules?.some(m => idx.modules.has(m))
}
function locate(i: ReworkItem) {
  const idx = desk.index.value!
  const t = i.target
  if (t.relation && idx.relations.has(t.relation)) desk.revealRelation(t.relation)
  else if (t.file && hasFile(t.file)) desk.selectFile(t.file)
  else {
    const m = t.modules?.find(x => idx.modules.has(x))
    if (m) desk.revealModule(m)
  }
}

async function copy(key: string, item?: ReworkItem) {
  const text = desk.reworkPrompt(item)
  try {
    await navigator.clipboard.writeText(text)
    copied.value = key
    setTimeout(() => copied.value === key && (copied.value = null), 1500)
  } catch {
    copied.value = null
  }
}
</script>

<template>
  <div class="issue-list">
    <p v-if="!list" class="muted pad">正在加载…</p>
    <template v-else>
      <header class="head">
        <div class="filters" role="group" aria-label="按严重度筛选">
          <button :class="{ on: filter === 'all' }" @click="filter = 'all'">全部 {{ list.items.length }}</button>
          <button
            v-for="s in ['error', 'warning', 'info'] as const"
            :key="s"
            :class="[s, { on: filter === s }]"
            :disabled="!list.counts[s]"
            @click="filter = s"
          >
            {{ REWORK_SEVERITY_LABELS[s] }} {{ list.counts[s] }}
          </button>
        </div>
        <select v-model="category" class="category" aria-label="按类别筛选">
          <option value="all">全部类别</option>
          <option v-for="c in REWORK_CATEGORIES" :key="c" :value="c" :disabled="!list.byCategory[c]">
            {{ REWORK_CATEGORY_LABELS[c] }} {{ list.byCategory[c] }}
          </option>
        </select>
        <button class="copy-all" :disabled="!list.items.length" title="把整份返工清单（Markdown）复制给 agent" @click="copy('*')">
          {{ copied === '*' ? '已复制' : '复制全部给 agent' }}
        </button>
      </header>
      <p v-if="!list.facts" class="muted pad note">没有代码事实（{{ desk.version ? '非当前版本' : '代码事实未就绪' }}），未含违规、未证实与未描述依赖。</p>
      <p v-if="!shown.length" class="muted pad">{{ list.items.length ? '没有符合筛选条件的问题。' : '没有需要返工的问题。' }}</p>
      <ul class="items">
        <li v-for="i in shown" :key="i.id" class="item" :class="[i.severity, { open: open.has(i.id) }]" :data-id="i.id">
          <button class="row" :aria-expanded="open.has(i.id)" @click="toggle(i.id)">
            <span class="sev">{{ REWORK_SEVERITY_LABELS[i.severity] }}</span>
            <span class="title">{{ i.title }}</span>
            <span class="meta"
              >{{ REWORK_CATEGORY_LABELS[i.category] }} · {{ i.rules.join('、')
              }}<template v-if="i.affected.length > 1"> · {{ i.affected.length }} 处</template></span
            >
          </button>
          <div v-if="open.has(i.id)" class="body">
            <p v-if="i.detail" class="detail">{{ i.detail }}</p>
            <p v-if="i.at" class="at">
              位置 <code>{{ where(i.at) }}</code>
            </p>
            <div v-if="i.affected.length" class="affected">
              <div class="sub">受影响 {{ i.affected.length }}</div>
              <ul>
                <li v-for="(a, k) in i.affected.slice(0, LIMIT)" :key="k">
                  <button v-if="inSource(a)" class="link" @click="desk.selectFile(a.file)">{{ where(a) }}</button>
                  <code v-else>{{ where(a) }}</code>
                  <span v-if="a.note" class="note">{{ a.note }}</span>
                </li>
                <li v-if="i.affected.length > LIMIT" class="muted">…另 {{ i.affected.length - LIMIT }} 处</li>
              </ul>
            </div>
            <div class="actions">
              <div class="sub">建议</div>
              <div v-for="(a, k) in i.actions" :key="k" class="action">
                <span>{{ a.text }}</span
                ><code v-if="a.file" class="file">{{ desk.modelDir.value }}/{{ a.file }}</code>
                <pre v-if="a.snippet">{{ a.snippet }}</pre>
              </div>
            </div>
            <div class="buttons">
              <button v-if="canLocate(i)" @click="locate(i)">定位</button>
              <button @click="copy(i.id, i)">{{ copied === i.id ? '已复制' : '复制给 agent' }}</button>
            </div>
          </div>
        </li>
      </ul>
    </template>
  </div>
</template>

<style scoped>
.pad {
  padding: 4px 12px;
  margin: 0;
}

.note {
  font-size: 12px;
}

.head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 2px 10px 6px;
  border-bottom: 1px solid var(--border);
}

.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.filters button,
.copy-all,
.buttons button {
  font-size: 11.5px;
  padding: 1px 7px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text-2);
}

.filters button.on {
  border-color: var(--accent);
  color: var(--accent);
  font-weight: 600;
}

.category {
  max-width: 46%;
  font-size: 11.5px;
  padding: 1px 4px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text-2);
}

.copy-all {
  margin-left: auto;
}

.items {
  list-style: none;
  margin: 0;
  padding: 0;
}

.item {
  border-bottom: 1px solid var(--border);
  border-left: 3px solid transparent;
}

.item.error {
  border-left-color: var(--danger);
}

.item.warning {
  border-left-color: var(--warning);
}

.row {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 2px 6px;
  width: 100%;
  text-align: left;
  border: none;
  border-radius: 0;
  background: none;
  padding: 6px 10px;
  color: inherit;
}

.item.open .row,
.row:hover {
  background: var(--surface-2);
}

.sev {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-3);
}

.error .sev {
  color: var(--danger);
}

.warning .sev {
  color: var(--warning);
}

.title {
  font-size: 12.5px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.item.open .title {
  -webkit-line-clamp: unset;
}

.meta {
  grid-column: 2;
  font-size: 11px;
  color: var(--text-3);
}

.body {
  padding: 4px 10px 8px 16px;
  font-size: 12px;
}

.body p {
  margin: 2px 0 6px;
}

.sub {
  font-size: 11px;
  color: var(--text-3);
  margin: 6px 0 2px;
}

.affected ul {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 180px;
  overflow: auto;
}

.affected li {
  word-break: break-all;
}

.affected .note {
  margin-left: 4px;
  color: var(--text-3);
}

code {
  font-size: 11px;
  word-break: break-all;
}

.action + .action {
  margin-top: 4px;
}

.action .file {
  margin-left: 4px;
  color: var(--text-3);
}

pre {
  margin: 3px 0 0;
  padding: 5px 7px;
  background: var(--surface-2);
  border-radius: 6px;
  font-size: 11px;
  white-space: pre-wrap;
  word-break: break-all;
}

.buttons {
  display: flex;
  gap: 6px;
  margin-top: 8px;
}
</style>
