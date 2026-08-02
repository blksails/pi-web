/**
 * 模型源装配(spec: kernel-boundary-decoupling,任务 4.1/4.3;自定义 provider 接线属
 * spec multi-gateway-providers 任务 5.3,Req 7.2/7.5)。
 *
 * 把 adapters/core 层的具体模型源登记进 runner 的注册表。**本模块属 assembly 层** ——
 * 按定义就允许同时引用 core / runner / adapters,那是它的职责,不是违规。
 *
 * ★ 为什么必须是单独一个模块:若由 `runner.ts` 或 `option-mapper.ts` **静态** import
 *   这两个实现,`runner → adapters` 的跨层边只是从一个文件挪到另一个文件,切包后 runner 包
 *   照样拖上 adapters 包。装配缝必须落在 runner 子树**之外**,并以运行期组合的方式接入。
 *
 * ★ 谁调用它:`runner.ts` 的 `main()` 首行 `composeModelSources()`,以**动态** import 取用。
 *   **不是** `runner-bootstrap.mjs` —— 那是本文件早期注释的说法,已被实测推翻:
 *   runner 有两条被支持的入口(`runner-bootstrap.mjs` 与直接跑 `runner.ts`),缝只放在
 *   bootstrap 会让直接入口**静默丢掉模型源**,表现是「会话起得来但模型找不到」
 *   (被 egress 登录闭环用例抓到)。故缝必须落在两条入口的**汇合点** `main()` 上。
 *   ⚠ 改动此处前先读这一段:把缝挪回 bootstrap 会复活那个缺陷,而测试面未必立刻转红。
 *
 * ★ 调用时机:必须早于 runner 读取注册表(即早于 `buildRuntimeFactory` 执行)。
 *   `main()` 第一件事就是 await 本模块的装配,满足该次序。
 */
import {
  createSharedModelServices,
  registerEgressProvider,
  resolveEgressSpecFromEnv,
  EGRESS_PROVIDER_NAME,
} from "@blksails/pi-web-adapters/auth/egress-model-source.js";
import {
  AI_GATEWAY_PROVIDER_NAME,
  registerAiGatewayProvider,
  resolveAiGatewaySessionSpecsFromEnv,
  declaredAiGatewaySessionProviderNamesFromEnv,
} from "@blksails/pi-web-adapters/ai-gateway/session-model-source.js";
import {
  CUSTOM_PROVIDER_SOURCE_ID,
  readCustomProviderEntries,
  resolveCustomProvidersAgentDir,
  type CustomProviderEntry,
} from "@blksails/pi-web-core/model-catalog/custom-provider-source.js";
import {
  registerModelSource,
  setSharedModelServicesFactory,
} from "@blksails/pi-web-runner/runner/model-source-registrar.js";

/**
 * pi SDK 的 `ProviderConfigInput.models[].input` 只接受 `"text" | "image"`
 * (不是本产品 `Modality` 的四值取值域,design.md「类型维度」表已注明该差异)。
 * 按 provider 级 `input` 声明收窄到 SDK 合法子集;收窄后为空(未声明,或只声明了
 * `video`/`audio`)则退回 `["text"]`,与 egress/ai-gateway 两个既有来源同惯例
 * (它们也恒为 `["text"]`)。
 */
function toSdkInputModalities(
  input: readonly string[] | undefined,
): ("text" | "image")[] {
  const narrowed = (input ?? []).filter(
    (v): v is "text" | "image" => v === "text" || v === "image",
  );
  return narrowed.length > 0 ? narrowed : ["text"];
}

/**
 * 登记 pi-web 内置的模型源。幂等:重复调用不会重复登记同名 provider。
 *
 * 两个源共用**同一个** `ModelRegistry` —— 谁自建 registry 谁就顶掉对方,
 * 故共享服务构造器只登记一份。
 */
