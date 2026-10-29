<script setup lang="ts">
/**
 * 新建设计（S-4、F-10、F-11，ADR-0025）：名称、目标一句话、挂载点（「在此设计」的入口带入，可改；下拉或搜索；不能选层）、设计 ID。
 * 根挂载（改骨架）只在入口带入 root 时可选（设计面板「改骨架」）。底稿一律按挂载点从基线复制（X18）——服务端把 base.commit 记为
 * 仓库 HEAD 并从那一版描述复制（05 裁决 3）；创建后打开新设计的草图（进入草图画布）。
 * 有草稿设计（status: draft、有草图）时多一个选项「加到设计 <名>」（T2b 裁决 6）：不新建，打开那个设计的草图并切到挂在这个模块上的一张
 * （会话里没有时按基线推出，改了才在保存时写出）。
 */
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ROOT_MOUNT } from '@/model'
import { useDesk } from '@/state/inject'
import { requestSheet } from './designHere'

const props = defineProps<{ mount?: string }>()
const emit = defineEmits<{ close: [] }>()
const desk = useDesk()
const router = useRouter()
const id = ref('')
const name = ref('')
const goal = ref('')
const idx = computed(() => desk.index.value)
const usable = (x: string | undefined) =>
  !!x && (x === ROOT_MOUNT ? props.mount === ROOT_MOUNT : !!idx.value?.modules.get(x) && idx.value.modules.get(x)!.parentId !== idx.value.rootId)
/** 缺省挂载点：入口带入的，否则选中的（不是根的子模块的）模块，否则空（必须选） */
const selectedModule = desk.selection.value?.kind === 'module' ? desk.selection.value.id : undefined
const mount = ref([props.mount, selectedModule].find(usable) ?? '')
const search = ref('')
const error = ref('')
const busy = ref(false)
/** 可选的挂载点：根的子模块之外的模块（根的子模块的直接子模块由根草图画，X9）；路径名便于认出 */
const mounts = computed(() => {
  const i = idx.value
  if (!i) return []
  return [...i.modules.values()]
    .filter(m => m.parentId !== i.rootId && m.id !== i.rootId)
    .map(m => ({
      id: m.id,
      label: (i.pathOf.get(m.id) ?? [])
        .slice(1)
        .map(x => i.modules.get(x)?.name ?? x)
        .join(' › '),
    }))
})
const shown = computed(() => {
  const q = search.value.trim().toLowerCase()
  const hits = q ? mounts.value.filter(m => m.id.toLowerCase().includes(q) || m.label.toLowerCase().includes(q)) : mounts.value
  // 选中的总在列表里
  return hits.some(m => m.id === mount.value) ? hits : [...mounts.value.filter(m => m.id === mount.value), ...hits]
})
watch(search, () => {
  if (shown.value.length && !shown.value.some(m => m.id === mount.value)) mount.value = shown.value[0].id
})
/** 设计 ID：名称能转写为 kebab-case 时跟着名称建议，手改后不再跟 */
let idTouched = false
const touchId = () => (idTouched = true)
watch(name, n => {
  if (!idTouched && /^[\x20-\x7e]*$/.test(n)) id.value = desk.edit.suggestShort(n)
})
const idOk = computed(() => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id.value.trim()))
const taken = computed(() => desk.versions.designs.value.some(d => d.id === id.value.trim()))
/** T2b 裁决 6：可以加进去的草稿设计（有草图） */
const drafts = computed(() => desk.versions.designs.value.filter(d => d.status === 'draft' && d.sketch))
const into = ref<'new' | 'add'>('new')
const target = ref(drafts.value[0]?.id ?? '')
const adding = computed(() => into.value === 'add' && !!target.value)
const valid = computed(() => (adding.value ? usable(mount.value) : idOk.value && !taken.value && !!name.value.trim() && usable(mount.value)))

function addTo() {
  requestSheet(target.value, mount.value)
  emit('close')
  void router.push({ name: 'design', params: { project: desk.project!, design: target.value, revision: 'sketch' } })
}

async function create() {
  if (!valid.value || busy.value) return
  if (adding.value) return addTo()
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
      <h3>{{ mount === ROOT_MOUNT ? '改骨架：新建设计' : '新建设计' }}</h3>
      <div v-if="drafts.length" class="into" role="radiogroup" aria-label="新建或加到已有设计">
        <label class="row"><input v-model="into" type="radio" value="new" name="design-into" /> 新建设计</label>
        <label class="row">
          <input v-model="into" type="radio" value="add" name="design-into" />
          <template v-if="drafts.length === 1">加到设计 {{ drafts[0].name }}</template>
          <template v-else>
            加到设计
            <select v-model="target" name="design-target" @focus="into = 'add'">
              <option v-for="d in drafts" :key="d.id" :value="d.id">{{ d.name }}</option>
            </select>
          </template>
        </label>
      </div>
      <template v-if="!adding">
        <label>名称 <input v-model="name" name="design-name" placeholder="如 草图的画布编辑" autofocus /></label>
        <label>目标（一句话） <input v-model="goal" name="design-goal" /></label>
      </template>
      <label>
        挂载点（在哪个模块下设计这一层）
        <input v-model="search" name="design-mount-search" placeholder="搜索模块名称或 ID" />
        <select v-model="mount" name="design-mount" size="1">
          <option v-if="!mount" value="" disabled>选择挂载点</option>
          <option v-if="props.mount === ROOT_MOUNT" :value="ROOT_MOUNT">根（层与第二级，改骨架）</option>
          <option v-for="m in shown" :key="m.id" :value="m.id">{{ m.label }}（{{ m.id }}）</option>
        </select>
        <span class="hint">层不能作为挂载点：层的直接子模块画在根草图里</span>
      </label>
      <label v-if="!adding">
        设计 ID
        <input v-model="id" name="design-id" placeholder="如 sketch-editor" @input="touchId" />
        <span v-if="id.trim() && !idOk" class="error small">只能包含字母、数字和 . _ -，以字母或数字开头</span>
        <span v-else-if="taken" class="error small">设计「{{ id.trim() }}」已存在</span>
      </label>
      <p v-if="adding" class="hint">打开这个设计的草图并切到挂在所选模块上的一张：设计里还没有时按设计的基线推出，改了才在保存时写出（X18、X20）。</p>
      <p v-else class="hint">底稿从基线复制挂载点下的一层：模块的 ID、名称、核心与本层关系，不带职责文字（X18）；基线为仓库当前提交（HEAD）的描述。</p>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <div class="actions">
        <button type="button" @click="emit('close')">取消</button>
        <button type="submit" class="ok" :disabled="!valid || busy">{{ adding ? '加到设计并打开草图' : '创建并打开草图' }}</button>
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

.into {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px 8px;
  border-radius: 6px;
  background: var(--surface-2);
}

label.row {
  flex-direction: row;
  align-items: center;
  gap: 6px;
}

.error {
  margin: 0;
  color: var(--danger);
}

.small {
  font-size: 12px;
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
