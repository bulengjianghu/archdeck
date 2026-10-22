<script setup lang="ts">
/**
 * 新建设计（S-4、L-3、SK-10，ADR-0024）：ID、名称、目标一句话、底稿——缺省「空草图」；「改骨架（定稿后晋升替换骨架）」复制骨架的层与第二级并声明 supersedes。
 * 创建后打开新设计的草图并进入编辑态。
 */
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useDesk } from '@/state/inject'

const emit = defineEmits<{ close: [] }>()
const desk = useDesk()
const router = useRouter()
const id = ref('')
const name = ref('')
const goal = ref('')
const base = ref<'empty' | 'copy'>('empty')
const error = ref('')
const busy = ref(false)
const valid = computed(() => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id.value.trim()) && !!name.value.trim())

async function create() {
  if (!valid.value || busy.value) return
  busy.value = true
  const r = await desk.edit.createDesign({ id: id.value.trim(), name: name.value.trim(), goal: goal.value.trim() || undefined, base: base.value })
  busy.value = false
  if (!r.ok) return void (error.value = r.error)
  emit('close')
  void router.push({ name: 'design', params: { project: desk.project!, design: id.value.trim(), revision: 'sketch' }, query: { edit: '1' } })
}
</script>

<template>
  <div class="mask" role="dialog" aria-modal="true" aria-label="新建设计" @click.self="emit('close')" @keydown.esc="emit('close')">
    <form class="box" @submit.prevent="create">
      <h3>新建设计</h3>
      <label>ID <input v-model="id" name="design-id" placeholder="如 sketch-editor" autofocus /></label>
      <label>名称 <input v-model="name" name="design-name" placeholder="如 草图的画布编辑" /></label>
      <label>目标（一句话） <input v-model="goal" name="design-goal" /></label>
      <fieldset>
        <legend>底稿</legend>
        <label class="radio"><input v-model="base" type="radio" value="empty" /> 空草图</label>
        <label class="radio"><input v-model="base" type="radio" value="copy" /> 改骨架（定稿后晋升替换骨架）</label>
        <p v-if="base === 'copy'" class="warn">
          复制骨架的层与第二级（含封闭与核心）并声明 supersedes: skeleton：可以改骨架里写了的字段、往封闭的层下加模块；定稿实现后这张草图会整份替换
          intent/skeleton.yaml，而不是归档。
        </p>
      </fieldset>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <div class="actions">
        <button type="button" @click="emit('close')">取消</button>
        <button type="submit" class="ok" :disabled="!valid || busy">创建并编辑草图</button>
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

label.radio {
  flex-direction: row;
  align-items: center;
}

fieldset {
  border: 1px solid var(--border);
  border-radius: 6px;
}

.warn {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--warning);
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
