// @vitest-environment node
/**
 * install-host-command 单测(spec install-host-command,任务 2.1-2.4)。
 *
 * 全程注入 fake 端口(installer/pluginInstaller/reloadRunner/audit),绝不真的调用 CLI
 * install 子域或 pi 子进程。覆盖:argv 解析全矩阵、adminGate 门控 + 审计、脱敏、
 * 生效分道(reloadRunner 调用次数与时序)、effect 取值、guidance 内容、component 直通、
 * list/update 编排,以及每个执行类结果对 `InstallResultDataSchema` 的 safeParse 校验。
 */
import { describe, expect, it, vi } from "vitest";
import { InstallResultDataSchema } from "@blksails/pi-web-protocol";
import { createInstallHostCommand, type InstallAuditEvent } from "@/lib/app/install-host-command";
import type { Installer, InstallerError, InstallOutcome, UninstallOutcome } from "@/server/cli/install/installer";
import type {
  PluginInstallError,
  PluginInstaller,
  UpdatePluginsResult,
} from "@/server/cli/install/plugin-installer";
import type { InstalledExtension } from "@blksails/pi-web-server";

type Result<T, E> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

/** uninstall 结果缺省与 install 结果同构造(仅用于测试场景里两者错误码/kind 一致的简单场景)。 */
function asUninstallResult(r: Result<InstallOutcome, InstallerError>): Result<UninstallOutcome, InstallerError> {
  if (!r.ok) return r;
  if (r.value.kind === "agent") {
    return { ok: true, value: { kind: "agent", result: { id: r.value.result.location } } };
  }
  return { ok: true, value: { kind: "plugin", result: r.value.result } };
}

function okInstaller(
  installResult: Result<InstallOutcome, InstallerError>,
  uninstallResult?: Result<UninstallOutcome, InstallerError>,
): { installer: Installer; installCalls: unknown[][]; uninstallCalls: unknown[][] } {
  const installCalls: unknown[][] = [];
  const uninstallCalls: unknown[][] = [];
  const installer: Installer = {
    async install(spec, options) {
      installCalls.push([spec, options]);
      return installResult;
    },
    async uninstall(id, options) {
      uninstallCalls.push([id, options]);
      return uninstallResult ?? asUninstallResult(installResult);
    },
  };
  return { installer, installCalls, uninstallCalls };
}

function neverList(): Promise<Result<readonly InstalledExtension[], PluginInstallError>> {
  throw new Error("pluginInstaller.install/uninstall should never be called by the host command");
}

function makePluginInstaller(overrides: Partial<PluginInstaller> = {}): PluginInstaller {
  return {
    install: vi.fn(neverList) as unknown as PluginInstaller["install"],
    uninstall: vi.fn(neverList) as unknown as PluginInstaller["uninstall"],
    listInstalled: vi.fn(
      async (): Promise<Result<readonly InstalledExtension[], PluginInstallError>> => ({ ok: true, value: [] }),
    ),
    update: vi.fn(
      async (): Promise<Result<UpdatePluginsResult, PluginInstallError>> => ({
        ok: true,
        value: { outcomes: [], hasFailures: false },
      }),
    ),
    ...overrides,
  };
}

function makeSession(): unknown {
  return { id: "session-1" };
}

