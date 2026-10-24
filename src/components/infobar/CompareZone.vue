<script setup lang="ts">
/**
 * 信息条的对比区（F-62，E3–E6、ADR-0002）：一个按钮「对比 <基线> · +a ~m −d」，点开弹层——基线选择、计数、「图上标出变更」、基线漂移警告。
 * 基线：提交版本为任一提交或当前版本（E6，经路由）；设计轮次为当前版本或上一轮（E3）；草图为相对基线或相对当前版本（desk.versions.sketchDiffs）。
 * 草图只写架构师钉住的部分，当前版本里草图没画的不算删除，所以草图下不显示删除数。弹层点外面或 Esc 关闭。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { isCommitVersion, WORKTREE } from '@/model'
import type { SketchCompare } from '@/state/desk/versions'
import { useDesk } from '@/state/inject'

const props = defineProps<{ mode: 'commit' | 'round' | 'sketch' }>()
const desk = useDesk()
const route = useRoute()
const router = useRouter()
const open = ref(false)
const root = ref<HTMLElement>()
const sketchBase = ref<SketchCompare>('baseline')
const SKETCH_BASES: Record<SketchCompare, { label: string; hint: string }> = {
  baseline: { label: '相对基线', hint: '我改了什么' },
  current: { label: '相对当前版本', hint: '实现还差什么' },
}

const c = computed(() => desk.versions.commit.value)
const commits = computed(() => desk.versions.commits.value)
/** E6：提交版本的缺省基线为历史中更早的一个提交，没有时为当前版本（与开发服务器同一口径） */
const commitBase = computed(() => {
  const v = desk.version
  if (isCommitVersion(v) && v.base) return desk.versions.baseCommit.value?.hash ?? v.base
  const at = commits.value.findIndex(x => x.hash === c.value?.hash)
  return (at >= 0 ? commits.value[at + 1]?.hash : undefined) ?? WORKTREE
})
const previous = computed(() => desk.versions.baselines.value.previous)

const counts = computed(() => {
  if (props.mode !== 'sketch') return desk.versions.diff.value?.counts
  return desk.versions.sketchDiffs.value[sketchBase.value]?.counts
})
const baseLabel = computed(() =>
  props.mode === 'sketch'
    ? SKETCH_BASES[sketchBase.value].label
    : props.mode === 'round' && desk.toggles.compareTo === 'previous' && previous.value
      ? `上一轮（${previous.value.label}）`
      : (desk.versions.baseline.value?.label ?? '当前版本'),
)

function onCommitBase(e: Event) {
  const next = (e.target as HTMLSelectElement).value
  void router.push({ name: 'commit', params: { project: desk.project!, commit: c.value!.hash, base: next }, query: route.query })
}

function onDocDown(e: MouseEvent) {
  if (open.value && root.value && !root.value.contains(e.target as Node)) open.value = false
}
/** 捕获阶段先拿到 Esc：只关弹层，不再取消画布上的选中 */
function onKey(e: KeyboardEvent) {
  if (!open.value || e.key !== 'Escape') return
  e.stopImmediatePropagation()
  open.value = false
}
onMounted(() => {
  document.addEventListener('mousedown', onDocDown)
  window.addEventListener('keydown', onKey, true)
})
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocDown)
  window.removeEventListener('keydown', onKey, true)
})
</script>

<template>
  <div ref="root" class="compare" aria-label="对比">
    <button class="cmp-btn" :class="{ on: desk.toggles.showDiff }" :aria-expanded="open" aria-haspopup="dialog" @click="open = !open">
      对比 {{ baseLabel
      }}<template v-if="counts">
        ·
        <b class="add">+{{ counts.added }}</b>
        <b class="mod">~{{ counts.changed }}</b>
        <b v-if="mode !== 'sketch'" class="del">−{{ counts.removed }}</b>
      </template>
      <span v-if="desk.versions.drift.value" class="warn" title="基线已漂移">⚠</span>
      ▾
    </button>
    <div v-if="open" class="pop" role="dialog" aria-label="对比设置">
      <div class="row bases" role="radiogroup" aria-label="对比基线">
        <template v-if="mode === 'commit'">
          <label>
            基线
            <select :value="commitBase" aria-label="对比基线提交" @change="onCommitBase">
              <option :value="WORKTREE">当前版本</option>
              <option v-for="x in commits" :key="x.hash" :value="x.hash" :disabled="x.hash === c?.hash">{{ x.short }} · {{ x.date }}</option>
            </select>
          </label>
        </template>
        <template v-else-if="mode === 'round'">
          <label
            ><input v-model="desk.toggles.compareTo" type="radio" value="current" /> {{ desk.versions.baselines.value.current?.label ?? '当前版本' }}</label
          >
          <label v-if="previous"><input v-model="desk.toggles.compareTo" type="radio" value="previous" /> 上一轮（{{ previous.label }}）</label>
        </template>
        <template v-else>
          <label v-for="(b, k) in SKETCH_BASES" :key="k">
            <input v-model="sketchBase" type="radio" :value="k" /> {{ b.label }} <span class="muted">{{ b.hint }}</span>
          </label>
        </template>
      </div>
      <div v-if="counts" class="counts">
        <div>
          <b class="add">{{ counts.added }}</b
          ><span>新增</span>
        </div>
        <div>
          <b class="mod">{{ counts.changed }}</b
          ><span>修改</span>
        </div>
        <div v-if="mode !== 'sketch'">
          <b class="del">{{ counts.removed }}</b
          ><span>删除</span>
        </div>
      </div>
      <label class="row"><input v-model="desk.toggles.showDiff" type="checkbox" /> 图上标出变更</label>
      <div v-if="desk.versions.drift.value" class="drift">⚠ 基线已漂移：设计起草后当前版本已按新代码重新生成，「相对当前版本」的变更可能包含代码本身的变化</div>
    </div>
  </div>
</template>

<style scoped>
.compare {
  position: relative;
}

.cmp-btn {
  font-size: 12px;
  padding: 2px 9px;
  white-space: nowrap;
}

.cmp-btn.on {
  border-color: var(--accent);
}

.cmp-btn b {
  font-weight: 600;
}

.cmp-btn b + b,
.cmp-btn .warn {
  margin-left: 4px;
}

.add {
  color: var(--diff-added);
}

.mod {
  color: var(--diff-changed);
}

.del {
  color: var(--diff-removed);
}

.warn {
  color: var(--warning);
}

.pop {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 30;
  width: 340px;
  padding: 10px 12px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: 0 8px 24px rgb(0 0 0 / 14%);
  font-size: 12.5px;
}

.row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 6px 0;
}

.bases {
  flex-direction: column;
  align-items: flex-start;
}

.bases label {
  display: flex;
  align-items: center;
  gap: 4px;
}

.bases select {
  font-size: 12px;
  max-width: 240px;
}

.counts {
  display: flex;
  gap: 6px;
  margin: 8px 0;
}

.counts div {
  flex: 1;
  padding: 4px;
  text-align: center;
  border: 1px solid var(--border);
  border-radius: 6px;
}

.counts b {
  display: block;
  font-size: 15px;
}

.counts span {
  font-size: 11.5px;
  color: var(--text-2);
}

.drift {
  margin-top: 6px;
  padding: 6px 8px;
  border-radius: 6px;
  color: var(--warning);
  background: var(--warning-soft);
}
</style>
