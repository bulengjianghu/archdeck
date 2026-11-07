<script setup lang="ts">
/**
 * 步骤面板（D-5，选中步骤时，V2；V15、PC-10，ADR-0053）：头部之下——
 * 理解：先回答「这一步做什么」——作用、输入（签名中与标签同名的一行 + 携带的数据）、输出（配对返回，F7）、数据结构、经由接口，
 * 步骤没写的接口与数据取自对应关系并标「取自关系」（S14）；交互关系默认折叠，可在画布上显示（V9）；
 * 核对：代码证据一行（无证据或承载缺段为 ⚠），清单为代码证据——包含链「这一步 → 交互（承载判定词）→ 承载段（文件:行）」（D-25、S18b），
 * 等级由承载判定导出（裁决 T0-10）与候选调用点，单击在资料区预览到该行（S16、S18）——、真实端点与本层投影（经由上层关系时注明关系建在上层
 * 并可定位，P15）、本层一条可见消息覆盖的多帧；最后是出处。
 */
import { computed } from 'vue'
import { usePanelPart } from '../shared/panelPart'
import { useDesk } from '@/state/inject'
import { CARRIER_ROLE_TEXT, moduleName, type CarrierSegment } from '@/model'
import Section from './Section.vue'
import Markdown from './Markdown.vue'
import InterfaceItem from './InterfaceItem.vue'
import DataStructureItem from './DataStructureItem.vue'
import RelationRow from './RelationRow.vue'
import RevealButton from './RevealButton.vue'
import PanelCard from './PanelCard.vue'
import CheckCard from './CheckCard.vue'
import type { CheckRow } from './panelCheck'
import { useOpenPreview } from '../shared/preview'
import { EVIDENCE_LEVEL_LABELS } from '../shared/labels'
import { alignedEvidence, stepChain } from './chain'
import { KIND_LABEL, dataNames, fragmentText, frameText, landingText, signatureLine, stepOutput } from './runText'

const desk = useDesk()
/** LY-13、LY-7：描述里面板头是一行操作（不写名称与 ID），核对里不出现 */
const pp = usePanelPart()
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
/** P15：经由上层关系时对应的关系（本帧自己的绑定优先） */
const upperRel = computed(() => {
  const at = msg.value?.at
  if (at?.kind !== 'upper') return null
  return idx.value.relations.get(f.value.relation ?? at.relationId) ?? null
})
/** V9：当前可见消息在本层的两端 */
const revealNodes = computed(() => {
  const at = msg.value?.at
  if (!at) return []
  return at.kind === 'internal' ? [at.node] : [at.from, at.to]
})

/** S16：代码证据；没有代码事实时为 null（K8） */
const openPreview = useOpenPreview()
const ev = computed(() => desk.evidence.step.value)
/** S18b、K5d：步骤 → 绑定的交互 → 承载（desk.facts 派生） */
const carrier = computed(() => desk.facts.stepCarrierOf(f.value).carrier)
/** T0-10：等级由承载判定导出，与包含链同一个词；承载齐全时候选调用点取承载段的文件依赖 */
const shownEv = computed(() => (ev.value ? alignedEvidence(idx.value, ev.value, carrier.value) : null))

/** D-25：包含链（只在有代码事实时，与代码证据同一节） */
const chain = computed(() =>
  ev.value ? stepChain(idx.value, f.value, carrier.value, f.value.relation ? desk.facts.relationFact(f.value.relation) : null) : null,
)
const CHAIN_MARK = { ok: '✓', missing: '✗', skipped: '—', na: '' } as const
const segText = (s: CarrierSegment) => CARRIER_ROLE_TEXT[s.role](s.from === '*' ? '某模块' : moduleName(idx.value, s.from), moduleName(idx.value, s.to))

