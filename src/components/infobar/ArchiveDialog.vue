<script setup lang="ts">
/**
 * 归档预览（DL-50，TK-5、TK-6）：三关（核验一致 / 棘轮无新增 / 草图指纹一致）、「认可时估牵动 N · 实际改了 N′」与差、
 * 将写确认记录的模块数、将晋升替换的持久草图；「确认归档」才写（status: implemented、确认记录、晋升）。数据取写端点的归档预览（与命令行同一份）。
 */
import { computed, nextTick, onMounted, ref } from 'vue'
import { useDesk } from '@/state/inject'

const emit = defineEmits<{ close: []; done: [note: string] }>()
const desk = useDesk()
const a = desk.edit.approval
const p = computed(() => a.preview.value)
const busy = ref(false)
const error = ref('')
const okBtn = ref<HTMLButtonElement | null>(null)
const nameOf = (id: string) => desk.edit.nameOf(id) ?? desk.edit.currentIndex.value?.modules.get(id)?.name ?? id
const list = (ids: readonly string[]) => (ids.length ? ids.map(nameOf).join('、') : '无')

async function confirm() {
  busy.value = true
  error.value = ''
  const r = await a.archive()
  busy.value = false
  if (r.ok) emit('done', r.note ?? '已归档')
  else error.value = r.reason
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
  e.stopPropagation()
}
onMounted(async () => {
  void a.refreshPreview()
  await nextTick()
  okBtn.value?.focus()
})
</script>

<template>
  <div class="mask" role="dialog" aria-modal="true" aria-label="归档预览" data-testid="archive-dialog" @keydown="onKey" @click.self="emit('close')">
    <div class="box">
      <h3>归档设计「{{ desk.versions.design.value?.name }}」</h3>
      <p class="lead">
        归档一个动作做三件事：状态改「已实现」，草图覆盖的模块写入确认记录（指纹取此刻的当前版本），声明替换的草图晋升为持久草图。草图、对话、设计说明原样留在设计里。
      </p>
      <p v-if="!p" class="muted">{{ a.archiveBlocked.value }}</p>
      <template v-else>
        <section data-testid="archive-gates">
          <h4>三关</h4>
          <ul class="gates">
            <li v-for="g in p.gates.gates" :key="g.key" :class="g.ok ? 'ok' : 'bad'" :data-gate="g.key">
              <span class="mark">{{ g.ok ? '✓' : '✗' }}</span> {{ g.label }} <span class="muted">· {{ g.detail }}</span>
            </li>
          </ul>
        </section>
        <section data-testid="archive-gap">
          <h4>估与实际</h4>
          <p data-testid="archive-gap-line">{{ a.gapText.value }}</p>
          <template v-if="p.gap.recorded">
            <p class="muted">改了没估：{{ list(p.gap.missed) }}</p>
            <p class="muted">估了没改：{{ list(p.gap.spared) }}</p>
            <p class="muted">新加：{{ list(p.gap.added) }}</p>
          </template>
        </section>
        <section>
          <h4>写入</h4>
          <p data-testid="archive-covered">确认记录 {{ p.covered.length }} 个模块（来源 sketch:{{ desk.versions.design.value?.id }}）</p>
          <p v-if="p.promotes.length">晋升替换持久草图：{{ p.promotes.join('、') }}</p>
        </section>
      </template>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <div class="actions">
        <button @click="emit('close')">取消</button>
        <button ref="okBtn" class="ok" data-testid="archive-confirm" :disabled="busy || !!a.archiveBlocked.value" @click="confirm">
          {{ busy ? '归档中…' : '确认归档' }}
        </button>
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

p {
  margin: 2px 0;
}

.lead,
.muted {
  color: var(--text-2);
}

.gates {
  margin: 2px 0;
  padding-left: 0;
  list-style: none;
}

.gates .ok .mark {
  color: var(--ok, #2e8b57);
}

.gates .bad .mark {
  color: var(--danger);
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