function baseDeps(overrides: Partial<Parameters<typeof createInstallHostCommand>[0]> = {}) {
  const { installer } = okInstaller({
    ok: true,
    value: { kind: "agent", result: { method: "local", location: "/root/agents/x", created: true } },
  });
  const reloadRunner = vi.fn(async () => undefined);
  const audit = vi.fn((_event: InstallAuditEvent) => undefined);
  return {
    installer,
    pluginInstaller: makePluginInstaller(),
    adminGate: () => true,
    reloadRunner,
    audit,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// argv 解析全矩阵(1.5/1.6/2.3/2.4)
// ---------------------------------------------------------------------------

describe("createInstallHostCommand argv parsing (usage paths, effect:none, 无 data)", () => {
  it("裸 /install -> 用法帮助,effect:none,无 data", async () => {
    const cmd = createInstallHostCommand(baseDeps());
    const r = await cmd.execute({ session: makeSession() as never, argv: "" });
    expect(r.effect).toBe("none");
    expect(r.data).toBeUndefined();
    expect(r.message).toMatch(/用法/);
  });

  it("未知子动作 -> 用法错误,effect:none,无 data", async () => {
    const cmd = createInstallHostCommand(baseDeps());
    const r = await cmd.execute({ session: makeSession() as never, argv: "frobnicate x" });
    expect(r.effect).toBe("none");
    expect(r.data).toBeUndefined();
    expect(r.message).toMatch(/未知子动作/);
  });

  it("install 缺少 <source> -> 用法错误", async () => {
    const cmd = createInstallHostCommand(baseDeps());
    const r = await cmd.execute({ session: makeSession() as never, argv: "install" });
    expect(r.effect).toBe("none");
    expect(r.data).toBeUndefined();
    expect(r.message).toMatch(/缺少 <source>/);
  });

  it("uninstall 缺少 <id> -> 用法错误", async () => {
    const cmd = createInstallHostCommand(baseDeps());
    const r = await cmd.execute({ session: makeSession() as never, argv: "uninstall" });
    expect(r.effect).toBe("none");
    expect(r.message).toMatch(/缺少 <id>/);
  });

  it("--kind 非法取值 -> 用法错误", async () => {
    const cmd = createInstallHostCommand(baseDeps());
    const r = await cmd.execute({
      session: makeSession() as never,
      argv: "install local:/x --kind whatever",
    });
    expect(r.effect).toBe("none");
    expect(r.message).toMatch(/--kind 取值须为 agent 或 plugin/);
  });

  it("update 携带任意 --kind -> 用法错误(update 仅支持 plugin 通道)", async () => {
    const cmd = createInstallHostCommand(baseDeps());
    const r = await cmd.execute({
      session: makeSession() as never,
      argv: "update npm:foo --kind plugin",
    });
    expect(r.effect).toBe("none");
    expect(r.message).toMatch(/update 不支持 --kind/);
  });

  it("list 不要求参数", async () => {
    const deps = baseDeps();
    const cmd = createInstallHostCommand(deps);
    const r = await cmd.execute({ session: makeSession() as never, argv: "list" });
    expect(r.effect).toBe("notify");
    expect(r.data).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// adminGate 拒绝 + 审计(3.2/3.5)
// ---------------------------------------------------------------------------

describe("adminGate 拒绝", () => {
  it("adminGate 返回 false -> 失败卡片 + 审计被调用,installer 零调用", async () => {
    const { installer, installCalls } = okInstaller({
      ok: true,
      value: { kind: "agent", result: { method: "local", location: "/x", created: true } },
    });
    const audit = vi.fn((_e: InstallAuditEvent) => undefined);
    const cmd = createInstallHostCommand({
      installer,
      pluginInstaller: makePluginInstaller(),
      adminGate: () => false,
      reloadRunner: vi.fn(async () => undefined),
      audit,
    });

    const r = await cmd.execute({ session: makeSession() as never, argv: "install local:/x" });

    expect(installCalls).toHaveLength(0);
    expect(audit).toHaveBeenCalledOnce();
    expect(audit.mock.calls[0]?.[0]).toMatchObject({ action: "install", outcome: "rejected" });
    expect(r.effect).toBe("notify");
    const parsed = InstallResultDataSchema.safeParse(r.data);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.ok).toBe(false);
      expect(parsed.data.error?.message).toMatch(/PI_WEB_EXT_ADMIN_ALLOW_ANY/);
    }
  });
});

// ---------------------------------------------------------------------------
// 脱敏(5.3):Bearer/token/URL 凭据样本
// ---------------------------------------------------------------------------

describe("脱敏:message 与 steps 不得泄露凭据", () => {
  it("installer 失败 message 含 Bearer/token/URL 凭据 -> 输出全部脱敏", async () => {
    const leaky =
      'request failed: Authorization: Bearer sk-abcdefghij1234567890, ' +
      'apiKey: "sekret-value-123", https://user:hunter2@example.com/repo';
    const { installer } = okInstaller({
      ok: false,
      error: { code: "PLUGIN_INSTALL_FAILED", message: leaky },
    });
    const cmd = createInstallHostCommand(baseDeps({ installer }));

    const r = await cmd.execute({ session: makeSession() as never, argv: "install npm:x@1.0.0" });

    const serialized = JSON.stringify(r);
    expect(serialized).not.toMatch(/sk-abcdefghij1234567890/);
    expect(serialized).not.toMatch(/Bearer sk-/);
    expect(serialized).not.toMatch(/sekret-value-123/);
    expect(serialized).not.toMatch(/hunter2/);
  });

  // 复核抓到的真实泄露路径(Req 5.3):source/id 本身就是凭据来源——用户 argv 原样输入
  // `user:token@host` 形式的 URL,过去未脱敏直进卡片 data.id 与审计事件 source。
  const CRED_SOURCE = "git:https://user:hunter2@github.com/org/repo.git";

  it("install 成功(agent):带凭据 URL source 不出现在卡片任何字段", async () => {
    const { installer } = okInstaller({
      ok: true,
      value: { kind: "agent", result: { method: "git", location: "/root/agents/repo", created: true } },
    });
    const cmd = createInstallHostCommand(baseDeps({ installer }));
    const r = await cmd.execute({ session: makeSession() as never, argv: `install ${CRED_SOURCE}` });
    const serialized = JSON.stringify(r);
    expect(serialized).not.toContain("hunter2");
    expect(serialized).toContain("[redacted]@");
  });

  it("install 失败(ALLOWLIST_REJECTED):卡片与审计事件均不含凭据", async () => {
    const { installer } = okInstaller({
      ok: false,
      error: { code: "ALLOWLIST_REJECTED", message: `source rejected: ${CRED_SOURCE}` },
    });
    const audit = vi.fn((_event: InstallAuditEvent) => undefined);
    const cmd = createInstallHostCommand(baseDeps({ installer, audit }));
    const r = await cmd.execute({ session: makeSession() as never, argv: `install ${CRED_SOURCE}` });
    expect(JSON.stringify(r)).not.toContain("hunter2");
    expect(audit).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(audit.mock.calls[0])).not.toContain("hunter2");
  });

  it("uninstall 成功与失败:带凭据 id 不出现在卡片与审计事件", async () => {
    const okCase = okInstaller(
      { ok: true, value: { kind: "agent", result: { method: "local", location: "/root/agents/x", created: true } } },
      { ok: true, value: { kind: "agent", result: { id: "/root/agents/x" } } },
    );
    const cmdOk = createInstallHostCommand(baseDeps({ installer: okCase.installer }));
    const rOk = await cmdOk.execute({ session: makeSession() as never, argv: `uninstall ${CRED_SOURCE}` });
    expect(JSON.stringify(rOk)).not.toContain("hunter2");

    const failCase = okInstaller(
      { ok: false, error: { code: "ALLOWLIST_REJECTED", message: "rejected" } },
      { ok: false, error: { code: "ALLOWLIST_REJECTED", message: `rejected: ${CRED_SOURCE}` } },
    );
    const audit = vi.fn((_event: InstallAuditEvent) => undefined);
    const cmdFail = createInstallHostCommand(baseDeps({ installer: failCase.installer, audit }));
    const rFail = await cmdFail.execute({ session: makeSession() as never, argv: `uninstall ${CRED_SOURCE}` });
    expect(JSON.stringify(rFail)).not.toContain("hunter2");
    expect(JSON.stringify(audit.mock.calls)).not.toContain("hunter2");
  });
});

// ---------------------------------------------------------------------------
// 生效分道:reloadRunner 调用次数与时序(4.1/4.2)
// ---------------------------------------------------------------------------

describe("生效分道", () => {
  it("agent install 成功 -> effect panel-refresh,reloadRunner 恒不被调用,guidance 提到选择器", async () => {
    const { installer } = okInstaller({
      ok: true,
      value: { kind: "agent", result: { method: "local", location: "/root/agents/foo", created: true } },
    });
    const reloadRunner = vi.fn(async () => undefined);
    const cmd = createInstallHostCommand(baseDeps({ installer, reloadRunner }));

    const r = await cmd.execute({ session: makeSession() as never, argv: "install local:/foo" });

    expect(reloadRunner).not.toHaveBeenCalled();
    expect(r.effect).toBe("panel-refresh");
    const parsed = InstallResultDataSchema.safeParse(r.data);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.ok).toBe(true);
      expect(parsed.data.kind).toBe("agent");
      expect(parsed.data.location).toBe("/root/agents/foo");
      expect(parsed.data.guidance).toMatch(/选择器/);
    }
  });

  it("agent uninstall 成功 -> effect panel-refresh,reloadRunner 恒不被调用", async () => {
    const { installer } = okInstaller(
      { ok: true, value: { kind: "agent", result: { method: "local", location: "/root/agents/foo", created: true } } },
      { ok: true, value: { kind: "agent", result: { id: "foo" } } },
    );
    const reloadRunner = vi.fn(async () => undefined);
    const cmd = createInstallHostCommand(baseDeps({ installer, reloadRunner }));

    const r = await cmd.execute({ session: makeSession() as never, argv: "uninstall foo --kind agent" });

    expect(reloadRunner).not.toHaveBeenCalled();
    expect(r.effect).toBe("panel-refresh");
  });

  it("plugin install 成功 -> reloadRunner 恰被调用一次,且早于返回(effect notify)", async () => {
    const order: string[] = [];
    const { installer } = okInstaller({
      ok: true,
      value: { kind: "plugin", result: { id: "npm:foo", stdout: "installed\n" } },
    });
    const reloadRunner = vi.fn(async () => {
      order.push("reload");
    });
    const cmd = createInstallHostCommand(baseDeps({ installer, reloadRunner }));

    const r = await cmd.execute({ session: makeSession() as never, argv: "install npm:foo@1.0.0" });
    order.push("returned");

    expect(reloadRunner).toHaveBeenCalledOnce();
    expect(order).toEqual(["reload", "returned"]);
    expect(r.effect).toBe("notify");
    const parsed = InstallResultDataSchema.safeParse(r.data);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.kind).toBe("plugin");
      expect(parsed.data.ok).toBe(true);
    }
  });

  it("plugin uninstall 成功 -> reloadRunner 恰被调用一次", async () => {
    const { installer } = okInstaller(
      { ok: true, value: { kind: "plugin", result: { id: "npm:foo", stdout: "" } } },
      { ok: true, value: { kind: "plugin", result: { id: "npm:foo", stdout: "removed\n" } } },
    );
    const reloadRunner = vi.fn(async () => undefined);
    const cmd = createInstallHostCommand(baseDeps({ installer, reloadRunner }));

    const r = await cmd.execute({ session: makeSession() as never, argv: "uninstall npm:foo" });

    expect(reloadRunner).toHaveBeenCalledOnce();
    expect(r.effect).toBe("notify");
  });

  it("install 失败 -> reloadRunner 不被调用", async () => {
    const { installer } = okInstaller({
      ok: false,
      error: { code: "PLUGIN_INSTALL_FAILED", message: "boom" },
    });
    const reloadRunner = vi.fn(async () => undefined);
    const cmd = createInstallHostCommand(baseDeps({ installer, reloadRunner }));

    const r = await cmd.execute({ session: makeSession() as never, argv: "install npm:foo@1.0.0" });

    expect(reloadRunner).not.toHaveBeenCalled();
    expect(r.data && (r.data as { ok: boolean }).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// component 错误直通(2.5)
// ---------------------------------------------------------------------------

describe("component 包直通失败卡片", () => {
  it("KIND_COMPONENT_UNSUPPORTED -> 失败卡片,guidance 含 pi-web add,reloadRunner 不被调用", async () => {
    const { installer } = okInstaller({
      ok: false,
      error: {
        code: "KIND_COMPONENT_UNSUPPORTED",
        message: "component packages are not supported; run `pi-web add` instead.",
      },
    });
    const reloadRunner = vi.fn(async () => undefined);
    const cmd = createInstallHostCommand(baseDeps({ installer, reloadRunner }));

    const r = await cmd.execute({
      session: makeSession() as never,
      argv: "install local:/examples/canvas-component-watermark",
    });

    expect(reloadRunner).not.toHaveBeenCalled();
    expect(r.effect).toBe("notify");
    const parsed = InstallResultDataSchema.safeParse(r.data);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.ok).toBe(false);
      expect(parsed.data.error?.code).toBe("KIND_COMPONENT_UNSUPPORTED");
      expect(parsed.data.guidance).toMatch(/pi-web add/);
    }
  });
});

// ---------------------------------------------------------------------------
// list(1.3)
// ---------------------------------------------------------------------------

describe("list 子动作", () => {
  it("空列表 -> ok:true,items 为空数组", async () => {
    const pluginInstaller = makePluginInstaller({
      listInstalled: vi.fn(
        async (): Promise<Result<readonly InstalledExtension[], PluginInstallError>> => ({ ok: true, value: [] }),
      ),
    });
    const cmd = createInstallHostCommand(baseDeps({ pluginInstaller }));

    const r = await cmd.execute({ session: makeSession() as never, argv: "list" });

    const parsed = InstallResultDataSchema.safeParse(r.data);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.ok).toBe(true);
      expect(parsed.data.items).toEqual([]);
    }
  });

  it("--outdated 时底层 OUTDATED_NOT_SUPPORTED -> 如实转达为失败卡片,不伪造数据", async () => {
    const pluginInstaller = makePluginInstaller({
      listInstalled: vi.fn(
        async (): Promise<Result<readonly InstalledExtension[], PluginInstallError>> => ({
          ok: false,
          error: { code: "OUTDATED_NOT_SUPPORTED", message: "pi-web list --outdated is not supported" },
        }),
      ),
    });
    const cmd = createInstallHostCommand(baseDeps({ pluginInstaller }));

    const r = await cmd.execute({ session: makeSession() as never, argv: "list --outdated" });

    const parsed = InstallResultDataSchema.safeParse(r.data);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.ok).toBe(false);
      expect(parsed.data.error?.code).toBe("OUTDATED_NOT_SUPPORTED");
      expect(parsed.data.items).toBeUndefined();
    }
  });

  it("list 有数据时 items 含 id/version/scope/kind", async () => {
    const pluginInstaller = makePluginInstaller({
      listInstalled: vi.fn(
        async (): Promise<Result<readonly InstalledExtension[], PluginInstallError>> => ({
          ok: true,
          value: [{ id: "npm:foo", kind: "npm", version: "1.0.0", scope: "global" }],
        }),
      ),
    });
    const cmd = createInstallHostCommand(baseDeps({ pluginInstaller }));

    const r = await cmd.execute({ session: makeSession() as never, argv: "list" });

    const parsed = InstallResultDataSchema.safeParse(r.data);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.items).toEqual([{ id: "npm:foo", version: "1.0.0", scope: "global", kind: "npm" }]);
    }
  });
});

