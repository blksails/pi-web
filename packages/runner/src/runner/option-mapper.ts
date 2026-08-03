/**
 * option-mapper — `AgentDefinition` → `CreateAgentSessionRuntimeFactory` 的**装配**。
 *
 * 三件事分住三个模块(SRP);本文件只保留第三件,并 re-export 前两件以保持既有 import 面:
 *  - 资源类映射(systemPrompt / extensions / skills / prompts / contextFiles)
 *    → `resource-options.ts`
 *  - 会话类映射(model / thinkingLevel / scopedModels / tools …)与模型解析
 *    → `session-options.ts`
 *  - **本文件**:把两者与模型源、trust 钩子组装成 factory。
 *
 * 缺省字段一律不注入,保留 pi 的默认发现行为。
 */
import { createLogger } from "@blksails/pi-web-logger";
import type { SlashCompletionDecl } from "@blksails/pi-web-protocol";
import type { AgentDefinition } from "@blksails/pi-web-core/agent-definition.js";
// spec multi-gateway-providers(任务 3.7,Req 6.5):失败文案的来源判据须覆盖该来源
// **声明**要注册的全部网关实例名(与是否已成功解析无关),而非模块级常量 —— 需要认得
// 网关来源的 sourceId 才能从 `listModelSources()` 里挑出它,取中立命名空间常量,
// 不引入具体 adapter 实现。
import { AI_GATEWAY_PROVIDER_NAME } from "@blksails/pi-web-core/model-provider-names.js";
import {
  type AgentSessionServices,
  createAgentSessionFromServices,
  createAgentSessionServices,
  type CreateAgentSessionRuntimeFactory,
  type CreateAgentSessionServicesOptions,
  type CreateAgentSessionFromServicesOptions,
} from "@earendil-works/pi-coding-agent";
import type { ResolveProjectTrust } from "./project-trust.js";
// desktop-cloud-login:登录态注入指向 egress 的共享 ModelRegistry(引 pi SDK 值,按子路径直引,
// 不经 server barrel;egress-model-source 见 auth/)。
// spec kernel-boundary-decoupling(任务 4.2):模型源改为经**注册表**取得,不再直接
// import auth / ai-gateway 的具体实现 —— 那两条 import 是 runner → adapters 的跨层边,
// 切包后会让 runner 包拖上 adapters 包。具体实现由 assembly 层在启动前自注册。
import {
  getSharedModelServicesFactory,
  listModelSources,
} from "./model-source-registrar.js";
import {
  collectExtensionPaths,
  mapResourceLoaderOptions,
  type SystemResourceOverrides,
} from "./resource-options.js";
import { mapSessionFields, resolveModel, type SessionModel } from "./session-options.js";

// 资源类 / 会话类映射已析出;此处原样再导出,使既有
// `from ".../option-mapper.js"` 的 import 路径零改动。
export {
  collectExtensionPaths,
  collectForcedExtensionPaths,
  mapResourceLoaderOptions,
} from "./resource-options.js";
export type {
  MappedResourceLoaderOptions,
  SystemResourceOverrides,
} from "./resource-options.js";
export { isModelRef, mapSessionFields } from "./session-options.js";
export type { MappedSessionFields } from "./session-options.js";

/** runner 侧模型来源注册的日志出口(Req 7.1:记 provider 名与条目数,绝不记凭据)。 */
const runnerLog = createLogger({ namespace: "server:runner:model-source" });

/**
 * Build a `CreateAgentSessionRuntimeFactory` from a normalized definition.
 *
 * The factory, when invoked by `createAgentSessionRuntime`, creates cwd-bound
 * services (wiring `resolveProjectTrust`), resolves model refs against the
 * registry, creates the session from services, and returns the runtime result
 * including `services` and `diagnostics`.
 */
