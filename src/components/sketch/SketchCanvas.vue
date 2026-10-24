<script setup lang="ts">
/**
 * 草图画布（present.sketch，SK-15、SK-16，X7、X7c–X7e、X7j、X7k、X13、X15、X19，ADR-0025）：Vue Flow 自由模式——不走 elk、不走分层投影，
 * 位置来自草图的 layout（草图布局 state.layout.sketch 给出节点与直线边）。每个手势只发 DeskState 编辑分组的一个操作：
 * - 拖节点（多选一起拖）松手 = moveNode 一步；拖到同层另一节点上 = 降级（根草图里拖到层上 = 移入）；拖到信息条面包屑的父级或拖出中心区（挂载点框）= 升级；
 * - 框选（在空白处拖）/ ⇧ 点选多选；右键：合并为新模块（≥2）、拆分、进入下一层、删除；空白处右键或双击：新建模块（就地输入名称与 ID 短名）；
 * - 从节点右侧的连线柄拖到另一节点：松手选类型 + 一句说明；选中的边可拖标签；双击模块下钻；
 * - 工具条：＋ 模块、引用外部模块、隐藏外部引用（X22，只在会话里）、重新排列、本层数与超七提示；快捷键 ⌘Z / ⇧⌘Z、Delete / Backspace、⌘S、Esc（只取消选中）。
 * 非根草图（X22）：框线（系统框、中心区、带层名的引用列）在最底、不接收指针；引用节点在所属层的列里，位置由规则算、不可拖；
 * 引用线画在模块之上、不接收指针，相关节点选中或悬停时实色；本层之间的线仍在模块之下。layout 的坐标相对中心区的内容原点（scene.origin）。
 * 图上标出变更时右下角有角标的图例（数据来自派生的对比）。
 * 根草图（X21）：层画成横向带（按 order），第二级模块在带内自由摆放（记 x 与相对带顶的 y，带高随内容增长）；拖到另一条带 = 移入；双击带内空白 = 在该层新建；
 * 带头编辑名称与 abstraction、「＋ 模块」「删层」；工具条「＋ 层」。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue'
import { ConnectionMode, VueFlow, useVueFlow, type Connection, type Edge, type GraphNode, type Node, type NodeMouseEvent } from '@vue-flow/core'
import '@vue-flow/core/dist/style.css'
import { ROOT_MOUNT, type SketchPoint } from '@/model'
import { bandAt, outsideCenter, type SketchEdgeData, type SketchNodeData } from '@/layout/layout'
import { useDesk } from '@/state/inject'
import { ask } from '../edit/useEditDialog'
import SketchNode from './SketchNode.vue'
import StraightEdge from './StraightEdge.vue'
import SketchMenu, { type MenuItem } from './SketchMenu.vue'
import PartsDialog from './PartsDialog.vue'
import ConnectPopover from './ConnectPopover.vue'
import ReferencePicker from './ReferencePicker.vue'
import { CHANGE_BADGES } from './labels'
import { dragOverParent, SKETCH_ACTIONS, sketchRequest } from './actions'

const desk = useDesk()
const e = desk.edit
const { setNodes, setEdges, project, fitView, getSelectedNodes, getNodes, dimensions, zoomIn, zoomOut } = useVueFlow('sketch')

// ── 提示 ──
const notice = ref('')
function notify(msg: string) {
  notice.value = msg
  setTimeout(() => notice.value === msg && (notice.value = ''), 4000)
}

// ── 节点与边：草图布局的结果写入 Vue Flow ──
/** 拖动经过的降级 / 移入目标与面包屑父级 */
const dropTarget = ref<string | null>(null)
/** 拖到信息条面包屑的父级（升级的落点，#15）：信息条读它高亮 */
const dropParent = dragOverParent
const picked = computed(() => new Set(e.picked.value))
const scene = computed(() => e.scene.value)
const sizeOf = computed(() => new Map((scene.value?.nodes ?? []).map(n => [n.id, { w: n.data.w, h: n.data.h }])))
/** X22：悬停的节点（引用线实色显示） */
const hovered = ref<string | null>(null)
const nodes = computed<Node<SketchNodeData & { drop?: boolean }>[]>(() =>
  (scene.value?.nodes ?? []).map(n => {
    const kind = n.data.kind
    const passive = kind === 'layer' || kind === 'frame'
    // X22：拖出中心区（或到面包屑父级）时系统框高亮升级的落点
    const drop = dropTarget.value === n.id || (kind === 'frame' && n.data.frame === 'system' && dropParent.value)
    return {
      id: n.id,
      type: 'sketch',
      position: { ...n.position },
      data: { ...n.data, selected: n.data.selected || picked.value.has(n.id), drop },
      width: n.data.w,
      height: n.data.h,
      // 层带与框线在模块之下、不接收指针（带头除外），框选与双击新建落到画布上（X21、X22）
      style: { width: `${n.data.w}px`, height: `${n.data.h}px`, ...(passive ? { pointerEvents: 'none' as const } : {}) },
      zIndex: kind === 'frame' ? -1 : kind === 'layer' ? 0 : 1,
      selected: !!n.data.selected || picked.value.has(n.id),
      selectable: !passive,
      // X22：引用节点的位置由规则算，不可拖
      draggable: !passive && kind !== 'reference',
      connectable: !passive,
    }
  }),
)
/** X22：引用线实色的条件——两端之一被选中（含多选）或悬停 */
const hotIds = computed(() => {
  const sel = desk.selection.value
  return new Set([...picked.value, ...(sel?.kind === 'module' ? [sel.id] : []), ...(hovered.value ? [hovered.value] : [])])
})
const edges = computed<Edge<SketchEdgeData & { sizes: { a: { w: number; h: number }; b: { w: number; h: number } }; hot?: boolean }>[]>(() =>
  (scene.value?.edges ?? []).map(x => ({
    id: x.id,
    type: 'straight',
    source: x.source,
    target: x.target,
    sourceHandle: 'c',
    targetHandle: 't',
    data: {
      ...x.data,
      sizes: { a: sizeOf.value.get(x.source)!, b: sizeOf.value.get(x.target)! },
      ...(x.data.external ? { hot: hotIds.value.has(x.source) || hotIds.value.has(x.target) } : {}),
    },
    // X22：引用线在模块之上、不接收指针；本层之间的线在模块之下
    ...(x.data.external ? { zIndex: 3, selectable: false, focusable: false, class: 'sk-ref-edge' } : {}),
  })),
)
watch(nodes, n => setNodes(n), { immediate: true })
watch(edges, x => setEdges(x), { immediate: true })

