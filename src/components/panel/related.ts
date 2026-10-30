/**
 * 属性栏卡片的接缝：相关资料卡（PC-9）里模块有没有图解由项目视图注入（W5 按 `explainer:` 字段或约定路径判定），缺省为没有；
 * 理解卡首节的运行信息由面板分派注入（V6）。
 */
import type { Component, InjectionKey } from 'vue'

export const HAS_EXPLAINER: InjectionKey<(moduleId: string) => boolean> = Symbol('hasExplainer')

/**
 * V6：运行视角下理解卡的首节——由面板分派注入要渲染的运行信息组件（运行视角且对象有运行信息时），没有则为 null。
 * 对象面板与卡片都不直接引用运行信息，「在这次流程中做了什么」只由分派决定放不放。
 */
export const RUN_FIRST: InjectionKey<{ readonly value: Component | null }> = Symbol('runFirst')
