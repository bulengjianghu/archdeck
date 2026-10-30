<script setup lang="ts">
/**
 * 理解卡 ④ 协作（PC-4、PC-5）：跨子树边界的关系按（方向，对端）合成一行「← / → 对端 · 类型 · 目的」，多条标「×N」，单击展开逐条；
 * 悬停一行（或一条）时画布上承载它的边高亮（L25 的机制）。对端为画布上与本模块相邻的那个节点（collaborationsOf，模型层）。
 */
import { computed, onBeforeUnmount, reactive } from 'vue'
import { useDesk } from '@/state/inject'
import { collaborationsOf, moduleName, purposeOf, type RelationType } from '@/model'
import { RELATION_TYPE_LABELS } from '../shared/labels'
import RelationRow from './RelationRow.vue'
import { hoverRelations } from './surfaceFocus'

const props = defineProps<{ id: string }>()
const desk = useDesk()
const idx = computed(() => desk.index.value!)
const rows = computed(() =>
  collaborationsOf(idx.value, props.id).map(c => {
    const rels = c.relations.map(id => idx.value.relations.get(id)!)
    const types = [...new Set(rels.map(r => r.type))] as RelationType[]
    return { ...c, key: `${c.dir}:${c.peer}`, types, purpose: purposeOf(rels[0]) }
  }),
)
const open = reactive<Record<string, boolean>>({})
const name = (id: string) => moduleName(idx.value, id)
const pick = (peer: string) => (idx.value.actors.has(peer) ? desk.select({ kind: 'actor', id: peer }) : desk.revealModule(peer))
const purposeText = (id: string) => purposeOf(idx.value.relations.get(id)!)
onBeforeUnmount(() => hoverRelations(null))
</script>

<template>
  <ul v-if="rows.length" class="collab" data-testid="collab">
    <li v-for="c in rows" :key="c.key" class="co" :data-peer="c.peer" @mouseenter="hoverRelations(c.relations)" @mouseleave="hoverRelations(null)">
      <div class="line">
        <span class="dir">{{ c.dir === 'in' ? '←' : '→' }}</span>
        <button class="link peer" :title="`选中 ${name(c.peer)}`" @click="pick(c.peer)">{{ name(c.peer) }}</button>
        <span class="chips"
          ><span v-for="t in c.types" :key="t" class="rel-chip" :class="`rel-${t}`">{{ RELATION_TYPE_LABELS[t] }}</span></span
        >
        <button
          class="why"
          :class="{ pending: c.purpose?.pending }"
          :aria-expanded="!!open[c.key]"
          :title="`${c.purpose?.text ?? ''}${c.purpose?.pending ? '（目的待提炼：取自说明首句）' : ''}\n${open[c.key] ? '收起' : '单击逐条展开'}`"
          @click="open[c.key] = !open[c.key]"
        >
          <span v-if="c.relations.length > 1" class="n">×{{ c.relations.length }}</span> {{ c.purpose?.text ?? '' }}
        </button>
      </div>
      <ul v-if="open[c.key]" class="plain each">
        <template v-for="r in c.relations" :key="r">
          <RelationRow :id="r" @mouseenter="hoverRelations([r])" />
          <li v-if="purposeText(r)" class="each-why muted">{{ purposeText(r)!.text }}</li>
        </template>
      </ul>
    </li>
  </ul>
</template>

<style scoped>
.collab {
  list-style: none;
  margin: 0;
  padding: 0;
}

.co {
  line-height: 20px;
}

.line {
  display: grid;
  grid-template-columns: 12px auto auto minmax(0, 1fr);
  align-items: baseline;
  gap: 0 6px;
  white-space: nowrap;
}

.dir {
  flex: none;
  width: 12px;
  color: var(--text-3);
}

.peer {
  max-width: 8.5em;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 500;
  text-align: left;
}

.chips {
  display: inline-flex;
  gap: 3px;
}

.chips .rel-chip {
  font-size: 11px;
  line-height: 16px;
}

.n {
  font-size: 11px;
  color: var(--accent);
}

.why {
  min-width: 0;
  padding: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  font: inherit;
  font-size: 12.5px;
  text-align: left;
  color: var(--text-2);
  background: none;
  border: 0;
  cursor: pointer;
}

.why:hover {
  color: var(--accent);
}

.why.pending {
  font-style: italic;
}

.each {
  margin: 2px 0 4px 18px;
  font-size: 12.5px;
}

.each-why {
  padding: 0 0 2px 4px;
  font-size: 12px;
}
</style>