// ── 视野：打开、切换草图后适应画布（等节点量好尺寸、容器有尺寸）──
let pendingFit = true
function tryFit(attempt = 0) {
  if (!pendingFit) return
  if (dimensions.value.width && nodes.value.length && getNodes.value.every(n => n.dimensions.width > 0)) {
    pendingFit = false
    void fitView({ padding: 0.2, maxZoom: 1.1 })
  } else if (attempt < 40) setTimeout(() => tryFit(attempt + 1), 50)
}
watch(
  () => [e.mount.value, e.hideReferences.value],
  async () => {
    pendingFit = true
    await nextTick()
    tryFit()
  },
)
onMounted(() => tryFit())

// ── 选中：单选为视图状态的选中；多选（框选 / ⇧ 点选）记在编辑分组 ──
function onNodeClick({ event, node }: NodeMouseEvent) {
  const shift = (event as MouseEvent).shiftKey || (event as MouseEvent).metaKey
  if (shift) {
    const cur = desk.selection.value?.kind === 'module' ? [desk.selection.value.id] : []
    const set = new Set([...e.picked.value, ...cur])
    if (set.has(node.id)) set.delete(node.id)
    else set.add(node.id)
    e.pick([...set])
  } else e.pick([])
  desk.select({ kind: 'module', id: node.id })
}
function onSelectionEnd() {
  const ids = getSelectedNodes.value.map(n => n.id)
  e.pick(ids.length > 1 ? ids : [])
  if (ids.length) desk.select({ kind: 'module', id: ids[ids.length - 1] })
}
function clearSelection() {
  e.pick([])
  desk.select(null)
}

