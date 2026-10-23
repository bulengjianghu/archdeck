/**
 * 草图写回同步（B6、X7i、X19、X20，ADR-0024、ADR-0025）：保存**整个设计**——改过的草图逐张整份写回（含 layout），会话里推出且改过的作为新文件，
 * 级联改名的写到新文件名并删旧文件，删掉的草图一并删；没有关系的引用节点保存前丢弃并提示。经注入的 ModelWriter 发往写入端点。
 * 成功 → 会话 saved（新指纹），文件变化推送回来后按 N5 重新加载；409 → 已过时；422 → 服务端的校验问题交给面板定位。
 * 持久草图只有一张，走单张写回。
 */
import { shallowRef, type ShallowRef } from 'vue'
import { dropOrphanReferences, type DesignEditContext, type SketchDef, type SketchValidationIssue } from '@/model'
import type { DesignSketchWrite, ModelWriter, WriteOutcome } from '../../sync/writer'
import { removedMounts, saved, sketchDirty, type EditSession } from './session'

export type SaveOutcome =
  { ok: true; files: string[]; dropped: { mount: string; ids: string[] }[] } | { ok: false; error: string; conflict?: true; issues?: SketchValidationIssue[] }

export interface SaveRequest {
  sketches: DesignSketchWrite[]
  removed: { mount: string; baseHash: string }[]
  /** X19：保存前丢掉的、没有关系的引用节点 */
  dropped: { mount: string; ids: string[] }[]
}

/** X20：要写的草图——读自文件且改过的（改名的带 renamedFrom）、会话里推出且改过的（baseHash: null）、删掉的；写前丢掉无关系的引用 */
export function saveRequest(s: EditSession, baseline?: DesignEditContext['baseline']): SaveRequest {
  const sketches: DesignSketchWrite[] = []
  const dropped: SaveRequest['dropped'] = []
  for (const [mount, def] of Object.entries(s.doc.sketches)) {
    if (!sketchDirty(s, mount, baseline)) continue
    const clean = dropOrphanReferences(def)
    if (clean.dropped.length) dropped.push({ mount, ids: clean.dropped })
    const o = s.doc.origin[mount]
    sketches.push({
      mount,
      sketch: clean.sketch,
      baseHash: o === undefined ? null : s.read[o].hash,
      ...(o !== undefined && o !== mount ? { renamedFrom: o } : {}),
    })
  }
  const removed = removedMounts(s).map(m => ({ mount: m, baseHash: s.read[m].hash }))
  return { sketches, removed, dropped }
}

export function createSaveSync(writer: ModelWriter, session: ShallowRef<EditSession | null>, baseline: () => DesignEditContext['baseline']) {
  const saving = shallowRef(false)
  /** 最近一次保存的结果说明（成功为文件，失败为原因），信息条显示 */
  const last = shallowRef<SaveOutcome | null>(null)
  /** 服务端校验不过时的问题（422），面板顶部与即时校验一起显示 */
  const serverIssues = shallowRef<SketchValidationIssue[]>([])

  async function save(): Promise<SaveOutcome> {
    const s = session.value
    if (!s) return { ok: false, error: '不在草图里' }
    const req = saveRequest(s, baseline())
    if (!req.sketches.length && !req.removed.length) return { ok: true, files: [], dropped: [] }
    saving.value = true
    try {
      let out: SaveOutcome
      let next: EditSession | null = null
      const sent: Record<string, SketchDef> = Object.fromEntries(req.sketches.map(w => [w.mount, w.sketch]))
      if (s.target.kind === 'persistent') {
        const w = req.sketches[0]
        const r = await writer.saveSketch({ target: s.target, sketch: w.sketch, baseHash: w.baseHash ?? '' })
        out = r.ok ? { ok: true, files: [r.file], dropped: req.dropped } : r
        if (r.ok) next = saved(s, sent, { [w.mount]: { file: s.read[w.mount]?.file ?? `intent/${s.target.id}.yaml`, hash: r.hash } })
      } else {
        const r = await writer.saveDesignSketches({ design: s.target.design, sketches: req.sketches, ...(req.removed.length ? { removed: req.removed } : {}) })
        out = r.ok ? { ok: true, files: r.files.map(f => f.file), dropped: req.dropped } : r
        if (r.ok) next = saved(s, sent, Object.fromEntries(r.files.map(f => [f.mount, { file: `sketches/${f.mount}.yaml`, hash: f.hash }])))
      }
      // 保存期间会话可能已继续编辑：只认保存时的那份；之后的步骤留在撤销栈里（基于新读取）
      if (next && session.value)
        session.value = session.value === s ? next : { ...session.value, read: next.read, doc: { ...session.value.doc, origin: next.doc.origin } }
      if (!out.ok && out.conflict && session.value) session.value = { ...session.value, stale: true }
      serverIssues.value = out.ok ? [] : (out.issues ?? [])
      last.value = out
      return out
    } finally {
      saving.value = false
    }
  }

  function createDesign(input: { id: string; name: string; goal?: string; mount: string }): Promise<WriteOutcome> {
    return writer.createDesign(input)
  }

  return { saving, last, serverIssues, save, createDesign }
}
