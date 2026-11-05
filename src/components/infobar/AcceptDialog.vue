<script setup lang="ts">
/**
 * 认可前总览（TK-1，DL-38）：全设计的改动项（带号、按类别分组）、影响面（各项映射回基线模块的并集加传入闭包，按当前描述估，DL-27）、
 * 涉及的场景；「确认认可」才写 design.yaml（status: accepted + 各张草图指纹）。认可后草图锁定、改动页签切任务模式。
 */
import { computed, nextTick, onMounted, ref } from 'vue'
import { CHANGE_KIND_LABELS } from '@/model'
import { useDesk } from '@/state/inject'

const emit = defineEmits<{ close: [] }>()
const desk = useDesk()
const a = desk.edit.approval
const ov = computed(() => a.overview.value)
const busy = ref(false)
const error = ref('')
const okBtn = ref<HTMLButtonElement | null>(null)
const scenarioName = (id: string) => desk.index.value?.scenarios.get(id)?.name ?? id

async function confirm() {
  busy.value = true
  error.value = ''
  const r = await a.accept()
  busy.value = false
  if (r.ok) emit('close')
  else error.value = r.reason
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
  e.stopPropagation()
}
onMounted(async () => {
  await nextTick()
  okBtn.value?.focus()
})
</script>

<template>
  <div class="mask" role="dialog" aria-modal="true" aria-label="认可前总览" data-testid="accept-dialog" @keydown="onKey" @click.self="emit('close')">
    <div class="box">
      <h3>认可设计「{{ desk.versions.design.value?.name }}」：最后看一眼后果</h3>
      <p class="lead">确认后设计进入「已认可」：草图锁定（对话只能问、手势禁用、撤回变灰），记下各张草图的指纹；「改动」页签原号不变地变成任务单。</p>
      <section>
        <h4>改动 {{ ov.total }} 项（全设计，相对基线）</h4>
        <p v-if="!ov.total" class="muted">没有改动：认可后任务单为空</p>
        <div v-for="g in ov.groups" :key="g.kind" class="group">
          <span class="kind">{{ CHANGE_KIND_LABELS[g.kind] }} {{ g.items.length }}</span>
          <ul>
            <li v-for="it in g.items" :key="it.n" data-testid="accept-item">
              <span class="no">#{{ it.n }}</span> {{ it.summary }} <span class="muted">· {{ it.mount }}</span>
            </li>
          </ul>
        </div>
      </section>
      <section v-if="ov.impact" data-testid="accept-impact">
        <h4>影响面 <span class="est">按当前描述估</span></h4>
        <p v-if="ov.impact.fresh">全是新框：映射不回基线，不给数</p>
        <template v-else>
          <p>
            牵动 <strong>{{ ov.impact.modules.length }}</strong> 个模块 · 涉及 <strong>{{ ov.impact.scenarios.length }}</strong> 个场景
          </p>
          <p v-if="ov.impact.scenarios.length" class="muted">场景：{{ ov.impact.scenarios.map(scenarioName).join('、') }}</p>
        </template>
      </section>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <div class="actions">
        <button @click="emit('close')">取消</button>
        <button ref="okBtn" class="ok" data-testid="accept-confirm" :disabled="busy" @click="confirm">{{ busy ? '认可中…' : '确认认可' }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: grid;
  place-items: center;
  background: rgb(20 26 36 / 28%);
}

.box {
  width: min(560px, calc(100vw - 32px));
  max-height: calc(100vh - 64px);
  overflow: auto;
  padding: 16px 18px;
  background: var(--surface);
  border-radius: var(--radius);
  box-shadow: 0 8px 28px rgb(0 0 0 / 18%);
  font-size: 12.5px;
}

h3 {
  margin: 0 0 6px;
  font-size: 14px;
}

h4 {
  margin: 12px 0 4px;
  font-size: 12.5px;
}

.lead,
.muted {
  color: var(--text-2);
}

.group {
  margin: 4px 0;
}

.kind {
  font-size: 11.5px;
  color: var(--text-2);
}

ul {
  margin: 2px 0;
  padding-left: 18px;
}

.no {
  font-family: var(--mono);
  color: var(--accent);
}

.est {
  margin-left: 6px;
  padding: 0 6px;
  border-radius: 8px;
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: normal;
  font-size: 11px;
}

.error {
  color: var(--danger);
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
}

.ok {
  border-color: var(--accent);
  background: var(--accent);
  color: #fff;
}
</style>