// ── 拖动：落点一步；拖到节点上 = 降级 / 移入；拖到面包屑父级 = 升级 ──
const host = ref<HTMLElement | null>(null)
/** Vue Flow 容器的屏幕矩形（project 的原点；不含画布顶部的工具条） */
const flowRect = () => ((host.value!.querySelector('.vue-flow') as HTMLElement | null) ?? host.value!).getBoundingClientRect()
function flowPoint(ev: MouseEvent | TouchEvent): SketchPoint {
  const pt = 'clientX' in ev ? ev : (ev.touches[0] ?? ev.changedTouches[0])
  const r = flowRect()
  return project({ x: pt.clientX - r.left, y: pt.clientY - r.top })
}
function overParentCrumb(ev: MouseEvent | TouchEvent): boolean {
  const pt = 'clientX' in ev ? ev : (ev.touches[0] ?? ev.changedTouches[0])
  return document.elementsFromPoint(pt.clientX, pt.clientY).some(el => (el as HTMLElement).dataset?.parent === '1')
}
const root = computed(() => e.mount.value === ROOT_MOUNT)
/** X22：画布上的位置换成 layout 记的样子——非根草图相对中心区的内容原点（根草图由编辑操作按层带换算） */
function toLayout(p: SketchPoint): SketchPoint {
  const o = root.value ? { x: 0, y: 0 } : (scene.value?.origin ?? { x: 0, y: 0 })
  return { x: Math.round(p.x - o.x), y: Math.round(p.y - o.y) }
}

/** X21：根草图里第二级模块所在的层（ID 的第一段） */
const layerOf = (id: string) => id.split('.')[0]
function onNodeDrag({ event, nodes: dragged }: { event: MouseEvent | TouchEvent; nodes: GraphNode[] }) {
  const p = flowPoint(event)
  const moving = new Set(dragged.map(n => n.id))
  // 落到另一个模块上 = 降级；根草图里落到另一条层带上 = 移入
  const hit = (scene.value?.nodes ?? []).find(
    n =>
      !moving.has(n.id) &&
      n.data.kind === 'module' &&
      p.x >= n.position.x &&
      p.x <= n.position.x + n.data.w &&
      p.y >= n.position.y &&
      p.y <= n.position.y + n.data.h,
  )
  const single = dragged.length === 1 && scene.value?.nodes.find(n => n.id === dragged[0].id)?.data.kind === 'module'
  const band = root.value && single && !hit ? bandAt(scene.value?.bands ?? [], p.y) : null
  dropTarget.value = single && hit ? hit.id : band && band !== layerOf(dragged[0].id) ? band : null
  // 升级：拖到面包屑父级，或拖出中心区（X22）
  dropParent.value = !!single && !root.value && !hit && (overParentCrumb(event) || (!!scene.value && outsideCenter(scene.value, p)))
}
function onNodeDragStop({ nodes: dragged }: { event: MouseEvent | TouchEvent; nodes: GraphNode[] }) {
  const target = dropTarget.value
  const parent = dropParent.value
  dropTarget.value = null
  dropParent.value = false
  let r: { ok: boolean; reason?: string }
  if (parent) r = e.promote(dragged[0].id)
  else if (target) {
    const kind = scene.value?.nodes.find(n => n.id === target)?.data.kind
    r =
      kind === 'layer'
        ? e.moveIn(dragged[0].id, target, { x: Math.round(dragged[0].position.x), y: Math.round(dragged[0].position.y) })
        : e.demote(dragged[0].id, target)
  } else {
    const moved = dragged.filter(n => scene.value?.nodes.find(x => x.id === n.id)?.data.kind !== 'reference')
    r = moved.length ? e.moveNode(Object.fromEntries(moved.map(n => [n.id, toLayout(n.position)]))) : { ok: true }
  }
  if (!r.ok) notify(r.reason ?? '做不成')
  // 被拒绝或改成降级 / 升级时，节点回到草图里的位置
  setNodes(nodes.value)
}

