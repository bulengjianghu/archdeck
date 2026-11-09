/**
 * 回放胶囊的位置（CD-8）：居中于未被悬浮卡片盖住的画布（宽度减去 `--canvas-inset`）；与左下角的缩放胶囊相碰时右移让开；
 * 右沿越过悬浮卡片（剩余宽度放不下）时改为居中于整个画布，这时悬浮卡片列的底部让出胶囊（由项目视图按 fits 处理）。
 */
export interface PlayerPlacementInput {
  /** 画布宽（并排时不含属性列） */
  canvasWidth: number
  /** 悬浮卡片盖住的宽度（WS-3 的 --canvas-inset；并排或没有属性列时为 0） */
  inset: number
  /** 胶囊宽 */
  playerWidth: number
  /** 缩放胶囊的右沿（相对画布左沿；没有时为 0） */
  zoomRight: number
  /** 胶囊与边、与其他胶囊之间的最小间距 */
  margin: number
}

export interface PlayerPlacement {
  /** 胶囊左沿（相对画布左沿） */
  left: number
  /** 是否放得进未被盖住的部分；放不下时居中于整个画布、悬浮卡片让出底部 */
  fits: boolean
}

export function playerPlacement({ canvasWidth, inset, playerWidth, zoomRight, margin }: PlayerPlacementInput): PlayerPlacement {
  const leftIn = (span: number) => Math.max((span - playerWidth) / 2, zoomRight + margin)
  const free = canvasWidth - inset
  const fits = leftIn(free) + playerWidth <= free - margin
  return { left: leftIn(fits ? free : canvasWidth), fits }
}
