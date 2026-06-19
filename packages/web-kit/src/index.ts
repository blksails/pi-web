/**
 * `@pi-web/web-kit` — agent source `.pi/web` 的作者侧 SDK(UI 控制层)。
 *
 * 与 `@pi-web/agent-kit` 对称:`defineAgent` ↔ `defineWebExtension`。作者写一个
 * `.pi/web` 入口,默认导出 {@link WebExtension};经随包发布的 `pi-web build`
 * 预构建为 ESM bundle + manifest(react/web-kit external)。
 *
 * ── 稳定核(stable) ──
 *   defineWebExtension / WebExtension / SlotContribution / RendererContributions /
 *   ContributionPoints / UiRpcClient / WebExtHostContext / SLOTS
 * ── 实验区(experimental) ──
 *   见 `./experimental`(尚未纳入 semver 稳定承诺的入口)。
 */

// 稳定核
export {
  defineWebExtension,
  type WebExtension,
  type SlotContribution,
  type SlotRenderProps,
  type RendererContributions,
  type ToolRenderer,
  type DataPartRenderer,
  type ContributionPoints,
  type SlashCommandItem,
  type MentionItem,
  type CompletionItem,
  type Keybinding,
} from "./define-web-extension.js";
export { type UiRpcClient, type UiRpcCall } from "./rpc-client.js";
export { type WebExtHostContext } from "./host-context.js";
export { SLOTS } from "./slots.js";

// 便于作者引用的可序列化契约(从 protocol re-export 类型)
export type {
  SlotKey,
  WebExtConfig,
  ThemeTokens,
  LayoutPreset,
  ArtifactDeclaration,
  WebExtensionManifest,
  WebExtensionCapability,
  UiRpcPoint,
  UiRpcAction,
  UiRpcRequest,
  UiRpcResponse,
} from "@pi-web/protocol";