// ── 双击：模块下钻；空白处新建 ──
function onNodeDoubleClick({ node }: NodeMouseEvent) {
  const kind = scene.value?.nodes.find(n => n.id === node.id)?.data.kind
  if (kind === 'reference') return notify('引用节点只读：它属于别的草图')
  const r = e.openChild(node.id)
  if (!r.ok) notify(r.reason)
}
/** 就地新建：位置（没给时由布局放到空位）；根草图里 layer 为所在层带（没有 = 新建一层，X21） */
const creating = ref<{ screen: { x: number; y: number }; at?: SketchPoint; layer?: string; error?: string } | null>(null)
function startCreate(ev: MouseEvent) {
  const at = flowPoint(ev)
  if (!root.value) return void (creating.value = { screen: { x: ev.clientX, y: ev.clientY }, at })
  const layer = bandAt(scene.value?.bands ?? [], at.y)
  if (!layer) return notify('双击层带内的空白处在该层新建模块；新建一层用工具条「＋ 层」')
  creating.value = { screen: { x: ev.clientX, y: ev.clientY }, at, layer }
}
function onHostDblClick(ev: MouseEvent) {
  if (!(ev.target as HTMLElement).closest('.vue-flow__pane') || (ev.target as HTMLElement).closest('.vue-flow__node')) return
  startCreate(ev)
}
function createAtCenter() {
  const r = flowRect()
  const screen = { x: r.left + r.width / 2 - 120, y: r.top + r.height / 2 - 60 }
  creating.value = root.value ? { screen } : { screen, at: project({ x: r.width / 2, y: r.height / 2 }) }
}
function create(rows: { name: string; id: string }[]) {
  const c = creating.value!
  const at = c.at ? toLayout(c.at) : undefined
  const r = e.addModule(rows[0].name, rows[0].id, at, c.layer)
  if (!r.ok) creating.value = { ...c, error: r.reason }
  else creating.value = null
}
provide(SKETCH_ACTIONS, {
  addIn: (layer, screen) => (creating.value = { screen: { x: screen.x - 40, y: screen.y + 12 }, layer }),
  removeLayer: layer => void removeIds([layer]),
  notify,
})

// ── 连线 ──
const connecting = ref<{ from: string; to: string } | null>(null)
function onConnect(c: Connection) {
  const kinds = new Map((scene.value?.nodes ?? []).map(n => [n.id, n.data.kind]))
  if (c.source === c.target) return notify('关系不能连自己')
  if (kinds.get(c.source) === 'reference' && kinds.get(c.target) === 'reference') return notify('两端都是引用节点的关系不能建：关系只写本层（X19）')
  connecting.value = { from: c.source, to: c.target }
}

