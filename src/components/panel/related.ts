/**
 * 面板的注入接缝：相关资料卡（PC-9，Actor 面板保留）里模块有没有图解由项目视图注入（W5），缺省为没有。
 * 原 RUN_FIRST（理解卡首节运行信息，V6）随理解卡搬去辅助栏而移除——运行信息现在住在运行视角右栏的步骤节。
 */
import type { InjectionKey } from 'vue'

export const HAS_EXPLAINER: InjectionKey<(moduleId: string) => boolean> = Symbol('hasExplainer')