export function buildRuntimeFactory(
  def: AgentDefinition,
  trust: ResolveProjectTrust,
  systemResources: SystemResourceOverrides = {},
): CreateAgentSessionRuntimeFactory & {
  slashCompletions?: readonly SlashCompletionDecl[];
} {
  const session = mapSessionFields(def);

  const factory: CreateAgentSessionRuntimeFactory & {
    slashCompletions?: readonly SlashCompletionDecl[];
  } = async ({ cwd, agentDir, sessionManager, sessionStartEvent }) => {
    // 主来源=runner 侧自解析(与文件系统无关);env 仅作过渡兼容与 sandbox 入口(已去重)。
    //
    // ★ 在 factory **内部**求值,不在 buildRuntimeFactory 求值一次后闭包捕获:factory 会被
    //   进程内的 new_session / switchSession / fork 多次调用,而捕获式写法会把首次求得的
    //   路径集永久钉死。当前 runner 是 per-session 子进程、env 进程内不变,故两种写法结果
    //   相同 —— 但一旦进程被复用(池化预 spawn),捕获式就会静默沿用陈旧值,表现是「新会话
    //   的内置扩展是上一个会话的」。放在这里使正确性不依赖「进程不复用」这个外部前提。
    const forcedExtensionPaths = collectExtensionPaths(process.env);
    const { resourceLoaderOptions } = mapResourceLoaderOptions(def, {
      forcedExtensionPaths,
      ...(systemResources.noSkills !== undefined ? { noSkills: systemResources.noSkills } : {}),
      ...(systemResources.noExtensions !== undefined
        ? { noExtensions: systemResources.noExtensions }
        : {}),
    });
    // desktop-cloud-login(Req 3.1/3.2/4.1/4.3):登录态经 runner env 注入指向云端 egress 的
    // 共享 ModelRegistry。★ 该 registry 由 `ModelRegistry.create` 读 `<agentDir>/models.json`
    // 构造,各模型源在其上**叠加** registerProvider(spec multi-gateway-providers 任务 2.1,
    // Req 6.1/6.3/6.4)—— 只读不写,不改 agentDir。此前用 inMemory 会顶掉磁盘上的自定义
    // provider 与覆写。未登录/未启用 → undefined,保持 SDK 默认,字节级等价今日本地路径。
    //
    // spec ai-gateway-session-models(design.md §D2,Req 1.1/1.3/3.1/3.4):会话服务只有
    // `modelRegistry` 一个位置,而 egress 与 ai-gateway 两个来源都要注册 provider ——
    // 谁自建 registry 谁就顶掉对方。故改为「先各自解析,再合成单一 registry」。
    // 两者皆无 → 完全不触碰 servicesOptions,保持 SDK 默认(共享 auth.json + models.json),
    // 与本 spec 实施前逐字节等价。
    // 逐个已登记的模型源解析其 env 配置;全部未配置 → 完全不触碰 servicesOptions,
    // 保持 SDK 默认(共享 auth.json + models.json),与本改动前逐字节等价。
    const resolved = listModelSources()
      .map((registrar) => ({ registrar, spec: registrar.resolveSpecFromEnv(process.env) }))
      .filter((r): r is { registrar: typeof r.registrar; spec: NonNullable<typeof r.spec> } =>
        r.spec !== undefined,
      );
    const servicesOptions: CreateAgentSessionServicesOptions = {
      cwd,
      agentDir,
      resourceLoaderOptions,
      resourceLoaderReloadOptions: { resolveProjectTrust: trust },
    };
    if (resolved.length > 0) {
      const makeShared = getSharedModelServicesFactory();
      if (makeShared === undefined) {
        // 有源可注册却没有共享服务构造器 —— 装配漏了一半。静默跳过会表现为
        // 「模型列表里有、选中却说找不到」,故 fail-fast。
        throw new Error(
          "模型源已登记但共享服务构造器缺失:assembly 层须同时调用 " +
            "setSharedModelServicesFactory()。",
        );
      }
      const shared = makeShared(agentDir);
      for (const { registrar, spec } of resolved) {
        // spec multi-gateway-providers 任务 3.5:一个来源今后可注册多个 provider,
        // 日志改按 `providerNamesOf` 回读而非假定"来源=provider"一一对应。
        runnerLog.info("model source resolved", {
          sourceId: registrar.sourceId,
          providers: registrar.providerNamesOf(spec),
        });
        registrar.register(shared.modelRegistry, spec, runnerLog);
      }
      servicesOptions.authStorage = shared.authStorage;
      servicesOptions.modelRegistry = shared.modelRegistry;
    }
    const services: AgentSessionServices = await createAgentSessionServices(servicesOptions);

    const registry = services.modelRegistry;
    // spec multi-gateway-providers(任务 3.7,Req 6.5)—— 重做:上一版从 `resolved`
    // (本次已成功解析出 spec 的源)取 provider 名,网关源本次未解析出 spec 时整体
    // 退回缺省单实例常量。但失败文案本身把「网关套件未启用 / 凭据缺失 / 会话侧未
    // 注册」列为头号成因 —— 恰在这些场景下 `resolveSpecFromEnv` 会返回 `undefined`,
    // 判据因而在它最该起作用的地方失效(完整性复查抓到:`cloudflare`/`blksails-ai`
    // 仍拿裸文案)。★ 判据不能是「该源是否已注册成功」。
    //
    // 改为:判据取自该来源在当前 env 下**声明**要注册的全部实例名 ——
    // `declaredProviderNamesFromEnv`(见 `model-source-registrar.ts`),直接解析 env
    // 取全集,与 `resolveSpecFromEnv` 是否解析成功无关。故从**已登记的全部来源**
    // (`listModelSources()`,不再限定 `resolved`)里按 `sourceId` 挑出网关来源后调用。
    //
    // ★ 与「声明集」取**并集**,而不是「声明集存在就整体取代已解析集」——若只用 `??`
    //   短路,一旦来源实现了 `declaredProviderNamesFromEnv` 却在当前 env 下返回空数组
    //   (如:未配置任何网关 env),`[] ?? x` 的结果仍是 `[]` 而非落到 `x`,判据会被
    //   收窄成空集,连缺省名 `ai-gateway` 都拿不到来源文案 —— 相对改造前是回归
    //   (违反 Req 9.1 的逐字节等价)。并集为空 → 显式传 `undefined`,让 `resolveModel`
    //   落回其模块内的 `DEFAULT_GATEWAY_PROVIDER_NAMES`,与改造前逐字节等价。
    const gatewaySource = listModelSources().find(
      (registrar) => registrar.sourceId === AI_GATEWAY_PROVIDER_NAME,
    );
    const gatewayResolvedEntry = resolved.find(
      ({ registrar }) => registrar.sourceId === AI_GATEWAY_PROVIDER_NAME,
    );
    const declaredGatewayProviderNames = gatewaySource?.declaredProviderNamesFromEnv?.(
      process.env,
    );
    const resolvedGatewayProviderNames =
      gatewayResolvedEntry !== undefined
        ? gatewayResolvedEntry.registrar.providerNamesOf(gatewayResolvedEntry.spec)
        : undefined;
    const gatewayProviderNamesUnion = new Set<string>([
      ...(declaredGatewayProviderNames ?? []),
      ...(resolvedGatewayProviderNames ?? []),
    ]);
    const gatewayProviderNames =
      gatewayProviderNamesUnion.size > 0 ? Array.from(gatewayProviderNamesUnion) : undefined;
    const model =
      session.model !== undefined
        ? resolveModel(session.model, registry, gatewayProviderNames)
        : undefined;
    const scopedModels =
      session.scopedModels !== undefined
        ? session.scopedModels.map((entry) => {
            const resolved: { model: SessionModel; thinkingLevel?: AgentDefinition["thinkingLevel"] } = {
              model: resolveModel(entry.model, registry, gatewayProviderNames),
            };
            if (entry.thinkingLevel !== undefined) {
              resolved.thinkingLevel = entry.thinkingLevel;
            }
            return resolved;
          })
        : undefined;

    const fromServices: CreateAgentSessionFromServicesOptions = {
      services,
      sessionManager,
    };
    if (sessionStartEvent !== undefined) fromServices.sessionStartEvent = sessionStartEvent;
    if (model !== undefined) fromServices.model = model;
    if (session.thinkingLevel !== undefined) fromServices.thinkingLevel = session.thinkingLevel;
    if (scopedModels !== undefined) fromServices.scopedModels = scopedModels;
    if (session.tools !== undefined) fromServices.tools = session.tools;
    if (session.excludeTools !== undefined) fromServices.excludeTools = session.excludeTools;
    if (session.noTools !== undefined) fromServices.noTools = session.noTools;
    if (session.customTools !== undefined) fromServices.customTools = session.customTools;

    const created = await createAgentSessionFromServices(fromServices);

    return {
      ...created,
      services,
      diagnostics: services.diagnostics,
    };
  };

  // pi-web 自有元数据:把 agent 声明的静态 slash 补全候选附到 factory 上,供 runner
  // 装配期读取并经 stdout 帧推送给 server 主进程(不进 pi session)。
  if (def.slashCompletions !== undefined && def.slashCompletions.length > 0) {
    factory.slashCompletions = def.slashCompletions;
  }
  return factory;
}
