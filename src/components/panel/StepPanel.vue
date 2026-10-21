<script setup lang="ts">
/**
 * 步骤面板（D-5，选中步骤时，V2）：先回答「这一步做什么」——作用、输入（签名中与标签同名的一行 + 携带的数据）、输出（配对返回，F7）、数据结构、经由接口；
 * 步骤没写的接口与数据取自对应关系并标「取自关系」（S14）；
 * 其后是真实端点与本层投影、本层一条可见消息覆盖的多帧；结构关系默认折叠，可在画布上显示（V9）；最后是出处。
 */
import { computed } from 'vue'
import { useDesk } from '@/state/inject'
import { moduleName } from '@/model'
import Section from './Section.vue'
import Markdown from './Markdown.vue'
import InterfaceItem from './InterfaceItem.vue'
import DataStructureItem from './DataStructureItem.vue'
import RelationRow from './RelationRow.vue'
import RevealButton from './RevealButton.vue'
import { KIND_LABEL, dataNames, fragmentText, frameText, landingText, signatureLine, stepOutput } from './runText'

const desk = useDesk()
const idx = computed(() => desk.index.value!)
const f = computed(() => desk.run.frame.value!)
const msg = computed(() => {
  const ci = desk.run.currentIndex.value
  return ci === null ? null : (desk.run.scenarioView.value?.messages[ci] ?? null)
})
const total = computed(() => desk.run.scenarioView.value?.messages.length ?? 0)
const writtenIn = computed(() => (f.value.scenarioId !== desk.run.scenario.value?.id ? idx.value.scenarios.get(f.value.scenarioId)?.name : undefined))
/** D-5：经由接口时签名中与标签同名的一行 */
const callLine = computed(() => signatureLine(f.value.interface ? idx.value.interfaces.get(f.value.interface)?.signature : undefined, f.value.label))
const output = computed(() => stepOutput(f.value, desk.run.pairs.value, desk.run.plan.value!.frames))
/** 输出侧要展开的数据结构：配对返回携带的 */
const outData = computed(() => (output.value.kind === 'pair' ? output.value.frame.payload : []))
/** V9：当前可见消息在本层的两端 */
const revealNodes = computed(() => {
  const at = msg.value?.at
  if (!at) return []
  return at.kind === 'internal' ? [at.node] : [at.from, at.to]
})

function pointAt(id: string) {
  if (idx.value.actors.has(id)) desk.select({ kind: 'actor', id })
  else desk.revealModule(id)
}
</script>

