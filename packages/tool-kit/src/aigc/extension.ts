/**
 * `aigcExtension` — AIGC 图像工具的进程内 pi extension factory(detoolspec-unify-builtin-tools)。
 *
 * 经 `AgentDefinition.extensions: [aigcExtension]` 装载(runner 透传进程内 factory),向会话注册
 * `image_generation` 与 `image_edit` 两个工具。与 `extension-manager` / `auto-title` 形态一致。
 *
 * 属 **runtime 层**:含 pi SDK 值导入,仅经 `@blksails/pi-web-tool-kit/runtime` 子入口加载,
 * 不进 Next/webpack 前端 bundle。
 */
import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { registerImageGeneration } from "./tools/image-generation.js";
import { registerImageEdit } from "./tools/image-edit.js";

/** 注册 AIGC 图像工具的进程内扩展工厂。 */
export const aigcExtension: ExtensionFactory = (pi: ExtensionAPI) => {
  registerImageGeneration(pi);
  registerImageEdit(pi);
};
