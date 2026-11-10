import { inject, type InjectionKey } from 'vue'
import type { DeskState } from './useDeskState'

export const DESK_STATE: InjectionKey<DeskState> = Symbol('desk-state')

export function useDesk(): DeskState {
  const desk = inject(DESK_STATE)
  if (!desk) throw new Error('DeskState 未注入')
  return desk
}
