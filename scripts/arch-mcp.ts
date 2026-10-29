/**
 * agent 接口的 MCP 外壳（AG-2，docs/architecture/governance.md §5）：stdio 传输，stdout 只留给协议，日志写 stderr。
 *   npm run -s arch:mcp
 * 工具与命令行一一对应（不含生成基线，Q5）；check_dependency 与 rescan 写拦截记录（Q4）。
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { REWORK_CATEGORIES, type ReworkCategory } from '../src/model'
import { ServiceError, createService } from './agent/service'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const svc = createService({ root, client: 'mcp' })
const server = new McpServer({ name: 'h5p-arch-desk', version: '0.1.0' })

const project = z.string().optional().describe('项目 ID；缺省为环境变量 ARCH_PROJECT 或唯一项目')

/** 统一把结果或错误包成 MCP 内容 */
function reply(fn: () => unknown) {
  try {
    return { content: [{ type: 'text' as const, text: JSON.stringify(fn(), null, 2) }] }
  } catch (e) {
    return { isError: true, content: [{ type: 'text' as const, text: e instanceof ServiceError ? e.message : String(e) }] }
  }
}

server.registerTool('list_projects', { title: '列出项目', description: '架构台中的项目及其源码是否在本地。', inputSchema: {} }, () =>
  reply(() => svc.projects()),
)

server.registerTool(
  'overview',
  {
    title: '架构治理概览',
    description: '规模、关系的证实情况、未解释的交互、违规（新增 / 已知）、环度与基线。开始一项改动前先看一眼。',
    inputSchema: { project },
  },
  ({ project }) => reply(() => svc.overview(project)),
)

server.registerTool(
  'locate',
  {
    title: '定位文件或模块',
    description:
      '给出文件或模块 ID 所属的模块、从顶层起每一级的职责、对它生效的架构规则（可依赖哪些模块、外部必须经由哪些文件访问它）、接口签名、出入关系与违规。写代码前用它了解「这里该做什么、能依赖谁」。',
    inputSchema: { target: z.string().describe('相对源码根目录的文件路径，或模块 ID'), project },
  },
  ({ target, project }) => reply(() => svc.locate(target, project)),
)

server.registerTool(
  'check_dependency',
  {
    title: '写前判定一条依赖',
    description:
      '在写下 import 之前询问是否允许：from 为源码文件或模块 ID，to 为模块 ID、源码文件，或从 from 文件出发的导入说明符（如 "../state/inject"、"@h5player/framework"）；names 为命名导入的名称（用于穿透 barrel 找到真正的声明文件）。返回 allowed / denied / unconstrained、违反的规则与理由、是否会形成或扩大模块环、是否已有关系覆盖，以及目标模块的职责、访问面与接口签名。denied 时不要写这条依赖，按理由改走允许的模块或入口；确需例外请交给架构师。',
    inputSchema: {
      from: z.string(),
      to: z.string(),
      names: z.array(z.string()).optional(),
      project,
    },
  },
  ({ from, to, names, project }) => reply(() => svc.check(from, to, project, names ?? [])),
)

server.registerTool(
  'list_violations',
  {
    title: '列出违规',
    description: '违反架构规则的模块依赖，带基线状态（new 为新增、会让门禁失败；known 为基线内存量；allowed 为已豁免）与文件证据。',
    inputSchema: { onlyNew: z.boolean().optional().describe('只列新增违规'), project },
  },
  ({ onlyNew, project }) => reply(() => svc.violations(project, onlyNew ?? false)),
)

server.registerTool(
  'list_cycles',
  { title: '列出环', description: '模块环与文件环（强连通分量）、环度（各环规模平方和）及基线中的环度。', inputSchema: { project } },
  ({ project }) => reply(() => svc.cycles(project)),
)

server.registerTool(
  'rescan',
  {
    title: '重新扫描',
    description: '改完代码后重新提取依赖：返回相对基线、相对本会话上一次扫描新增与消除的违规，环度变化，以及门禁是否会失败。违规与环度只许不增加。',
    inputSchema: { project },
  },
  ({ project }) => reply(() => svc.rescan(project)),
)

