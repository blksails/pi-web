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
import { getSessionState } from "../session-state.js";
import { resolveAigcToolSettings } from "./model-config.js";
import { deriveActiveModels } from "./active-models.js";

/** 尺寸档位(与两工具 requiredParams 的 size 选项一致;auto = 交由工具默认行为)。 */
const SIZE_OPTIONS: readonly string[] = ["1024x1024", "1536x1024", "1024x1536", "auto"];

/**
 * 装配期清单下发(aigc-prompt-toolbar Req 2.2/3.1):把「生成∪编辑」模型并集与尺寸档位
 * 写入会话共享状态,供工具排快捷设置选择器动态渲染(单一事实源 = 工具 routes,新增
 * provider 自动出现)。
 *
 * ⚠ 装配时序:runner 里 extensions 在 `createAgentSessionRuntime` 期间执行,而
 * `wireStateBridge` 挂 globalThis seam 在其**之后**(runner.ts 装配段)——factory 同步
 * 执行瞬间 seam 尚未就绪,直接 set 恒 no-op(真实 runner 实证:选择器只见 fallback)。
 * 故采用**短退避重试**:seam 未就绪则 setTimeout 重试(首试排在下一宏任务,此时 runner
 * 主流程的同步装配段已挂好 seam,一般第一次重试即成)。非子进程/桥未装配(重试耗尽)
 * 则放弃,UI 侧回退内置常量。
 */
const PUBLISH_RETRY_MS = 50;
const PUBLISH_MAX_TRIES = 40; // ~2s 上限,覆盖极慢装配;耗尽即放弃(fail-soft)

function publishAigcCatalog(
  disabledModels: ReadonlySet<string>,
  enablePromptOptimization: boolean,
  attempt = 0,
): void {
  const state = getSessionState();
  if (!state.available) {
    if (attempt < PUBLISH_MAX_TRIES) {
      setTimeout(
        () => publishAigcCatalog(disabledModels, enablePromptOptimization, attempt + 1),
        attempt === 0 ? 0 : PUBLISH_RETRY_MS,
      );
    }
    return;
  }
  // aigc-tool-settings:下发清单须与工具实际暴露的模型同源过滤——被禁模型从 models/labels/providers
  // 一并移除(前端 picker 自然收敛);全禁时 deriveActiveModels 内部 filterRoutes 保留默认,与工具侧一致。
  // canvas-actions-m2:活跃模型推导提取为 deriveActiveModels 共享纯函数(KV 键/值/顺序零变),
  // 与 buildCanvasCapability 同源消费。清单仍是 id 数组(value/路由键不变),另下发 label 映射供
  // 选择器渲染「可见=label、hover title=id」、provider 映射供字母徽章。
  const entries = deriveActiveModels(disabledModels);
  const labelByModel: Record<string, string> = {};
  const providerByModel: Record<string, string> = {};
  for (const e of entries) {
    labelByModel[e.model] = e.label;
    if (e.provider !== undefined) providerByModel[e.model] = e.provider;
  }
  state.set("aigc.models", entries.map((e) => e.model));
  state.set("aigc.modelLabels", labelByModel);
  state.set("aigc.modelProviders", providerByModel);
  state.set("aigc.sizes", SIZE_OPTIONS);
  // 提示词优化开关(aigc-tool-settings):持久值 publish 到会话状态,run-image-tool 读同键。
  state.set("aigc.enablePromptOptimization", enablePromptOptimization);
}

/**
 * 注册 AIGC 图像工具的进程内扩展工厂。
 * aigc-tool-settings:装配期读持久设置得到被禁模型集合,喂给两个工具注册函数并使清单同源过滤——
 * 被禁模型从 LLM 枚举与下发清单一并移除。当前已激活会话不追溯(装配期读取的自然结果)。
 */
export const aigcExtension: ExtensionFactory = (pi: ExtensionAPI) => {
  const { disabledModels, enablePromptOptimization } = resolveAigcToolSettings();
  registerImageGeneration(pi, { disabledModels });
  registerImageEdit(pi, { disabledModels });
  publishAigcCatalog(disabledModels, enablePromptOptimization);
};
