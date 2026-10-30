<script setup lang="ts">
/**
 * 代码依赖叠加线的面板（K10）与依赖边面板（选中束，ADR-0031 修订）——V15、PC-10（ADR-0053）：头部（两端、类型徽标、知识）之下——
 * 理解：结构视角「文件依赖」（DepStructure，按元素分组、交互覆盖、判定与不稳定度）；交互视角「模块依赖」（A6 并入）；
 * 核对：治理一行（违规，口径与模块面板同——治理信号，非门禁红 U8），清单为违规明细（折叠带计数）。
 */
import { computed, ref } from 'vue'
import { useDesk } from '@/state/inject'
import { RULE_LABELS, moduleName } from '@/model'
import Section from './Section.vue'
import FileDepList from './FileDepList.vue'
import StructureFacts, { type StructureGroup } from './StructureFacts.vue'
import DepStructure from './DepStructure.vue'
import PanelCard from './PanelCard.vue'
import CheckCard from './CheckCard.vue'
import { usePanelJump, type PanelNotice } from './panelNotices'
import { rowsFromNotices } from './panelCheck'

const desk = useDesk()
const structureView = computed(() => desk.perspective.value === 'structure')
const sel = computed(() => desk.facts.selectedDep.value)
const name = (id: string) => (desk.index.value ? moduleName(desk.index.value, id) : id)
const STATUS: Record<string, string> = { new: '新增', known: '已知', open: '违规', allowed: '已豁免' }
/** K12、K13：这对节点之间的子类与组装事实 */
const structure = computed<StructureGroup[]>(() => {
  if (!sel.value) return []
  const b = desk.facts.structureBetween(sel.value.from, sel.value.to)
  return [
    { key: 'sub', label: '子类', title: '继承（K12）：不是关系', list: b.subclass },
    { key: 'asm', label: '组装', title: '组装（K13）：new / 工厂 / 注册，不是关系', list: b.assembly },
  ]
})

// ── 核对卡（PC-10）：治理一行（违规），单击跳到「违规」明细 ──
const root = ref<HTMLElement | null>(null)
usePanelJump(root)
const violations = computed(() => sel.value?.detail?.violations ?? [])
const notices = computed<PanelNotice[]>(() =>
  violations.value.length
    ? [
        {
          key: 'violations',
          label: '违规',
          count: violations.value.length,
          target: 'evidence.violations',
          to: '违规',
          // 与模块面板同口径（审核轮 2 B1）：治理信号，不是门禁红（U8），不含返工清单 info 级（K24）
          note: '这对节点之间声明的架构规则违规（U2–U6），含基线内的已知违规；门禁卡的是基线外的新增（U8），返工清单的 info 级提示（K24 层符合性）不在此计数',
        },
      ]
    : [],
)
const rows = computed(() => rowsFromNotices(notices.value, [{ key: 'governance', label: '治理', notices: ['violations'], ok: '没有违规' }]))
</script>

<template>
  <div ref="root" class="dep-panel">
    <header class="head" data-sec="head">
      <h2 v-if="sel">{{ name(sel.from) }} → {{ name(sel.to) }}</h2>
      <div class="badges">
        <span class="badge">{{ structureView ? '依赖边' : '代码依赖' }}</span>
        <template v-if="structure.some(g => g.list.length)"><span class="muted">知识</span><StructureFacts :groups="structure" /></template>
      </div>
    </header>
    <Section v-if="!sel || !sel.detail" title="说明" data-sec="purpose">
      <p class="muted">本层没有这对节点之间的代码依赖（层次已变化，或代码事实已刷新）。</p>
    </Section>
    <template v-else>
      <PanelCard kind="understand" title="理解" closed-summary :summary="`${sel.detail.deps.length} 组模块依赖`">
        <DepStructure v-if="structureView" data-sec="boundary.deps" :from="sel.from" :to="sel.to" />
        <Section v-if="!structureView" title="模块依赖" :count="sel.detail.deps.length" data-sec="boundary.deps">
          <ul class="plain">
            <li v-for="d in sel.detail.deps" :key="d.key" class="item">
              <div>
                <button class="link" @click="desk.revealModule(d.from)">{{ name(d.from) }}</button> →
                <button class="link" @click="desk.revealModule(d.to)">{{ name(d.to) }}</button>
                <span :class="d.described ? 'muted' : 'warn'">{{ d.described ? '有交互' : '未解释' }}</span>
                <span class="muted">{{ d.files.length }} 处</span>
              </div>
              <FileDepList :deps="d.files" :limit="4" />
            </li>
          </ul>
        </Section>
      </PanelCard>
      <CheckCard :rows="rows">
        <Section v-if="violations.length" title="违规" :count="violations.length" fold data-sec="evidence.violations">
          <ul class="plain">
            <li v-for="v in violations" :key="v.key" class="item">
              <div>
                <button class="link" @click="desk.revealModule(v.from)">{{ name(v.from) }}</button> →
                <button class="link" @click="desk.revealModule(v.to)">{{ name(v.to) }}</button>
                <span class="chip">{{ RULE_LABELS[v.kind] }}</span
                ><span :class="v.status === 'new' ? 'bad' : 'muted'">{{ STATUS[v.status] }}</span>
              </div>
              <p class="muted reason">
                {{ v.reason }}<template v-if="v.allowReason">；例外理由：{{ v.allowReason }}</template>
              </p>
              <FileDepList :deps="v.files" :limit="4" />
            </li>
          </ul>
        </Section>
      </CheckCard>
    </template>
  </div>
</template>

<style scoped>
.item {
  padding: 4px 0 6px;
  border-bottom: 1px dashed var(--border);
}

.item:last-child {
  border-bottom: none;
}

.chip {
  margin: 0 6px;
  padding: 0 6px;
  font-size: 11px;
  border: 1px solid var(--border);
  border-radius: 8px;
}

.reason {
  margin: 2px 0;
  font-size: 12px;
}

.bad,
.warn {
  color: var(--danger);
}
</style>