export function registerBuiltinModelSources(): void {
  setSharedModelServicesFactory(createSharedModelServices);

  registerModelSource({
    sourceId: EGRESS_PROVIDER_NAME,
    resolveSpecFromEnv: (env) => resolveEgressSpecFromEnv(env),
    // ★ 当前恒为单元素:egress 来源今日只注册一个 provider。任务 3.5 只扩展契约形状,
    //   实际"一个来源多个 provider"的接线属后续任务(3.6)。
    providerNamesOf: () => [EGRESS_PROVIDER_NAME],
    register: (registry, spec) => {
      registerEgressProvider(registry, spec as Parameters<typeof registerEgressProvider>[1]);
    },
  });

  registerModelSource({
    sourceId: AI_GATEWAY_PROVIDER_NAME,
    // ★ spec multi-gateway-providers 任务 3.5(Req 1.1/6.2/6.5):spec 形状改为一批
    //   实例条目(每条各自的 providerName + spec),不再是单个 spec —— 一个来源(网关套件)
    //   今后可注册多个 provider(每个网关实例一个)。空数组视为未启用,与其余来源的
    //   `undefined` 约定对齐。
    resolveSpecFromEnv: (env) => {
      const entries = resolveAiGatewaySessionSpecsFromEnv(env);
      return entries.length > 0 ? entries : undefined;
    },
    // ★ 从解析结果**派生**,不再是硬编码常量 —— 回读能力须反映真实实例数(Req 6.5)。
    providerNamesOf: (entries) => entries.map((e) => e.providerName),
    register: (registry, entries, log) => {
      for (const { providerName, spec } of entries) {
        registerAiGatewayProvider(registry, spec, log, providerName);
      }
    },
    // ★ spec multi-gateway-providers 任务 3.7(Req 6.5)重做:失败文案的来源判据不能
    //   只靠「本次是否已成功解析出 spec」(即上面的 `providerNamesOf(resolveSpecFromEnv(env))`
    //   路径)——网关套件未启用 / 凭据缺失 / 会话侧未注册,恰恰是该文案列出的头号成因,
    //   此时 `resolveSpecFromEnv` 整体返回 `undefined`,判据会在它最该起作用的场景失效。
    //   本回调直接解析 env 取「声明」的全集,与解析成败无关(唯一的生产接线点 ——
    //   `packages/runner/src/runner/option-mapper.ts` 经 `declaredProviderNamesFromEnv`
    //   回读)。
    declaredProviderNamesFromEnv: (env) => declaredAiGatewaySessionProviderNamesFromEnv(env),
  });

  // 自定义 provider(spec multi-gateway-providers,任务 5.3,Req 7.2/7.5):第三个来源,
  // 与 egress / ai-gateway **并列**注册,不特判 —— 同一份 `providers.json`(装配处
  // `custom-provider-source.ts` 的读取逻辑)在部署级目录(`ModelCatalogService` 的
  // `customProviders` 依赖)与会话侧(本处)各自消费,使「同一份定义」在两处同时生效。
  registerModelSource<readonly CustomProviderEntry[]>({
    sourceId: CUSTOM_PROVIDER_SOURCE_ID,
    // ★ 与 egress/ai-gateway 不同:自定义 provider 的配置落在 `<agentDir>/providers.json`
    //   (config 域,而非 env)。`agentDir` 本身经 env 解析(`PI_WEB_AGENT_DIR` 优先,
    //   否则 `PI_CODING_AGENT_DIR` —— runner 子进程恒有后者,由 `assemble-spawn.ts`
    //   写入),这样 `resolveSpecFromEnv(env)` 仍能满足契约签名,而不必扩展契约
    //   本身去接受一个额外的 `agentDir` 参数。只返回**已启用**的条目 —— 停用的
    //   provider 不应在会话中可注册(与部署级目录「停用即消失」对称;它们的定义仍
    //   完整保留在磁盘上,配置不因此丢失)。
    resolveSpecFromEnv: (env) => {
      const agentDir = resolveCustomProvidersAgentDir(env);
      const enabled = readCustomProviderEntries(agentDir).filter((e) => e.enabled);
      return enabled.length > 0 ? enabled : undefined;
    },
    providerNamesOf: (entries) => entries.map((e) => e.id),
    register: (registry, entries, log) => {
      for (const entry of entries) {
        // ★ 实测发现(本任务用例报红揪出):protocol 侧 providers 域把 `apiKey` 设计成
        //   可选(Req 7.2「并非全部自定义 provider 都要求凭据」),但 pi SDK 的
        //   `ModelRegistry.registerProvider` 在传入非空 `models` 时**硬性要求**
        //   `apiKey` 或 `oauth` 二选一,否则同步抛错(`"apiKey" or "oauth" is
        //   required when defining models.`)——自定义 provider 不支持 oauth,
        //   若在此处任其抛出,整个 `register()` 循环(乃至上层 `buildRuntimeFactory`)
        //   会因**一个**缺凭据的 provider 而中断,连带其余已正确配置的自定义 provider
        //   与 egress/ai-gateway 都注册不完。这不是「静默丢弃」——
        //   跳过并记日志,好过让一个 provider 的配置缺陷打断整条会话装配。
        //   部署级目录不受影响:`ModelCatalogService` 只消费 `ProviderDefinition`
        //   (不含 apiKey),该 provider 仍会出现在目录里,只是暂不能在会话中实际调用。
        if (entry.apiKey === undefined) {
          log.info("custom provider skipped for session (no apiKey)", { provider: entry.id });
          continue;
        }
        registry.registerProvider(entry.id, {
          baseUrl: entry.baseUrl,
          apiKey: entry.apiKey,
          api: "openai-completions",
          authHeader: true,
          models: entry.models.map((m) => ({
            id: m.id,
            name: m.name ?? m.id,
            api: "openai-completions",
            reasoning: false,
            input: toSdkInputModalities(entry.input),
            // 计费与上下文窗口对自定义 provider 无从得知,取与 egress/ai-gateway
            // 一致的保守缺省(不影响上游行为,只影响本地截断策略)。
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 128_000,
            maxTokens: 8_192,
          })),
        });
      }
      log.info("custom provider session registered", {
        providers: entries.map((e) => e.id),
        models: entries.reduce((sum, e) => sum + e.models.length, 0),
      });
    },
  });
}
