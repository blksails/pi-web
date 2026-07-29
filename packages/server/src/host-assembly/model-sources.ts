/**
 * 模型源装配(spec: kernel-boundary-decoupling,任务 4.1/4.3)。
 *
 * 把 adapters 层的两个具体模型源登记进 runner 的注册表。**本模块属 assembly 层** ——
 * 按定义就允许同时引用 core / runner / adapters,那是它的职责,不是违规。
 *
 * ★ 为什么必须是单独一个模块、且由 `runner-bootstrap.mjs` 导入:
 *   若由 `runner.ts` 或 `option-mapper.ts` 去 import 这两个实现,`runner → adapters`
 *   的跨层边只是从一个文件挪到另一个文件,切包后 runner 包照样拖上 adapters 包。
 *   装配缝必须落在 runner 子树**之外**。
 *
 * ★ 调用时机:必须早于 runner 读取注册表(即早于 `buildRuntimeFactory` 执行)。
 *   引导脚本在 import runner 之前调用本模块,满足该次序。
 */
import {
  createSharedModelServices,
  registerEgressProvider,
  resolveEgressSpecFromEnv,
  EGRESS_PROVIDER_NAME,
} from "../auth/egress-model-source.js";
import {
  AI_GATEWAY_PROVIDER_NAME,
  registerAiGatewayProvider,
  resolveAiGatewaySessionSpecFromEnv,
} from "../ai-gateway/session-model-source.js";
import {
  registerModelSource,
  setSharedModelServicesFactory,
} from "../runner/model-source-registrar.js";

/**
 * 登记 pi-web 内置的模型源。幂等:重复调用不会重复登记同名 provider。
 *
 * 两个源共用**同一个** `ModelRegistry` —— 谁自建 registry 谁就顶掉对方,
 * 故共享服务构造器只登记一份。
 */
export function registerBuiltinModelSources(): void {
  setSharedModelServicesFactory(createSharedModelServices);

  registerModelSource({
    providerName: EGRESS_PROVIDER_NAME,
    resolveSpecFromEnv: (env) => resolveEgressSpecFromEnv(env),
    register: (registry, spec) => {
      registerEgressProvider(registry, spec as Parameters<typeof registerEgressProvider>[1]);
    },
  });

  registerModelSource({
    providerName: AI_GATEWAY_PROVIDER_NAME,
    resolveSpecFromEnv: (env) => resolveAiGatewaySessionSpecFromEnv(env),
    register: (registry, spec, log) => {
      registerAiGatewayProvider(
        registry,
        spec as Parameters<typeof registerAiGatewayProvider>[1],
        log,
      );
    },
  });
}