/** 核对卡（PC-10）：代码证据一行——无证据或承载缺段为 ⚠，不判定为 — */
const rows = computed<CheckRow[]>(() => {
  const e = shownEv.value
  if (!e) return [{ key: 'evidence', label: '代码证据', state: 'none', text: '没有代码事实', items: [] }]
  const missing = chain.value?.carrier.segments?.filter(sg => sg.missing) ?? []
  const items = [
    ...(e.level === 'none' ? [{ text: e.note || '代码里没找到这一步的证据', target: 'evidence.code' }] : []),
    ...missing.map(sg => ({ text: `承载缺段：${segText(sg)}`, target: 'evidence.code' })),
  ]
  return [
    { key: 'evidence', label: '代码证据', state: items.length ? 'bad' : e.level === 'skipped' ? 'none' : 'ok', text: EVIDENCE_LEVEL_LABELS[e.level], items },
  ]
})

function pointAt(id: string) {
  if (idx.value.actors.has(id)) desk.select({ kind: 'actor', id })
  else desk.revealModule(id)
}
</script>

<template>
  <div v-if="f" class="step-panel">
    <header v-if="pp.card" class="head id-card">
      <div class="badges top">
        <span class="badge accent">选中的步骤</span>
        <span v-if="msg" class="muted">第 {{ msg.index + 1 }} / {{ total }} 步（本层）</span>
        <span v-else class="badge warn">本层不可见</span>
      </div>
      <h2 v-if="pp.name">{{ f.label || frameText(idx, f) }}</h2>
      <div class="badges">
        <span class="badge">{{ KIND_LABEL[f.kind] }}</span>
        <span v-for="(t, i) in f.fragments" :key="i" class="badge">{{ fragmentText(t) }}</span>
      </div>
    </header>

    <PanelCard kind="understand" title="理解" closed-summary :summary="f.label || undefined">
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
      <details class="structure">
        <summary class="structure-head">交互关系</summary>
        <Section title="对应关系">
          <ul v-if="f.relation" class="plain">
            <RelationRow :id="f.relation" />
            <li v-if="f.relationInferred" class="muted inferred">
              <span class="badge warn">推断</span> 描述中没写 relation，两端之间恰好一条运行时关系，自动认定
            </li>
          </ul>
          <p v-else class="muted">交互中没有与这一步对应的关系</p>
          <RevealButton :nodes="revealNodes" class="reveal-row" />
        </Section>
      </details>
    </PanelCard>

    <CheckCard :rows="rows">
      <Section v-if="ev && shownEv" data-sec="evidence.code" title="代码证据" :count="shownEv.total || undefined">
        <ol v-if="chain" class="chain" aria-label="包含链">
          <li class="link-step">这一步</li>
          <li class="link-interaction" :class="`st-${chain.interaction.state}`">
            <span class="arrow">→</span><span class="lvl">交互</span>
            <span v-if="CHAIN_MARK[chain.interaction.state]" class="mark">{{ CHAIN_MARK[chain.interaction.state] }}</span>
            {{ chain.interaction.text }}
            <span v-if="chain.interaction.verdict" class="badge verdict" :data-verdict="carrier?.verdict">{{ chain.interaction.verdict }}</span>
          </li>
          <li class="link-carrier" :class="`st-${chain.carrier.state}`">
            <span class="arrow">→</span><span class="lvl">承载</span>
            <span v-if="CHAIN_MARK[chain.carrier.state]" class="mark">{{ CHAIN_MARK[chain.carrier.state] }}</span>
            {{ chain.carrier.text }}
          </li>
          <li v-for="(sg, i) in chain.carrier.segments ?? []" :key="i" class="link-segment" :class="{ 'st-missing': sg.missing }" :data-role="sg.role">
            <span class="arrow">·</span>
            <span>{{ segText(sg) }}</span>
            <template v-if="sg.missing"><span class="mark">✗</span> 缺</template>
            <template v-else-if="sg.edge">
              <code v-if="sg.edge.element">{{ sg.edge.element.name }}</code>
              <span v-if="sg.moduleLevel" class="muted">模块级</span>
              <button
                v-if="sg.edge.files[0]"
                class="link"
                :title="`在副栏预览 ${sg.edge.files[0].from} 第 ${sg.edge.files[0].line} 行`"
                @click="openPreview(sg.edge.files[0].from, sg.edge.files[0].line)"
              >
                {{ sg.edge.files[0].from }}:{{ sg.edge.files[0].line }}
              </button>
            </template>
            <span v-else class="muted">同一组代码</span>
          </li>
        </ol>
        <div class="evidence-level">
          <span class="badge" :class="`ev-${shownEv.level}`">{{ EVIDENCE_LEVEL_LABELS[shownEv.level] }}</span>
          <span class="muted">{{ shownEv.note }}</span>
        </div>
        <ul v-if="shownEv.candidates.length" class="plain candidates">
          <li v-for="d in shownEv.candidates.slice(0, 10)" :key="`${d.from}:${d.line}:${d.to}`">
            <button class="link" :title="`在副栏预览 ${d.from} 第 ${d.line} 行`" @click="openPreview(d.from, d.line)">{{ d.from }}:{{ d.line }}</button>
            <span class="muted">
              → {{ d.to }}<template v-if="d.via !== d.to">（经 {{ d.via }}）</template><template v-if="d.kind === 'type'"> · 只引类型</template></span
            >
            <code v-if="d.names?.length" class="names">{{ d.names.join(', ') }}</code>
          </li>
        </ul>
        <p v-if="shownEv.total > Math.min(10, shownEv.candidates.length)" class="muted">
          另有 {{ shownEv.total - Math.min(10, shownEv.candidates.length) }} 条未列出
        </p>
      </Section>

      <Section title="端点与本层投影" fold data-sec="evidence.ends">
        <div class="ends">
          <button class="link" @click="pointAt(f.from)">{{ moduleName(idx, f.from) }}</button>
          <span class="muted">→</span>
          <button class="link" @click="pointAt(f.to)">{{ moduleName(idx, f.to) }}</button>
        </div>
        <div v-if="msg" class="sub muted">在本层：{{ landingText(idx, msg.at) }}</div>
        <div v-if="upperRel" class="sub upper">
          对应关系建在上层：{{ moduleName(idx, upperRel.from) }} → {{ moduleName(idx, upperRel.to) }}，本层没有它的边。
          <button class="link" @click="desk.revealRelation(upperRel.id)">定位到这条关系</button>
        </div>
        <div v-else class="sub muted">两端都在本层之外。<button class="link" @click="desk.goTo(desk.run.frameLevel.value!)">到能看到它的层次</button></div>
      </Section>

      <Section v-if="msg && msg.frameIds.length > 1" title="本层这一步覆盖的帧" :count="msg.frameIds.length" fold>
        <ol class="frames">
          <li v-for="id in msg.frameIds" :key="id" :class="{ current: id === f.id }">
            <button class="link" @click="desk.seek(id)">{{ frameText(idx, desk.run.plan.value!.frames.get(id)!) }}</button>
          </li>
        </ol>
        <p class="muted hint">下钻可以看到更细的步骤。</p>
      </Section>
    </CheckCard>

    <footer class="src muted">
      <template v-if="writtenIn">写在场景「{{ writtenIn }}」中 · </template>
      出处：{{ desk.modelDir.value }}/{{ f.src.file }}{{ f.src.line ? `:${f.src.line}` : '' }} · <code>{{ f.id }}</code>
    </footer>
  </div>
</template>

<style scoped>
.chain {
  list-style: none;
  margin: 0 0 6px;
  padding: 0;
  font-size: 12.5px;
}

.chain li {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px;
  padding: 1px 0;
}

.chain .arrow {
  color: var(--text-3);
}

.chain .lvl {
  font-weight: 600;
  color: var(--text-2);
}

.chain .st-ok .mark {
  color: var(--success, var(--accent));
}

.chain .st-missing {
  color: var(--warning);
}

.chain .link-segment {
  padding-left: 14px;
  font-size: 12px;
}

.chain .verdict {
  margin-left: 4px;
}

.chain .st-skipped,
.chain .st-na {
  color: var(--text-3);
}

.evidence-level {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
}

.ev-name {
  color: var(--success, var(--accent));
}

.ev-none {
  color: var(--warning);
  background: var(--warning-soft);
  border-color: transparent;
}

.candidates li {
  margin-top: 4px;
  word-break: break-all;
  font-size: 12.5px;
}

.candidates .names {
  margin-left: 6px;
  font-size: 11.5px;
  color: var(--text-3);
}

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

.upper {
  color: var(--text-2);
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
