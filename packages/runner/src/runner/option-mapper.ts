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
import {
  type AgentSessionServices,
  createAgentSessionFromServices,
  createAgentSessionServices,
  type CreateAgentSessionRuntimeFactory,
  type CreateAgentSessionServicesOptions,
  type CreateAgentSessionFromServicesOptions,
} from "@earendil-works/pi-coding-agent";
import type { ResolveProjectTrust } from "./project-trust.js";
// desktop-cloud-login:登录态注入指向 egress 的内存 ModelRegistry(引 pi SDK 值,按子路径直引,
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
    // 内存 ModelRegistry(复用共享 auth.json,零落盘,不改 agentDir)。未登录/未启用 →
    // undefined,保持 SDK 默认(共享 auth.json + models.json),字节级等价今日本地路径。
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
        registrar.register(shared.modelRegistry, spec, runnerLog);
      }
      servicesOptions.authStorage = shared.authStorage;
      servicesOptions.modelRegistry = shared.modelRegistry;
    }
    const services: AgentSessionServices = await createAgentSessionServices(servicesOptions);

    const registry = services.modelRegistry;
    const model =
      session.model !== undefined ? resolveModel(session.model, registry) : undefined;
    const scopedModels =
      session.scopedModels !== undefined
        ? session.scopedModels.map((entry) => {
            const resolved: { model: SessionModel; thinkingLevel?: AgentDefinition["thinkingLevel"] } = {
              model: resolveModel(entry.model, registry),
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
