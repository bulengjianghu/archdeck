/**
 * 对话的同步适配器（DA-11）：页面经开发服务器的 POST /agent/<项目>/turn、/stop 起停一轮（/outcome 补记提议卡结果，DL-51），agent 的输出经推送通道 `arch-agent:event` 回来。
 * 外界是状态的投影：这里只搬运请求与事件，不改对话会话（会话只经 dialogueTransition 改变）。
 */
import type { AgentPush, AgentTransport, AgentTurnRequest } from '../desk/dialogue'

export const AGENT_EVENT = 'arch-agent:event'

/** 推送的来源：开发态为 import.meta.hot */
export interface AgentEvents {
  on(event: typeof AGENT_EVENT, cb: (data: AgentPush & { project?: string }) => void): void
  off(event: typeof AGENT_EVENT, cb: (data: AgentPush & { project?: string }) => void): void
}

export function httpAgentTransport(base: string, events: AgentEvents | undefined): AgentTransport {
  const post = async (url: string, body: unknown) => {
    const res = await fetch(`${base}${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const data = (await res.json().catch(() => ({}))) as { error?: string }
    return res.ok ? ({ ok: true } as const) : ({ ok: false, error: data.error ?? `HTTP ${res.status}` } as const)
  }
  return {
    turn: (project: string, request: AgentTurnRequest) =>
      post(`agent/${encodeURIComponent(project)}/turn`, request).catch(e => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) })),
    stop: async (project: string, turn: string) => void (await post(`agent/${encodeURIComponent(project)}/stop`, { turn }).catch(() => null)),
    outcome: async (project, record) => void (await post(`agent/${encodeURIComponent(project)}/outcome`, record).catch(() => null)),
    subscribe(project, cb) {
      if (!events) return () => {}
      const on = (data: AgentPush & { project?: string }) => {
        if (data.project !== project) return
        const { project: _p, ...event } = data
        cb(event as AgentPush)
      }
      events.on(AGENT_EVENT, on)
      return () => events.off(AGENT_EVENT, on)
    },
  }
}
