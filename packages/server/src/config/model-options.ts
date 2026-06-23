/**
 * model-options — 用 pi SDK 在进程内列出「已配置凭证、当前可用」的模型,供 settings
 * 域把 defaultProvider/defaultModel 升级为下拉(见 enrich-settings-models.ts)。
 *
 * 取自 pi SDK 的 ModelRegistry(内置 + `<agentDir>/models.json` 自定义 provider),
 * 经 AuthStorage 解析凭证后只保留 `getAvailable()`(有 auth 的模型) —— 即用户实际
 * 能选的集合。这是 pi-coding-agent CLI `--list-models` 的同源数据,但走进程内 API
 * 而非解析表格输出(后者无 JSON 模式,易碎)。
 *
 * pi SDK 经 next.config `serverExternalPackages` 外置,在 server 运行时以 Node
 * require 加载;此模块刻意与 enrich 纯函数分离,使 config-routes 的单测不被迫加载
 * pi SDK。
 */
import { join } from "node:path";
import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
import type { ModelOptions } from "./model-options.types.js";

/**
 * 列出 `<agentDir>` 下已配置凭证的可用模型。
 * 同步:AuthStorage/ModelRegistry 的构造与 getAvailable() 均不触发网络/OAuth 刷新。
 * 抛错由调用方(config-routes)兜底回退,不阻断配置读取。
 */
export function listModelOptions(agentDir: string): ModelOptions {
  const authStorage = AuthStorage.create(join(agentDir, "auth.json"));
  const registry = ModelRegistry.create(authStorage, join(agentDir, "models.json"));
  const models = registry.getAvailable().map((m) => ({
    provider: m.provider,
    id: m.id,
    name: m.name,
  }));
  const providers = [...new Set(models.map((m) => m.provider))].sort();
  return { providers, models };
}