server.registerTool(
  'issues',
  {
    title: '返工清单',
    description:
      '当前版本里需要人或 AI 修正的问题，按根因聚合（同一对 codeRefs 重叠的冲突文件、同一目录的未归属文件、同一对端点间未建模的步骤各为一条）：描述错误与提醒、违规（新增 / 已知 / 已豁免）、环度上升、源码归属、未证实的关系（编译期关系，以及两端之间没有任何依赖的运行时关系）、未解释的交互、结构中未建模的步骤。每条带文件行号、规则编号与建议动作（含可粘贴的 YAML 片段）。修正描述前先看它，改完用 rescan 或 lint:model 自检。',
    inputSchema: {
      format: z.enum(['markdown', 'json']).optional().describe('缺省 markdown（与命令行 npm run arch -- issues 相同）；json 为结构化结果（与 --json 相同）'),
      category: z
        .enum(REWORK_CATEGORIES as [ReworkCategory, ...ReworkCategory[]])
        .optional()
        .describe('只看一类'),
      project,
    },
  },
  ({ format, category, project }) => {
    try {
      const r = svc.issues(project, category)
      return { content: [{ type: 'text' as const, text: format === 'json' ? JSON.stringify(r.list, null, 2) : r.markdown }] }
    } catch (e) {
      return { isError: true, content: [{ type: 'text' as const, text: e instanceof ServiceError ? e.message : String(e) }] }
    }
  },
)

server.registerTool(
  'hotspots',
  {
    title: '修改 / 缺陷热度前 N 的模块',
    description:
      '按 git 历史（缺省近 180 天）统计模块的修改次数与缺陷修复次数，热度 = 次数 × √当前行数；只列有直接归属文件的模块。改一个热点模块前先看它的职责与接口。',
    inputSchema: {
      kind: z.enum(['changes', 'fixes']).optional().describe('修改热度（缺省）或缺陷热度'),
      limit: z.number().int().positive().optional(),
      project,
    },
  },
  ({ kind, limit, project }) => reply(() => svc.hotspots(project, kind ?? 'changes', limit ?? 10)),
)

server.registerTool(
  'coupling',
  {
    title: '时间耦合的模块对',
    description:
      '总在同一提交里一起改的模块对（同提交 ≥ 5 次且占两端修改次数 ≥ 30%），标注两端之间有没有模块依赖与描述关系；onlyIsolated 只列两者都没有的对——代码事实看不见的耦合，多半是未描述的运行时关系或该合并 / 拆分。',
    inputSchema: { onlyIsolated: z.boolean().optional(), project },
  },
  ({ onlyIsolated, project }) => reply(() => svc.coupling(project, onlyIsolated ?? false)),
)

server.registerTool(
  'surface',
  {
    title: '模块表面',
    description:
      '模块的表面：入口导出的符号与描述声明的接口，逐个给出种类（端口 / 操作 / 类型 / 数据）、声明状态（已声明且导出 / 导出未声明 / 声明未导出）、扇入（使用它的模块数）与使用它的模块；表面宽度 w、越过入口数 b、越过入口的文件依赖（依赖方文件:行 → 目标）与建议（提升到入口、声明接口、改经入口）。要用另一个模块的东西时先看它的表面：只从入口导入表面上的元素，不要深层导入它的内部文件。',
    inputSchema: { module: z.string().describe('模块 ID'), project },
  },
  ({ module, project }) => reply(() => svc.surface(module, project)),
)

server.registerTool(
  'impact',
  {
    title: '影响面',
    description:
      '改一个模块会牵动谁（传入闭包）、它要谁才能工作（传出闭包）：模块依赖（含只引类型——改类型也会传播）上的闭包，按距离分组、标出模块环成员；附该模块的扇入 Ca、扇出 Ce 与不稳定度 I。改一个模块的接口或数据类型之前先看它，按距离 1 的清单安排连带修改。',
    inputSchema: {
      module: z.string().describe('模块 ID'),
      direction: z.enum(['in', 'out']).optional().describe('只看一个方向：in 传入（牵动谁）/ out 传出（依赖谁）；缺省两个都给'),
      valuesOnly: z.boolean().optional().describe('只看值依赖（去掉只引类型）'),
      project,
    },
  },
  ({ module, direction, valuesOnly, project }) => reply(() => svc.impact(module, project, { direction, valuesOnly })),
)

