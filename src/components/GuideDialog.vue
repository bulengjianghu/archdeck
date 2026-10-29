<script setup lang="ts">
/**
 * 「怎么读这张图」（W-10）：顶栏「帮助」打开的一页，按结构 / 交互 / 运行 / 对照与治理四组各一句话加示意（ADR-0031：结构图是依赖事实，交互图是四类交互），
 * 结构组另有「束与表面」「承载」两段（第八轮，C-27–C-29）；「读一条线」一段讲机制标签与两段标签位（ADR-0041）；另一段讲三视角共享的通道（L18，文字与「显示」面板同源）；只讲概念，线型、颜色等具体图例在画布右下角的「显示」面板。Esc 或单击遮罩关闭。
 */
import { onBeforeUnmount, onMounted } from 'vue'
import { RELATION_TYPE_LABELS, THREE_QUESTIONS } from './shared/labels'
import { SHARED_CHANNELS } from './display/labels'

const emit = defineEmits<{ close: [] }>()
const onKey = (e: KeyboardEvent) => {
  if (e.key === 'Escape') {
    e.stopPropagation()
    emit('close')
  }
}
onMounted(() => window.addEventListener('keydown', onKey, true))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey, true))
</script>

<template>
  <div class="mask" @click.self="emit('close')">
    <section class="guide" role="dialog" aria-modal="true" aria-label="怎么读这张图">
      <header>
        <h2>怎么读这张图</h2>
        <button class="close" aria-label="关闭" @click="emit('close')">×</button>
      </header>
      <p class="lead">本地架构工作台：<strong>看见</strong>结构与运行，<strong>对照</strong>描述与代码，<strong>守住</strong>规则与门禁。</p>

      <div class="group" aria-label="结构">
        <svg viewBox="0 0 120 64" aria-hidden="true">
          <rect x="6" y="8" width="34" height="14" rx="3" class="node" />
          <rect x="80" y="8" width="34" height="14" rx="3" class="node" />
          <rect x="43" y="44" width="34" height="14" rx="3" class="node" />
          <rect x="6" y="8" width="3" height="14" class="bar unstable" />
          <rect x="43" y="44" width="3" height="14" class="bar stable" />
          <path d="M40 15 L76 15" class="dep" />
          <path d="M72 11 L78 15 L72 19" class="dep-head" />
          <path d="M23 22 L55 42" class="dep" />
          <path d="M50 38 L56 43 L49 44" class="dep-head" />
          <path d="M97 22 L70 42" class="dep" />
          <path d="M70 42 L73 36 L77 40 Z" class="tri" />
        </svg>
        <div>
          <h3>结构</h3>
          <p>
            顶部「结构」：模块之间的依赖事实，从源码算出、不用人写——依赖一律虚线，看端点记号：开口箭头是使用（只引类型画点线、缺省收起；例外画得深而粗，其余安静），
            空心三角是继承，空心菱形 ◇
            是端口实现，实心菱形是组装。选中模块只看它直接和谁打交道（一跳），「改它牵动谁」在面板里点「影响面」查；块边的色条是不稳定度；只标违规。
          </p>
          <p class="sub" data-testid="guide-bundle">
            <b>束与表面</b>：一对模块之间的线是一条束（线宽按束内元素级边条数，形态不止一种时标「×N 元素」），展开模块看它的表面——入口导出与声明的接口；
            依赖接到表面元素，不经入口的深层导入标「越过入口」。束与折叠都带计数，从不掩盖耦合。
            平时只画骨架与例外：违规、向上、逆稳定、未解释照画；环内的依赖按组计数（单击「↻ N」选中环组画出），能由别的路径推出的线退到「另直连
            N」，聚焦时画出。
          </p>
          <p class="sub" data-testid="guide-carrier">
            <b>承载</b>：每条交互都应由结构图上的一段元素级依赖撑着（直接 / 经端口 / 经总线 / 回调注册 /
            经通道五种模板），逐段判定为齐全、模块级、缺段、无承载或外部； 交互视角选中一条交互时承载临时叠加在图上，缺的段画成警示色虚线、标「缺段」。
          </p>
        </div>
      </div>

      <div class="group" aria-label="交互">
        <svg viewBox="0 0 120 64" aria-hidden="true">
          <rect x="4" y="6" width="112" height="22" rx="4" class="band" />
          <rect x="12" y="11" width="34" height="12" rx="3" class="node" />
          <rect x="4" y="36" width="112" height="22" rx="4" class="band" />
          <rect x="62" y="41" width="34" height="12" rx="3" class="node" />
          <path d="M29 23 L79 41" class="edge" marker-end="url(#g-arrow)" />
          <defs>
            <marker id="g-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M0 0 L8 4 L0 8 z" class="head" />
            </marker>
          </defs>
        </svg>
        <div>
          <h3>交互</h3>
          <p>
            顶部「交互」（缺省）：方框是模块、带是层、有向线是交互（颜色表类型，×N 是聚合了几条）；一次只看一层，双击下钻，带里的「+N」单击临时展开其余模块。
            结构与交互两种视角节点位置不动，只换线。
          </p>
        </div>
      </div>

      <div class="group" aria-label="读一条线：三问四修饰">
        <svg viewBox="0 0 120 64" aria-hidden="true">
          <path d="M10 18 L98 18" class="edge query" marker-end="url(#g-arrow)" />
          <path d="M10 40 L98 40" class="edge" marker-end="url(#g-arrow)" />
          <path d="M94 33 A7 7 0 0 1 94 47" class="socket" />
        </svg>
        <div>
          <h3>读一条线：三问四修饰</h3>
          <ol class="questions">
            <li v-for="(x, i) in THREE_QUESTIONS" :key="i">{{ x.q }}{{ x.answers.map(a => `${a.a} → ${RELATION_TYPE_LABELS[a.type]}`).join('；') }}</li>
          </ol>
          <p data-testid="guide-mechanism">
            再读修饰：经什么连写在线中点的标签（回调、端口、总线、注入、跨进程、路由、事件、通道、拉取，中性色；直接不写，经端口的线另在目标端画插座记号）、异步（空心箭头）。
            异常（违规、向上、未证实……）用警示色写在前一段；一条线至多两个标签，其余写「+k」、悬停列出。向上的线有机制就自带理由，没有机制的才标「向上」。
            查询画得淡，委托实色；端口是方框进边一侧的小记号，单击看实现者与使用者。
          </p>
        </div>
      </div>

      <div class="group">
        <svg viewBox="0 0 120 64" aria-hidden="true">
          <line x1="22" y1="8" x2="22" y2="60" class="life" />
          <line x1="62" y1="8" x2="62" y2="60" class="life" />
          <line x1="102" y1="8" x2="102" y2="60" class="life" />
          <path d="M22 20 L60 20" class="edge" marker-end="url(#g-arrow)" />
          <path d="M62 34 L100 34" class="edge now" marker-end="url(#g-arrow)" />
          <path d="M100 48 L64 48" class="edge ret" marker-end="url(#g-arrow)" />
        </svg>
        <div>
          <h3>运行</h3>
          <p>顶部「运行」选一个场景，交互图变成舞台、旁边出现时序图；逐步前进，每一步都是一次真实的调用或推送，下钻后步骤变细。</p>
        </div>
      </div>

      <div class="group">
        <svg viewBox="0 0 120 64" aria-hidden="true">
          <rect x="6" y="8" width="34" height="14" rx="3" class="node" />
          <rect x="80" y="8" width="34" height="14" rx="3" class="node" />
          <rect x="6" y="42" width="34" height="14" rx="3" class="node" />
          <rect x="80" y="42" width="34" height="14" rx="3" class="node" />
          <path d="M40 15 L80 15" class="edge" />
          <text x="60" y="12" class="mark">未证实</text>
          <path d="M40 49 L80 49" class="edge dep-fact" />
          <text x="60" y="46" class="mark">未解释</text>
          <path d="M23 22 L97 42" class="edge bad" />
        </svg>
        <div>
          <h3>对照与治理</h3>
          <p>
            交互视角下代码事实缺省叠加，只标异常、写在线中点：「未证实」是代码里找不到的关系，「未解释」是代码有而描述没写的依赖（画成依赖的虚线），
            「违规」是基线外新增的违规（红色），↻ 是本层的环；所有问题汇总在导航树「问题」页签，可复制给 agent 返工。
          </p>
        </div>
      </div>

      <div class="group" aria-label="层与节点注记" data-testid="guide-layers">
        <svg viewBox="0 0 120 64" aria-hidden="true">
          <rect x="4" y="4" width="112" height="26" rx="4" class="band" />
          <rect x="4" y="34" width="112" height="26" rx="4" class="band" />
          <rect x="14" y="10" width="40" height="14" rx="3" class="node" />
          <rect x="66" y="40" width="40" height="14" rx="3" class="node" />
          <path d="M34 24 L86 40" class="dep" />
        </svg>
        <div>
          <h3>层</h3>
          <p data-testid="guide-layer-status">
            上依赖下，位置就是方向。层是父模块对子模块的分类，由作者声明（分层总览的带，标「已确认」或「待确认」），不占级；按依赖算出的是「依赖深度」，标「算出」——是证据，不是分层。
            依赖深度与折叠无关：「+N」放在成员最浅的深度，写「深度
            X–Y」，跨三个深度以上提示该标核心或该拆；子模块多于七个又没声明分层时画布角提示；彼此没有依赖也没有交互的层次明说「平铺」。
          </p>
          <p class="sub" data-testid="guide-node-marks">
            <b>节点注记</b>位置固定：名称行是身份（角色、环编号 ↻），上边左是状态（变更、影响面），上边右是端口，下边左是量（入 · 出 ·
            表面），下边右是没画出来的线（共用、另直连），外侧是界外；平时每个节点最多三个，悬停或选中时全部出现。
          </p>
        </div>
      </div>

      <div class="shared" aria-label="三个视角共享">
        <h3>三个视角共享</h3>
        <p>箭头、颜色在三个视角各有含义（看「显示」面板）；下面这些在三个视角意思一样——实线是交互、虚线是依赖，异常写在线中点：</p>
        <ul>
          <li v-for="c in SHARED_CHANNELS" :key="c.key">{{ c.text }}</li>
        </ul>
      </div>

      <p class="foot muted">箭头、颜色与节点样式的完整图例在画布右下角的「显示」面板，随视角整组切换。</p>
    </section>
  </div>
