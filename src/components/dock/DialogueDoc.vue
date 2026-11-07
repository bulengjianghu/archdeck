<script setup lang="ts">
/**
 * 对话标签（DA-1–DA-5、DA-7，第二十一轮波 1）：辅助栏的常驻「对话」。
 * 锚点条粘顶（下一句话带着哪个模块 / 哪一步）；转录里每条带当时的锚点、单击定位；问答卡的引用由架构台按 {模块, 字段} 填原文、单击定位，
 * 推断段标「推断」；梳理卡与照片并排、四组、不确定标记；重讲的结果卡（落了 / 被拒的原因）；AI 回合中的状态提示与停止；
 * 输入框钉在底部：「只问」/「重讲」、贴图（粘贴或选文件）。只读对话会话、只发意图（desk.dialogue）。
 * 草图里（波 2，DA-6–DA-10）：「改 / 问」切换（「可改」/「只问」徽标）；AI 改完一轮出提议卡（动了哪几个号、牵动谁「按当前描述估」、撤回本轮）；
 * 梳理卡旁「按这张图起草」；问答卡「存为设计说明」。
 * 机制图（波 4 T4.0，DL-40–DL-43）：回答里的图块由 DiagramBlock 内联显示（被拒的只出原因），存为设计说明时随文字一起存。
 */
import { computed, nextTick, ref, watch } from 'vue'
import { useDesk } from '@/state/inject'
import type { CiteView, DialogueEntry, ImageAttachment } from '@/state/desk/dialogue'
import DiagramBlock from './DiagramBlock.vue'
import ProposalCard from './ProposalCard.vue'

// 呈现层只依赖视图状态层与类型契约（rules.yaml）：对话的块、锚点、引用的类型从会话条目推出，不直引模型层
type Anchor = DialogueEntry['anchor']
type AgentBlock = Extract<DialogueEntry, { role: 'agent' }>['blocks'][number]
type Citation = CiteView['cite']

const desk = useDesk()
const dlg = desk.dialogue
const s = computed(() => dlg.state.value)
const running = computed(() => s.value.run.status === 'running')
const isModule = computed(() => s.value.anchor.kind === 'module')
/** 草图画布里：「改 / 问」；当前版本上：「问 / 重讲」（DL-19） */
const inSketch = computed(() => s.value.perspective === 'sketch')
const mode = computed(() => (inSketch.value ? s.value.mode : isModule.value ? s.value.mode : 'ask'))
const BADGE = { ask: '只问', renarrate: '只动讲法', edit: '可改' } as const
type Outcome = NonNullable<Extract<DialogueEntry, { role: 'agent' }>['outcome']>
const proposal = (o: Outcome | undefined) => (o && 'kind' in o && o.kind === 'proposal' ? o : null)
const renarrated = (o: Outcome | undefined) => (o && !('kind' in o) ? o : null)
/** DL-51：恢复的「改」一轮没有补记提议卡结果（收尾 S3 之前落盘的）、有改动块时的一句话 */
const restoredEdit = (e: Extract<DialogueEntry, { role: 'agent' }>): string | null => {
  if (e.outcome) return null
  const b = e.blocks.find(x => x.kind === 'edit')
  return b && b.kind === 'edit' ? (b.summary ?? '这一轮的改动') : null
}
const notesCount = (o: Outcome | undefined) => {
  const r = renarrated(o)
  return r?.applied ? r.notes.length : 0
}
const reasonsOf = (o: Outcome | undefined) => {
  const r = renarrated(o)
  return r && !r.applied ? r.reasons : []
}
/** DA-10：存为设计说明——问答卡的段落连同引用原文存成一份 Markdown */
const saved = ref<Record<string, string>>({})
async function saveNote(e: Extract<DialogueEntry, { role: 'agent' }>, k: number) {
  const b = e.blocks[k]
  if (b.kind !== 'answer') return
  const ask = [...s.value.transcript.slice(0, s.value.transcript.indexOf(e))].reverse().find(x => x.role === 'user')
  const title = (ask?.role === 'user' ? ask.input.text : '').trim().split('\n')[0].slice(0, 40) || '设计说明'
  const text = b.parts
    .map(
      p =>
        `${p.inferred ? '（推断）' : ''}${p.text}${citeViews(p.cites)
          .map(c => (c.ok ? `\n> ${c.name}：${c.text}` : ''))
          .join('')}`,
    )
    .join('\n\n')
  // DL-43：这条回答里通过检查的图块按次序接在正文后
  const withDiagrams = [text, ...dlg.diagramFences(e)].join('\n\n')
  const r = await desk.notes.save({ title, text: withDiagrams, ...(e.anchor.kind === 'module' ? { module: e.anchor.module } : {}) })
  saved.value = { ...saved.value, [`${e.id}:${k}`]: r.ok ? '已存为设计说明' : `没存成：${r.error}` }
}