server.registerTool(
  'metrics',
  {
    title: '扇入扇出与不稳定度',
    description:
      '模块的扇入 Ca（子树外依赖它的不同模块数）、扇出 Ce（它依赖的子树外不同模块数）与不稳定度 I = Ce ÷ (Ca + Ce)，按系统内模块计、与层次无关。I 高不等于坏（入口、组装根天然易变），I 低的模块被大量依赖、改动牵动广。有入口的模块另带表面宽度 w（被外部引用的不同入口导出数）与越过入口数 b（绕过入口的文件依赖条数）。给 module 为明细（含贡献最多的依赖方 / 被依赖方）；给 level 为该父模块的子模块；缺省全系统的叶子模块；top 按 Ca 取前 N。',
    inputSchema: {
      module: z.string().optional().describe('模块 ID：只看这个模块的明细'),
      level: z.string().optional().describe('父模块 ID：列它的子模块'),
      top: z.number().int().positive().optional().describe('按 Ca 降序取前 N'),
      valuesOnly: z.boolean().optional().describe('只看值依赖（去掉只引类型）'),
      project,
    },
  },
  ({ module, level, top, valuesOnly, project }) => reply(() => svc.metrics(project, { module, level, top, valuesOnly })),
)

server.registerTool(
  'tiers',
  {
    title: '依赖深度',
    description:
      '依赖深度是证据、不是分层（ADR-0052）；声明了分层的父模块用 strata。普通层次按本层值依赖算深度（L28）：被依赖的在下、本层没人依赖的（入口）在第 1 层、成环的合为一组同层、孤立的不占层。依赖全部朝下，向上的交互边只可能是控制反转（通知、流、经端口 / 总线 / 通道含回调，K22）；不是控制反转却向上的多半是没标的回调。另给有交互却没有值依赖的兄弟、不占文件的子模块、共用文件——模块拆分不沿文件边界的信号（K21）。分层总览不适用。',
    inputSchema: { level: z.string().describe('父模块 ID'), project },
  },
  ({ level, project }) => reply(() => svc.tiers(level, project)),
)

server.registerTool(
  'strata',
  {
    title: '声明的分层',
    description:
      '父模块声明的分层（ADR-0052）：层是父模块对子模块的分类、不占级。返回各层的回答的问题（asks）、归属判定问（admits）、原则、可依赖的层、成员、Ca / Ce / I、本层的向上依赖，与 ST-3 稳定性逆序、ST-4 单成员层、ST-5 底层只引类型的向上 import 提示。没声明分层的给出提示（子模块多于七个时按 ST-1 归纳）。',
    inputSchema: { parent: z.string().describe('父模块 ID，根写 root'), project },
  },
  ({ parent, project }) => reply(() => svc.strata(parent, project)),
)

server.registerTool(
  'place',
  {
    title: '新模块归属建议',
    description: '在已分层的父模块下新增模块前调用（ST-2）：给出各层的回答的问题与归属判定问，按职责文字的重合度排序；按 admits 选层，designNote 写一句理由。',
    inputSchema: { parent: z.string().describe('父模块 ID，根写 root'), responsibility: z.string().describe('新模块的职责'), project },
  },
  ({ parent, responsibility, project }) => reply(() => svc.place(parent, responsibility, project)),
)

server.registerTool(
  'sketch_check',
  {
    title: '草图核验',
    description:
      '架构师的草图是 AI 不能违背的约束（X4）：缺省核验活动草图（持久草图与已定稿设计的草图）对当前版本；给 design 时核验该设计的草图对当前版本，再给 revision 时对那一轮。返回每张草图的偏差（错误：缺模块、封闭子树多出子模块、父模块 / kind / core 不一致、分层（strata）与草图不一致；提醒：关系或接口没有对应）与是否一致。起草设计版本后先跑它，零错误才交评审；提醒确有理由时写进 design.yaml 的 questions 由架构师认可，不要自己改草图。',
    inputSchema: { design: z.string().optional().describe('设计 ID'), revision: z.string().optional().describe('轮次 ID，如 r1'), project },
  },
  ({ design, revision, project }) => reply(() => svc.sketchCheck(project, design, revision)),
)

server.registerTool(
  'sketch_archive',
  {
    title: '归档 / 晋升设计的草图',
    description:
      '设计实现、当前版本重新生成后，对当前版本核验一致时归档（X3、X8）：一次性草图把设计状态改为 implemented 并为草图覆盖的模块写确认记录；声明 supersedes 的草图晋升、整份替换对应的持久草图。不一致即拒绝。归档的决定由架构师做出，agent 只代为执行。',
    inputSchema: { design: z.string().describe('设计 ID'), project },
  },
  ({ design, project }) => reply(() => svc.sketchArchive(project, design)),
)

server.registerTool(
  'prevention_report',
  { title: '拦截报告', description: '拦截记录的统计：判定次数与结果、按规则统计的拒绝、扫描中违规数与环度的首末值。', inputSchema: { project } },
  ({ project }) => reply(() => svc.report(project)),
)

await server.connect(new StdioServerTransport())
console.error('[h5p-arch-desk] MCP 服务器已就绪（stdio）')
