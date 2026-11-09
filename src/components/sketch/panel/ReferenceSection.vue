<script setup lang="ts">
/**
 * 草图面板 · 引用节点（present.panel.sketch，F-43，X19、05 裁决 4）：只读——它在当前版本里的职责与位置；折叠显示时展开列出精确关系
 * （点一条选中它）；「在模型里查看」在新标签页打开当前版本并选中它；「在此设计」向本设计加一张挂在它身上的草图（F-10，没有时按基线推出）；
 * 删除 = 删折叠进它的全部关系。
 */
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useDesk } from '@/state/inject'
import { requestSketch } from '../actions'

const props = defineProps<{ id: string }>()
const emit = defineEmits<{ note: [text: string] }>()
const desk = useDesk()
const router = useRouter()
const e = desk.edit
const cur = computed(() => e.currentIndex.value?.modules.get(props.id))
const place = computed(() => e.placeOf(props.id))
const rels = computed(() => e.lookup.referenceRelations(props.id))
const name = (id: string) => e.nameOf(id) ?? id
function view() {
  const parent = e.currentIndex.value?.modules.get(props.id)?.parentId
  const root = e.currentIndex.value?.rootId
  const href = router.resolve({
    name: 'project',
    params: { project: desk.project! },
    query: { ...(parent && parent !== root ? { level: parent } : {}), sel: `m:${props.id}` },
  }).href
  window.open(href, '_blank')
}
const designable = computed(() => !!cur.value && cur.value.parentId !== e.currentIndex.value?.rootId)
function designHere() {
  const r = e.openMount(props.id)
  emit('note', r.ok ? '' : r.reason)
}
</script>

<template>
  <div class="skp-body" data-testid="sketch-reference">
    <h3>{{ name(id) }} <span class="muted small">外部引用 · 只读</span></h3>
    <span class="cap"
      ><code>{{ id }}</code></span
    >
    <div class="f">
      <span class="lab">在当前版本里的职责</span>
      <p class="ro">{{ cur?.responsibility || (cur ? '（没写职责）' : '（当前版本里没有：可能是本设计其他草图里的新模块）') }}</p>
    </div>
    <div v-if="place.length" class="f">
      <span class="lab">位置</span>
      <p class="ro">{{ place.join(' › ') }}</p>
    </div>
    <div class="f">
      <span class="lab"
        >关系 {{ rels.length }} 条<span v-if="rels.some(r => r.from !== id && r.to !== id)" class="muted">（折叠显示，下列为精确端点）</span></span
      >
      <ul class="rels" data-testid="reference-relations">
        <li v-for="r in rels" :key="r.id">
          <button class="link" @click="desk.select({ kind: 'relation', id: r.id })">
            {{ name(r.from) }} → {{ name(r.to) }}
            <span class="muted"
              >{{ r.type }}<template v-if="r.description"> · {{ r.description }}</template></span
            >
          </button>
          <code class="muted tiny">{{ r.from }} → {{ r.to }}</code>
        </li>
        <li v-if="!rels.length" class="muted">还没有关系：保存时丢弃</li>
      </ul>
    </div>
    <div class="actions">
      <button class="small" @click="view">在模型里查看</button>
      <button v-if="designable" class="small" title="向本设计加一张挂在它身上的草图（底稿从基线复制）" @click="designHere">在此设计</button>
      <button class="small danger" @click="requestSketch({ kind: 'remove', ids: [id] })">删除（连同 {{ rels.length }} 条关系）</button>
    </div>
  </div>
</template>
