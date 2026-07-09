// @vitest-environment node
/**
 * Installer 单测(spec cli-package-commands,任务 4.5,Req 3.1, 3.2, 3.3)。
 *
 * 全程注入通道/信任策略/PiCli 替身,绝不真的 spawn `git`/`npm`/`pi`,绝不碰真实
 * trust store。覆盖:
 *   - 观察态:注入两个通道替身,`kindHint: "agent"` 只调 agent 替身,`kindHint: "plugin"`
 *     只调 plugin 替身;调用方对两者用同一个 `install()` 方法。
 *   - npm/git 直连且无 `kindHint` → 走 plugin 通道(默认约定)。
 *   - `kindHint: "agent"` 覆盖上述约定 → 走 agent 通道。
 *   - scope 默认 user;`scope: "project"` + plugin → 传给 pi 的 args 含 `-l`。
 *   - `scope: "project"` + agent → `AGENT_SCOPE_UNSUPPORTED`,两条通道替身均零调用。
 *   - trust 替身返回 "ask"/"never" → `PROJECT_NOT_TRUSTED`,两条通道替身均零调用;
 *     返回 "always" → 放行。
 *   - `PI_WEB_EXT_ALLOW_NPM` 开/关两种取值下,`npm:third-party@1.2.3` 分别通过/被拒。
 *   - AgentChannel.uninstall 经生产通道真实委托 `uninstallAgentSource`(非 NOT_IMPLEMENTED)。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PiCli, PiCommandResult } from "@blksails/pi-web-server";
import {
  createInstaller,
  isAllowAnyNpmEnabled,
  type AgentChannel,
  type PluginChannel,
  type Scope,
  type TrustDecision,
} from "@/server/cli/install/installer";
import { installAgentSource, type AgentInstallResult } from "@/server/cli/install/agent-installer";
import type { InstallPluginResult, UninstallPluginResult } from "@/server/cli/install/plugin-installer";

// ---------------------------------------------------------------------------
// 测试替身
// ---------------------------------------------------------------------------

interface AgentChannelStub extends AgentChannel {
  readonly installCalls: unknown[][];
  readonly uninstallCalls: unknown[][];
}

function makeAgentChannelStub(result?: AgentInstallResult): AgentChannelStub {
  const installCalls: unknown[][] = [];
  const uninstallCalls: unknown[][] = [];
  return {
    installCalls,
    uninstallCalls,
    async install(source) {
      installCalls.push([source]);
      return {
        ok: true,
        value: result ?? { method: "local", location: "/tmp/agent-x", created: true },
      };
    },
    async uninstall(sourceId) {
      uninstallCalls.push([sourceId]);
      return { ok: true, value: { id: sourceId } };
    },
  };
}

interface PluginChannelStub extends PluginChannel {
  readonly installCalls: Array<{ source: unknown; scope: Scope }>;
  readonly uninstallCalls: Array<{ sourceId: string; scope: Scope }>;
}

function makePluginChannelStub(result?: InstallPluginResult): PluginChannelStub {
  const installCalls: Array<{ source: unknown; scope: Scope }> = [];
  const uninstallCalls: Array<{ sourceId: string; scope: Scope }> = [];
  return {
    installCalls,
    uninstallCalls,
    async install(source, scope) {
      installCalls.push({ source, scope });
      return { ok: true, value: result ?? { id: "npm:some-plugin", stdout: "installed\n" } };
    },
    async uninstall(sourceId, scope) {
      uninstallCalls.push({ sourceId, scope });
      const value: UninstallPluginResult = { id: sourceId, stdout: "removed\n" };
      return { ok: true, value };
    },
  };
}

function makeAlwaysTrustPolicy() {
  return () => "always" as TrustDecision;
}

function makeTrustPolicyReturning(decision: TrustDecision) {
  return () => decision;
}

// ---------------------------------------------------------------------------
// 观察态:同一条 install() 调用,按 kind 分派到唯一对应的通道
// ---------------------------------------------------------------------------

describe("Installer.install dispatch (observable, Req 3.1)", () => {
  it("kindHint: 'agent' -> only the agent channel stub is called", async () => {
    const agentChannel = makeAgentChannelStub();
    const pluginChannel = makePluginChannelStub();
    const installer = createInstaller({
      agentChannel,
      pluginChannel,
      trustPolicy: makeAlwaysTrustPolicy(),
    });

    const result = await installer.install("./some/local/dir", { kindHint: "agent" });

    expect(result.ok).toBe(true);
    expect(agentChannel.installCalls).toHaveLength(1);
    expect(pluginChannel.installCalls).toHaveLength(0);
    if (result.ok) expect(result.value.kind).toBe("agent");
  });

  it("kindHint: 'plugin' -> only the plugin channel stub is called (same install() call site)", async () => {
    const agentChannel = makeAgentChannelStub();
    const pluginChannel = makePluginChannelStub();
    const installer = createInstaller({
      agentChannel,
      pluginChannel,
      trustPolicy: makeAlwaysTrustPolicy(),
    });

    const result = await installer.install("./some/local/dir", { kindHint: "plugin" });

    expect(result.ok).toBe(true);
    expect(pluginChannel.installCalls).toHaveLength(1);
    expect(agentChannel.installCalls).toHaveLength(0);
    if (result.ok) expect(result.value.kind).toBe("plugin");
  });
});

// ---------------------------------------------------------------------------
// 决策 1:kind 的确定策略
// ---------------------------------------------------------------------------

describe("Installer kind determination (Req 3.1, decision 1)", () => {
  it("npm direct source without kindHint defaults to the plugin channel (convention, not detection)", async () => {
    const agentChannel = makeAgentChannelStub();
    const pluginChannel = makePluginChannelStub();
    const installer = createInstaller({
      agentChannel,
      pluginChannel,
      trustPolicy: makeAlwaysTrustPolicy(),
      env: { PI_WEB_EXT_ALLOW_NPM: "1" },
    });

    const result = await installer.install("npm:@pi-web/some-tool@1.0.0");

    expect(result.ok).toBe(true);
    expect(pluginChannel.installCalls).toHaveLength(1);
    expect(agentChannel.installCalls).toHaveLength(0);
  });

  it("git direct source without kindHint defaults to the plugin channel (convention, not detection)", async () => {
    const agentChannel = makeAgentChannelStub();
    const pluginChannel = makePluginChannelStub();
    const installer = createInstaller({
      agentChannel,
      pluginChannel,
      trustPolicy: makeAlwaysTrustPolicy(),
    });

    const result = await installer.install("git:github.com/some-org/some-repo@abc1234def");

    expect(result.ok).toBe(true);
    expect(pluginChannel.installCalls).toHaveLength(1);
    expect(agentChannel.installCalls).toHaveLength(0);
  });

  it("kindHint: 'agent' overrides the npm/git default-plugin convention", async () => {
    const agentChannel = makeAgentChannelStub();
    const pluginChannel = makePluginChannelStub();
    const installer = createInstaller({
      agentChannel,
      pluginChannel,
      trustPolicy: makeAlwaysTrustPolicy(),
      env: { PI_WEB_EXT_ALLOW_NPM: "1" },
    });

    const result = await installer.install("npm:@pi-web/some-tool@1.0.0", { kindHint: "agent" });

    expect(result.ok).toBe(true);
    expect(agentChannel.installCalls).toHaveLength(1);
    expect(pluginChannel.installCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 决策 2:scope 语义
// ---------------------------------------------------------------------------

describe("Installer scope semantics (Req 3.2, decision 2)", () => {
  it("defaults to user scope when unspecified", async () => {
    const pluginChannel = makePluginChannelStub();
    const installer = createInstaller({
      agentChannel: makeAgentChannelStub(),
      pluginChannel,
      trustPolicy: makeAlwaysTrustPolicy(),
    });

    const result = await installer.install("npm:@pi-web/foo@1.0.0", { kindHint: "plugin" });

    expect(result.ok).toBe(true);
    expect(pluginChannel.installCalls[0]?.scope).toBe("user");
  });

  it("scope: 'project' + plugin dispatches with scope 'project' to the channel", async () => {
    const pluginChannel = makePluginChannelStub();
    const installer = createInstaller({
      agentChannel: makeAgentChannelStub(),
      pluginChannel,
      trustPolicy: makeAlwaysTrustPolicy(),
    });

    const result = await installer.install("npm:@pi-web/foo@1.0.0", {
      kindHint: "plugin",
      scope: "project",
      cwd: "/tmp/some-project",
    });

    expect(result.ok).toBe(true);
    expect(pluginChannel.installCalls[0]?.scope).toBe("project");
  });

  it("scope: 'project' + agent -> AGENT_SCOPE_UNSUPPORTED, neither channel stub is called", async () => {
    const agentChannel = makeAgentChannelStub();
    const pluginChannel = makePluginChannelStub();
    const installer = createInstaller({
      agentChannel,
      pluginChannel,
      trustPolicy: makeAlwaysTrustPolicy(),
    });

    const result = await installer.install("./some/local/dir", {
      kindHint: "agent",
      scope: "project",
      cwd: "/tmp/some-project",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AGENT_SCOPE_UNSUPPORTED");
    expect(agentChannel.installCalls).toHaveLength(0);
    expect(pluginChannel.installCalls).toHaveLength(0);
  });
});

// `-l` 的追加内联在 plugin-installer.ts 的 install(source, { scope }) 里,
// 由下面这个集成测试（真实 PiCli 替身，断言 args 含 `-l`）覆盖，而非单独的纯函数单测。

describe("Installer.install project scope wires '-l' into the args sent to pi (Req 3.2)", () => {
  interface RecordedCall {
    readonly args: readonly string[];
    readonly env: Record<string, string>;
  }

  function makeStubPiCli(runResult: PiCommandResult): { piCli: PiCli; calls: RecordedCall[] } {
    const calls: RecordedCall[] = [];
    const piCli: PiCli = {
      async runPiCommand(args, env) {
        calls.push({ args, env });
        return runResult;
      },
      async listExtensions() {
        throw new Error("listExtensions() should not be used by the default install path");
      },
    };
    return { piCli, calls };
  }

  it("user scope: pi args do not contain '-l'", async () => {
    const { piCli, calls } = makeStubPiCli({ ok: true, stdout: "installed\n", exitCode: 0 });
    const installer = createInstaller({
      agentChannel: makeAgentChannelStub(),
      piCli,
      trustPolicy: makeAlwaysTrustPolicy(),
    });

    const result = await installer.install("npm:@pi-web/foo@1.0.0", { kindHint: "plugin" });

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).not.toContain("-l");
  });

  it("project scope: pi args contain '-l'", async () => {
    const { piCli, calls } = makeStubPiCli({ ok: true, stdout: "installed\n", exitCode: 0 });
    const installer = createInstaller({
      agentChannel: makeAgentChannelStub(),
      piCli,
      trustPolicy: makeAlwaysTrustPolicy(),
    });

    const result = await installer.install("npm:@pi-web/foo@1.0.0", {
      kindHint: "plugin",
      scope: "project",
      cwd: "/tmp/some-project",
    });

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toContain("-l");
  });
});

// ---------------------------------------------------------------------------
// 决策 3:信任门控
// ---------------------------------------------------------------------------

describe("Installer project trust gating (Req 3.2, 3.3, decision 3)", () => {
  it.each<TrustDecision>(["ask", "never"])(
    "trust policy returns %s -> PROJECT_NOT_TRUSTED, neither channel stub is called",
    async (decision) => {
      const agentChannel = makeAgentChannelStub();
      const pluginChannel = makePluginChannelStub();
      const installer = createInstaller({
        agentChannel,
        pluginChannel,
        trustPolicy: makeTrustPolicyReturning(decision),
      });

      const result = await installer.install("npm:@pi-web/foo@1.0.0", {
        kindHint: "plugin",
        scope: "project",
        cwd: "/tmp/untrusted-project",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("PROJECT_NOT_TRUSTED");
        expect(result.error.dir).toBe("/tmp/untrusted-project");
        expect(result.error.hint).toBeTruthy();
      }
      expect(agentChannel.installCalls).toHaveLength(0);
      expect(pluginChannel.installCalls).toHaveLength(0);
    },
  );

  it("trust policy returns 'always' -> install proceeds", async () => {
    const pluginChannel = makePluginChannelStub();
    const installer = createInstaller({
      agentChannel: makeAgentChannelStub(),
      pluginChannel,
      trustPolicy: makeAlwaysTrustPolicy(),
    });

    const result = await installer.install("npm:@pi-web/foo@1.0.0", {
      kindHint: "plugin",
      scope: "project",
      cwd: "/tmp/trusted-project",
    });

    expect(result.ok).toBe(true);
    expect(pluginChannel.installCalls).toHaveLength(1);
  });

  it("user scope never consults the trust policy", async () => {
    const pluginChannel = makePluginChannelStub();
    let trustCalls = 0;
    const installer = createInstaller({
      agentChannel: makeAgentChannelStub(),
      pluginChannel,
      trustPolicy: () => {
        trustCalls += 1;
        return "never";
      },
    });

    const result = await installer.install("npm:@pi-web/foo@1.0.0", { kindHint: "plugin" });

    expect(result.ok).toBe(true);
    expect(trustCalls).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// PI_WEB_EXT_ALLOW_NPM 接线
// ---------------------------------------------------------------------------

describe("Installer PI_WEB_EXT_ALLOW_NPM wiring (Req 3.4-adjacent allowAnyNpm)", () => {
  it("isAllowAnyNpmEnabled: '1' and 'true' are truthy, others are falsy", () => {
    expect(isAllowAnyNpmEnabled({ PI_WEB_EXT_ALLOW_NPM: "1" })).toBe(true);
    expect(isAllowAnyNpmEnabled({ PI_WEB_EXT_ALLOW_NPM: "true" })).toBe(true);
    expect(isAllowAnyNpmEnabled({ PI_WEB_EXT_ALLOW_NPM: "TRUE" })).toBe(true);
    expect(isAllowAnyNpmEnabled({ PI_WEB_EXT_ALLOW_NPM: "0" })).toBe(false);
    expect(isAllowAnyNpmEnabled({})).toBe(false);
  });

  it("PI_WEB_EXT_ALLOW_NPM unset: an unscoped npm package is rejected by the allowlist", async () => {
    const pluginChannel = makePluginChannelStub();
    const installer = createInstaller({
      agentChannel: makeAgentChannelStub(),
      pluginChannel,
      trustPolicy: makeAlwaysTrustPolicy(),
      env: {},
    });

    const result = await installer.install("npm:third-party@1.2.3", { kindHint: "plugin" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("ALLOWLIST_REJECTED");
    expect(pluginChannel.installCalls).toHaveLength(0);
  });

  it("PI_WEB_EXT_ALLOW_NPM=1: an unscoped npm package is allowed through", async () => {
    const pluginChannel = makePluginChannelStub();
    const installer = createInstaller({
      agentChannel: makeAgentChannelStub(),
      pluginChannel,
      trustPolicy: makeAlwaysTrustPolicy(),
      env: { PI_WEB_EXT_ALLOW_NPM: "1" },
    });

    const result = await installer.install("npm:third-party@1.2.3", { kindHint: "plugin" });

    expect(result.ok).toBe(true);
    expect(pluginChannel.installCalls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 任务 4.5 缺口 1:AgentChannel.uninstall 真的委托到 uninstallAgentSource(不再是
// NOT_IMPLEMENTED)。用默认(生产)agentChannel,不注入替身。
// ---------------------------------------------------------------------------

describe("Installer.uninstall wires the default agent channel to uninstallAgentSource (gap 1)", () => {
  let root: string;
  let sourcesRoot: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "installer-agent-uninstall-test-"));
    sourcesRoot = join(root, "sources-root");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("uninstalls a real git-installed directory under sourcesRoot via the production agent channel", async () => {
    const dirName = "git-github.com-acme-my-agent-v1.2.3";
    const target = join(sourcesRoot, dirName);
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, "pi-web.json"), JSON.stringify({ kind: "agent" }));

    const installer = createInstaller({
      pluginChannel: makePluginChannelStub(),
      trustPolicy: makeAlwaysTrustPolicy(),
      agentInstallerOptions: { sourcesRoot },
    });

    const result = await installer.uninstall(dirName, { kindHint: "agent" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.kind).toBe("agent");
    }
  });

  it("propagates NOT_INSTALLED (not NOT_IMPLEMENTED) for an id that was never installed", async () => {
    const installer = createInstaller({
      pluginChannel: makePluginChannelStub(),
      trustPolicy: makeAlwaysTrustPolicy(),
      agentInstallerOptions: { sourcesRoot },
    });

    const result = await installer.uninstall("nonexistent-thing", { kindHint: "agent" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("AGENT_UNINSTALL_FAILED");
      expect(result.error.message).not.toContain("not implemented");
    }
  });

  it("round-trips through installAgentSource() itself: install a local dir, then uninstall via the Installer port", async () => {
    const localDir = join(root, "my-local-agent");
    mkdirSync(localDir, { recursive: true });
    writeFileSync(join(localDir, "index.ts"), "export default {};\n");
    const registryPath = join(root, "agent-dir", "sources.json");

    const installed = await installAgentSource(
      { kind: "local", path: localDir },
      { sourcesRoot, registryPath },
    );
    expect(installed.ok).toBe(true);
    if (!installed.ok) return;

    const installer = createInstaller({
      pluginChannel: makePluginChannelStub(),
      trustPolicy: makeAlwaysTrustPolicy(),
      agentInstallerOptions: { sourcesRoot, registryPath },
    });

    const result = await installer.uninstall(installed.value.location, { kindHint: "agent" });

    expect(result.ok).toBe(true);
  });
});
