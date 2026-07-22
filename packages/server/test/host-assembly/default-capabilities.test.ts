/**
 * host-assembly · 装配级等价测试(spec: host-contract-capability-composition,M3,任务 4.1)。
 *
 * 权威依据:`.kiro/specs/host-contract-capability-composition/design.md`(D1/D2/D3)、
 * `docs/pi-web-host-contract-v1.md` §5.3。
 *
 * 六组守卫,逐条附「什么错误实现会让它转红」的变异判据:
 *  ① id 集 === 名册(杀多/少一个 descriptor)
 *  ② 路由集等价:compose 全 use 的路由并集 === 直调各工厂并集(杀漏绑/绑错工厂)
 *  ③ 命令集 === 现状两个 host 命令名(杀 host.commands 漏绑)
 *  ④ 条件两态:llm/ai/auth 未配置产空、已配置产非空(杀条件映射错)
 *  ⑤ 强制表态:漏一个 id → 抛 `CapabilityCompositionError` code `missing-decision`(杀表态不全被放过)
 *  ⑥ host.commands 可弃用:decline 后无命令贡献、不抛、onDecline 收到 (id,reason)(杀非路由不能弃用)
 *
 * HostDeps 构造策略:多数 factory 在**构造路由**时不解引用 deps 内容(store/manager 等的方法
 * 只在路由 handler 运行时才调),故用「真实轻量对象 + 结构化 stub」拼出代表性 HostDeps ——
 * 见 STUBS_USED 记录(交付报告)。
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  defaultCapabilities,
  type HostDeps,
} from "../../src/host-assembly/default-capabilities.js";
import type { HostContribution } from "../../src/host-assembly/host-contribution.js";
import {
  CapabilityCompositionError,
  composeCapabilities,
  HOST_CAPABILITY_IDS_V1,
  type CapabilityDecision,
} from "../../src/host-manifest/index.js";
import { InMemorySessionStore } from "../../src/session/session-store.js";
import { SessionManager } from "../../src/session/session-manager.js";
import { AuthSessionState } from "../../src/auth/auth-session-state.js";
import { AttachmentStore } from "../../src/attachment/attachment-store.js";
import { createUrlSigner } from "../../src/attachment/url-signer.js";
import { LocalFsBlobBackend } from "../../src/attachment/local-fs-backend.js";
import { AttachmentRegistry } from "../../src/attachment/attachment-registry.js";
import type { PiCli } from "../../src/extensions/ext.types.js";
import type { HostCommandHandler } from "../../src/commands/host-command-registry.js";
// 守卫②的**独立基线**:直接 import 15 个真实路由工厂,与 defaultCapabilities 分离地各调一次
// 作为「第二份真相」。绑错/漏绑工厂只改 defaultCapabilities 一侧 → 与此基线对不上 → 转红。
// ★ 不得用 `descriptors.flatMap(d.factory)`(那是同一份 factory 自我对比,恒等,对绑错零反应)。
import { createConfigRoutes } from "../../src/config/config-routes.js";
import { createMcpConfigRoutes } from "../../src/config/mcp-config-routes.js";
import { createSandboxProjectRoutes } from "../../src/config/sandbox-project-routes.js";
import { createSourceSettingsRoutes } from "../../src/config/source-settings-routes.js";
import { createExtensionsConfigRoutes } from "../../src/config/extensions-config-routes.js";
import { createSessionListRoutes } from "../../src/session-list/session-list-routes.js";
import { createSessionActionsRoutes } from "../../src/session-actions/session-actions-routes.js";
import { createAgentSourcesRoutes } from "../../src/agent-source-list/agent-sources-routes.js";
import { createFavoritesRoutes } from "../../src/agent-source-list/favorites-routes.js";
import { createLlmGatewayRoutes } from "../../src/llm-gateway/gateway-routes.js";
import { createAiGatewayRoutes } from "../../src/ai-gateway/routes.js";
import { createAuthRoutes } from "../../src/auth/auth-routes.js";
import { createAttachmentRoutes } from "../../src/http/routes/attachment-routes.js";
import { createBashRoutes } from "../../src/http/routes/bash-routes.js";
import { createExtensionRoutes } from "../../src/extensions/routes.js";

/**
 * ★ 真实命令名(dumped,非猜测):`lib/app/clear-host-command.ts` 的
 * `createClearHostCommand()` 返回 `{ name: "clear", … }`;`lib/app/install-host-command.ts`
 * 的 `createInstallHostCommand(...)` 返回 `{ name: COMMAND_NAME, … }` 其中
 * `COMMAND_NAME`(该文件内 `grep -n "name:" install-host-command.ts` 第 264 行绑定)= `"install"`。
 * 两文件在仓库根 `lib/app/`(pi-handler 装配层),不属 `packages/server` 包边界,故本测试
 * 不跨包 import 它们,只以**结构化 stub**复刻其公开形状(`{ name, execute }`),name 取
 * 上述 dump 到的真实字符串常量。
 */
