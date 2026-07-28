// @vitest-environment node
/**
 * package-host-command 单测(spec agent-plugin-commands,任务 2.1/2.2;迁自
 * install-host-command.test.ts 并按两条命令重组)。
 *
 * 全程注入 fake 端口(installer/pluginInstaller/reloadRunner/audit),绝不真的调用 CLI
 * install 子域或 pi 子进程。覆盖:argv 解析全矩阵(含 `--kind` 已移除、agent 侧 update
 * 越界)、类别锁定(kindHint 恒等于命令名)、adminGate 门控 + 审计、脱敏、生效分道
 * (reloadRunner 调用次数与时序)、effect 取值、guidance 内容、component 直通、
 * list/update 编排,以及每个执行类结果对 `InstallResultDataSchema` 的 safeParse 校验。
 */
import { describe, expect, it, vi } from "vitest";
import { InstallResultDataSchema } from "@blksails/pi-web-protocol";
import {
  createPackageHostCommand,
  type InstallAuditEvent,
  type PackageHostCommandDeps,
} from "@/lib/app/package-host-command";
import type { Installer, InstallerError, InstallOutcome, UninstallOutcome } from "@/server/cli/install/installer";
import type {
  PluginInstallError,
  PluginInstaller,
  UpdatePluginsResult,
} from "@/server/cli/install/plugin-installer";
import type { InstalledExtension } from "@blksails/pi-web-server";

type Result<T, E> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

/** uninstall 结果缺省与 install 结果同构造(仅用于两者错误码/kind 一致的简单场景)。 */
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

function baseDeps(overrides: Partial<PackageHostCommandDeps> = {}): PackageHostCommandDeps {
  const { installer } = okInstaller({
    ok: true,
    value: { kind: "agent", result: { method: "local", location: "/root/agents/x", created: true } },
  });
  return {
    installer,
    pluginInstaller: makePluginInstaller(),
    adminGate: () => true,
    reloadRunner: vi.fn(async () => undefined),
    audit: vi.fn((_event: InstallAuditEvent) => undefined),
    listAgentSources: vi.fn(async () => []),
    ...overrides,
  };
}

const agentCmd = (o?: Partial<PackageHostCommandDeps>) => createPackageHostCommand("agent", baseDeps(o));
const pluginCmd = (o?: Partial<PackageHostCommandDeps>) => createPackageHostCommand("plugin", baseDeps(o));

// ---------------------------------------------------------------------------
// 命令身份(1.1/2.1/3.1)
// ---------------------------------------------------------------------------

describe("命令身份", () => {
  it("工厂产出的 handler 名与结果 command 字段恒等于承载类别", async () => {
    expect(agentCmd().name).toBe("agent");
    expect(pluginCmd().name).toBe("plugin");
    const r = await agentCmd().execute({ session: makeSession() as never, argv: "" });
    expect(r.command).toBe("agent");
  });
});

// ---------------------------------------------------------------------------
// argv 解析全矩阵(1.5/1.6/2.6/3.4)
// ---------------------------------------------------------------------------

