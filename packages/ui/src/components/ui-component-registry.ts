/**
 * ui-component-registry — server-driven UI 的「内置白名单组件」注册表。
 *
 * 对应信任模型路径 1:agent 以 `kind:"builtin"` 给出组件名 + JSON props,
 * 前端只渲染**预先注册**的组件 —— 未注册即拒绝(回退占位),agent 无法引入任意组件。
 *
 * 与 renderer-registry 同构(注册 / 解析 / 覆盖语义 / 工厂 + 单例),但键空间独立:
 * 这里是「UiSpec.component 名 → React 组件」,而非「part 类型 → 渲染器」。
 *
 * 默认单例预置一组通用可视化组件(metric/table/keyValue/alert/progress),
 * 宿主可经 `registerUiComponent` 增量扩展,实现零配置 + 可定制。
 */
import type { ComponentType } from "react";

/** 内置组件统一入参:经 schema 透传的 JSON props(组件自身做形状校验/容错)。 */
export type UiComponent = ComponentType<{
  readonly props: Record<string, unknown>;
}>;

export interface UiComponentRegistry {
  registerUiComponent(name: string, component: UiComponent): void;
  resolveUiComponent(name: string): UiComponent | undefined;
  /** 已注册组件名列表(用于占位回退提示 / 调试)。 */
  list(): string[];
  /** 测试辅助:清空所有注册。 */
  reset(): void;
}

export function createUiComponentRegistry(): UiComponentRegistry {
  const components = new Map<string, UiComponent>();
  return {
    registerUiComponent(name, component): void {
      // 覆盖语义:最后写入胜出。
      components.set(name, component);
    },
    resolveUiComponent(name): UiComponent | undefined {
      return components.get(name);
    },
    list(): string[] {
      return [...components.keys()].sort();
    },
    reset(): void {
      components.clear();
    },
  };
}

/** 模块级单例,供 PiUiPart 解析与宿主直接扩展。 */
export const defaultUiComponentRegistry: UiComponentRegistry =
  createUiComponentRegistry();

export function registerUiComponent(
  name: string,
  component: UiComponent,
): void {
  defaultUiComponentRegistry.registerUiComponent(name, component);
}
