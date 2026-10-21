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
    description: '规模、关系的证实情况、未描述依赖、违规（新增 / 已知）、环度与基线。开始一项改动前先看一眼。',
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
  'prevention_report',
  { title: '拦截报告', description: '拦截记录的统计：判定次数与结果、按规则统计的拒绝、扫描中违规数与环度的首末值。', inputSchema: { project } },
  ({ project }) => reply(() => svc.report(project)),
)

await server.connect(new StdioServerTransport())
console.error('[h5p-arch-desk] MCP 服务器已就绪（stdio）')
