/**
 * 时钟同步（R12）：playing 为真时计时器按速度运行，到点 → onTick（协调者 dispatch(tick)）。
 * 每条可见消息一个节拍：1 倍速 1 秒；尚未开始（播放头为空）时很快走出第一步。
 */
import { watch, type WatchStopHandle } from 'vue'
import type { PlaybackState } from '../transition'

export const BEAT_MS = 1000
export const START_MS = 200

export interface Timers {
  set(cb: () => void, ms: number): unknown
  clear(handle: unknown): void
}

const realTimers: Timers = {
  set: (cb, ms) => setTimeout(cb, ms),
  clear: h => clearTimeout(h as ReturnType<typeof setTimeout>),
}

export function createClockSync(playback: () => PlaybackState | null, onTick: () => void, timers: Timers = realTimers): WatchStopHandle {
  let handle: unknown = null
  const stop = watch(
    () => {
      const pb = playback()
      return pb?.playing ? `${pb.scenarioId}|${pb.frameId}|${pb.speed}` : null
    },
    key => {
      if (handle !== null) timers.clear(handle)
      handle = null
      if (key === null) return
      const pb = playback()!
      handle = timers.set(
        () => {
          handle = null
          onTick()
        },
        pb.frameId === null ? START_MS : BEAT_MS / pb.speed,
      )
    },
    { immediate: true },
  )
  return () => {
    stop()
    if (handle !== null) timers.clear(handle)
  }
}