const anchorLabel = (a: Anchor) => dlg.anchorText(a)
const anchorKind = (a: Anchor) => (a.kind === 'module' ? '模块' : a.kind === 'step' ? '步骤' : '系统')

/** DA-2：单击锚点定位——模块在画布上选中；步骤打开场景并走到那一步 */
function locate(a: Anchor) {
  if (a.kind === 'module') desk.revealModule(a.module)
  else if (a.kind === 'step') {
    if (desk.playback.value?.scenarioId !== a.scenario) desk.openScenario(a.scenario)
    desk.seek(a.frame)
  }
}

/** DA-3：引用单击定位——题解打开题解，其余在画布上选中模块 */
function openCite(c: Citation) {
  if (c.field === 'explainer') desk.readExplainer(c.module)
  else desk.revealModule(c.module)
}
/** 引用的原文由架构台填（DL-13）；解析不了的标「引用无效」 */
const citeViews = (list: Citation[] | undefined) => dlg.citeViews(list)

const digest = (b: AgentBlock) => dlg.digest(b)
/** DA-7：梳理卡旁边并排的照片 = 发问那一条贴的图 */
function photosBefore(i: number): ImageAttachment[] {
  for (let k = i - 1; k >= 0; k--) {
    const e = s.value.transcript[k]
    if (e.role === 'user') return e.input.images
  }
  return []
}
const hasDigest = (e: DialogueEntry) => e.role === 'agent' && e.blocks.some(b => b.kind === 'digest')

// ── 输入：草稿在会话里（停止时退回的排队输入也回到这里）；图片只在组件里，发出去才进会话 ──
const draft = computed({ get: () => s.value.draft, set: v => dlg.dispatch({ type: 'setDraft', text: v }) })
const images = ref<ImageAttachment[]>([])
const fileInput = ref<HTMLInputElement | null>(null)
const readImage = (f: File) =>
  new Promise<ImageAttachment>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve({ name: f.name || 'image.png', type: f.type, dataUrl: String(r.result) })
    r.onerror = () => reject(r.error)
    r.readAsDataURL(f)
  })
async function addFiles(list: FileList | File[] | null) {
  const files = [...(list ?? [])].filter(f => f.type.startsWith('image/')).slice(0, 4 - images.value.length)
  images.value = [...images.value, ...(await Promise.all(files.map(readImage)))]
}
function onPaste(e: ClipboardEvent) {
  const files = [...(e.clipboardData?.files ?? [])].filter(f => f.type.startsWith('image/'))
  if (!files.length) return
  e.preventDefault()
  void addFiles(files)
}
function send() {
  const text = draft.value
  if (!text.trim() && !images.value.length) return
  dlg.send({ text, mode: mode.value, images: images.value })
  images.value = []
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    send()
  }
}

