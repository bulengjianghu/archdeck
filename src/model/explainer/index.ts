/** 图解（ADR-0055，EX-1–EX-9）：查找、导航、依据与指纹、引用原文、检查 */
export * from './types'
export { basisEntries, explainerBasis, formatBasis, parseBasis, diffBasis, basisLabel } from './basis'
export { readBasisMeta, writeBasisMeta, archRefs, plainText, lineAt } from './html'
export { explainerOf, explainerModules, explainerHtml, explainerNav, explainerStatus, explainerRefs } from './lookup'
export { explainerIssues, COPY_MIN_WIDTH } from './lint'
