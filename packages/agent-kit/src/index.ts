/**
 * `@blksails/agent-kit` — lightweight, zero-forced-runtime-dependency helpers for
 * authoring pi-web custom agents.
 *
 * Authors write an `index.ts` whose default export is an {@link AgentDefinition}
 * (or a factory producing one). {@link defineAgent} is an identity function that
 * exists purely for type inference — it never transforms or copies the input,
 * so a definition produced without this package is structurally identical and
 * still loadable by the runner.
 */
export type { AgentContext, AgentDefinition, AgentModel } from "./types.js";
export type {
  AgentsFilesOverride,
  ExtensionFactory,
  FromServicesOptions,
  Model,
  PromptsOverride,
  ScopedModelEntry,
  SkillsOverride,
  SystemPromptValue,
  ThinkingLevel,
  ToolDefinition,
} from "./sdk-types.js";

import type { AgentDefinition } from "./types.js";

/**
 * Identity helper providing compile-time type checking for an
 * {@link AgentDefinition}. Returns the exact same reference it was given;
 * there are no runtime side effects and no forced runtime dependency.
 *
 * @example
 * ```ts
 * export default defineAgent({
 *   model: { provider: "anthropic", modelId: "claude-opus-4-5" },
 *   systemPrompt: "You are helpful.",
 * });
 * ```
 */
export function defineAgent(def: AgentDefinition): AgentDefinition {
  return def;
}

export { defineMinimalAgent, minimalAgentPreset } from "./minimal-preset.js";

// server-driven UI:在工具 execute 内经 onUpdate 发出 data-pi-ui 部件。
export { emitUi } from "./emit-ui.js";
export type { UiSpec, UiNode } from "@blksails/protocol";

// attachment-tool-bridge(task 4.1):tool 接入上下文的**作者面类型契约**。
// 仅类型,无值导入 —— 构造(createAttachmentToolContext)与运行期句柄留在 @blksails/server
// 子进程侧,故本包不因此获得到 server 的运行时依赖边(不破坏 webpack externals 边界)。
export type {
  AttachmentToolContext,
  AttachmentToolHandle,
  PutOutputInput,
  ToolOutputRef,
} from "./attachment.js";