<template>
  <div v-if="f" class="step-panel">
    <header class="head">
      <div class="badges top">
        <span class="badge accent">选中的步骤</span>
        <span v-if="msg" class="muted">第 {{ msg.index + 1 }} / {{ total }} 步（本层）</span>
        <span v-else class="badge warn">本层不可见</span>
      </div>
      <h2>{{ f.label || frameText(idx, f) }}</h2>
      <div class="badges">
        <span class="badge">{{ KIND_LABEL[f.kind] }}</span>
        <span v-for="(t, i) in f.fragments" :key="i" class="badge">{{ fragmentText(t) }}</span>
      </div>
    </header>

    <Section title="作用">
      <p class="lead">
        <button class="link" @click="pointAt(f.from)">{{ moduleName(idx, f.from) }}</button>
        <span class="muted"> {{ f.kind === 'return' ? '返回给' : f.kind === 'async' ? '通知' : '调用' }} </span>
        <button class="link" @click="pointAt(f.to)">{{ moduleName(idx, f.to) }}</button>
        <template v-if="f.label">：{{ f.label }}</template>
      </p>
      <Markdown v-if="f.note" :text="f.note" />
    </Section>

    <Section title="输入与输出">
      <dl class="io">
        <dt>输入</dt>
        <dd>
          <code v-if="callLine" class="call">{{ callLine }}</code>
          <div v-if="f.payload.length">{{ dataNames(idx, f.payload) }}<span v-if="f.inherited?.payload" class="badge from-rel">取自关系</span></div>
          <span v-else-if="!callLine" class="muted">没有写携带的数据</span>
        </dd>
        <dt>输出</dt>
        <dd>
          <template v-if="output.kind === 'pair'">
            <button class="link" @click="desk.seek(output.frame.id)">{{ output.frame.label || '返回' }}</button>
            <template v-if="output.frame.payload.length">：{{ dataNames(idx, output.frame.payload) }}</template>
          </template>
          <template v-else-if="output.kind === 'reply'">
            回应调用 <button class="link" @click="desk.seek(output.frame.id)">{{ frameText(idx, output.frame) }}</button>
          </template>
          <span v-else-if="output.kind === 'async'" class="muted">异步，不等待返回</span>
          <span v-else-if="output.kind === 'implicit'" class="muted">隐含返回（描述没写显式返回，见接口签名）</span>
          <span v-else class="muted">没有对应的调用</span>
        </dd>
      </dl>
    </Section>

    <Section v-if="f.payload.length || outData.length" title="数据结构" :count="f.payload.length + outData.length">
      <DataStructureItem v-for="d in f.payload" :key="`in:${d}`" :id="d" />
      <DataStructureItem v-for="d in outData" :key="`out:${d}`" :id="d" />
    </Section>
    <Section v-if="f.interface" title="经由接口">
      <span v-if="f.inherited?.interface" class="badge from-rel">取自关系</span>
      <InterfaceItem :id="f.interface" open />
    </Section>

    <Section title="端点与本层投影">
      <div class="ends">
        <button class="link" @click="pointAt(f.from)">{{ moduleName(idx, f.from) }}</button>
        <span class="muted">→</span>
        <button class="link" @click="pointAt(f.to)">{{ moduleName(idx, f.to) }}</button>
      </div>
      <div v-if="msg" class="sub muted">在本层：{{ landingText(idx, msg.at) }}</div>
      <div v-else class="sub muted">两端都在本层之外。<button class="link" @click="desk.goTo(desk.run.frameLevel.value!)">到能看到它的层次</button></div>
    </Section>

    <Section v-if="msg && msg.frameIds.length > 1" title="本层这一步覆盖的帧" :count="msg.frameIds.length">
      <ol class="frames">
        <li v-for="id in msg.frameIds" :key="id" :class="{ current: id === f.id }">
          <button class="link" @click="desk.seek(id)">{{ frameText(idx, desk.run.plan.value!.frames.get(id)!) }}</button>
        </li>
      </ol>
      <p class="muted hint">下钻可以看到更细的步骤。</p>
    </Section>

    <details class="structure">
      <summary class="structure-head">结构关系</summary>
      <Section title="对应关系">
        <ul v-if="f.relation" class="plain">
          <RelationRow :id="f.relation" />
          <li v-if="f.relationInferred" class="muted inferred">
            <span class="badge warn">推断</span> 描述中没写 relation，两端之间恰好一条运行时关系，自动认定
          </li>
        </ul>
        <p v-else class="muted">结构中没有与这一步对应的关系</p>
        <RevealButton :nodes="revealNodes" class="reveal-row" />
      </Section>
    </details>

    <footer class="src muted">
      <template v-if="writtenIn">写在场景「{{ writtenIn }}」中 · </template>
      出处：{{ desk.modelDir.value }}/{{ f.src.file }}{{ f.src.line ? `:${f.src.line}` : '' }} · <code>{{ f.id }}</code>
    </footer>
  </div>
</template>

<style scoped>
.top {
  margin: 0 0 6px;
}

.lead {
  margin: 0 0 4px;
  font-size: 14px;
}

.io {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 10px;
  margin: 0;
  font-size: 13px;
}

.io dt {
  color: var(--text-3);
}

.io dd {
  margin: 0;
}

.call {
  display: block;
  font-size: 12px;
  margin-bottom: 2px;
  white-space: pre-wrap;
  word-break: break-all;
}

.from-rel {
  margin-left: 6px;
}

.ends {
  display: flex;
  gap: 6px;
  align-items: baseline;
  font-size: 14px;
}

.sub {
  font-size: 12.5px;
  margin-top: 4px;
}

.frames {
  margin: 0;
  padding-left: 1.4em;
  font-size: 13px;
}

.frames li.current {
  font-weight: 600;
}

.hint {
  margin: 4px 0 0;
  font-size: 12px;
}

.inferred {
  font-size: 12px;
  padding-top: 2px;
}

.reveal-row {
  margin-top: 8px;
}
</style>