// ---------------------------------------------------------------------------
// update(1.4/5.4)
// ---------------------------------------------------------------------------

describe("update 子动作", () => {
  it("全部成功(无 hasFailures) -> ok:true,reloadRunner 恰被调用一次", async () => {
    const reloadRunner = vi.fn(async () => undefined);
    const pluginInstaller = makePluginInstaller({
      update: vi.fn(
        async (): Promise<Result<UpdatePluginsResult, PluginInstallError>> => ({
          ok: true,
          value: { outcomes: [{ id: "npm:a", status: "updated" }], hasFailures: false },
        }),
      ),
    });
    const cmd = createInstallHostCommand(baseDeps({ pluginInstaller, reloadRunner }));

    const r = await cmd.execute({ session: makeSession() as never, argv: "update" });

    expect(reloadRunner).toHaveBeenCalledOnce();
    const parsed = InstallResultDataSchema.safeParse(r.data);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.ok).toBe(true);
  });

  it("部分失败(hasFailures) -> 整体 ok:false,reloadRunner 不被调用", async () => {
    const reloadRunner = vi.fn(async () => undefined);
    const pluginInstaller = makePluginInstaller({
      update: vi.fn(
        async (): Promise<Result<UpdatePluginsResult, PluginInstallError>> => ({
          ok: true,
          value: {
            outcomes: [
              { id: "npm:a", status: "updated" },
              { id: "npm:b", status: "failed", reason: "pi update failed" },
            ],
            hasFailures: true,
          },
        }),
      ),
    });
    const cmd = createInstallHostCommand(baseDeps({ pluginInstaller, reloadRunner }));

    const r = await cmd.execute({ session: makeSession() as never, argv: "update" });

    expect(reloadRunner).not.toHaveBeenCalled();
    const parsed = InstallResultDataSchema.safeParse(r.data);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.ok).toBe(false);
      expect(parsed.data.steps.some((s) => s.status === "failed")).toBe(true);
    }
  });
});
