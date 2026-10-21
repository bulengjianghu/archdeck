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
  /** G14：选中文件的归属模块 */
  fileOwners: ReadonlySet<string>
}

/** 文件树（G13）：展开状态、选中与高亮、归属标记 */
export interface FileTreeContext {
  expanded: ReadonlySet<string>
  selected: string | null
  /** 选中模块的文件 */
  hits: ReadonlySet<string>
  hitDirs: ReadonlySet<string>
  unowned: ReadonlySet<string>
  conflicts: ReadonlySet<string>
  ignored: ReadonlySet<string>
  onlyUnowned: boolean
  /** G19–G21：文件行数、超长阈值、「只看超长」 */
  lines: Readonly<Record<string, number>>
  maxLines: number
  onlyLong: boolean
}

/** T7：一帧在步骤树上的标记 */
export interface FrameMark {
  /** selected：选中的步骤；same：与它在本层合并为同一条可见消息的其他帧；progress：选中的不是步骤时进度所在的帧 */
  state: 'walked' | 'selected' | 'same' | 'progress' | 'ahead' | 'unchosen' | 'unreached'
  /** 本层可见消息序号（1 起）；本层不可见时为空 */
  seq?: number
  hidden: boolean
}

export interface StepTreeContext {
  index: ModelIndex
  collapsed: ReadonlySet<string>
  mark: (f: Frame, status: 'path' | 'unchosen' | 'unreached') => FrameMark
}