// 新条目或流式片段到了，转录滚到底
const log = ref<HTMLElement | null>(null)
watch(
  () => [s.value.transcript.length, s.value.run.status === 'running' ? s.value.run.live.length : -1],
  () => void nextTick(() => log.value && (log.value.scrollTop = log.value.scrollHeight)),
)
const STOP_TEXT = { stopped: '已停止：这一轮什么都没落', timeout: '超时，视同停止：这一轮什么都没落' }
</script>

<template>
  <div class="dialogue" data-testid="dialogue">
    <!-- DA-2：锚点条粘顶 -->
    <header class="anchor-bar" data-testid="anchor-bar">
      <span class="lbl">锚点</span>
      <button class="link anchor" :title="`定位到${anchorLabel(s.anchor)}`" :disabled="s.anchor.kind === 'none'" @click="locate(s.anchor)">
        <span class="kind">{{ anchorKind(s.anchor) }}</span
        >{{ anchorLabel(s.anchor) }}
      </button>
    </header>

    <div ref="log" class="log" data-testid="dialogue-log">
      <p v-if="!s.transcript.length && !running" class="empty">
        问这个系统：为什么这样分、改它牵动谁、这条线为什么是通知……答案引用描述原文，单击定位。<br />对题解不满意，切到「重讲」说怎么讲。
      </p>
      <template v-for="(e, i) in s.transcript" :key="e.id">
        <div v-if="e.role === 'user'" class="msg user" data-testid="msg-user">
          <button class="link at" :title="`当时的锚点：${anchorLabel(e.anchor)}，单击定位`" @click="locate(e.anchor)">@{{ anchorLabel(e.anchor) }}</button>
          <span v-if="e.input.mode === 'renarrate'" class="tag">重讲</span>
          <span v-else-if="e.input.mode === 'edit'" class="tag">改</span>
          <p class="text">{{ e.input.text }}</p>
          <div v-if="e.input.images.length && !hasDigest(s.transcript[i + 1] ?? e)" class="thumbs">
            <img v-for="(img, k) in e.input.images" :key="k" :src="img.dataUrl" :alt="img.name" />
          </div>
        </div>
        <div v-else-if="e.role === 'agent'" class="msg agent" data-testid="msg-agent">
          <template v-for="(b, k) in e.blocks" :key="k">
            <!-- DA-3：问答卡 -->
            <div v-if="b.kind === 'answer'" class="card answer" data-testid="answer-card">
              <p v-for="(p, j) in b.parts" :key="j" class="part" :class="{ inferred: p.inferred }">
                <span v-if="p.inferred" class="tag infer" data-testid="inferred">推断</span>{{ p.text }}
                <template v-for="(cv, n) in citeViews(p.cites)" :key="n">
                  <button v-if="cv.ok" class="cite" data-testid="cite" :data-module="cv.module" :title="`${cv.name} · 单击定位`" @click="openCite(cv.cite)">
                    「{{ cv.text }}」<span class="src">{{ cv.name }}</span>
                  </button>
                  <span v-else class="cite bad" data-testid="cite-bad" :title="cv.reason">引用无效</span>
                </template>
              </p>
              <p v-if="inSketch && desk.notes.design" class="card-actions">
                <span v-if="saved[`${e.id}:${k}`]" class="muted" data-testid="note-saved">{{ saved[`${e.id}:${k}`] }}</span>
                <button v-else class="link" data-testid="save-note" title="存为设计说明：挂在设计下，标「目标态 · 未实现」" @click="saveNote(e, k)">
                  存为设计说明 ›
                </button>
              </p>
            </div>
            <!-- DL-42：机制图（被拒的只出原因，文字照常） -->
            <DiagramBlock v-else-if="b.kind === 'diagram' && dlg.diagram(e, k)" :view="dlg.diagram(e, k)!" />
            <!-- DA-7：梳理卡与照片并排 -->
            <div v-else-if="b.kind === 'digest' && digest(b)" class="digest-row" data-testid="digest">
              <div v-if="photosBefore(i).length" class="photos">
                <img v-for="(img, n) in photosBefore(i)" :key="n" :src="img.dataUrl" :alt="img.name" data-testid="digest-photo" />
              </div>
              <div class="card digest">
                <p class="head">
                  梳理卡 · {{ digest(b)!.total }} 项<template v-if="digest(b)!.uncertain"> · {{ digest(b)!.uncertain }} 项不确定</template>
                </p>
                <section v-for="g in digest(b)!.groups" :key="g.key" class="grp" :data-group="g.key">
                  <h4 :title="g.hint">
                    {{ g.title }} <span class="n">{{ g.items.length }}</span>
                  </h4>
                  <ul>
                    <li v-for="(it, n) in g.items" :key="n">
                      {{ it.label }}
                      <template v-if="it.modules.length"
                        >→
                        <template v-for="m in it.modules" :key="m.id"
                          ><button v-if="m.known" class="link" :data-ref-module="m.id" @click="desk.revealModule(m.id)">{{ m.name }}</button
                          ><span v-else class="muted">{{ m.id }}</span>
                        </template></template
                      >
                      <span v-if="it.note" class="muted">· {{ it.note }}</span>
                      <span v-if="it.uncertain" class="tag unsure" data-testid="uncertain">不确定</span>
                    </li>
                  </ul>
                </section>
                <p v-if="inSketch" class="card-actions">
                  <button
                    class="link"
                    data-testid="draft-from-digest"
                    :disabled="running"
                    title="按这张图起草：一键变成一轮提议，可撤回"
                    @click="dlg.draftFromDigest(e.id)"
                  >
                    按这张图起草 ›
                  </button>
                </p>
              </div>
            </div>
          </template>
          <!-- DA-8：提议卡 -->
          <ProposalCard v-if="proposal(e.outcome)" :outcome="proposal(e.outcome)!" :busy="running" :restored="!!e.restored" />
          <!-- DL-51：从设计目录恢复的「改」一轮没有补记提议卡结果时（收尾 S3 之前落盘的）——只给一句话，号与撤回看「改动」页签 -->
          <p v-else-if="restoredEdit(e)" class="card restored" data-testid="restored-edit">
            改动（已随设计保存）· {{ restoredEdit(e) }} <span class="muted">· 号与撤回见「改动」页签</span>
          </p>
          <!-- DA-4：重讲的结果 -->
          <div v-else-if="renarrated(e.outcome)" class="card outcome" :class="{ rejected: !renarrated(e.outcome)!.applied }" data-testid="renarrate-outcome">
            <template v-if="renarrated(e.outcome)!.applied">
              题解已按要求重讲，依据已盖 · 讲法要求 {{ notesCount(e.outcome) }} 条
              <button v-if="e.anchor.kind === 'module'" class="link" @click="desk.readExplainer(e.anchor.module)">看题解 ›</button>
            </template>
            <template v-else>
              重讲被拒，什么都没写：
              <ul>
                <li v-for="(r, n) in reasonsOf(e.outcome)" :key="n">{{ r }}</li>
              </ul>
            </template>
          </div>
          <p v-if="!e.blocks.length && e.text" class="text plain">{{ e.text }}</p>
        </div>
        <div v-else-if="e.role === 'error'" class="msg error" data-testid="msg-error">{{ e.message }}（会话与描述不受影响，可重发）</div>
        <div v-else class="msg stopped" data-testid="msg-stopped">{{ STOP_TEXT[e.reason] }}</div>
      </template>
      <div v-if="s.run.status === 'running'" class="msg live" data-testid="msg-live">
        <span class="spin" aria-hidden="true" />AI 正在{{ s.run.mode === 'renarrate' ? '重讲' : s.run.mode === 'edit' ? '修改' : '回答' }}…
        <span v-if="s.queue.length" class="muted">（排队 {{ s.queue.length }} 条）</span>
        <p v-if="s.run.live" class="text plain">{{ s.run.live }}</p>
      </div>
    </div>

    <!-- DA-1：输入框钉在辅助栏底部 -->
    <footer class="input" @paste="onPaste">
      <div class="modes">
        <template v-if="inSketch">
          <button
            class="seg"
            :class="{ on: mode === 'edit' }"
            :disabled="!!s.lock"
            data-testid="mode-edit"
            :title="s.lock ?? '改：说想法，AI 改草图（一轮一步，可撤回）'"
            @click="dlg.dispatch({ type: 'setMode', mode: 'edit' })"
          >
            改
          </button>
          <button class="seg" :class="{ on: mode === 'ask' }" title="问：只回答，不改草图" @click="dlg.dispatch({ type: 'setMode', mode: 'ask' })">问</button>
        </template>
        <template v-else>
          <button class="seg" :class="{ on: mode === 'ask' }" @click="dlg.dispatch({ type: 'setMode', mode: 'ask' })">问</button>
          <button
            class="seg"
            :class="{ on: mode === 'renarrate' }"
            :disabled="!isModule"
            :title="isModule ? '重讲：按你的意见重新生成这个模块的题解（只动讲法不动事实）' : '重讲要先选中一个模块'"
            @click="dlg.dispatch({ type: 'setMode', mode: 'renarrate' })"
          >
            重讲
          </button>
        </template>
        <span class="badge" data-testid="mode-badge">{{ BADGE[mode] }}</span>
        <!-- DL-34：设计已认可 / 已实现 / 已放弃时只能问 -->
        <span v-if="inSketch && s.lock" class="lock-note" data-testid="dialogue-lock">{{ s.lock }}</span>
        <span class="sp" />
        <button v-if="running" class="stop" data-testid="dialogue-stop" title="停止：终止这一轮，什么都不落" @click="dlg.stop()">■ 停止</button>
      </div>
      <div v-if="images.length" class="pending">
        <span v-for="(img, k) in images" :key="k" class="pimg">
          <img :src="img.dataUrl" :alt="img.name" /><button class="x" :aria-label="`去掉 ${img.name}`" @click="images.splice(k, 1)">×</button>
        </span>
      </div>
      <div class="row">
        <textarea
          v-model="draft"
          rows="2"
          :placeholder="
            mode === 'edit'
              ? '说想法，AI 改草图…（「撤回 #3」也行；Enter 发送，可粘贴白板照片）'
              : mode === 'ask'
                ? '问这个系统…（Enter 发送，Shift+Enter 换行，可粘贴图片）'
                : '说说这张图 / 这段讲法要怎么改…'
          "
          aria-label="对话输入"
          @keydown="onKey"
        />
        <div class="btns">
          <button class="ib" title="贴图：选择图片文件" aria-label="贴图" @click="fileInput?.click()">⎙</button>
          <input
            ref="fileInput"
            type="file"
            accept="image/*"
            multiple
            hidden
            data-testid="dialogue-file"
            @change="addFiles(($event.target as HTMLInputElement).files)"
          />
          <button class="send" :disabled="!draft.trim() && !images.length" @click="send">{{ running ? '排队' : '发送' }}</button>
        </div>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.card.restored {
  font-size: 12px;
}

