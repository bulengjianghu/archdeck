/** 导航树各行组件共用的只读上下文：由 ModuleTree / StepTree 从协调者的派生数据算出，行组件只画 */
import type { Frame, ModelIndex } from '@/model'

export interface ModuleTreeContext {
  index: ModelIndex
  childrenOf: (id: string) => string[]
  expanded: ReadonlySet<string>
  levelId: string
  selectedId: string | null
  /** T5：参与本场景的模块（结构视角为空） */
  participants: ReadonlySet<string>
  /** T5：当前步骤两端及其祖先 */
  active: ReadonlySet<string>
}

/** T7：一帧在步骤树上的标记 */
export interface FrameMark {
  state: 'walked' | 'current' | 'ahead' | 'unchosen' | 'unreached'
  /** 本层可见消息序号（1 起）；本层不可见时为空 */
  seq?: number
  hidden: boolean
}

export interface StepTreeContext {
  index: ModelIndex
  collapsed: ReadonlySet<string>
  mark: (f: Frame, status: 'path' | 'unchosen' | 'unreached') => FrameMark
}
