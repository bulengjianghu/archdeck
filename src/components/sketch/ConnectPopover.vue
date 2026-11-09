<script setup lang="ts">
/**
 * 连线（F-21、X23）：从连线柄拖到另一节点松手后弹出——类型（查 / 托 / 通知 / 流，附一句读法）、机制（直接 / 端口 / 总线 / 通道）、
 * 异步 / 拉取 + 一句说明；被拒绝（同对同类型、连自己、两端都是引用）时就地显示原因。缺省为委托、直接。
 */
import { nextTick, onMounted, ref } from 'vue'
import type { RelationModifiers, RelationType } from '@/model'
import { useDesk } from '@/state/inject'
import RelationKindFields from './panel/RelationKindFields.vue'

const props = defineProps<{ from: string; to: string }>()
const emit = defineEmits<{ close: []; done: [] }>()
const desk = useDesk()
const type = ref<RelationType>('commands')
const mods = ref<RelationModifiers>({})
function onKind(p: { type?: RelationType } & RelationModifiers) {
  const { type: t, ...rest } = p
  if (t) type.value = t
  mods.value = { ...mods.value, ...rest }
}
const description = ref('')
const error = ref('')
const desc = ref<HTMLInputElement | null>(null)
const name = (id: string) => desk.edit.nameOf(id) ?? id
onMounted(async () => {
  await nextTick()
  desc.value?.focus()
})

function submit() {
  const r = desk.edit.connect(props.from, props.to, type.value, description.value, mods.value)
  if (!r.ok) return void (error.value = r.reason)
  emit('done')
}
</script>

<template>
  <div class="sk-dialog-mask" @click.self="emit('close')">
    <form class="sk-dialog" role="dialog" aria-label="新建关系" @submit.prevent="submit" @keydown.stop="e => e.key === 'Escape' && emit('close')">
      <h3>{{ name(from) }} → {{ name(to) }}</h3>
      <RelationKindFields
        :type="type"
        :via="mods.via || undefined"
        :mode="mods.mode === 'async' ? 'async' : undefined"
        :pull="mods.pull"
        :to="to"
        @change="onKind"
      />
      <label>说明（一句话） <input ref="desc" v-model="description" name="rel-description" /></label>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <div class="actions">
        <button type="button" @click="emit('close')">取消</button>
        <button type="submit" class="ok">连上</button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.sk-dialog-mask {
  position: fixed;
  inset: 0;
  z-index: 45;
  display: grid;
  place-items: center;
  background: rgb(20 26 36 / 20%);
}

.sk-dialog {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 380px;
  padding: 12px 14px;
  background: var(--surface);
  border-radius: var(--radius);
  box-shadow: 0 8px 28px rgb(0 0 0 / 18%);
  font-size: 13px;
}

h3 {
  margin: 0;
  font-size: 13.5px;
}

label {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.hint,
.error {
  margin: 0;
  font-size: 12px;
  color: var(--text-3);
}

.error {
  color: var(--danger);
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.ok {
  border-color: var(--accent);
  background: var(--accent);
  color: #fff;
}
</style>
