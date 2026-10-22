<script setup lang="ts">
/** 对外接口（P-4）：增删改名称与签名，owner 固定为该模块 */
import { ref } from 'vue'
import { useDesk } from '@/state/inject'
import Field from './Field.vue'

const props = defineProps<{ owner: string }>()
const emit = defineEmits<{ notice: [msg: string] }>()
const desk = useDesk()
const name = ref('')
const done = (r: { ok: boolean; reason?: string }) => !r.ok && emit('notice', r.reason ?? '')
function add() {
  if (!name.value.trim()) return
  done(desk.edit.edit({ op: 'addInterface', owner: props.owner, name: name.value.trim() }))
  name.value = ''
}
</script>

<template>
  <div class="ifaces">
    <h4>对外接口</h4>
    <div v-for="x in desk.edit.lookup.interfacesOf(owner)" :key="x.id" class="iface">
      <div class="row">
        <code>{{ x.id }}</code>
        <button class="link danger" @click="done(desk.edit.edit({ op: 'removeInterface', id: x.id }))">删除</button>
      </div>
      <Field label="名称" :value="x.name" @commit="v => done(desk.edit.edit({ op: 'updateInterface', id: x.id, patch: { name: v as string } }))" />
      <Field
        label="签名"
        :value="x.signature"
        multiline
        mono
        @commit="v => done(desk.edit.edit({ op: 'updateInterface', id: x.id, patch: { signature: v as string } }))"
      />
    </div>
    <form class="add" @submit.prevent="add">
      <input v-model="name" name="interface-name" placeholder="新接口名称" aria-label="新接口名称" @keydown.stop />
      <button type="submit">加接口</button>
    </form>
  </div>
</template>

<style scoped>
h4 {
  margin: 8px 0 4px;
  font-size: 12.5px;
}

.iface {
  padding: 6px 0;
  border-top: 1px dashed var(--border);
}

.row {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
}

.add {
  display: flex;
  gap: 6px;
}

.add input {
  flex: 1;
  font-size: 12.5px;
}

.danger {
  color: var(--danger);
}
</style>
