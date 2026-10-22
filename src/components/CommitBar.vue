<script setup lang="ts">
/** 提交版本信息条（E5、E6）：看的是哪个提交时的描述；对比基线（另一个提交或当前版本）、变更计数、是否在图上标出变更 */
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { isCommitVersion, WORKTREE } from '@/model'
import { useDesk } from '@/state/inject'

const desk = useDesk()
const route = useRoute()
const router = useRouter()
const c = computed(() => desk.versions.commit.value)
const commits = computed(() => desk.versions.commits.value)
const counts = computed(() => desk.versions.diff.value?.counts)
/** E6：缺省基线为历史中更早的一个提交，没有时为当前版本（与开发服务器同一口径） */
const base = computed(() => {
  const v = desk.version
  if (isCommitVersion(v) && v.base) return desk.versions.baseCommit.value?.hash ?? v.base
  const at = commits.value.findIndex(x => x.hash === c.value?.hash)
  return (at >= 0 ? commits.value[at + 1]?.hash : undefined) ?? WORKTREE
})

function onBase(e: Event) {
  const next = (e.target as HTMLSelectElement).value
  void router.push({ name: 'commit', params: { project: desk.project!, commit: c.value!.hash, base: next }, query: route.query })
}

function showChanges() {
  const idx = desk.index.value
  if (idx) desk.goTo(idx.rootId, null)
}
</script>

<template>
  <div v-if="c" class="commit-bar">
    <span class="kind">提交版本</span>
    <code class="rev" :title="c.hash">{{ c.short }}</code>
    <span v-if="c.subject" class="subject">{{ c.subject }}</span>
    <span v-if="c.date" class="muted">{{ c.date }}</span>
    <button class="link" @click="showChanges">变更清单</button>

    <span class="spacer" />

    <label class="cmp">
      对比
      <select :value="base" aria-label="对比基线" @change="onBase">
        <option :value="WORKTREE">当前版本</option>
        <option v-for="x in commits" :key="x.hash" :value="x.hash" :disabled="x.hash === c.hash">{{ x.short }} · {{ x.date }}</option>
      </select>
    </label>
    <span v-if="counts" class="counts" :title="`相对${desk.versions.baseline.value?.label}`">
      <span class="diff-tag added">新增 {{ counts.added }}</span>
      <span class="diff-tag changed">修改 {{ counts.changed }}</span>
      <span class="diff-tag removed">删除 {{ counts.removed }}</span>
    </span>
    <label class="check"><input v-model="desk.toggles.showDiff" type="checkbox" /> 图上标出变更</label>
  </div>
</template>

<style scoped>
.commit-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px 10px;
  padding: 6px 14px;
  font-size: 12.5px;
  background: var(--diff-changed-soft);
  border-bottom: 1px solid var(--border);
}

.kind {
  font-size: 11px;
  font-weight: 600;
  color: var(--diff-changed);
  border: 1px solid var(--diff-changed);
  border-radius: 4px;
  padding: 0 5px;
}

.rev {
  font-family: var(--mono);
  font-weight: 600;
}

.subject {
  max-width: 420px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.spacer {
  flex: 1;
}

.cmp,
.check {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--text-2);
  white-space: nowrap;
}

.cmp select {
  font-size: 12px;
}

.counts {
  display: flex;
  gap: 4px;
}
</style>