// ── 右键菜单与对话框 ──
const menu = ref<{ x: number; y: number; items: MenuItem[]; node?: string; edge?: string; pane?: MouseEvent } | null>(null)
const parts = ref<{ kind: 'merge' | 'split'; ids: string[]; error?: string } | null>(null)
function onNodeMenu({ event, node }: NodeMouseEvent) {
  event.preventDefault()
  const ev = event as MouseEvent
  const kind = scene.value?.nodes.find(n => n.id === node.id)?.data.kind
  const group = picked.value.has(node.id) ? [...picked.value] : [node.id]
  if (!picked.value.has(node.id)) {
    e.pick([])
    desk.select({ kind: 'module', id: node.id })
  }
  const items: MenuItem[] = []
  if (kind === 'module') {
    items.push({ key: 'merge', label: `合并为新模块…${group.length > 1 ? `（${group.length} 个）` : ''}`, disabled: group.length < 2 })
    items.push({ key: 'split', label: '拆分…', disabled: group.length > 1 })
    items.push({ key: 'open', label: '进入下一层', disabled: group.length > 1 })
  }
  items.push({ key: 'remove', label: kind === 'reference' ? '删除（连同它的关系）' : '删除', danger: true })
  menu.value = { x: ev.clientX, y: ev.clientY, items, node: node.id }
}
/** 聚合边（05 裁决 4）合进来的关系；单条为它自己 */
const relationsOf = (edgeId: string): string[] => scene.value?.edges.find(x => x.id === edgeId)?.data.relationIds ?? [edgeId]
function onEdgeClick(edgeId: string) {
  const x = scene.value?.edges.find(y => y.id === edgeId)
  if (x?.data.relationIds && x.data.reference) desk.select({ kind: 'module', id: x.data.reference })
  else desk.select({ kind: 'relation', id: edgeId })
}
function onEdgeMenu({ event, edge }: { event: MouseEvent | TouchEvent; edge: { id: string } }) {
  event.preventDefault()
  onEdgeClick(edge.id)
  const ev = event as MouseEvent
  const n = relationsOf(edge.id).length
  menu.value = { x: ev.clientX, y: ev.clientY, items: [{ key: 'remove-edge', label: n > 1 ? `删除这 ${n} 条关系` : '删除关系', danger: true }], edge: edge.id }
}
function onPaneMenu(ev: MouseEvent) {
  ev.preventDefault()
  const inBand = root.value && !!bandAt(scene.value?.bands ?? [], flowPoint(ev).y)
  const items: MenuItem[] = root.value && !inBand ? [{ key: 'create-layer', label: '新建一层' }] : [{ key: 'create', label: '在这里新建模块' }]
  menu.value = { x: ev.clientX, y: ev.clientY, items, pane: ev }
}
async function onMenu(key: string) {
  const m = menu.value!
  menu.value = null
  if (key === 'create' && m.pane) return startCreate(m.pane)
  if (key === 'create-layer') return createAtCenter()
  if (key === 'remove-edge' && m.edge) return void removeIds(relationsOf(m.edge))
  const id = m.node!
  const group = picked.value.has(id) ? [...picked.value] : [id]
  if (key === 'merge') parts.value = { kind: 'merge', ids: group }
  else if (key === 'split') parts.value = { kind: 'split', ids: [id] }
  else if (key === 'open') {
    const r = e.openChild(id)
    if (!r.ok) notify(r.reason)
  } else if (key === 'remove') await removeIds(group)
}
async function onParts(rows: { name: string; id: string }[]) {
  const p = parts.value!
  if (p.kind === 'split' && !(await confirmSplit(p.ids[0], rows))) return
  const r = p.kind === 'merge' ? e.merge(p.ids, rows[0].name, rows[0].id) : e.split(p.ids[0], rows)
  if (!r.ok) return void (parts.value = { ...p, error: r.reason })
  parts.value = null
  e.pick([])
  if (p.kind === 'merge') notify('已合并：来源成为新模块的子模块，双击进入继续设计内部')
  else if (e.pending.value.length) notify(`已拆分：${e.pending.value.length} 条关系待重连`)
}

/** X7k：拆分前的二次确认——原模块的下一层草图随拆分删除；拆分本身不成立时留在对话框里显示原因 */
async function confirmSplit(id: string, rows: { name: string; id: string }[]): Promise<boolean> {
  const pv = e.previewSplit(id, rows)
  if ('rejected' in pv) {
    parts.value = { ...parts.value!, error: pv.rejected }
    return false
  }
  if (!pv.sketches.length) return true
  const lines = pv.sketches.map(x =>
    x.derived
      ? `它的下一层（当前版本里 ${x.modules} 个模块）不再挂在它身上：子模块的去向请在拆分前用升级 / 降级安排，或交给 AI 按职责分配`
      : `拆分会删除它的下一层草图 ${x.mount}.yaml（${x.modules} 个模块）`,
  )
  return ask({ title: `拆分「${e.nameOf(id) ?? id}」？`, lines, ok: '拆分', danger: true })
}