.lock-note {
  font-size: 11.5px;
  color: var(--text-3);
}

.card-actions {
  margin: 6px 0 0;
  display: flex;
  gap: 10px;
  align-items: center;
  font-size: 12px;
}

.dialogue {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  font-size: 13px;
}

.anchor-bar {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  flex: none;
}

.anchor-bar .lbl {
  color: var(--text-3);
  font-size: 12px;
}

.anchor {
  font-weight: 600;
}

.anchor .kind {
  margin-right: 6px;
  padding: 0 6px;
  border-radius: 8px;
  font-size: 11px;
  font-weight: 400;
  background: var(--accent-soft);
  color: var(--accent);
}

.log {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.empty {
  margin: 20px 4px;
  color: var(--text-3);
  font-size: 12.5px;
  line-height: 1.7;
}

.msg .text {
  margin: 2px 0 0;
  white-space: pre-wrap;
}

.msg.user {
  align-self: flex-end;
  max-width: 92%;
  padding: 6px 10px;
  border-radius: 10px;
  background: var(--accent-soft);
}

.msg .at {
  font-size: 11.5px;
  color: var(--text-3);
}

.tag {
  display: inline-block;
  margin: 0 6px 0 0;
  padding: 0 6px;
  border-radius: 8px;
  font-size: 11px;
  background: var(--surface-2);
  color: var(--text-2);
  border: 1px solid var(--border);
}

.tag.infer,
.tag.unsure {
  color: var(--warning);
  background: var(--warning-soft);
  border-color: transparent;
}

.card {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 10px;
  background: var(--bg);
}

.part {
  margin: 0 0 6px;
  line-height: 1.6;
}

.part.inferred {
  color: var(--text-2);
}

.cite {
  display: inline;
  margin: 0 2px;
  padding: 0 4px;
  border: none;
  border-bottom: 1px dashed var(--accent);
  background: none;
  color: var(--text);
  font: inherit;
  cursor: pointer;
  text-align: left;
}

.cite .src {
  margin-left: 4px;
  font-size: 11px;
  color: var(--accent);
}

.cite.bad {
  color: var(--text-3);
  text-decoration: line-through;
  cursor: help;
}

.digest-row {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(0, 3fr);
  gap: 8px;
  align-items: start;
}

.photos img,
.thumbs img,
.pimg img {
  display: block;
  max-width: 100%;
  border-radius: 6px;
  border: 1px solid var(--border);
}

.thumbs {
  display: flex;
  gap: 4px;
  margin-top: 4px;
}

.thumbs img {
  max-height: 80px;
}

.digest .head {
  margin: 0 0 4px;
  font-weight: 600;
}

.grp h4 {
  margin: 6px 0 2px;
  font-size: 12px;
}

.grp .n {
  color: var(--text-3);
  font-weight: 400;
}

.grp ul {
  margin: 0;
  padding-left: 16px;
}

.muted {
  color: var(--text-3);
}

.outcome.rejected {
  border-color: var(--warning);
}

.msg.error {
  color: var(--danger, var(--warning));
  font-size: 12.5px;
}

.msg.stopped {
  color: var(--text-3);
  font-size: 12px;
}

.msg.live {
  color: var(--text-2);
}

.spin {
  display: inline-block;
  width: 9px;
  height: 9px;
  margin-right: 6px;
  border-radius: 50%;
  border: 2px solid var(--accent);
  border-right-color: transparent;
  animation: spin 0.9s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.input {
  flex: none;
  border-top: 1px solid var(--border);
  padding: 6px 10px 8px;
  background: var(--surface);
}

.modes {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 4px;
}

.seg {
  padding: 1px 10px;
  font-size: 12px;
}

.seg.on {
  background: var(--accent-soft);
  color: var(--accent);
  border-color: var(--accent);
}

.badge {
  margin-left: 4px;
  padding: 0 7px;
  border-radius: 10px;
  font-size: 11px;
  background: var(--surface-2);
  color: var(--text-2);
  border: 1px solid var(--border);
}

.sp {
  flex: 1;
}

.stop {
  font-size: 12px;
  color: var(--warning);
}

.pending {
  display: flex;
  gap: 6px;
  margin-bottom: 4px;
}

.pimg {
  position: relative;
}

.pimg img {
  height: 48px;
}

.pimg .x {
  position: absolute;
  top: -6px;
  right: -6px;
  width: 18px;
  height: 18px;
  padding: 0;
  border-radius: 50%;
  font-size: 11px;
  line-height: 1;
}

.row {
  display: flex;
  gap: 6px;
  align-items: flex-end;
}

.row textarea {
  flex: 1;
  resize: none;
  font: inherit;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--text);
}

.btns {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ib {
  width: 30px;
  height: 26px;
  padding: 0;
}
</style>
