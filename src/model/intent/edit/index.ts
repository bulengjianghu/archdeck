/**
 * 草图编辑（X7、X7b–X7k，ADR-0024、ADR-0025）：applyEdit(草图, 操作, 上下文) → 新草图 + 影响 | 拒绝原因——单张草图上的操作；
 * 跨草图的合并 / 拆分 / 降级 / 升级 / 移入 / 改 ID / 删除在 applyDesignEdit（design.ts），输入输出为一个设计的全部草图。
 * 纯函数：输入不动，在副本上按操作族修改；只拒绝做不成的操作，结构合法性交给 validateSketch（X7f、X14）。
 */
import { removeLayer } from './layers'

export { applyEdit, sketchText } from './apply'
export { idImpact } from './move'
export { seedFromBaseline, deriveChildSketch } from './seed'
export type { SeedOptions } from './seed'
export { gridLayout, referenceNodes, referenceRelations, foldReference, layoutForSave, ROOT_BAND_X0, ROOT_BAND_GAP, ROOT_BAND_COLS, ROOT_BAND_PAD, ROOT_BAND_ROW, GRID_GAP_X, GRID_GAP_Y, type GridArea } from './layout'
export { applyDesignEdit, sketchesUnder } from './design'
export { locateAll, locate, knownModules, moduleId, relationId, interfaceId, kebab, shortName, ID_PATTERN, mountOf, isRootSketch } from './locate'
export type { LocatedModule } from './locate'
export { removeLayer }
