<script setup lang="ts">
import { computed } from 'vue'
import { useDesk } from '@/state/inject'
import Markdown from './Markdown.vue'
import Section from './Section.vue'
import InterfaceItem from './InterfaceItem.vue'
import DataStructureItem from './DataStructureItem.vue'
import RelationRow from './RelationRow.vue'
import ChangeBadge from './ChangeBadge.vue'
import DesignNote from './DesignNote.vue'
import ModuleSource from './ModuleSource.vue'
import ModuleGovernance from './ModuleGovernance.vue'
import ModuleEvolution from './ModuleEvolution.vue'
import ModulePorts from './ModulePorts.vue'
import ModuleKnowledge from './ModuleKnowledge.vue'
import ModuleStructure from './ModuleStructure.vue'
import ReviewSection from './ReviewSection.vue'
import ModuleDecisions from './ModuleDecisions.vue'
import { canDesignAt, openNewDesign } from '../edit/designHere'

const props = defineProps<{ id: string }>()
const desk = useDesk()
const idx = computed(() => desk.index.value!)
const m = computed(() => idx.value.modules.get(props.id)!)
const children = computed(() => (idx.value.childrenOf.get(props.id) ?? []).map(id => idx.value.modules.get(id)!))
const outs = computed(() => idx.value.outRelations.get(props.id) ?? [])
const ins = computed(() => idx.value.inRelations.get(props.id) ?? [])
const isLayer = computed(() => m.value.kind === 'layer')
const isCurrentLevel = computed(() => desk.levelId.value === props.id)
const name = (id: string) => idx.value.modules.get(id)?.name ?? id
const STATUS: Record<string, string> = { current: '现状', target: '目标态', deprecated: '已废弃' }

function openChild(childId: string) {
  if (isCurrentLevel.value) desk.select({ kind: 'module', id: childId })
  else desk.goTo(props.id, { kind: 'module', id: childId })
}
</script>

