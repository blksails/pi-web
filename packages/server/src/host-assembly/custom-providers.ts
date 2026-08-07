/**
 * host-assembly · custom-providers — 自定义 provider 部署级目录注册表装配
 * (spec: multi-gateway-providers,任务 5.3 修复轮;design.md `CustomProviderSource`;
 * Req 7.2, 7.5)。
 *
 * ★ 为什么落在 `server/host-assembly` 而不是从 core barrel 转出:
 * `packages/core/src/model-catalog/index.ts` 文件头声明「零 IO」,而
 * `custom-provider-source.ts` 走 `fs.readFileSync`;`packages/server/src/index.ts`
 * 头部同样声明该主 barrel「纯组装零 env 零 IO」。`host-assembly` 是既有的允许
 * env + IO 的装配层(`model-sources.ts` 已在此读 env 与磁盘),本模块与之同层。
 *
 * ★ 为什么必须经 server 转出:根 `package.json` 只有 `@blksails/pi-web-server`
 * 依赖,**没有** `@blksails/pi-web-core`,`lib/app/pi-handler.ts` 无法 deep-import
 * core 的子路径。本模块把 core 的 `createCustomProviderSource` + `createProviderRegistry`
 * 包成一个装配函数,经 server 的 `./host-assembly/custom-providers.js` 子路径转出
 * (惯例同既有 `./host-assembly/model-sources.js`),供 `lib/app/pi-handler.ts` 使用。
 *
 * 冲突处理:`createProviderRegistry` 在 provider 标识冲突时**抛错**(任务 1.3 的契约)。
 * 而 `readCustomProviderEntries` 的 fail-soft 只丢弃结构不合规的**单条**条目,不去重
 * 同 id ——一份被手工改坏、含重复 id 的 `providers.json` 因此会让装配抛错。本函数
 * 在此吞掉该错误、记日志、退回空注册表:保持「目录端点不因用户配置文件而 500」
 * (与 `ProviderSource.list()` 契约「失败即空集并自记」同精神,只是冲突发生在
 * 注册表组装这一步而非单来源 `list()` 内部,故不能指望 `createProviderRegistry`
 * 自身的单来源 try/catch 兜住)。
 */
import {
  createCustomProviderSource,
  type CustomProviderModel,
} from "@blksails/pi-web-core/model-catalog/custom-provider-source.js";
import {
  createProviderRegistry,
  type ProviderRegistry,
} from "@blksails/pi-web-core/model-catalog/provider-source.js";

/**
 * 组装自定义 provider 的部署级注册表:读 `<agentDir>/providers.json`,产出
 * `ProviderRegistry`(供 `ModelCatalogService` 的 `customProviders` 依赖注入)。
 *
 * 标识冲突(同一 `providers.json` 内重复 id)时不向上抛错 —— 记日志并退回空注册表,
 * 使 `GET /api/config/models` 在用户配置文件损坏时仍能正常响应(降级而非 500)。
 */
export function createCustomProviderRegistry(
  agentDir: string,
): ProviderRegistry<CustomProviderModel> {
  try {
    return createProviderRegistry([createCustomProviderSource(agentDir)]);
  } catch (err) {
    console.error(
      `[host-assembly] 自定义 provider 注册表组装失败(providers.json 标识冲突?),` +
        `退回空注册表: ${err instanceof Error ? err.message : String(err)}`,
    );
    return {
      providers: () => [],
      find: () => undefined,
    };
  }
}

/**
 * 展示可见性(provider-visibility-config spec 任务 2.1)的转出面。
 *
 * 与本模块头注同一条理由:根 `package.json` 只依赖 `@blksails/pi-web-server`,
 * `lib/app/pi-handler.ts` 无法 deep-import core 子路径,故经此转出。
 * `readProviderVisibility` 走 `fs`(属本装配层允许的 IO);`applyProviderVisibility`
 * 是纯函数,一并从此处转出以免调用方拆成两个 import 源。
 */
export { readProviderVisibility } from "@blksails/pi-web-core/model-catalog/custom-provider-source.js";
export {
  applyProviderVisibility,
  type ProviderVisibilityConfig,
} from "@blksails/pi-web-core/model-catalog/visibility-filter.js";
