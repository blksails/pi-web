/**
 * `visionExtension` — 视觉识别的进程内 pi extension factory。
 *
 * 仅注册 `image_vision` 工具与 `/img_vision` 命令,**不注册任何事件钩子、无全局副作用**
 * ⇒ 装载后对话流行为不变(7.3);未装载时与该能力不存在时完全一致(7.4)。
 *
 * 经 `AgentDefinition.extensions` 装载(与 `aigcExtension` 同形):
 *   defineAgent({ extensions: [visionExtension] })
 *
 * 含 pi SDK 值导入(`completeSimple`),故只从 `@blksails/pi-web-tool-kit/runtime`
 * 子入口导出 —— 主入口须保持前端安全。
 */
import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { getAttachmentToolContext } from "../attachment/seam.js";
import { registerImgVisionCommand } from "./command.js";
import { createVisionRunner, envDefaultModel } from "./run-vision-tool.js";
import { registerImageVision } from "./tools/image-vision.js";
import { VISION_MODEL_ENV, type CompleteFn, type VisionRunnerDeps } from "./types.js";

/**
 * 惰性取 `completeSimple`。
 *
 * ⚠ 这里踩过两层坑,别「简化」回静态顶层 import:
 *
 * 1. `@earendil-works/pi-ai` 的 `exports["./compat"]` **只声明 `import` 条件、没有
 *    `require`**。agent 源经 jiti(CJS 转译)加载本模块时,顶层 import 会被降级成
 *    `require("@earendil-works/pi-ai/compat")` 而解析失败。
 * 2. runner 的 jiti `alias` 做的是**前缀替换**,`@earendil-works/pi-ai` → 包目录,
 *    于是子路径变成 `<pkgDir>/compat`(实际文件在 `<pkgDir>/dist/compat.js`),
 *    包自身的 `exports` 再也不会被查询。
 *
 * 修法是两处配合:`agent-loader.ts` 为该子路径注册**精确 alias**(直指 `dist/compat.js`),
 * 本处用**动态 import** 把加载推迟到首次真正调用模型时。
 *
 * `auto-title` 用顶层 import 没事,是因为它经 `forcedExtensionPaths` 由 pi 自己的
 * extension loader(ESM)加载,从不走 jiti 的 agent-loader —— 别照抄它的写法。
 */
let cachedComplete: CompleteFn | undefined;
const lazyComplete: CompleteFn = async (model, context, options) => {
  if (cachedComplete === undefined) {
    const mod = await import("@earendil-works/pi-ai/compat");
    cachedComplete = mod.completeSimple as unknown as CompleteFn;
  }
  return cachedComplete(model, context, options);
};

/** 生产默认依赖:真实模型调用 + 真实附件上下文 + env 默认模型。 */
function defaultDeps(): VisionRunnerDeps {
  return {
    complete: lazyComplete,
    getAttachmentCtx: () => getAttachmentToolContext(),
    defaultModel: envDefaultModel(VISION_MODEL_ENV),
  };
}

/**
 * 构造视觉识别 extension。`overrides` 供测试注入 fake `complete` / 附件上下文。
 */
export function makeVisionExtension(
  overrides?: Partial<VisionRunnerDeps>,
): ExtensionFactory {
  return (pi: ExtensionAPI) => {
    const deps: VisionRunnerDeps = { ...defaultDeps(), ...overrides };
    const run = createVisionRunner(deps);
    registerImageVision(pi, run);
    registerImgVisionCommand(pi, run);
  };
}

/** 生产用 extension(零参装载)。 */
export const visionExtension: ExtensionFactory = makeVisionExtension();
