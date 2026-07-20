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
  AI_GATEWAY_IMAGE_ROUTES,
} from "./tools/image-generation.js";
import { registerImageEdit, AI_GATEWAY_IMAGE_EDIT_ROUTES } from "./tools/image-edit.js";
import { getSessionState } from "../session-state.js";
import { resolveAigcToolSettings } from "./model-config.js";
import { deriveActiveModels } from "./active-models.js";
import type { ImageRoute } from "./types.js";

/** 尺寸档位(与两工具 requiredParams 的 size 选项一致;auto = 交由工具默认行为)。 */
export const SIZE_OPTIONS: readonly string[] = ["1024x1024", "1536x1024", "1024x1536", "auto"];

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
  extraRoutes: readonly ImageRoute[],
  attempt = 0,
): void {
  const state = getSessionState();
  if (!state.available) {
    if (attempt < PUBLISH_MAX_TRIES) {
      setTimeout(
        () => publishAigcCatalog(disabledModels, enablePromptOptimization, extraRoutes, attempt + 1),
        attempt === 0 ? 0 : PUBLISH_RETRY_MS,
      );
    }
    return;
  }
  // aigc-tool-settings:下发清单须与工具实际暴露的模型同源过滤——被禁模型从 models/labels/providers
  // 一并移除(前端 picker 自然收敛);全禁时 deriveActiveModels 内部 filterRoutes 保留默认,与工具侧一致。
  // canvas-actions-m2:活跃模型推导提取为 deriveActiveModels 共享纯函数(KV 键/值/顺序零变),
  // 与 buildCanvasCapability 同源消费。清单仍是 id 数组(value/路由键不变),另下发 label 映射供
  // 选择器渲染「可见=label、hover title=id」、provider 映射供字母徽章。extraRoutes(Req 4.2/5.2):
  // 与两工具注册时同一批 ai-gateway 条件路由,使清单下发与工具实际暴露的模型同源(未启用套件
  // 时为空数组,行为逐字节一致)。
  const entries = deriveActiveModels(disabledModels, extraRoutes);
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
/** 网关 env 的新名 → 旧名映射(旧名仅为存量部署兼容,见下方函数注释)。 */
const GATEWAY_ENV_ALIASES: readonly (readonly [string, string])[] = [
  ["BLKSAILS_GATEWAY_BASE_URL", "AI_GATEWAY_BASE_URL"],
  ["BLKSAILS_GATEWAY_API_KEY", "AI_GATEWAY_API_KEY"],
];

/**
 * 存量部署兼容:新名未设而旧名有值时,把值搬到新名下。
 *
 * 声明层的 `${VAR:-default}` 占位不支持多变量回落(见 engine/var-resolver 的 VAR_RE),
 * 故回落只能在允许读 env 的 runtime 层做一次归一化。
 *
 * ⚠️ 运维注意:旧名 `AI_GATEWAY_API_KEY` 是 pi-ai SDK 的 **Vercel AI Gateway** 保留 env,
 * 只要它存在于 pi 进程环境里就会劫持全部模型调用(pi-clouds 8.2 事故)。本函数只做"读得到"
 * 的兼容,**不能**消除这个劫持——沙箱等 pi 同进程场景必须改配新名,故此处显式告警。
 */
function normalizeGatewayEnvNames(): void {
  for (const [next, legacy] of GATEWAY_ENV_ALIASES) {
    const nextVal = process.env[next];
    const legacyVal = process.env[legacy];
    if (
      (nextVal === undefined || nextVal.trim() === "") &&
      legacyVal !== undefined &&
      legacyVal.trim() !== ""
    ) {
      process.env[next] = legacyVal;
      console.warn(
        `[aigc] ${legacy} 已弃用,请改配 ${next}。` +
          `本次已按旧名取值;但在与 pi 同进程的场景(如云沙箱)下,${legacy} 会被 pi-ai SDK ` +
          `当作 Vercel AI Gateway 凭据并劫持全部模型调用,必须迁移。`,
      );
    }
  }
}

export const aigcExtension: ExtensionFactory = (pi: ExtensionAPI) => {
  const { disabledModels, enablePromptOptimization } = resolveAigcToolSettings();
  // ai-gateway 路由组条件并入(spec ai-gateway-providers,design.md §3,Req 5.2/5.3):
  // 本模块属 runtime 层(经 `@blksails/pi-web-tool-kit/runtime` 加载,含 pi SDK 值导入),
  // 允许读 env——浏览器 bundle 只见声明层的类型/静态 routes,不违双入口边界(Req 6.2)。
  // 未配置 AI_GATEWAY_BASE_URL 时 extraRoutes 为 undefined,两工具行为与今天逐字节一致。
  normalizeGatewayEnvNames();
  const aiGatewayEnabled =
    typeof process.env.BLKSAILS_GATEWAY_BASE_URL === "string" &&
    process.env.BLKSAILS_GATEWAY_BASE_URL.trim().length > 0;
  const genExtraRoutes: readonly ImageRoute[] | undefined = aiGatewayEnabled
    ? AI_GATEWAY_IMAGE_ROUTES
    : undefined;
  const editExtraRoutes: readonly ImageRoute[] | undefined = aiGatewayEnabled
    ? AI_GATEWAY_IMAGE_EDIT_ROUTES
    : undefined;
  registerImageGeneration(pi, { disabledModels, extraRoutes: genExtraRoutes });
  registerImageEdit(pi, { disabledModels, extraRoutes: editExtraRoutes });
  const publishExtraRoutes: readonly ImageRoute[] = aiGatewayEnabled
    ? [...AI_GATEWAY_IMAGE_ROUTES, ...AI_GATEWAY_IMAGE_EDIT_ROUTES]
    : [];
  publishAigcCatalog(disabledModels, enablePromptOptimization, publishExtraRoutes);
};
