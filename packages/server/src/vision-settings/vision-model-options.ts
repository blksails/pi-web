/**
 * vision-model-options — 用 pi SDK 在进程内列出「已配置凭证 **且支持图像输入**」的模型,
 * 供 Canvas 提示词栏的视觉模型选择器列举(spec canvas-vision-readout)。
 *
 * 与 `config/model-options.ts` 同构:`AuthStorage` + `ModelRegistry`(内置模型 +
 * `<agentDir>/models.json` 自定义 provider),`getAvailable()` 只保留有 auth 的模型。
 * 在其上追加 `input` 含 `"image"` 的过滤 —— 与 `image_vision` 工具自身的候选计算
 * (tool-kit `select-model.ts` 的 `listVisionModels`)**逐字同构**,故下拉里看到的
 * 就是工具弹层里能选到的,两处不会出现差异。
 *
 * ⚠ 安全:`Model` 含 `baseUrl` 等字段。此处**显式挑字段**构造 `VisionModelOption`,
 * 绝不整体透传(端点是公开只读的)。
 *
 * pi SDK 经 next.config `serverExternalPackages` 外置;此模块刻意与薄路由分离,
 * 使 `vision-models-routes` 的单测不被迫加载 pi SDK。
 */
import { join } from "node:path";
import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
import type { VisionModelOptions } from "./vision-model-options.types.js";

/**
 * 列出 `<agentDir>` 下「已配置凭证且支持图像输入」的模型。
 *
 * 同步:`AuthStorage` / `ModelRegistry` 的构造与 `getAvailable()` 均不触发网络 / OAuth 刷新。
 * 抛错由调用方(路由)兜底为空清单,不阻断前端。
 */
export function listVisionModelOptions(agentDir: string): VisionModelOptions {
  const authStorage = AuthStorage.create(join(agentDir, "auth.json"));
  const registry = ModelRegistry.create(authStorage, join(agentDir, "models.json"));
  const models = registry
    .getAvailable()
    .filter((m) => m.input.includes("image"))
    .map((m) => ({
      value: `${m.provider}/${m.id}`,
      label: m.name.length > 0 ? m.name : m.id,
      provider: m.provider,
    }));
  return { models };
}
