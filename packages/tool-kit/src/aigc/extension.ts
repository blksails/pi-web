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
import {
  registerImageGeneration,
  IMAGE_GENERATION_ROUTES,
} from "./tools/image-generation.js";
import { registerImageEdit, IMAGE_EDIT_ROUTES } from "./tools/image-edit.js";
import { getSessionState } from "../session-state.js";

/** 尺寸档位(与两工具 requiredParams 的 size 选项一致;auto = 交由工具默认行为)。 */
const SIZE_OPTIONS: readonly string[] = ["1024x1024", "1536x1024", "1024x1536", "auto"];

/**
 * 装配期清单下发(aigc-prompt-toolbar Req 2.2/3.1):把「生成∪编辑」模型并集与尺寸档位
 * 写入会话共享状态,供工具排快捷设置选择器动态渲染(单一事实源 = 工具 routes,新增
 * provider 自动出现)。seam 缺失(非子进程/桥未装配)时 set 为 no-op,UI 侧回退内置常量。
 */
function publishAigcCatalog(): void {
  const state = getSessionState();
  const models = Array.from(
    new Set([...IMAGE_GENERATION_ROUTES, ...IMAGE_EDIT_ROUTES].map((r) => r.model)),
  );
  state.set("aigc.models", models);
  state.set("aigc.sizes", SIZE_OPTIONS);
}

/** 注册 AIGC 图像工具的进程内扩展工厂。 */
export const aigcExtension: ExtensionFactory = (pi: ExtensionAPI) => {
  registerImageGeneration(pi);
  registerImageEdit(pi);
  publishAigcCatalog();
};