</template>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgb(0 0 0 / 28%);
}

.guide {
  width: min(560px, calc(100vw - 32px));
  max-height: calc(100vh - 48px);
  overflow: auto;
  padding: 16px 20px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: 0 12px 40px rgb(0 0 0 / 18%);
}

header {
  display: flex;
  align-items: center;
}

h2 {
  margin: 0;
  font-size: 16px;
}

.close {
  margin-left: auto;
  border: none;
  background: none;
  font-size: 18px;
}

.group p.sub {
  margin-top: 4px;
}

.questions {
  margin: 0 0 4px;
  padding-left: 18px;
  font-size: 12.5px;
  color: var(--text-2);
}

.socket {
  fill: none;
  stroke: var(--rel-commands, var(--accent));
  stroke-width: 1.5;
}

.edge.query {
  stroke: var(--rel-queries);
  opacity: 0.6;
}

.lead {
  margin: 6px 0 12px;
  font-size: 13px;
  color: var(--text-2);
}

.group {
  display: grid;
  grid-template-columns: 120px 1fr;
  gap: 14px;
  align-items: center;
  padding: 10px 0;
  border-top: 1px solid var(--border);
}

.group h3 {
  margin: 0 0 2px;
  font-size: 13px;
}

.group p {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--text-2);
}

