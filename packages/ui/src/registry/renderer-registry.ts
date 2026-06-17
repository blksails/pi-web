/**
 * renderer-registry — 渲染器注册表(注册 / 解析 / 默认回退 / 覆盖语义)。
 *
 * 工具与 data-part 的自定义渲染器映射。`PartRenderer` 调用 `resolve*` 解析:
 * 命中返回注册组件,未命中返回 `undefined`(由调用方回退默认)。重复注册以最后者为准。
 *
 * 默认导出模块级单例(供宿主在挂载 `<PiChat>` 前直接 register*);另提供
 * `createRendererRegistry()` 工厂,测试可用隔离实例避免跨用例污染。
 */
import type { ComponentType } from "react";
import type { UIMessage } from "ai";

type AnyPart = UIMessage["parts"][number];
type ToolPart = Extract<AnyPart, { type: `tool-${string}` }> | Extract<AnyPart, { type: "dynamic-tool" }>;
type DataPart = Extract<AnyPart, { type: `data-${string}` }>;

export type ToolRenderer = ComponentType<{
  readonly part: ToolPart;
  readonly message: UIMessage;
}>;
export type DataPartRenderer = ComponentType<{
  readonly part: DataPart;
  readonly message: UIMessage;
}>;

export interface RendererRegistry {
  registerToolRenderer(toolName: string, component: ToolRenderer): void;
  registerDataPartRenderer(type: string, component: DataPartRenderer): void;
  resolveToolRenderer(toolName: string): ToolRenderer | undefined;
  resolveDataPartRenderer(type: string): DataPartRenderer | undefined;
  /** 测试辅助:清空所有注册。 */
  reset(): void;
}

export function createRendererRegistry(): RendererRegistry {
  const tools = new Map<string, ToolRenderer>();
  const dataParts = new Map<string, DataPartRenderer>();

  return {
    registerToolRenderer(toolName, component): void {
      // 覆盖语义:最后写入胜出。
      tools.set(toolName, component);
    },
    registerDataPartRenderer(type, component): void {
      dataParts.set(type, component);
    },
    resolveToolRenderer(toolName): ToolRenderer | undefined {
      return tools.get(toolName);
    },
    resolveDataPartRenderer(type): DataPartRenderer | undefined {
      return dataParts.get(type);
    },
    reset(): void {
      tools.clear();
      dataParts.clear();
    },
  };
}

/** 模块级单例,供宿主直接调用。 */
export const defaultRendererRegistry: RendererRegistry =
  createRendererRegistry();

export function registerToolRenderer(
  toolName: string,
  component: ToolRenderer,
): void {
  defaultRendererRegistry.registerToolRenderer(toolName, component);
}

export function registerDataPartRenderer(
  type: string,
  component: DataPartRenderer,
): void {
  defaultRendererRegistry.registerDataPartRenderer(type, component);
}
