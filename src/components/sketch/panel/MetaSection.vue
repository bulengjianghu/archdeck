<script setup lang="ts">
/**
 * 草图面板 · 草图元信息（present.panel.sketch，F-44，X3、X4）：挂载点与文件只读；设计的草图可改 lifetime 与 supersedes（同挂载点的持久草图）；
 * 持久草图的 ID 只读。
 */
import { computed } from 'vue'
import { ROOT_MOUNT, SKETCH_LIFETIMES, type SketchLifetime } from '@/model'
import { useDesk } from '@/state/inject'

const emit = defineEmits<{ note: [text: string] }>()
const desk = useDesk()
const e = desk.edit
const def = computed(() => e.sketch.value)
const design = computed(() => e.target?.kind === 'design')
const file = computed(() => {
  const s = e.session.value
  if (!s || !def.value) return ''
  return s.target.kind === 'persistent' ? `intent/${s.target.id}.yaml` : `designs/${s.target.design}/sketches/${def.value.mount}.yaml`
})
const derived = computed(() => !!def.value && !e.sheets.value.find(x => x.mount === def.value!.mount)?.file)
/** 可被替换的持久草图：同挂载点的（X4） */
const persistents = computed(() => (e.ctx.value?.persistent ?? []).filter(p => p.def.mount === def.value?.mount).map(p => p.def.id))
function report(r: { ok: boolean; reason?: string }) {
  emit('note', r.ok ? '' : (r.reason ?? ''))
}
const setLifetime = (v: SketchLifetime) => report(e.edit({ op: 'setMeta', patch: { lifetime: v } }))
const setSupersedes = (v: string) => report(e.edit({ op: 'setMeta', patch: { supersedes: v || null } }))
</script>

<template>
  <details v-if="def" class="skp-meta" data-testid="sketch-meta">
    <summary>草图元信息</summary>
    <dl>
      <dt>挂载点</dt>
      <dd>
        <code>{{ def.mount }}</code
        ><span v-if="def.mount === ROOT_MOUNT" class="muted">（层与第二级）</span>
      </dd>
      <dt>文件</dt>
      <dd>
        <code>{{ file }}</code
        ><span v-if="derived" class="muted">（会话里推出，改了才写出）</span>
      </dd>
      <template v-if="design">
        <dt>lifetime</dt>
        <dd>
          <select
            :value="def.lifetime ?? 'until-implemented'"
            name="sketch-lifetime"
            @change="setLifetime(($event.target as HTMLSelectElement).value as SketchLifetime)"
          >
            <option v-for="l in SKETCH_LIFETIMES" :key="l" :value="l">{{ l }}</option>
          </select>
        </dd>
        <dt>supersedes</dt>
        <dd>
          <select :value="def.supersedes ?? ''" name="sketch-supersedes" @change="setSupersedes(($event.target as HTMLSelectElement).value)">
            <option value="">（不替换）</option>
            <option v-for="p in persistents" :key="p" :value="p">{{ p }}</option>
          </select>
          <span v-if="!persistents.length" class="muted small">该挂载点没有持久草图</span>
        </dd>
      </template>
      <template v-else>
        <dt>ID</dt>
        <dd>
          <code>{{ def.id }}</code> <span class="muted">（持久草图，只读）</span>
        </dd>
      </template>
    </dl>
  </details>
</template>

<style scoped>
.skp-meta summary {
  cursor: pointer;
  font-size: 12px;
  color: var(--text-3);
}

dl {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 10px;
  margin: 6px 0 0;
  font-size: 12px;
}

dt {
  color: var(--text-3);
}

dd {
  margin: 0;
  min-width: 0;
  overflow-wrap: anywhere;
}
</style>
