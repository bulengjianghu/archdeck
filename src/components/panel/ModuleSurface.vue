<script setup lang="ts">
/**
 * 模块面板 · 表面（结构视角，在「结构」之后；C7、L20③，ADR-0032）：
 * - K19：表面宽度 W、越过入口数 B；没有入口或没有代码事实（K8、C8）时说明原因，表面只有声明的接口；
 * - K18：元素清单——种类 · 声明状态 · 扇入 · 使用它的模块（单击定位模块），按扇入降序，长清单先列 15 条；
 *   L20b：模块有子模块的元素时按所属子模块分组（子模块按声明顺序、本体在后），组内按扇入降序，组首标子模块名；
 *   端口类元素与「端口」一节（K11）互相定位；画布单击元素（surfaceFocus）时滚到该元素；
 * - C3：越过入口清单（依赖方文件:行 → 符号）——G12：二级折叠带计数（O11 面板版），常显只留 W / B 度量与元素清单；
 * - C4：建议（提升到入口 / 声明接口 / 改经入口）——G12：折叠带计数。
 * 只读 desk.facts 的派生（surfaceOf、surfaceMetricsOf）。
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { HOT_SURFACE_MODULES, moduleName, type SurfaceElement } from '@/model'
import { useDesk } from '@/state/inject'
import Section from './Section.vue'
import { DECL_STATE_LABEL, ELEMENT_KIND_LABEL, ELEMENT_KIND_MARK } from '../display/labels'
import { useOpenPreview } from '../shared/preview'
import { hoverSurfaceElement, leaveSurfaceElement, revealIn, useSurfaceFocus, useSurfaceHover } from './surfaceFocus'

const props = defineProps<{ id: string; /** PC-8：核对卡的清单缺省折叠 */ fold?: boolean }>()
const desk = useDesk()
const idx = computed(() => desk.index.value!)
const name = (id: string) => moduleName(idx.value, id)
const openPreview = useOpenPreview()

const surface = computed(() => desk.facts.surfaceOf(props.id))
const sm = computed(() => desk.facts.surfaceMetricsOf(props.id))
/** L20④：画布上悬停的端口点（或本节悬停的行）——这一行同亮 */
const hoverRef = useSurfaceHover()
const hot = computed(() => (hoverRef.value?.module === props.id ? hoverRef.value.element : null))
const facts = computed(() => !!surface.value?.facts)

interface Row {
  element: SurfaceElement
  fanIn: number
  users: string[]
  /** L20b：所属子模块（本体为 null） */
  sub: string | null
}
/** 元素清单：L20b 先按所属子模块（声明顺序、本体在后），再按扇入降序（同扇入保持表面顺序：端口、操作、类型、数据，声明未导出在后） */
const rows = computed<Row[]>(() => {
  const s = surface.value
  if (!s) return []
  const uses = new Map((sm.value?.uses ?? []).map(u => [u.element.name, u]))
  const order = idx.value.childrenOf.get(props.id) ?? []
  const rank = (sub: string | null) => (sub === null ? Infinity : order.indexOf(sub))
  return s.elements
    .map(element => {
      const u = uses.get(element.name)
      return { element, fanIn: u?.modules.length ?? 0, users: u?.modules ?? [], sub: desk.facts.surfaceSubOf(props.id, element) }
    })
    .map((r, i) => ({ r, i }))
    .sort((a, b) => rank(a.r.sub) - rank(b.r.sub) || b.r.fanIn - a.r.fanIn || a.i - b.i)
    .map(x => x.r)
})
/** L20b：有子模块的元素时分组，组首行标子模块名（本体为「本体」） */
const grouped = computed(() => rows.value.some(r => r.sub !== null))
const groupHead = (i: number) => {
  const r = shown.value[i]
  if (!grouped.value || (i > 0 && shown.value[i - 1].sub === r.sub)) return null
  const n = rows.value.filter(x => x.sub === r.sub).length
  return { name: r.sub ? name(r.sub) : '本体', count: n }
}
const LIMIT = 15
const USERS = 5
const all = ref(false)
const shown = computed(() => (all.value ? rows.value : rows.value.slice(0, LIMIT)))

const bypasses = computed(() => sm.value?.bypasses ?? [])
/** C4 建议 */
const promote = computed(() => [...new Set(bypasses.value.flatMap(f => f.names ?? []))])
const viaFiles = computed(() => [...new Set(bypasses.value.map(f => f.via))])
const fromFiles = computed(() => new Set(bypasses.value.map(f => f.from)).size)
const declare = computed(() => rows.value.filter(r => r.element.state === 'exported-only' && r.fanIn >= HOT_SURFACE_MODULES))
/** G12：建议折叠的计数——提升到入口 / 声明接口 / 改经入口各一条 */
const adviceCount = computed(() => (bypasses.value.length ? 1 : 0) + (declare.value.length ? 1 : 0) + (bypasses.value.length ? 1 : 0))