const REAL_HOST_COMMAND_NAMES = ["clear", "install"] as const;

function stubHostCommand(name: string): HostCommandHandler {
  return {
    name,
    execute: vi.fn(async () => ({ command: name, effect: "none" as const })),
  };
}

/** 结构化最小 PiCli stub(仅供 `createExtensionRoutes` 工厂构造期持有,不在本测试内被调用)。 */
function stubPiCli(): PiCli {
  return {
    runPiCommand: vi.fn(async () => ({ ok: true, stdout: "", exitCode: 0 })),
    listExtensions: vi.fn(async () => []),
  };
}

const tmpRoots: string[] = [];
function mkTmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tmpRoots.push(dir);
  return dir;
}

/**
 * 构造代表性 HostDeps。`conditional` 控制 `gateway.llm`/`gateway.ai`/`auth.session` 三个
 * 可选字段是否被构造(D3 的条件挂载:未配置时字段为 `undefined`,由此驱动守卫④两态)。
 */
function buildDeps(opts: { readonly conditional: boolean }): HostDeps {
  const agentDir = mkTmp("host-assembly-agent-");
  const defaultCwd = mkTmp("host-assembly-cwd-");
  const attachmentRoot = mkTmp("host-assembly-attach-");

  const store = new InMemorySessionStore(true);
  const manager = new SessionManager({ store });
  const piCli = stubPiCli();

  const signer = createUrlSigner("test-secret-stable");
  const backend = new LocalFsBlobBackend(attachmentRoot, signer);
  const registry = new AttachmentRegistry(attachmentRoot);
  const attachmentStore = new AttachmentStore({ blob: backend, registry, signer, backend });

  const base: HostDeps = {
    agentDir,
    defaultCwd,
    listModelOptions: () => ({ providers: [], models: [] }),
    resolveSourceSettings: async () => undefined,
    onSourceSettingsSaved: () => {},
    sessionStoreConfig: { kind: "fs", root: join(agentDir, "sessions") },
    sessionsGlobalEnabled: true,
    sessionsManageEnabled: true,
    sourcesScanRoots: [],
    sourcesRegistryPath: join(agentDir, "agent-sources-registry.json"),
    attachmentStore,
    resolveWriteBackend: () => undefined,
    store,
    bashEnabled: true,
    extension: { piCli, store, manager },
    hostCommandHandlers: REAL_HOST_COMMAND_NAMES.map(stubHostCommand),
  };

  if (!opts.conditional) return base;

  return {
    ...base,
    llmGateway: { secret: "test-llm-secret", registry: {} },
    aiGateway: {
      baseUrl: "http://ai-gateway.test",
      secret: "test-ai-secret",
      keyResolver: { resolve: async () => undefined },
    },
    authState: new AuthSessionState(),
  };
}

afterEach(() => {
  // mkdtempSync 目录留在系统临时区不清理不影响测试正确性(vitest 各用例独立目录);
  // 显式清空数组即可,不做磁盘 rm(测试运行期只读/只写临时区,非本文件职责)。
  tmpRoots.length = 0;
});

/** 收集贡献里的路由 `{method,path}`(丢弃 handler,handler 引用不参与相等比较)。 */
function routeShape(c: HostContribution): { method: string; path: string } | undefined {
  return c.kind === "route" ? { method: c.route.method, path: c.route.path } : undefined;
}

function sortRoutes(routes: readonly { method: string; path: string }[]) {
  return [...routes].sort((a, b) => `${a.method} ${a.path}`.localeCompare(`${b.method} ${b.path}`));
}