describe("argv 解析(用法路径,effect:none,无 data)", () => {
  it("裸 /agent 与裸 /plugin -> 各自专属用法帮助", async () => {
    const a = await agentCmd().execute({ session: makeSession() as never, argv: "" });
    expect(a.effect).toBe("none");
    expect(a.data).toBeUndefined();
    expect(a.message).toMatch(/用法: \/agent/);

    const p = await pluginCmd().execute({ session: makeSession() as never, argv: "" });
    expect(p.message).toMatch(/用法: \/plugin/);
  });

  it("未知子动作 -> 用法错误,effect:none,无 data", async () => {
    const r = await agentCmd().execute({ session: makeSession() as never, argv: "frobnicate x" });
    expect(r.effect).toBe("none");
    expect(r.data).toBeUndefined();
    expect(r.message).toMatch(/未知子动作/);
  });

  // agent 侧没有 update 通道:CLI 的 AgentChannel 只有装/卸,故按未知子动作处理而非静默降级。
  it("/agent update -> 未知子动作(update 仅 plugin 有),且不触达任何 installer", async () => {
    const pluginInstaller = makePluginInstaller();
    const r = await agentCmd({ pluginInstaller }).execute({
      session: makeSession() as never,
      argv: "update npm:foo",
    });
    expect(r.effect).toBe("none");
    expect(r.message).toMatch(/未知子动作 "update"/);
    expect(pluginInstaller.update).not.toHaveBeenCalled();
  });

  it("install 缺少 <source> / uninstall 缺少 <id> -> 用法错误", async () => {
    const a = await pluginCmd().execute({ session: makeSession() as never, argv: "install" });
    expect(a.message).toMatch(/缺少 <source>/);
    const b = await pluginCmd().execute({ session: makeSession() as never, argv: "uninstall" });
    expect(b.message).toMatch(/缺少 <id>/);
  });

  // 拆分的核心:类别由命令名决定,`--kind` 静默忽略会让沿用旧习惯的人以为覆盖生效了。
  it("出现 --kind(任意取值)-> 参数错误,且 installer 零调用", async () => {
    for (const [cmd, argv] of [
      [agentCmd, "install local:/x --kind plugin"],
      [agentCmd, "install local:/x --kind agent"],
      [pluginCmd, "uninstall foo --kind agent"],
      [pluginCmd, "update npm:foo --kind plugin"],
    ] as const) {
      const { installer, installCalls, uninstallCalls } = okInstaller({
        ok: true,
        value: { kind: "agent", result: { method: "local", location: "/x", created: true } },
      });
      const r = await cmd({ installer }).execute({ session: makeSession() as never, argv });
      expect(r.effect).toBe("none");
      expect(r.data).toBeUndefined();
      expect(r.message).toMatch(/--kind 选项已移除/);
      expect(installCalls).toHaveLength(0);
      expect(uninstallCalls).toHaveLength(0);
    }
  });

  it("list 不要求参数", async () => {
    const r = await pluginCmd().execute({ session: makeSession() as never, argv: "list" });
    expect(r.effect).toBe("notify");
    expect(r.data).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 类别锁定(1.2/1.3/2.2)
// ---------------------------------------------------------------------------

describe("类别锁定", () => {
  it("/agent 的装/卸恒以 kindHint:agent 调用 installer", async () => {
    const { installer, installCalls, uninstallCalls } = okInstaller(
      { ok: true, value: { kind: "agent", result: { method: "local", location: "/root/agents/x", created: true } } },
      { ok: true, value: { kind: "agent", result: { id: "x" } } },
    );
    const cmd = agentCmd({ installer });
    await cmd.execute({ session: makeSession() as never, argv: "install local:./x" });
    await cmd.execute({ session: makeSession() as never, argv: "uninstall x" });
    expect(installCalls[0]?.[1]).toMatchObject({ kindHint: "agent" });
    expect(uninstallCalls[0]?.[1]).toMatchObject({ kindHint: "agent" });
  });

  it("/plugin 的装/卸恒以 kindHint:plugin 调用 installer", async () => {
    const { installer, installCalls, uninstallCalls } = okInstaller(
      { ok: true, value: { kind: "plugin", result: { id: "npm:foo", stdout: "" } } },
      { ok: true, value: { kind: "plugin", result: { id: "npm:foo", stdout: "" } } },
    );
    const cmd = pluginCmd({ installer });
    await cmd.execute({ session: makeSession() as never, argv: "install npm:foo@1.0.0" });
    await cmd.execute({ session: makeSession() as never, argv: "uninstall npm:foo" });
    expect(installCalls[0]?.[1]).toMatchObject({ kindHint: "plugin" });
    expect(uninstallCalls[0]?.[1]).toMatchObject({ kindHint: "plugin" });
  });

  // 有意的行为变化:直连 npm/git 来源在 /agent 下按 agent 处理,绕过 installer 那条
  // 「直连来源不可信、保守按 plugin」的默认约定(命令名即意图)。
  it("/agent install <npm 包> 仍以 kindHint:agent 下发", async () => {
    const { installer, installCalls } = okInstaller({
      ok: true,
      value: { kind: "agent", result: { method: "npm", location: "/root/agents/foo", created: true } },
    });
    await agentCmd({ installer }).execute({
      session: makeSession() as never,
      argv: "install npm:@scope/foo@1.0.0",
    });
    expect(installCalls[0]?.[1]).toMatchObject({ kindHint: "agent" });
  });
});

// ---------------------------------------------------------------------------
// adminGate 拒绝 + 审计(6.1)
// ---------------------------------------------------------------------------

describe("adminGate 拒绝", () => {
  it("adminGate 返回 false -> 失败卡片 + 审计被调用,installer 零调用", async () => {
    const { installer, installCalls } = okInstaller({
      ok: true,
      value: { kind: "agent", result: { method: "local", location: "/x", created: true } },
    });
    const audit = vi.fn((_e: InstallAuditEvent) => undefined);
    const cmd = agentCmd({ installer, adminGate: () => false, audit });

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
// 脱敏(6.3):Bearer/token/URL 凭据样本
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
    const r = await pluginCmd({ installer }).execute({
      session: makeSession() as never,
      argv: "install npm:x@1.0.0",
    });

    const serialized = JSON.stringify(r);
    expect(serialized).not.toMatch(/sk-abcdefghij1234567890/);
    expect(serialized).not.toMatch(/Bearer sk-/);
    expect(serialized).not.toMatch(/sekret-value-123/);
    expect(serialized).not.toMatch(/hunter2/);
  });

  // 复核抓到的真实泄露路径(Req 6.3):source/id 本身就是凭据来源——用户 argv 原样输入
  // `user:token@host` 形式的 URL,过去未脱敏直进卡片 data.id 与审计事件 source。
  const CRED_SOURCE = "git:https://user:hunter2@github.com/org/repo.git";

  it("install 成功(agent):带凭据 URL source 不出现在卡片任何字段", async () => {
    const { installer } = okInstaller({
      ok: true,
      value: { kind: "agent", result: { method: "git", location: "/root/agents/repo", created: true } },
    });
    const r = await agentCmd({ installer }).execute({
      session: makeSession() as never,
      argv: `install ${CRED_SOURCE}`,
    });
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
    const r = await agentCmd({ installer, audit }).execute({
      session: makeSession() as never,
      argv: `install ${CRED_SOURCE}`,
    });
    expect(JSON.stringify(r)).not.toContain("hunter2");
    expect(audit).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(audit.mock.calls[0])).not.toContain("hunter2");
  });

  it("uninstall 成功与失败:带凭据 id 不出现在卡片与审计事件", async () => {
    const okCase = okInstaller(
      { ok: true, value: { kind: "agent", result: { method: "local", location: "/root/agents/x", created: true } } },
      { ok: true, value: { kind: "agent", result: { id: "/root/agents/x" } } },
    );
    const rOk = await agentCmd({ installer: okCase.installer }).execute({
      session: makeSession() as never,
      argv: `uninstall ${CRED_SOURCE}`,
    });
    expect(JSON.stringify(rOk)).not.toContain("hunter2");

    const failCase = okInstaller(
      { ok: false, error: { code: "ALLOWLIST_REJECTED", message: "rejected" } },
      { ok: false, error: { code: "ALLOWLIST_REJECTED", message: `rejected: ${CRED_SOURCE}` } },
    );
    const audit = vi.fn((_event: InstallAuditEvent) => undefined);
    const rFail = await agentCmd({ installer: failCase.installer, audit }).execute({
      session: makeSession() as never,
      argv: `uninstall ${CRED_SOURCE}`,
    });
    expect(JSON.stringify(rFail)).not.toContain("hunter2");
    expect(JSON.stringify(audit.mock.calls)).not.toContain("hunter2");
  });
});

// ---------------------------------------------------------------------------
// 本地源解析基准 = 会话 cwd(6.4;与 install-sources 补全端点同基准)
// ---------------------------------------------------------------------------

describe("本地源解析基准", () => {
  it("installer 收到 ctx.session.cwd(补全候选 local:<rel> 按会话 cwd 产出,执行必须同基准)", async () => {
    const { installer, installCalls } = okInstaller({
      ok: true,
      value: { kind: "agent", result: { method: "local", location: "/root/agents/x", created: true } },
    });
    await agentCmd({ installer, cwd: "/assembly/default" }).execute({
      session: { id: "s1", cwd: "/session/workdir" } as never,
      argv: "install local:./hello-agent",
    });
    expect(installCalls[0]?.[1]).toMatchObject({ cwd: "/session/workdir" });
  });

  it("会话未暴露 cwd 时回退装配兜底 cwd", async () => {
    const { installer, uninstallCalls } = okInstaller(
      { ok: true, value: { kind: "agent", result: { method: "local", location: "/root/agents/x", created: true } } },
      { ok: true, value: { kind: "agent", result: { id: "x" } } },
    );
    await agentCmd({ installer, cwd: "/assembly/default" }).execute({
      session: makeSession() as never,
      argv: "uninstall x",
    });
    expect(uninstallCalls[0]?.[1]).toMatchObject({ cwd: "/assembly/default" });
  });
});

// ---------------------------------------------------------------------------
// 生效分道(1.7/2.5)
// ---------------------------------------------------------------------------

describe("生效分道", () => {
  it("/agent install 成功 -> effect panel-refresh,reloadRunner 恒不被调用,guidance 提到选择器", async () => {
    const { installer } = okInstaller({
      ok: true,
      value: { kind: "agent", result: { method: "local", location: "/root/agents/foo", created: true } },
    });
    const reloadRunner = vi.fn(async () => undefined);
    const r = await agentCmd({ installer, reloadRunner }).execute({
      session: makeSession() as never,
      argv: "install local:/foo",
    });

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

  it("/agent uninstall 成功 -> effect panel-refresh,reloadRunner 恒不被调用", async () => {
    const { installer } = okInstaller(
      { ok: true, value: { kind: "agent", result: { method: "local", location: "/root/agents/foo", created: true } } },
      { ok: true, value: { kind: "agent", result: { id: "foo" } } },
    );
    const reloadRunner = vi.fn(async () => undefined);
    const r = await agentCmd({ installer, reloadRunner }).execute({
      session: makeSession() as never,
      argv: "uninstall foo",
    });

    expect(reloadRunner).not.toHaveBeenCalled();
    expect(r.effect).toBe("panel-refresh");
  });

  it("/plugin install 成功 -> reloadRunner 恰被调用一次,且早于返回(effect notify)", async () => {
    const order: string[] = [];
    const { installer } = okInstaller({
      ok: true,
      value: { kind: "plugin", result: { id: "npm:foo", stdout: "installed\n" } },
    });
    const reloadRunner = vi.fn(async () => {
      order.push("reload");
    });
    const r = await pluginCmd({ installer, reloadRunner }).execute({
      session: makeSession() as never,
      argv: "install npm:foo@1.0.0",
    });
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

  it("/plugin uninstall 成功 -> reloadRunner 恰被调用一次", async () => {
    const { installer } = okInstaller(
      { ok: true, value: { kind: "plugin", result: { id: "npm:foo", stdout: "" } } },
      { ok: true, value: { kind: "plugin", result: { id: "npm:foo", stdout: "removed\n" } } },
    );
    const reloadRunner = vi.fn(async () => undefined);
    const r = await pluginCmd({ installer, reloadRunner }).execute({
      session: makeSession() as never,
      argv: "uninstall npm:foo",
    });

    expect(reloadRunner).toHaveBeenCalledOnce();
    expect(r.effect).toBe("notify");
  });

  it("install 失败 -> reloadRunner 不被调用", async () => {
    const { installer } = okInstaller({
      ok: false,
      error: { code: "PLUGIN_INSTALL_FAILED", message: "boom" },
    });
    const reloadRunner = vi.fn(async () => undefined);
    const r = await pluginCmd({ installer, reloadRunner }).execute({
      session: makeSession() as never,
      argv: "install npm:foo@1.0.0",
    });

    expect(reloadRunner).not.toHaveBeenCalled();
    expect(r.data && (r.data as { ok: boolean }).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// component 错误直通
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
    const r = await agentCmd({ installer, reloadRunner }).execute({
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
// list:两条命令各自的数据源(1.4/2.3)
// ---------------------------------------------------------------------------

describe("/agent list", () => {
  it("取装配注入的 agent 源枚举,items 标注 kind:agent,且不触达 pluginInstaller", async () => {
    const pluginInstaller = makePluginInstaller();
    const listAgentSources = vi.fn(async () => [{ id: "/root/agents/foo" }, { id: "/root/agents/bar" }]);
    const r = await agentCmd({ pluginInstaller, listAgentSources }).execute({
      session: makeSession() as never,
      argv: "list",
    });

    expect(listAgentSources).toHaveBeenCalledOnce();
    expect(pluginInstaller.listInstalled).not.toHaveBeenCalled();
    const parsed = InstallResultDataSchema.safeParse(r.data);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.ok).toBe(true);
      expect(parsed.data.items).toEqual([
        { id: "/root/agents/foo", kind: "agent" },
        { id: "/root/agents/bar", kind: "agent" },
      ]);
    }
  });

  // 未注入枚举源时如实转达,而不是假装"没有已安装 agent 源"。
  it("装配未注入枚举源 -> 失败卡片 AGENT_LIST_NOT_SUPPORTED", async () => {
    const deps = baseDeps();
    delete (deps as { listAgentSources?: unknown }).listAgentSources;
    const r = await createPackageHostCommand("agent", deps).execute({
      session: makeSession() as never,
      argv: "list",
    });
    const parsed = InstallResultDataSchema.safeParse(r.data);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.ok).toBe(false);
      expect(parsed.data.error?.code).toBe("AGENT_LIST_NOT_SUPPORTED");
      expect(parsed.data.items).toBeUndefined();
    }
  });
});

describe("/plugin list", () => {
  it("空列表 -> ok:true,items 为空数组", async () => {
    const pluginInstaller = makePluginInstaller({
      listInstalled: vi.fn(
        async (): Promise<Result<readonly InstalledExtension[], PluginInstallError>> => ({ ok: true, value: [] }),
      ),
    });
    const r = await pluginCmd({ pluginInstaller }).execute({ session: makeSession() as never, argv: "list" });

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
    const r = await pluginCmd({ pluginInstaller }).execute({
      session: makeSession() as never,
      argv: "list --outdated",
    });

    const parsed = InstallResultDataSchema.safeParse(r.data);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.ok).toBe(false);
      expect(parsed.data.error?.code).toBe("OUTDATED_NOT_SUPPORTED");
      expect(parsed.data.items).toBeUndefined();
    }
  });

  it("有数据时 items 含 id/version/scope/kind", async () => {
    const pluginInstaller = makePluginInstaller({
      listInstalled: vi.fn(
        async (): Promise<Result<readonly InstalledExtension[], PluginInstallError>> => ({
          ok: true,
          value: [{ id: "npm:foo", kind: "npm", version: "1.0.0", scope: "global" }],
        }),
      ),
    });
    const r = await pluginCmd({ pluginInstaller }).execute({ session: makeSession() as never, argv: "list" });

    const parsed = InstallResultDataSchema.safeParse(r.data);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.items).toEqual([{ id: "npm:foo", version: "1.0.0", scope: "global", kind: "npm" }]);
    }
  });
});

// ---------------------------------------------------------------------------
// update(2.4/2.5)
// ---------------------------------------------------------------------------

describe("/plugin update", () => {
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
    const r = await pluginCmd({ pluginInstaller, reloadRunner }).execute({
      session: makeSession() as never,
      argv: "update",
    });

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
    const r = await pluginCmd({ pluginInstaller, reloadRunner }).execute({
      session: makeSession() as never,
      argv: "update",
    });

    expect(reloadRunner).not.toHaveBeenCalled();
    const parsed = InstallResultDataSchema.safeParse(r.data);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.ok).toBe(false);
      expect(parsed.data.steps.some((s) => s.status === "failed")).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// registry 通道(spec installer-registry-channel,任务 3.4)
// ---------------------------------------------------------------------------

describe("registry 标识的安装结果卡片", () => {
  it("成功 → 与直连 agent 安装同形状的卡片(panel-refresh,不重载会话)", async () => {
    const reloadRunner = vi.fn(async () => undefined);
    const { installer, installCalls } = okInstaller({
      ok: true,
      value: {
        kind: "agent",
        result: { method: "registry", location: "/root/agents/acme_hello-cloud", created: true },
        registry: { sourceId: "acme/hello-cloud", version: "1.2.3", verifiedFiles: 4 },
      },
    });
    const r = await agentCmd({ installer, reloadRunner }).execute({
      session: makeSession() as never,
      argv: "install acme/hello-cloud",
    });

    // 类别仍在构造时固化 —— registry 标识不改变「命令名即意图」这条。
    expect(installCalls[0]?.[1]).toMatchObject({ kindHint: "agent" });
    expect(r.effect).toBe("panel-refresh");
    expect(reloadRunner).not.toHaveBeenCalled();
    const parsed = InstallResultDataSchema.safeParse(r.data);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.ok).toBe(true);
      expect(parsed.data.kind).toBe("agent");
      expect(parsed.data.location).toBe("/root/agents/acme_hello-cloud");
    }
  });

  it("通道不可用 → REGISTRY_UNAVAILABLE 卡片 + 登录/配置指路(不再是 not yet supported)", async () => {
    const { installer } = okInstaller({
      ok: false,
      error: { code: "REGISTRY_UNAVAILABLE", message: "registry 不可用:当前未登录或未取得源授予。" },
    });
    const r = await agentCmd({ installer }).execute({
      session: makeSession() as never,
      argv: "install acme/hello-cloud",
    });

    const parsed = InstallResultDataSchema.safeParse(r.data);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.ok).toBe(false);
    expect(parsed.data.error?.code).toBe("REGISTRY_UNAVAILABLE");
    expect(parsed.data.guidance).toContain("登录");
    expect(JSON.stringify(parsed.data)).not.toContain("not yet supported");
  });

  it("清单 kind 与命令不符 → 卡片指出应改用哪条命令", async () => {
    const { installer } = okInstaller({
      ok: false,
      error: {
        code: "REGISTRY_KIND_MISMATCH",
        message: '该 registry 包声明的类别是 "plugin",而当前命令按 "agent" 安装。请改用 /plugin install。',
      },
    });
    const r = await agentCmd({ installer }).execute({
      session: makeSession() as never,
      argv: "install acme/some-plugin",
    });

    const parsed = InstallResultDataSchema.safeParse(r.data);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.ok).toBe(false);
    expect(parsed.data.error?.code).toBe("REGISTRY_KIND_MISMATCH");
    expect(parsed.data.error?.message).toContain("/plugin install");
    expect(parsed.data.guidance).toBeDefined();
  });

  it("registry 标识里若夹带凭据,输出面一律脱敏(安装调用仍用原值)", async () => {
    const { installer, installCalls } = okInstaller({
      ok: false,
      error: { code: "REGISTRY_UNAVAILABLE", message: "registry 不可用。" },
    });
    const raw = "https://user:s3cr3t@example.com/org/name";
    const r = await agentCmd({ installer }).execute({
      session: makeSession() as never,
      argv: `install ${raw}`,
    });

    expect(installCalls[0]?.[0]).toBe(raw); // 安装调用需要原值
    expect(JSON.stringify(r.data)).not.toContain("s3cr3t"); // 卡片不得泄露
  });
});
