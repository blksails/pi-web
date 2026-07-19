/**
 * web-kit — 运行时 WebExtension 描述符 + `defineWebExtension()`(与 agent-kit 的
 * `defineAgent` 对称的 identity 助手,纯编译期类型检查,无运行时副作用)。
 *
 * 这里承载携带 React 组件的运行时面(slots/renderers/contributions);可序列化的
 * 清单/SlotKey/声明式 config 在 `@blksails/pi-web-protocol`。
 */
import type { ComponentType, ReactNode } from "react";
import type { UIMessage } from "ai";
import type {
  SlotKey,
  WebExtConfig,
  ArtifactDeclaration,
  WebExtensionCapability,
} from "@blksails/pi-web-protocol";
import type { UiRpcClient } from "./rpc-client.js";

/** 插槽贡献:静态节点或受 props 的组件。 */
export interface SlotRenderProps {
  readonly extId: string;
}
export type SlotContribution = ReactNode | ComponentType<SlotRenderProps>;

/**
 * 面⑦ per-source settings 动态控件(spec source-settings-and-slots,任务 7.1;
 * `settingsWidgets` capability)的组件 props。窄接口(不携带宿主 `FieldProps` 的
 * descriptor/path/errors/registry 等宿主内部字段)——宿主(`@blksails/pi-web-ui`)
 * 装载时把自身的 `FieldProps` 适配为此形状再渲染,web-kit 不反向依赖 ui 包。
 *
 * `baseUrl`/`sessionId` 供控件按需经标准 agent-declared-routes HTTP 端点
 * (`GET|POST {baseUrl}/sessions/{sessionId}/agent-routes/{name}`)自取数据(面⑤⑦
 * 互为供给的咬合点);宿主在装载时注册(`applySettingsWidgets`)一并注入,不经
 * `FieldProps` 透传。会话尚未建立(如源选择阶段尚无 session)时两者均为
 * `undefined`,控件应自行降级(如禁用/空态),不得假定恒有值。
 */
export interface SettingsWidgetProps<V = unknown> {
  readonly value: V;
  readonly onChange: (next: V) => void;
  /** 该字段所属 source 的稳定 key(与 per-source scoped registry 注册时一致)。 */
  readonly sourceKey: string;
  /** 字段键(`FormSchema` 字段声明的 `key`,即 `FieldDescriptor.key`)。 */
  readonly fieldKey: string;
  readonly disabled?: boolean;
  /** http-api 基址(如 `/api`),调用本模块 agent-declared-routes 端点用。 */
  readonly baseUrl?: string;
  /** 当前会话 id(agent-declared-routes 端点挂在 `/sessions/:id/agent-routes/:name`)。 */
  readonly sessionId?: string;
}
export type SettingsWidgetComponent<V = unknown> = ComponentType<SettingsWidgetProps<V>>;

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

/**
 * Canvas 插件捆(**最小结构镜像**)。
 *
 * canonical 家在 `@blksails/pi-web-canvas-kit`(那里的同名类型给 tools/layers/actions
 * 以具体的 Canvas 插件形状)。web-kit 刻意不 import canvas-kit —— 二者无依赖边(web-kit
 * 是 source 作者侧 SDK,canvas-kit 是画布领域内核),故此处只镜像作者声明时需要的结构:
 * 稳定的 `id`/`requires` 标量键,加上组件位宽型 `unknown` 的插件槽。宿主领域中立地搬运整个
 * 捆,真正的形状收敛在领域侧消费点(canvas-ui 聚合处对两个同名类型下双向可赋值断言,
 * 防镜像与 canonical 漂移)。
 */
export interface CanvasPluginBundle {
  readonly id: string;
  readonly requires?: readonly string[];
  readonly tools?: readonly unknown[];
  readonly layers?: readonly unknown[];
  readonly actions?: readonly unknown[];
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
  /**
   * 面⑦ per-source settings 动态控件供给(`settingsWidgets` capability,任务 7.1)。
   * 键=`FormSchema` 字段声明的 `widget:"<key>"`;宿主装载扩展时把整份映射并入该
   * source 的 per-source scoped field registry(`registerSourceFieldRenderer`),
   * 设置面板渲染时按 fieldKey→widget→kind 三级解析命中。未装载/验签失败/未提供
   * 对应键时,宿主侧字段降级为只读 JSON(不影响面板其余字段)。
   */
  readonly settingsWidgets?: Readonly<Record<string, SettingsWidgetComponent>>;
  /**
   * 该 source / 插件包为 Canvas 实例贡献的插件捆集合。与既有声明键(slots/renderers 等)
   * 同形共存、互不干扰。宿主对其领域中立(只整体搬运,不解析内容);实际提取与前缀化聚合
   * 发生在领域侧(canvas-ui)。
   */
  readonly canvasPlugins?: readonly CanvasPluginBundle[];
}

/**
 * identity 助手:返回同一引用,仅提供编译期类型检查。无运行时副作用、无强制依赖,
 * 不经此函数书写的结构相同的描述符同样可被宿主加载。
 */
export function defineWebExtension(ext: WebExtension): WebExtension {
  return ext;
}
