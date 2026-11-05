/**
 * 对话一轮的接入（DA-11，T1.1 / T1.2）：POST /agent/<项目>/turn 与 /agent/<项目>/stop 的处理。
 * 一轮 = 读描述 → 模型层构造上下文包（锚点、题解、骨架字段、代码事实摘要、可用查询、讲法要求）→ 贴图落到临时目录 → 起子进程；
 * 输出经推送通道（`arch-agent:event`）流到页面。设计里的对话按设计落盘（designs/<设计>/dialogue/，AI 拥有、不登记指纹），
 * 当前版本上的对话不落盘（DA-1）。重讲的收尾交给 writeExplainer（DL-8）。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  buildContextPack,
  editLock,
  loadModel,
  packPrompt,
  type AgentBlock,
  type Anchor,
  type CodeFactsSummary,
  type DialogueMode,
  type SketchContext,
} from '../src/model'
import type { AgentRunner, DialogueEvent } from './agentProcess'
import { readProject } from './readModelDir'
import { readSourceTree } from './readSource'
import { applyRenarrate, readNotes } from './writeExplainer'

export const AGENT_EVENT = 'arch-agent:event'

export interface TurnBody {
  /** 对话会话（页面）的编号 */
  session: string
  turn: string
  mode: DialogueMode
  anchor: Anchor
  text: string
  images?: { name: string; type: string; dataUrl: string }[]
  design?: string
  /** 改（DA-6）：草图里的上下文，页面从编辑会话构造（DL-14） */
  sketch?: SketchContext
}

export class TurnInvalid extends Error {}

/** 贴图上限：每张 5 MB，一轮至多 4 张（只收图片） */
export const IMAGE_LIMIT = { bytes: 5 * 1024 * 1024, count: 4 }
const IMAGE_EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }

function validBody(b: Partial<TurnBody>): TurnBody {
  if (!b || typeof b.turn !== 'string' || !/^[\w-]{1,60}$/.test(b.turn)) throw new TurnInvalid('缺轮次编号')
  if (typeof b.session !== 'string' || !/^[\w-]{1,40}$/.test(b.session)) throw new TurnInvalid('缺对话会话编号')
  if (b.mode !== 'ask' && b.mode !== 'renarrate' && b.mode !== 'edit') throw new TurnInvalid('mode 只能是 ask / renarrate / edit')
  if (typeof b.text !== 'string') throw new TurnInvalid('缺 text')
  const a = b.anchor as Anchor | undefined
  if (!a || !['module', 'step', 'none'].includes(a.kind)) throw new TurnInvalid('缺锚点')
  if (b.mode === 'renarrate' && a.kind !== 'module') throw new TurnInvalid('重讲要锚在一个模块上')
  if ((b.images?.length ?? 0) > IMAGE_LIMIT.count) throw new TurnInvalid(`一轮至多 ${IMAGE_LIMIT.count} 张图`)
  if (b.design !== undefined && !/^[\w.-]+$/.test(b.design)) throw new TurnInvalid('设计名不合法')
  // DA-2、DA-6：改只在设计的草图里，且总带着草图上下文
  if (b.mode === 'edit' && (!b.design || !b.sketch || typeof b.sketch !== 'object' || typeof b.sketch.mount !== 'string'))
    throw new TurnInvalid('改要在设计的草图里发，并带草图上下文')
  return b as TurnBody
}

/** 贴图：data URL → 文件（设计里落到设计目录随设计归档，否则临时目录）；返回包里的图片清单与要额外放行的目录 */
function saveImages(images: TurnBody['images'], dir: string) {
  const out: { name: string; path: string; mediaType: string }[] = []
  for (const [i, img] of (images ?? []).entries()) {
    const m = /^data:([\w/+.-]+);base64,(.*)$/s.exec(img.dataUrl)
    const ext = m ? IMAGE_EXT[m[1]] : undefined
    if (!m || !ext) throw new TurnInvalid(`第 ${i + 1} 张不是图片`)
    const bytes = Buffer.from(m[2], 'base64')
    if (bytes.length > IMAGE_LIMIT.bytes) throw new TurnInvalid(`第 ${i + 1} 张超过 5 MB`)
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, `${String(i + 1).padStart(2, '0')}.${ext}`)
    fs.writeFileSync(file, bytes)
    out.push({ name: img.name || path.basename(file), path: file, mediaType: m[1] })
  }
  return out
}

