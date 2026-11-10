<script setup lang="ts">
/**
 * 草图面板 · 父模块（present.panel.sketch，F-40，X10、#3）：没有选中时显示挂载点。名称与职责属上一层、只读——上一层草图里职责为空时
 * 显示当前版本的文字并标「取自当前版本」；原则（abstraction，对内的一面，属本张）多行编辑、失焦提交一步；「带入现有原则」取当前版本的原则。
 */
import { computed, ref, watch } from 'vue'
import { useDesk } from '@/state/inject'

const emit = defineEmits<{ note: [text: string] }>()
const desk = useDesk()
const e = desk.edit
const p = computed(() => e.parent.value)
const own = computed(() => e.sketch.value?.abstraction ?? '')
const text = ref('')
watch(own, v => (text.value = v), { immediate: true })
function report(r: { ok: boolean; reason?: string }) {
  emit('note', r.ok ? '' : (r.reason ?? ''))
}
function commit() {
  if (text.value.trim() !== own.value.trim()) report(e.setAbstraction(text.value))
}
function bring() {
  if (!p.value?.currentAbstraction) return
  text.value = p.value.currentAbstraction
  report(e.setAbstraction(text.value))
}
</script>

<template>
  <div v-if="p" class="skp-body" data-testid="sketch-parent">
    <h3>{{ p.name }} <span class="muted small">挂载点 · 父模块</span></h3>
    <code class="cap">{{ p.id }}</code>
    <div class="f">
      <span class="lab">职责 <span class="muted">（属上一层，只读）</span></span>
      <p class="ro">{{ p.responsibility || '（上一层没写）' }}<span v-if="p.fromCurrent" class="from" data-testid="from-current">取自当前版本</span></p>
    </div>
    <label class="f">
      <span class="lab">原则 <span class="muted">（对内的一面，属本张草图）</span></span>
      <textarea v-model="text" name="mount-principle" rows="4" placeholder="这一层内部怎么分、按什么划界……" @blur="commit" />
    </label>
    <button v-if="p.currentAbstraction && !own" class="small" title="把当前版本里这个模块的原则带进本张草图" @click="bring">带入现有原则</button>
  </div>
</template>
