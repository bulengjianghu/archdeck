<script setup lang="ts">
/**
 * 关系面板 · 承载（D5、L22、K5d、K20，ADR-0032）：模板名、判定（齐全 / 已证实（模块级）/ 缺段 / 无承载 / 外部承载）；
 * 各段：角色、元素级边（依赖方 → 元素，文件:行可单击在副栏预览）或「缺」与建议；模块级回退注明；
 * 承载涉及的第三个节点（端口定义模块、总线、契约模块、组装者）可定位；所在的交互束（本层视图边）修饰混合（D8）时列出各条。
 * 只读 desk.facts.carrierOf / interactionSpread；不判定（参与者、目标态、同宿主、端口 / 总线未指明）或没有代码事实时不出现。
 */
import { computed } from 'vue'
import {
  CARRIER_ROLE_TEXT,
  CARRIER_TEMPLATE_LABELS,
  CARRIER_VERDICT_LABELS,
  moduleName,
  relationMode,
  viaLabel,
  type CarrierRole,
  type CarrierSegment,
} from '@/model'
import { useDesk } from '@/state/inject'
import { useOpenPreview } from '../shared/preview'
import { ELEMENT_KIND_LABEL } from '../display/labels'
import Section from './Section.vue'

const props = defineProps<{ id: string }>()
const desk = useDesk()
const idx = computed(() => desk.index.value!)
const r = computed(() => idx.value.relations.get(props.id)!)
const name = (id: string) => (id === '*' ? '某模块' : moduleName(idx.value, id))
const openPreview = useOpenPreview()
const carrier = computed(() => desk.facts.carrierOf(props.id))

/** 缺段的建议（按角色） */
const ADVICE: Record<CarrierRole, string> = {
  call: '发起方没有导入接收方的操作：接收方在入口导出这个操作、发起方经入口导入；确实经注入或回调传递的，给关系写 via',
  'use-port': '发起方没有依赖端口元素：经端口调用应导入端口定义模块入口导出的端口（接口）',
  implement: '接收方没有实现端口：在类上写 implements <端口>，或核对 implementedBy',
  assemble: '没有模块组装接收方（new / 工厂 / 注册）：核对组装根，或接收方由框架注入',
  publish: '发起方没有依赖总线的发布操作：经总线发出应导入总线入口导出的发布操作',
  subscribe: '接收方没有依赖总线的订阅操作：声明了经总线，接收方应订阅；否则改写 via',
  register: '接收方没有导入发起方的注册操作（回调注册）：核对通知的方向，或改为直接调用',
  'contract-from': '发起方没有依赖通道契约模块的元素：核对 channel:<名>@<模块 ID> 的契约模块',
  'contract-to': '接收方没有依赖通道契约模块的元素：核对 channel:<名>@<模块 ID> 的契约模块',
}

/** 第三个节点：段的两端里不是关系两端（也不在其子树 / 祖先上）的模块 */
const related = (a: string, b: string) => !!idx.value.pathOf.get(a)?.includes(b) || !!idx.value.pathOf.get(b)?.includes(a)
const thirds = computed(() => {
  const c = carrier.value
  if (!c) return []
  const ends = [r.value.from, r.value.to]
  const out = new Set<string>()
  for (const s of c.segments) for (const m of [s.from, s.to]) if (m !== '*' && idx.value.modules.has(m) && !ends.some(e => related(e, m))) out.add(m)
  return [...out]
})
const inView = (m: string) => !!desk.view.value?.nodes.some(n => n.moduleId === m)

/** D8：所在的交互束修饰混合时列出各条 */
const spread = computed(() => {
  const e = desk.view.value?.edges.find(x => x.relationIds.includes(props.id))
  if (!e || e.relationIds.length < 2) return null
  const s = desk.facts.interactionSpread(e.id)
  return s?.mixed ? { mixed: s.mixed, relations: e.relationIds.filter(id => idx.value.relations.has(id)) } : null
})
const modeText = (id: string) => (relationMode(idx.value.relations.get(id)!) === 'async' ? '异步' : '同步')
const viaText = (id: string) => {
  const v = idx.value.relations.get(id)!.via
  return v ? `经 ${viaLabel(v, idx.value)}` : '直接'
}

/** 束内一条交互的称呼：接口名，没写接口时为 ID */
const relName = (id: string) => {
  const x = idx.value.relations.get(id)!
  return (x.interface && idx.value.interfaces.get(x.interface)?.name) || id
}

