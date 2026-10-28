/**
 * 线的预算（L43，第十四轮 F11）：与节点的七个左右（SP4）对等，静息态常显的线也有上限；两个视角都管。
 * 超出时画布角提示，只说事实、不拦操作：结构视角是「这一层的依赖多」（考虑标核心或拆分），交互视角是「描述可能写得过细」（SP6 描述求准）。
 */

/** L43：一个层次静息态常显的线的预算（议：实测三项目结构视角每层 p90 = 9、最多 30，交互视角 p90 = 13、最多 39；按七个节点每个两条线取 15） */
export const LINE_BUDGET = 15

/** L43：超预算的提示；不超时为 null */
export function budgetHint(perspective: 'structure' | 'interaction', count: number, budget = LINE_BUDGET): string | null {
  if (count <= budget) return null
  return perspective === 'structure'
    ? `常显的依赖 ${count} 条，超过预算 ${budget}：这一层依赖多，考虑标出核心或拆分`
    : `交互线 ${count} 条，超过预算 ${budget}：描述是否写得过细（模块级只写谁对谁做什么）`
}