// 面板请求的合并 / 拆分 / 删除（对话框与级联确认都在画布里）
watch(sketchRequest, r => {
  if (!r) return
  sketchRequest.value = null
  if (r.kind === 'remove') void removeIds(r.ids)
  else parts.value = { kind: r.kind, ids: r.ids }
})

/** F-30：删除（有级联时二次确认并列出） */
async function removeIds(ids: string[]) {
  const pv = e.previewRemove(ids)
  if ('rejected' in pv) return notify(pv.rejected)
  const extra = pv.removed.filter(x => !ids.includes(x))
  if (extra.length || pv.sketches.length) {
    const lines = [...(extra.length ? [`一并删除：${extra.join('、')}`] : []), ...(pv.sketches.length ? [`连同下一层草图：${pv.sketches.join('、')}`] : [])]
    if (!(await ask({ title: `删除 ${ids.join('、')}？`, lines, ok: '删除', danger: true }))) return
  }
  const r = e.remove(ids)
  if (!r.ok) notify(r.reason)
  else e.pick([])
}

// ── 工具条 ──
const picking = ref(false)
function toggleReferences() {
  picking.value = false
  e.toggleReferences()
}
function arrange() {
  const r = e.autoArrange()
  if (!r.ok) notify(r.reason)
}

// ── 键盘（X7a、X7g）：⌘Z / ⇧⌘Z、Delete / Backspace、⌘S、Esc ──
async function save() {
  const r = await e.save()
  const dropped = r.ok ? r.dropped.flatMap(d => d.ids) : []
  notify(
    r.ok
      ? dropped.length
        ? `已保存（丢掉没有关系的引用：${dropped.join('、')}）`
        : '已保存'
      : r.conflict
        ? '文件已在外部改动：重新加载并重放后再保存'
        : `保存失败：${r.error}`,
  )
}
function onKey(ev: KeyboardEvent) {
  const t = ev.target as HTMLElement
  if (t.closest('input, textarea, select, [contenteditable="true"]') || menu.value || parts.value || creating.value || connecting.value) return
  const mod = ev.metaKey || ev.ctrlKey
  if (mod && ev.key.toLowerCase() === 'z') {
    ev.preventDefault()
    if (ev.shiftKey) e.redo()
    else e.undo()
  } else if (mod && ev.key.toLowerCase() === 'y') {
    ev.preventDefault()
    e.redo()
  } else if (mod && ev.key.toLowerCase() === 's') {
    ev.preventDefault()
    void save()
  } else if (ev.key === 'Delete' || ev.key === 'Backspace') {
    ev.preventDefault()
    const sel = desk.selection.value
    const ids = e.picked.value.length ? [...e.picked.value] : sel && (sel.kind === 'module' || sel.kind === 'relation') ? [sel.id] : []
    if (ids.length) void removeIds(ids)
  } else if (ev.key === 'Escape') clearSelection()
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

const legend = computed(() => {
  const kinds = new Set((scene.value?.nodes ?? []).map(n => n.data.change).filter(Boolean))
  return [...kinds].map(k => CHANGE_BADGES[k!])
})
const prefix = computed(() => (e.mount.value === ROOT_MOUNT ? '' : (e.mount.value ?? '')))
/** 合并 / 拆分的新 ID 前缀：所选模块的父（根草图里为所在层） */
const partsPrefix = computed(() => {
  const id = parts.value?.ids[0]
  return id && id.includes('.') ? id.slice(0, id.lastIndexOf('.')) : prefix.value
})
const splitName = computed(() => (parts.value?.kind === 'split' ? (e.nameOf(parts.value.ids[0]) ?? parts.value.ids[0]) : ''))
</script>

<template>
  <div ref="host" class="sketch-canvas" @dblclick="onHostDblClick">
    <header class="sk-top">
      <span class="spacer" />
      <div class="sk-tools" role="toolbar" aria-label="草图工具条">
        <button v-if="root" title="新建一层（排在最后；层的子模块在带内双击新建）" @click="createAtCenter">＋ 层</button>
        <button v-else title="新建一个模块（也可双击空白处）" @click="createAtCenter">＋ 模块</button>
        <button
          v-if="!root"
          title="搜索当前版本的模块，放上画布作为待连端点（排在所属层的引用列里）"
          :disabled="e.hideReferences.value"
          @click="picking = !picking"
        >
          引用外部模块
        </button>
        <button
          v-if="!root"
          :aria-pressed="e.hideReferences.value"
          :class="{ on: e.hideReferences.value }"
          title="隐藏引用列与引用线，中心区占满画布（只在本次会话）"
          @click="toggleReferences"
        >
          {{ e.hideReferences.value ? '显示外部引用' : '隐藏外部引用' }}
        </button>
        <button title="重新排列本张草图（可撤销）" @click="arrange">重新排列</button>
        <span v-if="root" class="count" :class="{ over: !!e.overSeven.value }" :title="e.overSeven.value?.message ?? '第二级模块数'">
          {{ scene?.bands.length ?? 0 }} 层 · {{ scene?.count ?? 0 }} 个模块<template v-if="e.overSevens.value.length">
            · {{ e.overSevens.value.length }} 层超七</template
          >
        </span>
        <span v-else class="count" :class="{ over: !!e.overSeven.value }" :title="e.overSeven.value?.message ?? '本层模块数'">
          本层 {{ scene?.count ?? 0 }} 个模块<template v-if="e.overSeven.value"> · 考虑归并</template>
        </span>
      </div>
    </header>
    <VueFlow
      id="sketch"
      class="sk-flow"
      :min-zoom="0.1"
      :max-zoom="2.5"
      :zoom-on-double-click="false"
      :nodes-draggable="true"
      :nodes-connectable="true"
      :elements-selectable="true"
      :selection-on-drag="true"
      :pan-on-drag="[1]"
      :pan-on-scroll="true"
      :multi-selection-key-code="null"
      :delete-key-code="null"
      :connection-mode="ConnectionMode.Loose"
      :connection-radius="60"
      :only-render-visible-elements="false"
      @node-click="onNodeClick"
      @node-double-click="onNodeDoubleClick"
      @node-drag="onNodeDrag"
      @node-drag-stop="onNodeDragStop"
      @node-mouse-enter="({ node }) => (hovered = node.id)"
      @node-mouse-leave="hovered = null"
      @node-context-menu="onNodeMenu"
      @edge-click="({ edge }) => onEdgeClick(edge.id)"
      @edge-context-menu="onEdgeMenu"
      @pane-click="clearSelection"
      @pane-context-menu="onPaneMenu"
      @selection-end="onSelectionEnd"
      @connect="onConnect"
      @nodes-initialized="tryFit()"
    >
      <template #node-sketch="p"><SketchNode :data="p.data" /></template>
      <template #edge-straight="p">
        <StraightEdge :id="p.id" :source-x="p.sourceX" :source-y="p.sourceY" :target-x="p.targetX" :target-y="p.targetY" :data="p.data" />
      </template>
    </VueFlow>

    <div class="sk-zoom">
      <button title="放大" @click="zoomIn()">＋</button>
      <button title="缩小" @click="zoomOut()">－</button>
      <button title="适应画布" @click="fitView({ padding: 0.2, maxZoom: 1.1 })">适应</button>
    </div>
    <div v-if="scene && !scene.nodes.length" class="sk-empty">这一层还没有模块：从加一个模块开始（双击空白处或「＋ 模块」）</div>
    <div v-if="e.needsLayout.value && scene?.nodes.length" class="sk-hint">初始布局：拖动任一节点后位置写进草图</div>
    <div v-if="notice" class="sk-notice" role="status">{{ notice }}</div>
    <div
      v-if="desk.toggles.showDiff && legend.length"
      class="sk-legend"
      :title="`图上标出变更（${e.compareMode.value === 'baseline' ? '相对基线' : '相对当前版本'}）`"
    >
      <span v-for="b in legend" :key="b.title" class="item"
        ><b>{{ b.text }}</b> {{ b.title }}</span
      >
    </div>

    <ReferencePicker v-if="picking" @close="picking = false" @notice="notify" />
    <SketchMenu v-if="menu" :x="menu.x" :y="menu.y" :items="menu.items" @choose="onMenu" @close="menu = null" />
    <PartsDialog
      v-if="creating"
      :title="root && !creating.layer ? '新建层' : '新建模块'"
      :prefix="creating.layer ?? prefix"
      ok="新建"
      :at="creating.screen"
      :error="creating.error"
      @submit="create"
      @close="creating = null"
    />
    <PartsDialog
      v-if="parts?.kind === 'merge'"
      title="合并为新模块"
      :prefix="partsPrefix"
      ok="合并"
      :error="parts.error"
      :hint="`来源 ${parts.ids.map(id => e.nameOf(id) ?? id).join('、')} 成为新模块的子模块`"
      @submit="onParts"
      @close="parts = null"
    />
    <PartsDialog
      v-if="parts?.kind === 'split'"
      :title="`拆分「${splitName}」`"
      :prefix="partsPrefix"
      :rows="2"
      extendable
      ok="拆分"
      :error="parts.error"
      hint="原模块的关系不自动分配，列为待重连"
      @submit="onParts"
      @close="parts = null"
    />
    <ConnectPopover v-if="connecting" :from="connecting.from" :to="connecting.to" @close="connecting = null" @done="connecting = null" />
  </div>
</template>

<style scoped>
.sketch-canvas {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg);
}