/** 端口类元素 ↔ 「端口」一节（K11） */
const root = ref<HTMLElement | null>(null)
function toPort(port: string) {
  const el = root.value?.closest('.module-panel')?.querySelector(`.port-entry[data-port="${port}"]`) as HTMLElement | null
  el?.scrollIntoView?.({ block: 'nearest' })
  el?.classList.remove('flash')
  void el?.offsetWidth
  el?.classList.add('flash')
}

/** C9：画布单击元素（或「端口」一节的定位）时滚到该元素 */
const focus = useSurfaceFocus()
/** 定位请求到达时展开折叠的清单（PC-8） */
const force = ref(0)
async function reveal() {
  const f = focus.value
  if (!f || f.module !== props.id || !rows.value.some(r => r.element.name === f.element)) return
  if (props.fold && !root.value?.querySelector('[data-element]')) {
    force.value++
    await nextTick()
  }
  if (!all.value && !shown.value.some(r => r.element.name === f.element)) {
    all.value = true
    await nextTick()
  }
  if (revealIn(root.value, f.element)) focus.value = null
}
onMounted(() => nextTick(reveal))
watch([focus, rows], () => nextTick(reveal))
</script>

<template>
  <div ref="root" class="module-surface-wrap">
    <Section v-if="surface" title="表面元素" :count="surface.elements.length" class="module-surface" :fold="fold" :force="force">
      <dl v-if="sm && sm.w !== null" class="dims">
        <dt>表面宽度 W</dt>
        <dd>{{ sm.w }} <span class="muted">个元素被外部模块引用</span></dd>
        <dt>越过入口 B</dt>
        <dd>
          {{ sm.b }} <span class="muted">条文件依赖不经入口</span>
          <span v-if="sm.entry" class="muted"
            >（入口 <code>{{ sm.entry }}</code
            >）</span
          >
        </dd>
        <template v-if="sm.whole">
          <dt>整模块导入</dt>
          <dd>{{ sm.whole }} <span class="muted">条（namespace / 默认 / *，不接到元素）</span></dd>
        </template>
      </dl>
      <p v-else-if="!facts" class="muted note">没有代码事实：表面只有声明的接口，W / B 不给</p>
      <p v-else-if="!surface.entry" class="muted note no-entry">
        没有入口（entry）：入口导出与越过入口都不判，表面只有声明的接口，W / B 不给；在描述里给模块写 <code>entry</code>
      </p>

      <p v-if="!rows.length" class="muted">本模块没有表面元素（入口没有导出，也没有声明接口）</p>
      <ul v-else class="plain elements" aria-label="表面元素">
        <li
          v-for="(r, i) in shown"
          :key="r.element.name"
          class="element"
          :class="{ hot: hot === r.element.name }"
          :data-element="r.element.name"
          :data-kind="r.element.kind"
          :data-sub="r.sub ?? ''"
          @mouseenter="hoverSurfaceElement({ module: id, element: r.element.name })"
          @mouseleave="leaveSurfaceElement(id, r.element.name)"
        >
          <div v-if="groupHead(i)" class="group-head" data-testid="surface-group-head">
            {{ groupHead(i)!.name }}<span class="muted"> · {{ groupHead(i)!.count }} 个元素</span>
          </div>
          <div class="e-head">
            <span class="el-mark" :data-kind="r.element.kind" aria-hidden="true">{{ ELEMENT_KIND_MARK[r.element.kind] }}</span>
            <code class="el-name">{{ r.element.name }}</code>
            <span class="muted">{{ ELEMENT_KIND_LABEL[r.element.kind] }}<template v-if="r.element.guessed">（按用法推断）</template></span>
            <span class="state" :data-state="r.element.state">{{ DECL_STATE_LABEL[r.element.state] }}</span>
            <span v-if="facts" class="fan" title="扇入：使用它的外部模块数">扇入 {{ r.fanIn }}</span>
            <button
              v-if="r.element.kind === 'port' && r.element.interfaceId"
              class="link to-port"
              title="定位到「端口」一节"
              @click="toPort(r.element.interfaceId)"
            >
              端口 ↓
            </button>
          </div>
          <div v-if="r.users.length" class="users">
            <span class="muted">使用它的模块</span>
            <template v-for="(m, i) in r.users.slice(0, USERS)" :key="m"
              >{{ i ? '、' : ' ' }}<button class="link" @click="desk.revealModule(m)">{{ name(m) }}</button></template
            ><span v-if="r.users.length > USERS" class="muted"> 等 {{ r.users.length }} 个</span>
          </div>
        </li>
        <li v-if="!all && rows.length > LIMIT">
          <button class="link more" @click="all = true">另 {{ rows.length - LIMIT }} 个元素，展开</button>
        </li>
      </ul>

      <div v-if="bypasses.length" class="fold-block" aria-label="越过入口">
        <!-- G12：常显节内二级折叠、折叠必有计数（O11 面板版）——越过入口清单收起，只留 B 度量 -->
        <details>
          <summary>
            越过入口<span class="muted"> · {{ bypasses.length }} 条</span>
          </summary>
          <ul class="plain">
            <li v-for="(f, i) in bypasses.slice(0, 10)" :key="`${f.from}:${f.line}:${f.to}:${i}`" class="bypass">
              <button class="link mono" :title="`在副栏预览 ${f.from} 第 ${f.line} 行`" @click="openPreview(f.from, f.line)">{{ f.from }}:{{ f.line }}</button>
              <span class="muted">→</span>
              <code v-if="f.names?.length">{{ f.names.join(', ') }}</code>
              <span v-else class="muted mono">{{ f.via }}</span>
            </li>
            <li v-if="bypasses.length > 10" class="muted">另 {{ bypasses.length - 10 }} 条</li>
          </ul>
        </details>
      </div>

      <div v-if="bypasses.length || declare.length" class="fold-block" aria-label="建议">
        <!-- G12：建议折叠带计数（提升到入口 / 声明接口 / 改经入口各一条） -->
        <details>
          <summary>
            建议<span class="muted"> · {{ adviceCount }} 条</span>
          </summary>
          <ul class="plain">
            <li v-if="bypasses.length" data-advice="promote">
              <b>提升到入口</b>：把<template v-if="promote.length">
                <code>{{ promote.slice(0, 8).join(', ') }}</code
                ><template v-if="promote.length > 8"> 等 {{ promote.length }} 个</template></template
              ><template v-else> {{ viaFiles.slice(0, 3).join('、') }} 里用到的符号</template>加进入口<template v-if="sm?.entry">
                <code>{{ sm.entry }}</code></template
              >
              的导出
            </li>
            <li v-if="declare.length" data-advice="declare">
              <b>声明接口</b>：<code>{{ declare.map(r => r.element.name).join(', ') }}</code> 被 ≥
              {{ HOT_SURFACE_MODULES }} 个模块使用而没有声明接口，在描述里声明（04 §3.3）
            </li>
            <li v-if="bypasses.length" data-advice="via-entry"><b>改经入口</b>：{{ fromFiles }} 个依赖方文件改为从入口导入，不直接导入模块内部的文件</li>
          </ul>
        </details>
      </div>
    </Section>
  </div>
