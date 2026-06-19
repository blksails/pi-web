/**
 * renderer-registry — 渲染器注册表(注册 / 解析 / 默认回退 / 覆盖语义 / per-session + 命名空间)。
 *
 * 工具与 data-part 的自定义渲染器映射。`PartRenderer` 调用 `resolve*` 解析:
 * 命中返回注册组件,未命中返回 `undefined`(由调用方回退默认)。
 *
 * 命名空间(agent-web-extension):每个注册归属一个 `extId`(缺省 `""` = 宿主)。
 * 不同 extId 注册同一 type **互不覆盖**(各存于自己命名空间);解析优先级为
 * 「扩展声明(非空 extId,后注册者胜) > 宿主默认("")」。`clearExtension(extId)`
 * 移除某扩展的全部注册;`reset()` 清空整表(会话结束/测试隔离)。
 *
 * 用法:
 *  - 宿主仍可用模块级单例 `defaultRendererRegistry` 直接 `register*`(向后兼容,extId="")。
 *  - 每会话用 `createRendererRegistry()` 取隔离实例,扩展注册带各自 extId。
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

/** 宿主默认命名空间(无 extId 的注册归此)。 */
export const HOST_NAMESPACE = "";

export interface RendererRegistry {
  /** 注册工具渲染器;`extId` 缺省为宿主命名空间。 */
  registerToolRenderer(toolName: string, component: ToolRenderer, extId?: string): void;
  /** 注册 data-part 渲染器;`extId` 缺省为宿主命名空间。 */
  registerDataPartRenderer(type: string, component: DataPartRenderer, extId?: string): void;
  resolveToolRenderer(toolName: string): ToolRenderer | undefined;
  resolveDataPartRenderer(type: string): DataPartRenderer | undefined;
  /** 移除某扩展的全部注册(扩展卸载时)。 */
  clearExtension(extId: string): void;
  /** 清空所有注册(会话结束 / 测试隔离)。 */
  reset(): void;
}

interface NamespaceEntry {
  readonly extId: string;
  readonly tools: Map<string, ToolRenderer>;
  readonly dataParts: Map<string, DataPartRenderer>;
}

export function createRendererRegistry(): RendererRegistry {
  // 按注册先后维护命名空间顺序;解析时扩展(非宿主)优先,且后注册的扩展胜出。
  const namespaces = new Map<string, NamespaceEntry>();

  function ns(extId: string): NamespaceEntry {
    let entry = namespaces.get(extId);
    if (entry === undefined) {
      entry = { extId, tools: new Map(), dataParts: new Map() };
      namespaces.set(extId, entry);
    }
    return entry;
  }

  /** 解析顺序:扩展命名空间(按插入逆序,后注册者优先)→ 宿主默认。 */
  function ordered(): NamespaceEntry[] {
    const all = [...namespaces.values()];
    const exts = all.filter((e) => e.extId !== HOST_NAMESPACE).reverse();
    const host = all.filter((e) => e.extId === HOST_NAMESPACE);
    return [...exts, ...host];
  }

  return {
    registerToolRenderer(toolName, component, extId = HOST_NAMESPACE): void {
      // 同一命名空间内覆盖语义:最后写入胜出。
      ns(extId).tools.set(toolName, component);
    },
    registerDataPartRenderer(type, component, extId = HOST_NAMESPACE): void {
      ns(extId).dataParts.set(type, component);
    },
    resolveToolRenderer(toolName): ToolRenderer | undefined {
      for (const entry of ordered()) {
        const hit = entry.tools.get(toolName);
        if (hit !== undefined) return hit;
      }
      return undefined;
    },
    resolveDataPartRenderer(type): DataPartRenderer | undefined {
      for (const entry of ordered()) {
        const hit = entry.dataParts.get(type);
        if (hit !== undefined) return hit;
      }
      return undefined;
    },
    clearExtension(extId): void {
      namespaces.delete(extId);
    },
    reset(): void {
      namespaces.clear();
    },
  };
}

/** 模块级单例,供宿主在挂载 `<PiChat>` 前直接 register*(宿主命名空间)。 */
export const defaultRendererRegistry: RendererRegistry =
  createRendererRegistry();

export function registerToolRenderer(
  toolName: string,
  component: ToolRenderer,
  extId?: string,
): void {
  defaultRendererRegistry.registerToolRenderer(toolName, component, extId);
}

export function registerDataPartRenderer(
  type: string,
  component: DataPartRenderer,
  extId?: string,
): void {
  defaultRendererRegistry.registerDataPartRenderer(type, component, extId);
}