describe("defaultCapabilities × composeCapabilities(装配级等价,M3 任务 4.1)", () => {
  it("① id 集 === HOST_CAPABILITY_IDS_V1 名册(杀多/少一个 descriptor)", () => {
    const deps = buildDeps({ conditional: true });
    const ids = defaultCapabilities(deps).map((d) => d.id);
    expect([...ids].sort()).toEqual([...HOST_CAPABILITY_IDS_V1].sort());
  });

  it("② 路由集等价:全 use compose 的路由并集 === 直调 15 个路由工厂并集(杀漏绑/绑错工厂)", () => {
    const deps = buildDeps({ conditional: true });
    const descriptors = defaultCapabilities(deps);

    const decisions: Record<string, CapabilityDecision<HostDeps, HostContribution>> = {};
    for (const id of HOST_CAPABILITY_IDS_V1) decisions[id] = { kind: "use" };

    const composed = composeCapabilities({ descriptors, decisions, deps });
    const composedRoutes = sortRoutes(
      composed.map(routeShape).filter((r): r is { method: string; path: string } => r !== undefined),
    );

    // 独立基线:直接调 15 个真实工厂(与 defaultCapabilities 分离,参数同 buildDeps)。
    // ★ 这是「第二份真相」——若 defaultCapabilities 把某 id 绑错工厂,只改它一侧,与此
    // 基线的 {method,path} 集合对不上 → toEqual 转红。deps.{llmGateway,aiGateway,authState}
    // 在 conditional:true 下非空。
    const directRoutes = sortRoutes(
      [
        ...createMcpConfigRoutes({ agentDir: deps.agentDir }),
        ...createConfigRoutes({ rootDir: deps.agentDir, listModelOptions: deps.listModelOptions }),
        ...createSandboxProjectRoutes({ defaultCwd: deps.defaultCwd }),
        ...createSourceSettingsRoutes({
          rootDir: deps.agentDir,
          defaultCwd: deps.defaultCwd,
          resolveSettings: deps.resolveSourceSettings,
          onSaved: deps.onSourceSettingsSaved,
        }),
        ...createExtensionsConfigRoutes({ agentDir: deps.agentDir, defaultCwd: deps.defaultCwd }),
        ...createSessionListRoutes({
          storeConfig: deps.sessionStoreConfig,
          globalEnabled: deps.sessionsGlobalEnabled,
          defaultCwd: deps.defaultCwd,
        }),
        ...createSessionActionsRoutes({
          storeConfig: deps.sessionStoreConfig,
          agentDir: deps.agentDir,
          manageEnabled: deps.sessionsManageEnabled,
        }),
        ...createAgentSourcesRoutes({
          scanRoots: deps.sourcesScanRoots,
          registryPath: deps.sourcesRegistryPath,
        }),
        ...createFavoritesRoutes({ agentDir: deps.agentDir }),
        ...createLlmGatewayRoutes(deps.llmGateway!),
        ...createAiGatewayRoutes(deps.aiGateway!),
        ...createAuthRoutes({ state: deps.authState! }),
        ...createAttachmentRoutes(deps.attachmentStore, {
          resolveWriteBackend: deps.resolveWriteBackend,
        }),
        ...createBashRoutes(deps.store, { enabled: deps.bashEnabled }),
        ...createExtensionRoutes(deps.extension),
      ].map((r) => ({ method: r.method, path: r.path })),
    );

    // 绑错工厂 → composedRoutes(来自 defaultCapabilities)与 directRoutes(独立基线)不符 → 红。
    expect(composedRoutes).toEqual(directRoutes);
    expect(composedRoutes.length).toBeGreaterThan(0);

    // 特征端点样本(真实存在,非猜测 —— 取自上面已验证过的 composedRoutes)。
    const paths = composedRoutes.map((r) => `${r.method} ${r.path}`);
    expect(paths).toContain("GET /config/mcp");
    expect(paths).toContain("POST /sessions/:id/bash");
    expect(paths).toContain("GET /agent-sources");
    expect(paths).toContain("GET /sessions");
    expect(paths).toContain("POST /auth/session");
  });

  it("③ 命令集 === 现状两个 host 命令名(杀 host.commands 漏绑)", () => {
    const deps = buildDeps({ conditional: true });
    const descriptors = defaultCapabilities(deps);
    const decisions: Record<string, CapabilityDecision<HostDeps, HostContribution>> = {};
    for (const id of HOST_CAPABILITY_IDS_V1) decisions[id] = { kind: "use" };

    const composed = composeCapabilities({ descriptors, decisions, deps });
    const commandNames = composed
      .filter((c): c is Extract<HostContribution, { kind: "command" }> => c.kind === "command")
      .map((c) => c.command.name);

    expect([...commandNames].sort()).toEqual([...REAL_HOST_COMMAND_NAMES].sort());
  });

  it("④ 条件两态:llm/ai/auth 未配置产空、已配置产非空(杀条件映射错,等价现状三元)", () => {
    const emptyDeps = buildDeps({ conditional: false });
    const fullDeps = buildDeps({ conditional: true });

    const emptyDescriptors = defaultCapabilities(emptyDeps);
    const fullDescriptors = defaultCapabilities(fullDeps);

    for (const id of ["gateway.llm", "gateway.ai", "auth.session"] as const) {
      const emptyDescriptor = emptyDescriptors.find((d) => d.id === id);
      const fullDescriptor = fullDescriptors.find((d) => d.id === id);
      expect(emptyDescriptor, `descriptor ${id} 应存在`).toBeDefined();
      expect(fullDescriptor, `descriptor ${id} 应存在`).toBeDefined();

      expect(emptyDescriptor!.factory(emptyDeps), `${id} 未配置应产空`).toEqual([]);
      expect(
        fullDescriptor!.factory(fullDeps).length,
        `${id} 已配置应产非空`,
      ).toBeGreaterThan(0);
    }
  });

  it("⑤ 强制表态:漏一个 id(session.list)→ 抛 CapabilityCompositionError code missing-decision(杀表态不全被静默放过)", () => {
    const deps = buildDeps({ conditional: true });
    const descriptors = defaultCapabilities(deps);
    const decisions: Record<string, CapabilityDecision<HostDeps, HostContribution>> = {};
    for (const id of HOST_CAPABILITY_IDS_V1) {
      if (id === "session.list") continue; // 故意漏一个。
      decisions[id] = { kind: "use" };
    }

    let caught: unknown;
    try {
      composeCapabilities({ descriptors, decisions, deps });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(CapabilityCompositionError);
    const err = caught as CapabilityCompositionError;
    expect(err.code).toBe("missing-decision");
    expect(err.ids).toContain("session.list");
  });

  it("⑥ host.commands 可弃用:decline 后无命令贡献、不抛,且 onDecline 收到 (id,reason)(杀非路由能力面无法弃用)", () => {
    const deps = buildDeps({ conditional: true });
    const descriptors = defaultCapabilities(deps);
    const decisions: Record<string, CapabilityDecision<HostDeps, HostContribution>> = {};
    for (const id of HOST_CAPABILITY_IDS_V1) {
      decisions[id] =
        id === "host.commands" ? { kind: "decline", reason: "test" } : { kind: "use" };
    }
    const onDecline = vi.fn();

    let composed: readonly HostContribution[] = [];
    expect(() => {
      composed = composeCapabilities({ descriptors, decisions, deps, onDecline });
    }).not.toThrow();

    const commandContributions = composed.filter((c) => c.kind === "command");
    expect(commandContributions).toEqual([]);
    expect(onDecline).toHaveBeenCalledWith("host.commands", "test");
  });

  it("⑦ 路由顺序:config.mcp(/config/mcp) 排在 config.domains(/config/:domain) 之前(杀顺序反转致 mcp 被 :domain 抢匹配)", () => {
    // Router 按注册顺序匹配、首个 method+path 命中即返回(router.ts:163 `for...break`)。
    // `/config/:domain` 会匹配 GET /config/mcp(`:domain`="mcp"),故 config.mcp 的具体路由
    // **必须**排在 config.domains 之前,否则 GET /config/mcp → DOMAIN_NOT_FOUND。此守卫补的正是
    // 「用 sort 比集合」看不见的顺序维度 —— 该 bug 曾逃过守卫①②与全部既有 e2e。
    const deps = buildDeps({ conditional: true });
    const descriptors = defaultCapabilities(deps);
    const decisions: Record<string, CapabilityDecision<HostDeps, HostContribution>> = {};
    for (const id of HOST_CAPABILITY_IDS_V1) decisions[id] = { kind: "use" };

    const composed = composeCapabilities({ descriptors, decisions, deps });
    const routePaths = composed
      .map((c) => (c.kind === "route" ? `${c.route.method} ${c.route.path}` : undefined))
      .filter((p): p is string => p !== undefined);

    const mcpIdx = routePaths.indexOf("GET /config/mcp");
    const domainIdx = routePaths.indexOf("GET /config/:domain");
    expect(mcpIdx, "GET /config/mcp 应存在").toBeGreaterThanOrEqual(0);
    expect(domainIdx, "GET /config/:domain 应存在").toBeGreaterThanOrEqual(0);
    // 变异判据:defaultCapabilities 把 config.mcp 移到 config.domains 之后 → mcpIdx > domainIdx,此处转红。
    expect(mcpIdx).toBeLessThan(domainIdx);
  });
});
