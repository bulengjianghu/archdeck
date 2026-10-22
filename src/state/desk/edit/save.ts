/**
 * 草图写回同步（B6、X7i，ADR-0024）：保存与新建设计经注入的 ModelWriter（与描述写入同一个 HTTP 来源）发往写入端点。
 * 成功 → 会话 saved，文件变化推送回来后按 N5 重新加载；409 → 已过时；422 → 服务端的校验问题交给面板定位。保存成功后停留在编辑态。
 */
import { shallowRef, type ShallowRef } from 'vue'
import type { SketchDef, SketchValidationIssue } from '@/model'
import type { ModelWriter, WriteOutcome } from '../../sync/writer'
import { saved, type EditSession } from './session'

export type SaveOutcome = { ok: true } | { ok: false; error: string; conflict?: true; issues?: SketchValidationIssue[] }

export function createSaveSync(writer: ModelWriter, session: ShallowRef<EditSession | null>) {
  const saving = shallowRef(false)
  /** 最近一次保存的结果说明（成功为文件，失败为原因），信息条显示 */
  const last = shallowRef<SaveOutcome | null>(null)
  /** 服务端校验不过时的问题（422），面板顶部与即时校验一起显示 */
  const serverIssues = shallowRef<SketchValidationIssue[]>([])

  async function save(): Promise<SaveOutcome> {
    const s = session.value
    if (!s) return { ok: false, error: '不在编辑态' }
    saving.value = true
    try {
      const r = await writer.saveSketch({ target: s.target, sketch: s.draft, baseHash: s.base.hash })
      const out: SaveOutcome = r.ok ? { ok: true } : r
      // 保存期间会话可能已继续编辑：只认保存时的那份草图
      if (r.ok && session.value)
        session.value = session.value.draft === s.draft ? saved(session.value, r.hash) : { ...session.value, base: { sketch: s.draft, hash: r.hash } }
      if (!r.ok && r.conflict && session.value) session.value = { ...session.value, stale: true }
      serverIssues.value = r.ok ? [] : (r.issues ?? [])
      last.value = out
      return out
    } finally {
      saving.value = false
    }
  }

  function createDesign(input: { id: string; name: string; goal?: string; sketch: SketchDef }): Promise<WriteOutcome> {
    return writer.createDesign(input)
  }

  return { saving, last, serverIssues, save, createDesign }
}