const segText = (s: CarrierSegment) => CARRIER_ROLE_TEXT[s.role](name(s.from), name(s.to))
</script>

<template>
  <Section v-if="carrier" title="承载" class="relation-carrier">
    <p class="verdict">
      <span class="badge">{{ CARRIER_TEMPLATE_LABELS[carrier.template] }}</span>
      <span class="badge v" :data-verdict="carrier.verdict">{{ CARRIER_VERDICT_LABELS[carrier.verdict] }}</span>
      <span v-if="carrier.verdict === 'external'" class="muted">通道没写契约模块（channel:&lt;名&gt;@&lt;模块 ID&gt;），静态导入核不了</span>
    </p>
    <ol v-if="carrier.segments.length" class="segments">
      <li v-for="(s, i) in carrier.segments" :key="i" class="segment" :data-role="s.role" :class="{ missing: s.missing }">
        <div class="s-head">
          <span class="mark">{{ s.missing ? '✗' : s.moduleLevel ? '~' : s.edge ? '✓' : '—' }}</span>
          <span>{{ segText(s) }}</span>
          <code v-if="s.element" class="want">{{ s.element }}</code>
        </div>
        <div v-if="s.missing" class="s-body">
          <span class="badge warn">缺</span> <span class="muted advice">{{ ADVICE[s.role] }}</span>
        </div>
        <div v-else-if="s.edge" class="s-body">
          <span class="muted">{{ name(s.edge.fromModule) }} →</span>
          <code v-if="s.edge.element">{{ s.edge.element.name }}</code>
          <span v-if="s.edge.element" class="muted">{{ ELEMENT_KIND_LABEL[s.edge.element.kind] }}</span>
          <span v-else class="muted">{{ name(s.edge.toModule) }}（模块本体）</span>
          <span v-if="s.moduleLevel" class="badge" title="边接到模块本体或别的元素，按模块依赖回退（K5）">模块级</span>
          <button
            v-for="(f, k) in s.edge.files.slice(0, 3)"
            :key="k"
            class="link mono file"
            :title="`在副栏预览 ${f.from} 第 ${f.line} 行`"
            @click="openPreview(f.from, f.line)"
          >
            {{ f.from }}:{{ f.line }}
          </button>
          <span v-if="s.edge.files.length > 3" class="muted">另 {{ s.edge.files.length - 3 }} 处</span>
        </div>
        <div v-else class="s-body muted">同一组代码，这一段不需要边</div>
      </li>
    </ol>
    <p v-if="thirds.length" class="thirds">
      <span class="muted">涉及</span>
      <template v-for="(m, i) in thirds" :key="m"
        >{{ i ? '、' : ' '
        }}<button class="link third" :title="inView(m) ? '选中它' : '跳到它所在的层次并选中'" @click="desk.revealModule(m)">{{ name(m) }}</button
        ><span v-if="!inView(m)" class="muted">（不在本层）</span></template
      >
    </p>
    <div v-if="spread" class="mixed" role="note">
      <span class="badge warn">混合</span>
      <span class="muted">所在的交互束里{{ [spread.mixed.mode ? '同步 / 异步' : '', spread.mixed.via ? '经由' : ''].filter(Boolean).join('与') }}不一致：</span>
      <ul class="plain">
        <li v-for="id in spread.relations" :key="id">
          <button class="link" @click="desk.select({ kind: 'relation', id })">{{ relName(id) }}</button>
          <span class="muted"> {{ modeText(id) }} · {{ viaText(id) }}</span>
        </li>
      </ul>
    </div>
  </Section>
</template>

<style scoped>
.verdict {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 6px;
  margin: 0 0 4px;
}

.v[data-verdict='complete'] {
  color: var(--success, var(--accent));
}

.v[data-verdict='partial'],
.v[data-verdict='none'] {
  color: var(--warning);
  background: var(--warning-soft);
  border-color: transparent;
}

.segments {
  list-style: none;
  margin: 0;
  padding: 0;
  font-size: 12.5px;
}

.segment {
  padding: 3px 0;
}

.s-head,
.s-body {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px 6px;
}

.s-body {
  padding-left: 16px;
  font-size: 12px;
}

.mark {
  width: 10px;
  color: var(--text-3);
}

.missing .mark {
  color: var(--warning);
}

.want {
  font-size: 11.5px;
  color: var(--text-3);
}

.mono {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 11.5px;
  word-break: break-all;
}

.thirds,
.mixed {
  margin: 6px 0 0;
  font-size: 12.5px;
}
</style>
