<script setup lang="ts">
/**
 * 草图面板（present.panel.sketch 的最小形式，T2b 补全）：顶部两级校验与超七 / 待重连；选中本层模块时名称、ID 短名、一句话职责可编辑
 * （失焦或回车提交即一步，值未变不提交，X7g）；选中引用节点时只读显示它在当前版本里的职责；多选时提示合并。
 */
import { computed, ref, watch } from 'vue'
import { useDesk } from '@/state/inject'

const desk = useDesk()
const e = desk.edit
const sel = computed(() => desk.selection.value)
const own = computed(() => (sel.value?.kind === 'module' ? e.lookup.module(sel.value.id) : undefined))
const refId = computed(() => (sel.value?.kind === 'module' && !own.value ? sel.value.id : null))
const relation = computed(() => (sel.value?.kind === 'relation' ? e.lookup.relation(sel.value.id) : undefined))
const v = computed(() => e.validation.value)
const note = ref('')

const name = ref('')
const short = ref('')
const resp = ref('')
watch(
  own,
  m => {
    name.value = m?.name ?? ''
    short.value = m ? m.id.slice(m.id.lastIndexOf('.') + 1) : ''
    resp.value = m?.responsibility ?? ''
  },
  { immediate: true },
)
function done(r: { ok: boolean; reason?: string }) {
  note.value = r.ok ? '' : (r.reason ?? '')
}
function commitName() {
  if (own.value && name.value.trim() && name.value.trim() !== own.value.name) done(e.updateModule(own.value.id, { name: name.value.trim() }))
}
function commitResp() {
  if (own.value && resp.value.trim() !== (own.value.responsibility ?? ''))
    done(e.updateModule(own.value.id, { responsibility: resp.value.trim() || undefined }))
}
function commitId() {
  const m = own.value
  if (!m) return
  const cur = m.id.slice(m.id.lastIndexOf('.') + 1)
  if (short.value.trim() && short.value.trim() !== cur) done(e.rename(m.id, short.value.trim()))
}
const blur = (ev: KeyboardEvent) => (ev.target as HTMLElement).blur()
</script>

<template>
  <div class="sk-panel" data-testid="sketch-panel">
    <section class="checks" data-testid="sketch-checks">
      <p v-if="v && !v.errors.length && !v.warnings.length" class="ok">本张校验通过</p>
      <p v-for="(x, i) in v?.errors ?? []" :key="`e${i}`" class="err">{{ x.message }}</p>
      <p v-for="(x, i) in v?.warnings ?? []" :key="`w${i}`" class="warn">{{ x.message }}</p>
      <p v-if="e.overSeven.value" class="warn">{{ e.overSeven.value.message }}</p>
      <p v-if="e.pending.value.length" class="warn">待重连 {{ e.pending.value.length }} 条</p>
      <p v-for="(x, i) in e.serverIssues.value" :key="`s${i}`" class="err">服务端：{{ x.message }}</p>
    </section>

    <section v-if="e.picked.value.length > 1" class="body">
      <p>已选 {{ e.picked.value.length }} 个：右键「合并为新模块…」把它们收进一个新概念。</p>
    </section>
    <section v-else-if="own" class="body" data-testid="sketch-module-form">
      <h3>{{ own.name }}</h3>
      <label>名称 <input v-model="name" name="module-name" @blur="commitName" @keydown.enter="blur" /></label>
      <label>
        ID
        <span class="id-row">
          <code>{{ own.id.slice(0, own.id.lastIndexOf('.') + 1) }}</code>
          <input v-model="short" name="module-id" @blur="commitId" @keydown.enter="blur" />
        </span>
      </label>
      <label>一句话职责 <textarea v-model="resp" name="module-responsibility" rows="3" @blur="commitResp" /></label>
      <p v-if="own.from?.length" class="muted">来自 {{ own.from.join('、') }}</p>
      <button v-if="e.deeper(own.id)" class="small" @click="e.openChild(own.id)">进入下一层 →</button>
    </section>
    <section v-else-if="refId" class="body">
      <h3>{{ e.nameOf(refId) ?? refId }} <span class="muted">· 引用</span></h3>
      <code>{{ refId }}</code>
      <p class="muted">{{ desk.index.value?.modules.get(refId)?.responsibility ?? '（当前版本里没有职责）' }}</p>
    </section>
    <section v-else-if="relation" class="body">
      <h3>{{ e.nameOf(relation.from) ?? relation.from }} → {{ e.nameOf(relation.to) ?? relation.to }}</h3>
      <p class="muted">
        {{ relation.type }}<template v-if="relation.description"> · {{ relation.description }}</template>
      </p>
    </section>
    <section v-else class="body">
      <h3>{{ e.breadcrumb.value[e.breadcrumb.value.length - 1]?.name }}</h3>
      <p class="muted">选中一个模块编辑名称、ID 与职责；属性面板的其余部分在 T2b 补全。</p>
    </section>
    <p v-if="note" class="err" role="alert">{{ note }}</p>
  </div>
</template>

<style scoped>
.sk-panel {
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  font-size: 13px;
}

.checks p {
  margin: 2px 0;
  font-size: 12px;
}

.ok {
  color: var(--diff-added);
}

.err {
  color: var(--danger);
}

.warn {
  color: var(--warning);
}

.body {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

h3 {
  margin: 0;
  font-size: 15px;
}

label {
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 12px;
  color: var(--text-2);
}

.id-row {
  display: flex;
  align-items: center;
  gap: 2px;
}

.id-row input {
  flex: 1;
  min-width: 0;
}

.muted {
  color: var(--text-3);
  font-size: 12px;
  margin: 0;
}

.small {
  align-self: flex-start;
  font-size: 12px;
}
</style>
