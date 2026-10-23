<script setup lang="ts">
/**
 * 新建设计（S-4、F-11，ADR-0025）：ID、名称、目标一句话、挂载点（入口带入，可改；根挂载即「改骨架」）。
 * 底稿一律按挂载点从基线复制（X18）；创建后打开新设计的草图（进入草图画布）。
 */
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ROOT_MOUNT } from '@/model'
import { useDesk } from '@/state/inject'

const props = defineProps<{ mount?: string }>()
const emit = defineEmits<{ close: [] }>()
const desk = useDesk()
const router = useRouter()
const id = ref('')
const name = ref('')
const goal = ref('')
/** 缺省挂载点：入口带入的，否则选中的模块，否则根 */
const selectedModule = desk.selection.value?.kind === 'module' ? desk.selection.value.id : undefined
const mount = ref(props.mount ?? selectedModule ?? ROOT_MOUNT)
const error = ref('')
const busy = ref(false)
/** 可选的挂载点：根与非层的模块（层的直接子模块由根草图画，X9） */
const mounts = computed(() => {
  const idx = desk.index.value
  if (!idx) return []
  return [...idx.modules.values()]
    .filter(m => m.kind !== 'layer')
    .map(m => ({
      id: m.id,
      label: `${(idx.pathOf.get(m.id) ?? [])
        .slice(1)
        .map(x => idx.modules.get(x)?.name ?? x)
        .join(' › ')}`,
    }))
})
const mountOk = computed(() => mount.value === ROOT_MOUNT || mounts.value.some(m => m.id === mount.value))
const valid = computed(() => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id.value.trim()) && !!name.value.trim() && mountOk.value)

async function create() {
  if (!valid.value || busy.value) return
  busy.value = true
  const r = await desk.edit.createDesign({ id: id.value.trim(), name: name.value.trim(), goal: goal.value.trim() || undefined, mount: mount.value })
  busy.value = false
  if (!r.ok) return void (error.value = r.error)
  emit('close')
  void router.push({ name: 'design', params: { project: desk.project!, design: id.value.trim(), revision: 'sketch' } })
}
</script>

<template>
  <div class="mask" role="dialog" aria-modal="true" aria-label="新建设计" @click.self="emit('close')" @keydown.esc="emit('close')">
    <form class="box" @submit.prevent="create">
      <h3>新建设计</h3>
      <label>ID <input v-model="id" name="design-id" placeholder="如 sketch-editor" autofocus /></label>
      <label>名称 <input v-model="name" name="design-name" placeholder="如 草图的画布编辑" /></label>
      <label>目标（一句话） <input v-model="goal" name="design-goal" /></label>
      <label>
        挂载点（在哪个模块下设计这一层）
        <select v-model="mount" name="design-mount">
          <option :value="ROOT_MOUNT">根（层与第二级，改骨架）</option>
          <option v-for="m in mounts" :key="m.id" :value="m.id">{{ m.label }}（{{ m.id }}）</option>
        </select>
      </label>
      <p class="hint">底稿从基线复制挂载点下的一层：模块的 ID、名称、核心与本层关系，不带职责文字（X18）。</p>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <div class="actions">
        <button type="button" @click="emit('close')">取消</button>
        <button type="submit" class="ok" :disabled="!valid || busy">创建并打开草图</button>
      </div>
    </form>
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
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 420px;
  padding: 16px 18px;
  background: var(--surface);
  border-radius: var(--radius);
  box-shadow: 0 8px 28px rgb(0 0 0 / 18%);
  font-size: 13px;
}

h3 {
  margin: 0 0 4px;
  font-size: 14px;
}

label {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.hint {
  margin: 0;
  font-size: 12px;
  color: var(--text-3);
}

.error {
  margin: 0;
  color: var(--danger);
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.ok:not(:disabled) {
  border-color: var(--accent);
  background: var(--accent);
  color: #fff;
}
</style>
