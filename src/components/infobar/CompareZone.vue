<script setup lang="ts">
/**
 * 信息条的对比区（F-62，E3–E6、ADR-0002）：一个按钮「对比 <基线> · +a ~m −d」，点开弹层——基线选择、计数、「图上标出变更」、基线漂移警告。
 * 基线：提交版本为任一提交或当前版本（E6，经路由）；设计轮次为当前版本或上一轮（E3）；
 * 草图为相对基线或相对当前版本（desk.edit.setCompareMode / compareMode，结果为全设计的 desk.edit.comparison）：六类计数（改 ID 并入修改，F-51、T1 裁决 2），
 * 「删除」只算范围内的主动删除；「图上标出变更」跟随当前口径（画布角标来自同一个 comparison）；弹层里列全设计清单（F-53）；
 * 没有基线提交时提示「相对基线 = 相对当前版本」（05 裁决 3）；持久草图只有相对当前版本，对象是去掉这张草图贡献后的当前版本（与服务端同一口径）。弹层点外面或 Esc 关闭。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { isCommitVersion, WORKTREE } from '@/model'
import { useDesk } from '@/state/inject'
import { sixCounts } from '../sketch/labels'
import ChangeGroups from './ChangeGroups.vue'

const props = defineProps<{ mode: 'commit' | 'round' | 'sketch' }>()
const desk = useDesk()
const route = useRoute()
const router = useRouter()
const open = ref(false)
const root = ref<HTMLElement>()
const e = desk.edit
type CompareMode = Parameters<typeof e.setCompareMode>[0]
const sketchBase = computed<CompareMode>({ get: () => e.compareMode.value, set: m => e.setCompareMode(m) })
const SKETCH_BASES: Record<CompareMode, { label: string; hint: string }> = {
  baseline: { label: '相对基线', hint: '我改了什么' },
  current: { label: '相对当前版本', hint: '实现还差什么' },
}

/** 持久草图只有「相对当前版本」（与去掉它贡献后的当前版本比，同服务端） */
const sketchBases = computed(() => (e.twoBases ? SKETCH_BASES : { current: SKETCH_BASES.current }))

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

const counts = computed(() => (props.mode !== 'sketch' ? desk.versions.diff.value?.counts : undefined))
/** 草图：全设计六类计数（随口径） */
const six = computed(() => (props.mode === 'sketch' && e.comparison.value ? sixCounts(e.comparison.value.counts) : null))
/** 按钮上：新增 / 修改始终显示，合并 / 拆分 / 移动 / 删除只在非 0 时显示（弹层里六类都列） */
const sixShown = computed(() => six.value?.filter(c => c.key === 'added' || c.key === 'changed' || c.n > 0) ?? [])
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
      }}<template v-if="six">
        ·
        <b v-for="c in sixShown" :key="c.key" :class="[c.key, { zero: !c.n }]" :title="c.label">{{ c.mark }}{{ c.n }}</b>
      </template>
      <template v-else-if="counts">
        ·
        <b class="add">+{{ counts.added }}</b>
        <b class="mod">~{{ counts.changed }}</b>
        <b class="del">−{{ counts.removed }}</b>
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
          <label v-for="(b, k) in sketchBases" :key="k">
            <input v-model="sketchBase" type="radio" :value="k" /> {{ b.label }} <span class="muted">{{ b.hint }}</span>
          </label>
        </template>
      </div>
      <div v-if="six" class="counts six">
        <div v-for="c in six" :key="c.key">
          <b :class="c.key">{{ c.n }}</b
          ><span>{{ c.label }}</span>
        </div>
      </div>
      <div v-else-if="counts" class="counts">
        <div>
          <b class="add">{{ counts.added }}</b
          ><span>新增</span>
        </div>
        <div>
          <b class="mod">{{ counts.changed }}</b
          ><span>修改</span>
        </div>
        <div>
          <b class="del">{{ counts.removed }}</b
          ><span>删除</span>
        </div>
      </div>
      <p v-if="mode === 'sketch' && e.baselineFallback.value" class="fallback" data-testid="baseline-fallback">设计没有基线提交，相对基线 = 相对当前版本</p>
      <label class="row"><input v-model="desk.toggles.showDiff" type="checkbox" /> 图上标出变更</label>
      <template v-if="mode === 'sketch'">
        <p class="cap">全设计清单</p>
        <ChangeGroups :view="e.comparison.value" :name-of="e.nameOf" />
      </template>
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

.add,
.added {
  color: var(--diff-added);
}

.merged,
.split,
.moved {
  color: var(--accent);
}

.cmp-btn b.zero {
  color: var(--text-3);
  font-weight: 400;
}

.mod,
.changed {
  color: var(--diff-changed);
}

.del,
.removed {
  color: var(--diff-removed);
}

.six div {
  padding: 4px 2px;
}

.fallback {
  margin: 6px 0;
  padding: 6px 8px;
  border-radius: 6px;
  color: var(--text-2);
  background: var(--surface-2);
}

.cap {
  margin: 8px 0 4px;
  font-size: 11.5px;
  color: var(--text-2);
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