</template>

<style scoped>
.dims {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 3px 10px;
  margin: 0 0 6px;
}

.dims dt {
  color: var(--text-3);
}

.dims dd {
  margin: 0;
}

.note {
  margin: 0 0 6px;
  font-size: 12.5px;
}

.element {
  padding: 3px 0;
}

.element.hot {
  background: var(--accent-soft);
}

.element.flash {
  animation: flash 1.2s ease-out;
}

@keyframes flash {
  from {
    background: var(--accent-soft);
  }
}

.group-head {
  margin: 6px 0 2px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-2);
}

.e-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px 6px;
  font-size: 12.5px;
}

.el-name {
  font-weight: 600;
}

.el-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  font-size: 10px;
  color: var(--text-2);
  border: 1px solid var(--border-strong);
  border-radius: 3px;
}

.el-mark[data-kind='port'] {
  border-radius: 50%;
}

.state {
  font-size: 11px;
  color: var(--text-3);
}

.state[data-state='exported-only'] {
  color: var(--warning);
}

.fan {
  font-size: 11.5px;
  color: var(--text-2);
}

.users {
  padding-left: 20px;
  font-size: 12px;
}

/* G12：常显节内二级折叠（O11 面板版：折叠必有计数） */
.fold-block summary {
  margin: 8px 0 2px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-2);
  cursor: pointer;
  list-style: none;
}

.fold-block summary::-webkit-details-marker {
  display: none;
}

.fold-block summary::before {
  content: '▸ ';
  color: var(--text-3);
}

.fold-block details[open] summary::before {
  content: '▾ ';
}

.bypass {
  display: flex;
  flex-wrap: wrap;
  gap: 2px 6px;
  font-size: 12px;
}

.mono {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 11.5px;
  word-break: break-all;
  text-align: left;
}

.advice li {
  font-size: 12.5px;
  padding: 1px 0;
}
</style>
