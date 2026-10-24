<script setup lang="ts">
/**
 * 一个端口的三方（K11，原端口三角）：定义（接口、签名、定义模块）· 实现者（描述的 implementedBy 与「仅代码事实」的，各带证据档 K5c）·
 * 使用者（经端口 via: port:<P> / 直接 interface 为 P 的交互关系的发起方，带证实状态）。单击实现者选中该模块，单击使用者选中那条关系。
 * 端口面板（选中端口，L13）与模块面板的「端口」一节共用。
 */
import { computed } from 'vue'
import { useDesk } from '@/state/inject'
import { moduleName, type PortImplementer, type PortPanel, type PortUser } from '@/model'
import { RELATION_TYPE_LABELS } from '../shared/labels'
import CodeBlock from './CodeBlock.vue'

const props = defineProps<{ panel: PortPanel; /** 模块面板里列出时带标题行（单击选中端口） */ titled?: boolean }>()
const desk = useDesk()
const x = computed(() => desk.index.value?.interfaces.get(props.panel.port))
const name = (id: string) => (desk.index.value ? moduleName(desk.index.value, id) : id)
/** 有代码事实时（当前版本）才区分「仅描述」与证据档 */
const facts = computed(() => !!desk.facts.report.value)

/** K5c：实现者的来源与证据档 */
function source(i: PortImplementer): string {
  if (i.code && !i.described) return '仅代码事实'
  if (i.described && !i.code && facts.value) return '仅描述'
  return i.described ? '描述' : ''
}
function evidence(i: PortImplementer): { mark: string; cls: string; title: string } | null {
  if (!facts.value || !i.status) return null
  if (i.status === 'confirmed') return { mark: '✓', cls: 'ok', title: '已证实：类 implements / extends 它，或依赖引用了接口名（K5c ①）' }
  if (i.structural) return { mark: '?', cls: 'muted', title: '结构性实现（代码未显式声明）：只引了定义模块的数据类型；可在类上写 implements（K5c ②）' }
  if (i.likeDepends) return { mark: '?', cls: 'bad', title: '证据像使用：引用了定义模块的实现，没有引用接口（K5c ③），考虑从 implementedBy 去掉并按交互改写' }
  if (i.status === 'skipped') return { mark: '', cls: 'muted', title: '不判定' }
  return { mark: '?', cls: 'bad', title: '未证实：与定义模块之间没有依赖（K6）' }
}
const userMark = (u: PortUser) => (u.status === 'confirmed' ? '✓' : u.status === 'unconfirmed' ? '?' : '')
const users = computed(() => ({ port: props.panel.users.filter(u => u.how === 'port'), direct: props.panel.users.filter(u => u.how === 'direct') }))
</script>

<template>
  <div class="port-entry" :data-port="panel.port">
    <div v-if="titled" class="title">
      <button class="link" :title="`选中端口 ${panel.port}`" @click="desk.select({ kind: 'port', id: panel.port })">{{ x?.name ?? panel.port }}</button>
      <code class="muted">{{ panel.port }}</code>
    </div>
    <div class="group">
      <div class="label">定义</div>
      <div class="def">
        <code>{{ x?.name ?? panel.port }}</code>
        <template v-if="panel.owner">
          <span class="muted">定义于</span>
          <button class="link" @click="desk.revealModule(panel.owner)">{{ name(panel.owner) }}</button>
        </template>
      </div>
      <CodeBlock v-if="!titled && x?.signature" :code="x.signature" />
    </div>
    <div class="group implementers">
      <div class="label">
        实现者 <span class="muted">{{ panel.implementers.length }}</span>
      </div>
      <p v-if="!panel.implementers.length" class="muted warn">没有任何实现者（描述与代码事实都没有，U14）</p>
      <ul v-else class="plain">
        <li v-for="i in panel.implementers" :key="i.module" class="party">
          <button class="link" @click="desk.revealModule(i.module)">{{ name(i.module) }}</button>
          <span v-if="source(i)" class="tag" :class="{ code: i.code && !i.described }">{{ source(i) }}</span>
          <span v-if="evidence(i)?.mark" class="fact" :class="evidence(i)!.cls" :title="evidence(i)!.title">{{ evidence(i)!.mark }}</span>
        </li>
      </ul>
    </div>
    <div class="group users">
      <div class="label">
        使用者 <span class="muted">{{ panel.users.length }}</span>
      </div>
      <p v-if="!panel.users.length" class="muted">系统内没有使用者（经端口或直接）</p>
      <template v-for="g in ['port', 'direct'] as const" :key="g">
        <ul v-if="users[g].length" class="plain">
          <li v-for="u in users[g]" :key="u.relation" class="party">
            <button class="link" :title="u.relation" @click="desk.revealRelation(u.relation)">{{ name(u.module) }}</button>
            <span class="rel-chip" :class="`rel-${u.type}`">{{ RELATION_TYPE_LABELS[u.type] }}</span>
            <span class="tag">{{ g === 'port' ? '经端口' : '直接' }}</span>
            <span
              v-if="userMark(u)"
              class="fact"
              :class="{ ok: u.status === 'confirmed' }"
              :title="u.status === 'confirmed' ? '已被代码证实' : '未被代码证实'"
              >{{ userMark(u) }}</span
            >
          </li>
        </ul>
      </template>
    </div>
  </div>
</template>

<style scoped>
.title {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin-bottom: 2px;
  font-weight: 600;
}

.title code {
  font-size: 11px;
  font-weight: 400;
}

.group + .group {
  margin-top: 6px;
}

.label {
  margin-bottom: 2px;
  font-size: 11.5px;
  color: var(--text-3);
}

.def {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 6px;
}

.party {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
  padding: 2px 0;
}

.tag {
  font-size: 11px;
  padding: 0 5px;
  border-radius: 4px;
  background: var(--surface-2);
  color: var(--text-2);
}

.tag.code {
  background: var(--accent-soft);
  color: var(--accent);
}

.fact {
  font-size: 12px;
  color: var(--text-3);
}

.fact.ok {
  color: var(--success, var(--accent));
}

.fact.bad,
.warn {
  color: var(--warning);
}

p {
  margin: 0;
}
</style>
