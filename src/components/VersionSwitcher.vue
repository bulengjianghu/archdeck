<script setup lang="ts">
/**
 * 版本切换：当前版本（由代码生成）、持久草图（骨架等，可编辑，ADR-0024）、某个设计的草图（DV-10，排在 r1 之前）或某一轮（ADR-0002），
 * 或描述在某个 git 提交时的快照（E5）。选中后下拉只显示名称，草图以 ✎ 前缀区分（#14，kind 在信息条的身份区）。切换时保留层次与选中；有未保存的草图改动时离开由项目视图确认（X7a）。旁边是「新建设计」（SK-10）。
 */
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useDesk } from '@/state/inject'
import { SKETCH_REVISION, isArchived, isCommitVersion, isDesignVersion, isIntentVersion } from '@/model'
import { DESIGN_STATUS_LABELS, intentName } from './shared/labels'
import NewDesignDialog from './edit/NewDesignDialog.vue'

const desk = useDesk()
const route = useRoute()
const router = useRouter()

const v = desk.version
/** 选项值：设计版本为 `<设计>/<轮次>`，提交版本为 `c:<提交>` */
const value = computed(() =>
  isCommitVersion(v)
    ? `c:${desk.versions.commit.value?.hash ?? v.commit}`
    : isDesignVersion(v)
      ? `${v.design}/${v.revision}`
      : isIntentVersion(v)
        ? `i:${v.intent}`
        : '',
)
/** 持久草图（骨架等）：读到的描述里带着 intent/ */
const intents = desk.edit.lookup.intentIds
const creating = ref(false)
const editSkeleton = () => void router.push({ name: 'intent', params: { project: desk.project!, intent: 'skeleton' }, query: { edit: '1' } })
const commits = computed(() => desk.versions.commits.value)
/** DV-6：推进中的设计各自一组，已归档的（已实现、已放弃）合为一组放在后面 */
const active = computed(() => desk.versions.designs.value.filter(d => !isArchived(d.status)))
const archived = computed(() => desk.versions.designs.value.filter(d => isArchived(d.status)))
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
  else if (val.startsWith('i:')) void router.push({ name: 'intent', params: { project, intent: val.slice(2) }, query })
  else {
    const [design, revision] = val.split('/')
    void router.push({ name: 'design', params: { project, design, revision }, query })
  }
}
</script>

<template>
  <span v-if="desk.project" class="versions">
    <label class="version" :class="{ design: !!desk.version }">
      <span class="sr">版本</span>
      <select :value="value" aria-label="切换版本" @change="onChange">
        <option value="">当前版本（代码）</option>
        <optgroup v-if="intents.length" label="持久草图（人拥有，可编辑）">
          <option v-for="id in intents" :key="id" :value="`i:${id}`" title="持久草图：人拥有，可编辑">✎ {{ intentName(id) }}</option>
        </optgroup>
        <optgroup v-for="d in active" :key="d.id" :label="`设计 · ${d.name}（${DESIGN_STATUS_LABELS[d.status]}）`">
          <option v-for="(r, i) in [...d.revisions].reverse()" :key="r.id" :value="`${d.id}/${r.id}`" :title="r.date">
            {{ d.name }} · {{ r.id }}{{ i === 0 ? '（最新）' : '' }}
          </option>
          <option v-if="d.sketch" :value="`${d.id}/${SKETCH_REVISION}`" title="草图：架构师画的局部描述，各轮按它展开">✎ {{ d.name }}</option>
        </optgroup>
        <optgroup v-if="archived.length" label="已归档的设计（已实现 / 已放弃）">
          <template v-for="d in archived" :key="d.id">
            <option
              v-for="r in [...d.revisions].reverse()"
              :key="r.id"
              :value="`${d.id}/${r.id}`"
              :title="`${DESIGN_STATUS_LABELS[d.status]}${r.date ? ` · ${r.date}` : ''}`"
            >
              {{ d.name }} · {{ r.id }}
            </option>
            <option v-if="d.sketch" :value="`${d.id}/${SKETCH_REVISION}`" title="草图">✎ {{ d.name }}</option>
          </template>
        </optgroup>
        <optgroup v-if="commits.length || extraCommit" label="提交（描述的历史）">
          <option v-if="extraCommit" :value="`c:${extraCommit.hash}`">{{ extraCommit.short }}</option>
          <option v-for="c in commits" :key="c.hash" :value="`c:${c.hash}`" :title="`${c.hash}\n${c.subject}`">
            {{ c.short }} · {{ c.date }} · {{ subject(c.subject) }}
          </option>
        </optgroup>
      </select>
    </label>
    <template v-if="!desk.version">
      <button v-if="intents.includes('skeleton')" class="new" title="打开骨架（持久草图）并进入编辑态（E-1）" @click="editSkeleton">编辑骨架</button>
      <button class="new" title="新建设计：画草图，AI 按它展开各轮（SK-10）" @click="creating = true">新建设计</button>
    </template>
    <NewDesignDialog v-if="creating" @close="creating = false" />
  </span>
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

.new {
  margin-left: 6px;
  font-size: 12px;
  padding: 2px 8px;
}

.sr {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}
</style>