svg {
  width: 120px;
  height: 64px;
}

.band {
  fill: var(--layer-bg);
  stroke: var(--layer-border);
}

.node {
  fill: var(--surface);
  stroke: var(--text-3);
}

.edge {
  fill: none;
  stroke: var(--rel-commands, var(--accent));
  stroke-width: 1.5;
}

.edge.now {
  stroke: var(--accent);
  stroke-width: 2.5;
}

.edge.ret {
  stroke-dasharray: 4 3;
}

.edge.dep-fact {
  stroke: var(--text-3);
  stroke-dasharray: 5 3;
}

.edge.bad {
  stroke: var(--danger);
  stroke-dasharray: 5 3;
}

.head {
  fill: var(--rel-commands, var(--accent));
}

.life {
  stroke: var(--border);
  stroke-dasharray: 3 3;
}

.mark {
  font-size: 7px;
  text-anchor: middle;
  fill: var(--warning);
}

.shared {
  padding: 10px 0 0;
  border-top: 1px solid var(--border);
}

.shared h3 {
  margin: 0 0 2px;
  font-size: 13px;
}

.shared p,
.shared ul {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--text-2);
}

.shared ul {
  padding-left: 18px;
}

.dep {
  fill: none;
  stroke: var(--text-2);
  stroke-width: 1.5;
  stroke-dasharray: 4 3;
}

.dep-head {
  fill: none;
  stroke: var(--text-2);
  stroke-width: 1.5;
}

.tri {
  fill: var(--surface);
  stroke: var(--text-2);
  stroke-width: 1.2;
}

.bar.stable {
  fill: var(--stability-stable);
}

.bar.unstable {
  fill: var(--stability-unstable);
}

.foot {
  margin: 10px 0 0;
  font-size: 12px;
}
</style>
