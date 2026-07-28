// @vitest-environment node
/**
 * Installer 的 registry 分派(spec installer-registry-channel,任务 2.3)。
 *
 * 全程注入 `RegistryChannel` / `AgentChannel` / `PluginChannel` 替身,不触网、不落盘、不 spawn。
 * 覆盖设计里四个关键裁断:
 *   1. registry 形态**在 `resolveSource` 之前**分派 —— 直连通道零调用,且不经 allowlist;
 *   2. 直连形态仍走原路 —— registry 通道零调用;
 *   3. 通道未注入 → `REGISTRY_UNAVAILABLE`(不是旧的 `REGISTRY_NOT_IMPLEMENTED`);
 *   4. plugin 物化后**由 Installer 转交** plugin 通道,且以 `{kind:"local",path:<物化目录>}` 形态。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createInstaller,
  type AgentChannel,
  type PluginChannel,
  type RegistryChannel,
  type RegistryChannelError,
  type RegistryMaterialization,
} from "@/server/cli/install/installer";

// ---------------------------------------------------------------------------
// 替身
// ---------------------------------------------------------------------------

interface RegistryChannelStub extends RegistryChannel {
  readonly calls: { spec: string; expectedKind?: string }[];
}

function makeRegistryStub(
  outcome:
    | { ok: true; value: RegistryMaterialization }
    | { ok: false; error: RegistryChannelError },
): RegistryChannelStub {
  const calls: { spec: string; expectedKind?: string }[] = [];
  return {
    calls,
    async materialize(spec, opts) {
      calls.push({ spec, ...(opts.expectedKind !== undefined ? { expectedKind: opts.expectedKind } : {}) });
      return outcome;
    },
  };
}

interface AgentChannelStub extends AgentChannel {
  readonly installCalls: unknown[];
}
function makeAgentStub(): AgentChannelStub {
  const installCalls: unknown[] = [];
  return {
    installCalls,
    async install(source) {
      installCalls.push(source);
      return { ok: true, value: { method: "local", location: "/tmp/direct", created: true } };
    },
    async uninstall(id) {
      return { ok: true, value: { id } };
    },
  };
}

interface PluginChannelStub extends PluginChannel {
  readonly installCalls: { source: unknown; scope: string }[];
}
function makePluginStub(fail?: string): PluginChannelStub {
  const installCalls: { source: unknown; scope: string }[] = [];
  return {
    installCalls,
    async install(source, scope) {
      installCalls.push({ source, scope });
      if (fail !== undefined) {
        return { ok: false, error: { code: "PI_COMMAND_FAILED", message: fail } };
      }
      return { ok: true, value: { id: "acme/some-plugin", scope: "user" } as never };
    },
    async uninstall() {
      return { ok: true, value: { id: "x" } as never };
    },
  };
}

const AGENT_MATERIALIZATION: RegistryMaterialization = {
  kind: "agent",
  sourceId: "acme/hello-cloud",
  version: "1.2.3",
  dir: "/sources/acme_hello-cloud",
  verifiedFiles: 4,
};

// ---------------------------------------------------------------------------

describe("Installer · registry 分派", () => {
  it("registry 标识走 registry 通道,直连通道零调用", async () => {
    const registryChannel = makeRegistryStub({ ok: true, value: AGENT_MATERIALIZATION });
    const agentChannel = makeAgentStub();
    const pluginChannel = makePluginStub();
    const installer = createInstaller({ registryChannel, agentChannel, pluginChannel, env: {} });

    const res = await installer.install("acme/hello-cloud", { kindHint: "agent" });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.kind).toBe("agent");
    if (res.value.kind !== "agent") return;
    expect(res.value.result.location).toBe("/sources/acme_hello-cloud");
    // 溯源信息随成功结果上浮,供 CLI 打印等效完成信息。
    expect(res.value.registry).toEqual({
      sourceId: "acme/hello-cloud",
      version: "1.2.3",
      verifiedFiles: 4,
    });
    expect(registryChannel.calls).toEqual([{ spec: "acme/hello-cloud", expectedKind: "agent" }]);
    expect(agentChannel.installCalls).toHaveLength(0);
    expect(pluginChannel.installCalls).toHaveLength(0);
  });

  it("直连形态仍走原通道,registry 通道零调用", async () => {
    const registryChannel = makeRegistryStub({ ok: true, value: AGENT_MATERIALIZATION });
    const agentChannel = makeAgentStub();
    const installer = createInstaller({
      registryChannel,
      agentChannel,
      pluginChannel: makePluginStub(),
      env: {},
    });

    const dir = mkdtempSync(join(tmpdir(), "pi-direct-"));
    const res = await installer.install(dir, { kindHint: "agent" });

    expect(res.ok).toBe(true);
    expect(registryChannel.calls).toHaveLength(0);
    expect(agentChannel.installCalls).toHaveLength(1);
  });

  it("CLI 无 kindHint 时不传 expectedKind(清单说了算)", async () => {
    const registryChannel = makeRegistryStub({ ok: true, value: AGENT_MATERIALIZATION });
    const installer = createInstaller({
      registryChannel,
      agentChannel: makeAgentStub(),
      pluginChannel: makePluginStub(),
      env: {},
    });

    await installer.install("acme/hello-cloud");

    expect(registryChannel.calls).toEqual([{ spec: "acme/hello-cloud" }]);
  });

  it("registry 标识不经 allowlist —— 即使 allowlist 极严也不被误拒", async () => {
    const registryChannel = makeRegistryStub({ ok: true, value: AGENT_MATERIALIZATION });
    const installer = createInstaller({
      registryChannel,
      agentChannel: makeAgentStub(),
      pluginChannel: makePluginStub(),
      env: {},
      // 一个什么都不放行的白名单:若分派顺序写错(先 resolveSource),这条必然 ALLOWLIST_REJECTED。
      allowlistConfig: { npmScopes: [], gitHosts: [], allowLocal: false, allowAnyNpm: false },
    });

    const res = await installer.install("acme/hello-cloud", { kindHint: "agent" });
    expect(res.ok).toBe(true);
  });
});

describe("Installer · registry 通道未注入", () => {
  it("→ REGISTRY_UNAVAILABLE(不再是 REGISTRY_NOT_IMPLEMENTED)", async () => {
    const installer = createInstaller({
      agentChannel: makeAgentStub(),
      pluginChannel: makePluginStub(),
      env: {},
    });

    const res = await installer.install("acme/hello-cloud", { kindHint: "agent" });

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("REGISTRY_UNAVAILABLE");
    expect(res.error.message).not.toContain("not yet supported");
  });
});

describe("Installer · registry 失败映射", () => {
  it("KIND_MISMATCH → REGISTRY_KIND_MISMATCH,并指出应改用哪条命令", async () => {
    const installer = createInstaller({
      registryChannel: makeRegistryStub({
        ok: false,
        error: { code: "KIND_MISMATCH", actual: "plugin", expected: "agent" },
      }),
      agentChannel: makeAgentStub(),
      pluginChannel: makePluginStub(),
      env: {},
    });

    const res = await installer.install("acme/some-plugin", { kindHint: "agent" });

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("REGISTRY_KIND_MISMATCH");
    expect(res.error.message).toContain("/plugin install");
  });

  it("component → 复用既有 KIND_COMPONENT_UNSUPPORTED 指引", async () => {
    const installer = createInstaller({
      registryChannel: makeRegistryStub({ ok: false, error: { code: "KIND_COMPONENT_UNSUPPORTED" } }),
      agentChannel: makeAgentStub(),
      pluginChannel: makePluginStub(),
      env: {},
    });

    const res = await installer.install("acme/widget", {});
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("KIND_COMPONENT_UNSUPPORTED");
    expect(res.error.message).toContain("pi-web add");
  });

  it("完整性复核失败 → REGISTRY_INSTALL_FAILED 且消息带子码", async () => {
    const installer = createInstaller({
      registryChannel: makeRegistryStub({ ok: false, error: { code: "INTEGRITY_MISMATCH" } }),
      agentChannel: makeAgentStub(),
      pluginChannel: makePluginStub(),
      env: {},
    });

    const res = await installer.install("acme/x", {});
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("REGISTRY_INSTALL_FAILED");
    expect(res.error.message).toContain("INTEGRITY_MISMATCH");
  });
});

describe("Installer · plugin 的两段组合", () => {
  function pluginMaterialization(dir: string): RegistryMaterialization {
    return { kind: "plugin", sourceId: "acme/some-plugin", version: "0.9.0", dir, verifiedFiles: 2 };
  }

  it("物化目录以 local: 形态转交 plugin 通道,且**目录必须保留**", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-plugroot-"));
    const dir = join(root, "acme_some-plugin");
    mkdirSync(dir, { recursive: true });
    const pluginChannel = makePluginStub();

    const installer = createInstaller({
      registryChannel: makeRegistryStub({ ok: true, value: pluginMaterialization(dir) }),
      agentChannel: makeAgentStub(),
      pluginChannel,
      env: {},
    });

    const res = await installer.install("acme/some-plugin", { kindHint: "plugin" });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.kind).toBe("plugin");
    expect(pluginChannel.installCalls).toEqual([
      { source: { kind: "local", path: dir }, scope: "user" },
    ]);
    // ★ 回归护栏:pi 只把路径记进 settings.json、不拷贝内容,删掉物化目录会让插件失效。
    //   若哪天有人给这条路径加回「转交后清理」,本断言会红。
    expect(existsSync(dir)).toBe(true);
  });

  it("转交失败如实报 PLUGIN_INSTALL_FAILED", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-plugroot-"));
    const dir = join(root, "acme_some-plugin");
    mkdirSync(dir, { recursive: true });

    const installer = createInstaller({
      registryChannel: makeRegistryStub({ ok: true, value: pluginMaterialization(dir) }),
      agentChannel: makeAgentStub(),
      pluginChannel: makePluginStub("pi exited with 1"),
      env: {},
    });

    const res = await installer.install("acme/some-plugin", { kindHint: "plugin" });

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("PLUGIN_INSTALL_FAILED");
  });
});
