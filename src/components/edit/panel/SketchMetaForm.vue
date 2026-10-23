<script setup lang="ts">
/** 草图元信息（P-5、L-2、L-4）：ID（持久草图只读）、lifetime、supersedes（下拉持久草图）、封闭的子树；未保存改动的摘要；声明 supersedes 时与被替换持久草图的差异 */
import { computed } from 'vue'
import { CHANGE_KIND_LABELS, type SketchLifetime } from '@/model'
import { useDesk } from '@/state/inject'

const emit = defineEmits<{ notice: [msg: string] }>()
const desk = useDesk()
const e = desk.edit
const d = computed(() => e.draft.value)
const design = computed(() => e.target?.kind === 'design')
const KIND = CHANGE_KIND_LABELS
const done = (x: { ok: boolean; reason?: string }) => !x.ok && emit('notice', x.reason ?? '')
const meta = (patch: { lifetime?: SketchLifetime; supersedes?: string | null }) => done(e.edit({ op: 'setMeta', patch }))
</script>

<template>
  <section v-if="d" class="form" data-testid="sketch-meta">
    <h3>
      草图 <code>{{ d.id }}</code
      >{{ design ? '' : '（持久草图，ID 只读）' }}
    </h3>
    <template v-if="design">
      <label class="field">
        <span class="label">生命周期</span>
        <select :value="d.lifetime ?? 'until-implemented'" @change="ev => meta({ lifetime: (ev.target as HTMLSelectElement).value as SketchLifetime })">
          <option value="until-implemented">until-implemented（实现一致后归档）</option>
          <option value="persistent">persistent（持久）</option>
        </select>
      </label>
      <label class="field">
        <span class="label">supersedes（定稿后晋升替换的持久草图）</span>
        <select :value="d.supersedes ?? ''" @change="ev => meta({ supersedes: (ev.target as HTMLSelectElement).value || null })">
          <option value="">（不替换）</option>
          <option v-for="p in e.lookup.persistentIds.value" :key="p" :value="p">{{ p }}</option>
        </select>
      </label>
    </template>
    <p class="field"><span class="label">封闭的子树</span> {{ d.closed?.length ? d.closed.join('、') : '（无）' }}</p>
    <div v-if="e.changes.value" class="field" data-testid="edit-changes">
      <span class="label">未保存的改动（{{ e.changes.value.changes.length }}）</span>
      <ul>
        <li v-for="c in e.changes.value.changes" :key="`${c.entity}:${c.id}`">{{ KIND[c.kind] }} {{ c.name }}</li>
      </ul>
    </div>
    <div v-if="e.promotion.value" class="field">
      <span class="label">晋升后与被替换的「{{ d.supersedes }}」相比</span>
      新增 {{ e.promotion.value.counts.added }} · 修改 {{ e.promotion.value.counts.changed }} · 删除 {{ e.promotion.value.counts.removed }}
    </div>
    <p class="note">选中层、模块或关系即编辑它；画布上用插入条加层、「+ 模块」加模块，从模块右侧的连线柄拖到另一个模块建关系。</p>
  </section>
</template>

<style scoped src="./form.css"></style>
