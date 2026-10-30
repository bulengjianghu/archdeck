/**
 * 相关资料卡（PC-9）的接缝：模块有没有图解由项目视图注入（W5 按 `explainer:` 字段或约定路径判定），缺省为没有。
 */
import type { InjectionKey } from 'vue'

export const HAS_EXPLAINER: InjectionKey<(moduleId: string) => boolean> = Symbol('hasExplainer')