<template>
  <div v-if="m" class="module-panel">
    <header class="head">
      <div class="title">
        <h2>{{ m.name }}</h2>
        <button v-if="children.length && !isCurrentLevel" class="drill" @click="desk.drillInto(m.id)">进入 ⌄</button>
        <button v-if="canDesignAt(desk, m.id)" class="drill" title="以这个模块为挂载点新建设计（F-10）" @click="openNewDesign(m.id)">在此设计</button>
      </div>
      <div class="badges">
        <code>{{ m.id }}</code>
        <span v-if="m.kind" class="badge">{{ isLayer ? '层' : m.kind }}</span>
        <span v-if="m.status && m.status !== 'current'" class="badge warn">{{ STATUS[m.status] }}</span>
        <span v-if="m.role === 'core'" class="badge accent">核心</span>
        <span v-for="t in m.tags ?? []" :key="t" class="badge">{{ t }}</span>
        <ChangeBadge entity="module" :id="m.id" detail />
        <ReviewSection :id="m.id" part="badge" />
      </div>
    </header>
    <DesignNote :text="m.designNote" />

    <Section title="职责">
      <Markdown v-if="m.responsibility" :text="m.responsibility" />
      <p v-else class="muted">未填写</p>
    </Section>
    <ReviewSection :id="m.id" part="diff" />
    <!-- 结构视角（ADR-0031）：指标、影响面与交互图互查紧跟职责 -->
    <ModuleStructure v-if="desk.perspective.value === 'structure'" :id="m.id" />
    <ModuleDecisions :id="m.id" />

    <template v-if="isLayer">
      <Section title="抽象原则">
        <Markdown v-if="m.abstraction" :text="m.abstraction" />
        <p v-else class="muted">未填写</p>
      </Section>
      <Section v-if="m.includes?.length || m.excludes?.length" title="应该包含 / 不应该包含">
        <div class="inc">
          <ul class="yes">
            <li v-for="x in m.includes ?? []" :key="x">{{ x }}</li>
          </ul>
          <ul class="no">
            <li v-for="x in m.excludes ?? []" :key="x">{{ x }}</li>
          </ul>
        </div>
      </Section>
      <Section title="可依赖的层">
        <span v-if="!m.mayDependOn?.length" class="muted">无</span>
        <span v-for="(d, i) in m.mayDependOn ?? []" :key="d">
          <span v-if="i > 0"> · </span><button class="link" @click="desk.select({ kind: 'module', id: d })">{{ name(d) }}</button>
        </span>
      </Section>
    </template>

    <Section v-if="m.provides?.length" title="对外接口" :count="m.provides.length">
      <InterfaceItem v-for="id in m.provides" :key="id" :id="id" :open="m.provides.length <= 2" />
    </Section>

    <Section v-if="children.length" :title="isLayer ? '本层模块' : '子模块'" :count="children.length">
      <ul class="plain">
        <li v-for="c in children" :key="c.id" class="child">
          <button class="link" @click="openChild(c.id)">{{ c.name }}</button>
          <ChangeBadge entity="module" :id="c.id" />
          <span v-if="c.role === 'core'" class="badge accent">核心</span>
          <span v-if="(idx.childrenOf.get(c.id) ?? []).length" class="muted">⌄ {{ idx.childrenOf.get(c.id)!.length }}</span>
          <span class="resp">{{ c.responsibility }}</span>
        </li>
      </ul>
    </Section>

    <Section v-if="outs.length" title="出边（它依赖 / 命令 / 通知谁）" :count="outs.length">
      <ul class="plain">
        <RelationRow v-for="r in outs" :key="r" :id="r" :perspective="m.id" />
      </ul>
    </Section>
    <Section v-if="ins.length" title="入边（谁依赖 / 命令 / 通知它）" :count="ins.length">
      <ul class="plain">
        <RelationRow v-for="r in ins" :key="r" :id="r" :perspective="m.id" />
      </ul>
    </Section>

    <ModulePorts :id="m.id" />
    <ModuleKnowledge :id="m.id" />
    <ModuleGovernance :id="m.id" />
    <ModuleEvolution :id="m.id" />
    <ModuleSource :id="m.id" />
    <Section v-if="m.principle" title="实现原理" fold><Markdown :text="m.principle" /></Section>
    <Section v-if="m.dataStructures?.length" title="核心数据结构" fold :count="m.dataStructures.length">
      <DataStructureItem v-for="id in m.dataStructures" :key="id" :id="id" :open="m.dataStructures.length <= 2" />
    </Section>
    <Section v-if="m.codeRefs?.length || m.docRefs?.length || m.owner" title="代码与文档引用" fold>
      <ul class="plain refs">
        <li v-for="c in m.codeRefs ?? []" :key="c">
          <code>{{ c }}</code>
        </li>
        <li v-for="d in m.docRefs ?? []" :key="d">
          <a v-if="/^https?:/.test(d)" :href="d" target="_blank" rel="noreferrer">{{ d }}</a>
          <span v-else>📄 {{ d }}</span>
        </li>
        <li v-if="m.owner" class="muted">负责人：{{ m.owner }}</li>
      </ul>
    </Section>

    <ReviewSection :id="m.id" part="confirm" />
    <footer class="src muted">出处：{{ desk.modelDir.value }}/{{ m.src.file }}{{ m.src.line ? `:${m.src.line}` : '' }}</footer>
  </div>
</template>

<style scoped>
.inc {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.inc ul {
  margin: 0;
  padding-left: 1.2em;
  font-size: 13px;
}

.inc .yes li::marker {
  content: '✓ ';
  color: var(--rel-streams);
}

.inc .no li::marker {
  content: '✗ ';
  color: var(--danger);
}

.child {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px 8px;
  padding: 3px 0;
}

.child .resp {
  flex-basis: 100%;
  font-size: 12px;
  color: var(--text-2);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.refs li {
  padding: 2px 0;
  font-size: 12.5px;
  word-break: break-all;
}
</style>
