<script setup lang="ts">
/** 版本切换：当前版本（由代码生成）、某个设计版本的某一轮（ADR-0002），或描述在某个 git 提交时的快照（E5）。切换时保留层次与选中 */
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useDesk } from '@/state/inject'
import { isCommitVersion, isDesignVersion } from '@/model'
import { DESIGN_STATUS_LABELS } from './shared/labels'

const desk = useDesk()
const route = useRoute()
const router = useRouter()

const v = desk.version
/** 选项值：设计版本为 `<设计>/<轮次>`，提交版本为 `c:<提交>` */
const value = computed(() => (isCommitVersion(v) ? `c:${desk.versions.commit.value?.hash ?? v.commit}` : isDesignVersion(v) ? `${v.design}/${v.revision}` : ''))
const commits = computed(() => desk.versions.commits.value)
/** 打开的提交不在最近的提交列表里时也要能显示 */
const extraCommit = computed(() => {
  const c = desk.versions.commit.value
  return c && !commits.value.some(x => x.hash === c.hash) ? c : null
})
const subject = (s: string) => (s.length > 28 ? `${s.slice(0, 28)}…` : s)

function onChange(e: Event) {
  const val = (e.target as HTMLSelectElement).value
  const project = desk.project!
  const query = route.query
  if (!val) void router.push({ name: 'project', params: { project }, query })
  else if (val.startsWith('c:')) void router.push({ name: 'commit', params: { project, commit: val.slice(2) }, query })
  else {
    const [design, revision] = val.split('/')
    void router.push({ name: 'design', params: { project, design, revision }, query })
  }
}
</script>

<template>
  <label v-if="desk.project && (desk.versions.designs.value.length || commits.length || extraCommit)" class="version" :class="{ design: !!desk.version }">
    <span class="sr">版本</span>
    <select :value="value" aria-label="切换版本" @change="onChange">
      <option value="">当前版本（代码）</option>
      <optgroup v-for="d in desk.versions.designs.value" :key="d.id" :label="`设计 · ${d.name}（${DESIGN_STATUS_LABELS[d.status]}）`">
        <option v-for="(r, i) in [...d.revisions].reverse()" :key="r.id" :value="`${d.id}/${r.id}`" :title="r.date">
          {{ d.name }} · {{ r.id }}{{ i === 0 ? '（最新）' : '' }}
        </option>
      </optgroup>
      <optgroup v-if="commits.length || extraCommit" label="提交（描述的历史）">
        <option v-if="extraCommit" :value="`c:${extraCommit.hash}`">{{ extraCommit.short }}</option>
        <option v-for="c in commits" :key="c.hash" :value="`c:${c.hash}`" :title="`${c.hash}\n${c.subject}`">
          {{ c.short }} · {{ c.date }} · {{ subject(c.subject) }}
        </option>
      </optgroup>
    </select>
  </label>
</template>

<style scoped>
.version select {
  max-width: 260px;
  font-size: 12.5px;
  padding: 3px 6px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text);
}

.version.design select {
  border-color: var(--diff-changed);
  background: var(--diff-changed-soft);
  font-weight: 600;
}

.sr {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}
</style>
