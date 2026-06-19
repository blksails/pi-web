/**
 * web-kit — 运行时 WebExtension 描述符 + `defineWebExtension()`(与 agent-kit 的
 * `defineAgent` 对称的 identity 助手,纯编译期类型检查,无运行时副作用)。
 *
 * 这里承载携带 React 组件的运行时面(slots/renderers/contributions);可序列化的
 * 清单/SlotKey/声明式 config 在 `@pi-web/protocol`。
 */
import type { ComponentType, ReactNode } from "react";
import type { UIMessage } from "ai";
import type {
  SlotKey,
  WebExtConfig,
  ArtifactDeclaration,
  WebExtensionCapability,
} from "@pi-web/protocol";
import type { UiRpcClient } from "./rpc-client.js";

/** 插槽贡献:静态节点或受 props 的组件。 */
export interface SlotRenderProps {
  readonly extId: string;
}
export type SlotContribution = ReactNode | ComponentType<SlotRenderProps>;

type AnyPart = UIMessage["parts"][number];

/** Tier 2 渲染器(与宿主 registry 的渲染器形状一致)。 */
export type ToolRenderer = ComponentType<{
  readonly part: AnyPart;
  readonly message: UIMessage;
}>;
export type DataPartRenderer = ComponentType<{
  readonly part: AnyPart;
  readonly message: UIMessage;
}>;

export interface RendererContributions {
  readonly tools?: Readonly<Record<string, ToolRenderer>>;
  readonly dataParts?: Readonly<Record<string, DataPartRenderer>>;
}

/** Tier 3 贡献点候选项类型。 */
export interface SlashCommandItem {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
}
export interface MentionItem {
  readonly id: string;
  readonly label: string;
}
export interface CompletionItem {
  readonly label: string;
  readonly insertText: string;
}
export interface Keybinding {
  readonly combo: string;
  readonly commandId: string;
}

/** Tier 3 贡献点(全部经注入的 UiRpcClient 回 agent)。 */
export interface ContributionPoints {
  readonly slash?: {
    list(query: string, rpc: UiRpcClient): Promise<readonly SlashCommandItem[]>;
    execute?(id: string, rpc: UiRpcClient): Promise<void>;
  };
  readonly mention?: {
    /** 触发字符,缺省 "@"。 */
    trigger?: string;
    query(q: string, rpc: UiRpcClient): Promise<readonly MentionItem[]>;
  };
  readonly autocomplete?: {
    complete(ctx: string, rpc: UiRpcClient): Promise<readonly CompletionItem[]>;
  };
  readonly inlineComplete?: {
    complete(ctx: string, rpc: UiRpcClient): Promise<string | undefined>;
  };
  readonly keybindings?: readonly Keybinding[];
}

/** 运行时 WebExtension 描述符(`.pi/web` 入口默认导出)。 */
export interface WebExtension {
  readonly manifestId: string;
  readonly slots?: Partial<Record<SlotKey, SlotContribution>>;
  readonly renderers?: RendererContributions;
  readonly contributions?: ContributionPoints;
  readonly config?: WebExtConfig;
  readonly artifact?: ArtifactDeclaration;
  readonly capabilities?: readonly WebExtensionCapability[];
}

/**
 * identity 助手:返回同一引用,仅提供编译期类型检查。无运行时副作用、无强制依赖,
 * 不经此函数书写的结构相同的描述符同样可被宿主加载。
 */
export function defineWebExtension(ext: WebExtension): WebExtension {
  return ext;
}
