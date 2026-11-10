/** LY-15：视图区里的引用悬停提示，接 DeskState（层次视图里可见的节点、祖先链、悬停意图） */
import { useDesk } from '@/state/inject'
import { createRefPeek } from './refHover'
import { useRefPeekNode } from '../shared/refPeek'

export function useRefPeek() {
  const desk = useDesk()
  const peekNode = useRefPeekNode()
  return createRefPeek({
    pathOf: id => desk.index.value?.pathOf.get(id),
    visible: () => new Set(desk.view.value?.nodes.map(n => n.id) ?? []),
    setHover: id => {
      peekNode.value = id
      desk.setHover(id)
    },
  })
}