.sk-top {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  z-index: 5;
}

.spacer {
  flex: 1;
}

.sk-tools {
  display: flex;
  align-items: center;
  gap: 6px;
}

.sk-tools button {
  font-size: 12px;
  padding: 2px 8px;
}

.sk-tools button.on {
  border-color: var(--accent);
  color: var(--accent);
}

.count {
  font-size: 12px;
  color: var(--text-3);
}

.count.over {
  color: var(--warning);
  font-weight: 600;
}

.sk-flow {
  flex: 1;
  min-height: 0;
}

.sk-empty {
  position: absolute;
  inset: 40px 0 0;
  display: grid;
  place-content: center;
  color: var(--text-3);
  pointer-events: none;
}

.sk-zoom {
  position: absolute;
  left: 12px;
  bottom: 12px;
  display: flex;
  gap: 4px;
  z-index: 5;
}

.sk-zoom button {
  min-width: 30px;
  font-size: 12px;
  padding: 3px 8px;
}

.sk-hint {
  position: absolute;
  left: 140px;
  bottom: 16px;
  font-size: 11.5px;
  color: var(--text-3);
}

.sk-notice {
  position: absolute;
  top: 48px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 7;
  padding: 4px 12px;
  font-size: 12.5px;
  color: var(--text);
  background: var(--warning-soft);
  border-radius: 14px;
}

.sk-legend {
  position: absolute;
  right: 12px;
  bottom: 12px;
  display: flex;
  gap: 8px;
  padding: 3px 8px;
  font-size: 11.5px;
  color: var(--text-2);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
}

.sk-legend b {
  color: var(--accent);
}
</style>

<style>
/* X22：引用线不接收指针（Vue Flow 的边容器缺省接收描边上的指针） */
.vue-flow__edge.sk-ref-edge {
  pointer-events: none;
}
</style>
