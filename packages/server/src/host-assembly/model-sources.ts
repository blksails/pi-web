/**
 * 模型源装配(spec: kernel-boundary-decoupling,任务 4.1/4.3)。
 *
 * 把 adapters 层的两个具体模型源登记进 runner 的注册表。**本模块属 assembly 层** ——
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
  registerModelSource,
  setSharedModelServicesFactory,
} from "@blksails/pi-web-runner/runner/model-source-registrar.js";

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
}