export interface TurnContext {
  modelRoot: string
  root: string
  runner: AgentRunner
  /** 代码事实摘要（架构治理；读不到为 null） */
  facts?: (project: string, module: string) => Promise<CodeFactsSummary | null>
}

export async function startTurn(
  ctx: TurnContext,
  project: string,
  raw: unknown,
): Promise<{ ok: true; turn: string } | { ok: false; error: string; status: number }> {
  let body: TurnBody
  try {
    body = validBody(raw as Partial<TurnBody>)
  } catch (e) {
    return { ok: false, error: (e as Error).message, status: 400 }
  }
  const payload = readProject(ctx.modelRoot, project, ctx.root)
  if (!payload) return { ok: false, error: `项目不存在：${project}`, status: 404 }
  const designDir = body.design ? path.join(ctx.modelRoot, project, 'designs', body.design) : null
  if (designDir && !fs.existsSync(designDir)) return { ok: false, error: `设计不存在：${body.design}`, status: 404 }
  // DL-34：已认可 / 已实现 / 已放弃的设计里不能「改」（服务端兜底，页面同口径）
  const lock = body.mode === 'edit' ? editLock(payload.designs?.find(d => d.id === body.design)?.status) : null
  if (lock) return { ok: false, error: lock, status: 409 }
  const { index } = loadModel(payload.files)
  const a = body.anchor
  // 草图里的锚点可以是草图里才有的模块（DA-2），不按当前版本查
  if (!body.sketch && a.kind === 'module' && a.module !== index.rootId && !index.modules.has(a.module))
    return { ok: false, error: `模块不存在：${a.module}`, status: 400 }

  const imgDir = designDir
    ? path.join(designDir, 'dialogue', 'photos', body.turn)
    : path.join(os.tmpdir(), 'arch-agent', `${project}-${body.turn}-${process.pid}`)
  let images: ReturnType<typeof saveImages>
  try {
    images = saveImages(body.images, imgDir)
  } catch (e) {
    return { ok: false, error: (e as Error).message, status: 400 }
  }
  const facts = a.kind === 'module' && ctx.facts ? await ctx.facts(project, a.module).catch(() => null) : null
  const pack = buildContextPack(index, {
    project,
    anchor: a,
    mode: body.mode,
    text: body.text,
    images,
    facts,
    ...(body.mode === 'renarrate' && a.kind === 'module' ? { notes: readNotes(ctx.modelRoot, project, a.module) } : {}),
    ...(body.mode === 'edit' && body.sketch ? { sketch: body.sketch } : {}),
  })
  const tree = readSourceTree(ctx.modelRoot, project, ctx.root)
  const cwd = tree?.status === 'local' ? tree.root : ctx.root
  const transcript = designDir ? path.join(designDir, 'dialogue', 'transcript.jsonl') : null
  const started = ctx.runner.start({
    project,
    session: body.session,
    turn: body.turn,
    pack,
    promptText: packPrompt(pack),
    cwd,
    addDirs: images.length ? [imgDir] : [],
    finish:
      body.mode === 'renarrate' && a.kind === 'module'
        ? async (blocks: AgentBlock[]) => {
            const b = blocks.find(x => x.kind === 'renarrate')
            if (!b || b.kind !== 'renarrate') return { applied: false, reasons: ['没有产出重讲块'] }
            return applyRenarrate(ctx.modelRoot, project, ctx.root, a.module, b)
          }
        : undefined,
    // 设计里的对话随设计落盘（一轮一行）；当前版本上的不落
    settled: transcript
      ? (e: DialogueEvent) => {
          fs.mkdirSync(path.dirname(transcript), { recursive: true })
          const request = { mode: body.mode, anchor: a, text: body.text, images: images.map(i => path.relative(designDir!, i.path)) }
          fs.appendFileSync(transcript, `${JSON.stringify({ at: new Date().toISOString(), turn: body.turn, request, result: e })}\n`)
        }
      : undefined,
  })
  return started.ok ? { ok: true, turn: body.turn } : { ok: false, error: started.error, status: 409 }
}
