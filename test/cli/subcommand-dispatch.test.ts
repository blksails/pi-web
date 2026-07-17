// @vitest-environment node
/**
 * runSubcommand 分发层单测(spec cli-package-commands,任务 6.1,Req 1.7)。
 *
 * 全程注入依赖替身(scaffold/installer/pluginInstaller),绝不真的 spawn
 * `git`/`npm`/`pi`,绝不触碰真实文件系统写入或网络。覆盖观察态:
 * create/install/uninstall/list/update 各一次成功(exit 0)与一次失败(非 0)路径;
 * create --list 与 list 空列表两个特殊 exit 0 分支;list --outdated 与未知子命令/
 * 非法选项/publish 的非 0 分支。
 */
import { describe, it, expect, vi } from "vitest";
import { tmpdir } from "node:os";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { runSubcommand, type RunSubcommandDeps, type ScaffoldResult } from "@/server/cli/index";
import type { Installer } from "@/server/cli/install/installer";
import type { PluginInstaller } from "@/server/cli/install/plugin-installer";
import type { RegistryPort } from "@/server/cli/registry/registry-port";
import type { ScaffoldSuccess, ScaffoldError } from "@/server/cli/scaffold/scaffold-writer";
import type { TemplateInfo } from "@/server/cli/scaffold/template-catalog";

/** 静默 reporter,避免测试输出污染终端;调用记录可用于断言。 */
function silentReporter() {
  return { start: vi.fn(), complete: vi.fn(), fail: vi.fn() };
}

/** create --list 用得到的一个真实存在的目录,内容无关(listTemplatesFn 被替身接管)。 */
const EXISTING_DIR_CANDIDATES = [tmpdir()];

describe("runSubcommand — create", () => {
  it("成功路径:scaffoldFn 返回 ok → 退出码 0", async () => {
    const scaffoldFn = vi.fn(
      async (): Promise<ScaffoldResult<ScaffoldSuccess, ScaffoldError>> => ({
        ok: true,
        value: {
          createdAt: new Date().toISOString(),
          absolutePath: "/tmp/my-agent",
          nextStepHint: "pi-web /tmp/my-agent",
        } satisfies ScaffoldSuccess,
      }),
    );
    const deps: RunSubcommandDeps = {
      examplesRootCandidates: EXISTING_DIR_CANDIDATES,
      scaffoldFn,
      reporter: silentReporter(),
    };
    const code = await runSubcommand("create", ["my-agent"], deps);
    expect(code).toBe(0);
    expect(scaffoldFn).toHaveBeenCalledTimes(1);
  });

  it("失败路径:scaffoldFn 返回 TARGET_NOT_EMPTY → 非零退出码", async () => {
    const scaffoldFn = vi.fn(
      async (): Promise<ScaffoldResult<ScaffoldSuccess, ScaffoldError>> => ({
        ok: false,
        error: { code: "TARGET_NOT_EMPTY", path: "/tmp/my-agent" } satisfies ScaffoldError,
      }),
    );
    const deps: RunSubcommandDeps = {
      examplesRootCandidates: EXISTING_DIR_CANDIDATES,
      scaffoldFn,
      reporter: silentReporter(),
    };
    const code = await runSubcommand("create", ["my-agent"], deps);
    expect(code).not.toBe(0);
  });

  it("--list → 退出码 0,不调用 scaffoldFn(不创建任何文件)", async () => {
    const listTemplatesFn = vi.fn(
      (): readonly TemplateInfo[] => [
        { name: "minimal-agent", title: "Minimal Agent", avatar: "📦", description: "" },
      ],
    );
    const scaffoldFn = vi.fn(async (): Promise<ScaffoldResult<ScaffoldSuccess, ScaffoldError>> => {
      throw new Error("scaffold 不应被调用");
    });
    const deps: RunSubcommandDeps = {
      examplesRootCandidates: EXISTING_DIR_CANDIDATES,
      listTemplatesFn,
      scaffoldFn,
      reporter: silentReporter(),
    };
    const code = await runSubcommand("create", ["--list"], deps);
    expect(code).toBe(0);
    expect(listTemplatesFn).toHaveBeenCalledTimes(1);
    expect(scaffoldFn).not.toHaveBeenCalled();
  });

  it("缺少 <name> 位置参数 → 非零退出码,不调用 scaffoldFn", async () => {
    const scaffoldFn = vi.fn();
    const code = await runSubcommand("create", [], {
      examplesRootCandidates: EXISTING_DIR_CANDIDATES,
      scaffoldFn: scaffoldFn as unknown as RunSubcommandDeps["scaffoldFn"],
      reporter: silentReporter(),
    });
    expect(code).not.toBe(0);
    expect(scaffoldFn).not.toHaveBeenCalled();
  });
});

describe("runSubcommand — install", () => {
  function fakeInstaller(overrides?: Partial<Installer>): Installer {
    return {
      install: vi.fn(async () => ({
        ok: true,
        value: { kind: "plugin" as const, result: { id: "npm:foo", stdout: "" } },
      } as const)),
      uninstall: vi.fn(async () => ({
        ok: true,
        value: { kind: "plugin" as const, result: { id: "npm:foo", stdout: "" } },
      } as const)),
      ...overrides,
    };
  }

  it("成功路径 → 退出码 0", async () => {
    const installer = fakeInstaller();
    const code = await runSubcommand("install", ["npm:foo"], { installer, reporter: silentReporter() });
    expect(code).toBe(0);
    expect(installer.install).toHaveBeenCalledTimes(1);
  });

  it("失败路径(ALLOWLIST_REJECTED)→ 非零退出码", async () => {
    const installer = fakeInstaller({
      install: vi.fn(async () => ({
        ok: false,
        error: { code: "ALLOWLIST_REJECTED" as const, message: "rejected" },
      } as const)),
    });
    const code = await runSubcommand("install", ["npm:foo"], { installer, reporter: silentReporter() });
    expect(code).not.toBe(0);
  });

  it("缺少 <source> 位置参数 → 非零退出码,不调用 installer", async () => {
    const installer = fakeInstaller();
    const code = await runSubcommand("install", [], { installer, reporter: silentReporter() });
    expect(code).not.toBe(0);
    expect(installer.install).not.toHaveBeenCalled();
  });

  it("--kind 非法取值 → 非零退出码,不调用 installer", async () => {
    const installer = fakeInstaller();
    const code = await runSubcommand("install", ["npm:foo", "--kind", "bogus"], {
      installer,
      reporter: silentReporter(),
    });
    expect(code).not.toBe(0);
    expect(installer.install).not.toHaveBeenCalled();
  });

  // --- 接线层覆盖(复核 REJECTED 补齐):断言 argv → installer.install(options) 的转发 ---

  it("--kind agent → installer.install 收到 kindHint: \"agent\"", async () => {
    const installer = fakeInstaller();
    const code = await runSubcommand("install", ["some-id", "--kind", "agent"], {
      installer,
      reporter: silentReporter(),
    });
    expect(code).toBe(0);
    expect(installer.install).toHaveBeenCalledTimes(1);
    const [, options] = (installer.install as ReturnType<typeof vi.fn>).mock.calls[0] as [string, { kindHint?: string }];
    expect(options.kindHint).toBe("agent");
  });

  it("--kind bogus → 非零退出码,错误信息含「取值非法」,installer.install 零调用", async () => {
    const installer = fakeInstaller();
    const reporter = silentReporter();
    const code = await runSubcommand("install", ["some-id", "--kind", "bogus"], { installer, reporter });
    expect(code).not.toBe(0);
    expect(installer.install).not.toHaveBeenCalled();
    expect(reporter.fail).toHaveBeenCalledTimes(1);
    const failCall = (reporter.fail as ReturnType<typeof vi.fn>).mock.calls[0] as [string, { message: string }];
    expect(failCall[1].message).toContain("取值非法");
  });

  it("--project → installer.install 收到 scope: \"project\"", async () => {
    const installer = fakeInstaller();
    const code = await runSubcommand("install", ["some-id", "--project"], { installer, reporter: silentReporter() });
    expect(code).toBe(0);
    const [, options] = (installer.install as ReturnType<typeof vi.fn>).mock.calls[0] as [string, { scope?: string }];
    expect(options.scope).toBe("project");
  });

  it("不传 --kind/--project → installer.install 收到 scope: \"user\" 且 kindHint 为 undefined(缺省语义)", async () => {
    const installer = fakeInstaller();
    const code = await runSubcommand("install", ["some-id"], { installer, reporter: silentReporter() });
    expect(code).toBe(0);
    const [, options] = (installer.install as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { scope?: string; kindHint?: string },
    ];
    expect(options.scope).toBe("user");
    expect(options.kindHint).toBeUndefined();
  });
});

describe("runSubcommand — uninstall", () => {
  function fakeInstaller(overrides?: Partial<Installer>): Installer {
    return {
      install: vi.fn(async () => ({
        ok: true,
        value: { kind: "plugin" as const, result: { id: "npm:foo", stdout: "" } },
      } as const)),
      uninstall: vi.fn(async () => ({
        ok: true,
        value: { kind: "plugin" as const, result: { id: "npm:foo", stdout: "" } },
      } as const)),
      ...overrides,
    };
  }

  it("成功路径 → 退出码 0", async () => {
    const installer = fakeInstaller();
    const code = await runSubcommand("uninstall", ["npm:foo"], { installer, reporter: silentReporter() });
    expect(code).toBe(0);
    expect(installer.uninstall).toHaveBeenCalledTimes(1);
  });

  it("失败路径(未安装)→ 非零退出码", async () => {
    const installer = fakeInstaller({
      uninstall: vi.fn(async () => ({
        ok: false,
        error: { code: "PLUGIN_UNINSTALL_FAILED" as const, message: "Not installed: npm:foo" },
      } as const)),
    });
    const code = await runSubcommand("uninstall", ["npm:foo"], { installer, reporter: silentReporter() });
    expect(code).not.toBe(0);
  });

  // --- 接线层覆盖(复核 REJECTED 补齐):断言 argv → installer.uninstall(options) 的转发 ---
  // 这是本轮修复的核心断言:mutation 实证(把 runUninstall 里的转发改成
  // `installer.uninstall(name, { cwd })`,丢弃 scope 与 kindHint)后,236 条既有测试
  // 全部仍绿 —— 因为此前没有任何用例检查 `uninstall.mock.calls[0]` 的第二个参数。

  it("--kind agent → installer.uninstall 收到 kindHint: \"agent\"", async () => {
    const installer = fakeInstaller();
    const code = await runSubcommand("uninstall", ["some-id", "--kind", "agent"], {
      installer,
      reporter: silentReporter(),
    });
    expect(code).toBe(0);
    expect(installer.uninstall).toHaveBeenCalledTimes(1);
    const [, options] = (installer.uninstall as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { kindHint?: string },
    ];
    expect(options.kindHint).toBe("agent");
  });

  it("--kind bogus → 非零退出码,错误信息含「取值非法」,installer.uninstall 零调用", async () => {
    const installer = fakeInstaller();
    const reporter = silentReporter();
    const code = await runSubcommand("uninstall", ["some-id", "--kind", "bogus"], { installer, reporter });
    expect(code).not.toBe(0);
    expect(installer.uninstall).not.toHaveBeenCalled();
    expect(reporter.fail).toHaveBeenCalledTimes(1);
    const failCall = (reporter.fail as ReturnType<typeof vi.fn>).mock.calls[0] as [string, { message: string }];
    expect(failCall[1].message).toContain("取值非法");
  });

  it("--project → installer.uninstall 收到 scope: \"project\"", async () => {
    const installer = fakeInstaller();
    const code = await runSubcommand("uninstall", ["some-id", "--project"], {
      installer,
      reporter: silentReporter(),
    });
    expect(code).toBe(0);
    const [, options] = (installer.uninstall as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { scope?: string },
    ];
    expect(options.scope).toBe("project");
  });

  it("不传 --kind/--project → installer.uninstall 收到 scope: \"user\" 且 kindHint 为 undefined(缺省语义)", async () => {
    const installer = fakeInstaller();
    const code = await runSubcommand("uninstall", ["some-id"], { installer, reporter: silentReporter() });
    expect(code).toBe(0);
    const [, options] = (installer.uninstall as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { scope?: string; kindHint?: string },
    ];
    expect(options.scope).toBe("user");
    expect(options.kindHint).toBeUndefined();
  });
});

describe("runSubcommand — list", () => {
  function fakePluginInstaller(overrides?: Partial<PluginInstaller>): PluginInstaller {
    return {
      install: vi.fn(),
      uninstall: vi.fn(),
      listInstalled: vi.fn(async () => ({ ok: true, value: [] } as const)),
      update: vi.fn(),
      ...overrides,
    } as unknown as PluginInstaller;
  }

  it("成功路径(非空列表)→ 退出码 0", async () => {
    const pluginInstaller = fakePluginInstaller({
      listInstalled: vi.fn(async () => ({
        ok: true,
        value: [{ id: "npm:foo", kind: "npm" as const, version: "1.0.0", scope: "global" as const }],
      } as const)),
    });
    const code = await runSubcommand("list", [], { pluginInstaller, reporter: silentReporter() });
    expect(code).toBe(0);
  });

  it("空列表(无已安装包)→ 退出码 0(Req 4.2)", async () => {
    const pluginInstaller = fakePluginInstaller();
    const code = await runSubcommand("list", [], { pluginInstaller, reporter: silentReporter() });
    expect(code).toBe(0);
  });

  it("失败路径(LIST_FAILED)→ 非零退出码", async () => {
    const pluginInstaller = fakePluginInstaller({
      listInstalled: vi.fn(async () => ({
        ok: false,
        error: { code: "LIST_FAILED" as const, message: "pi list failed" },
      } as const)),
    });
    const code = await runSubcommand("list", [], { pluginInstaller, reporter: silentReporter() });
    expect(code).not.toBe(0);
  });

  it("--outdated → OUTDATED_NOT_SUPPORTED → 非零退出码", async () => {
    const pluginInstaller = fakePluginInstaller({
      listInstalled: vi.fn(async () => ({
        ok: false,
        error: { code: "OUTDATED_NOT_SUPPORTED" as const, message: "not supported" },
      } as const)),
    });
    const code = await runSubcommand("list", ["--outdated"], { pluginInstaller, reporter: silentReporter() });
    expect(code).not.toBe(0);
  });
});

describe("runSubcommand — update", () => {
  function fakePluginInstaller(overrides?: Partial<PluginInstaller>): PluginInstaller {
    return {
      install: vi.fn(),
      uninstall: vi.fn(),
      listInstalled: vi.fn(),
      update: vi.fn(async () => ({ ok: true, value: { outcomes: [], hasFailures: false } } as const)),
      ...overrides,
    } as unknown as PluginInstaller;
  }

  it("成功路径(全部成功/跳过)→ 退出码 0", async () => {
    const pluginInstaller = fakePluginInstaller({
      update: vi.fn(async () => ({
        ok: true,
        value: { outcomes: [{ id: "npm:foo", status: "updated" as const }], hasFailures: false },
      } as const)),
    });
    const code = await runSubcommand("update", [], { pluginInstaller, reporter: silentReporter() });
    expect(code).toBe(0);
  });

  it("失败路径(hasFailures)→ 非零退出码", async () => {
    const pluginInstaller = fakePluginInstaller({
      update: vi.fn(async () => ({
        ok: true,
        value: {
          outcomes: [{ id: "npm:foo", status: "failed" as const, reason: "boom" }],
          hasFailures: true,
        },
      } as const)),
    });
    const code = await runSubcommand("update", [], { pluginInstaller, reporter: silentReporter() });
    expect(code).not.toBe(0);
  });

  it("基础设施失败(listInstalled 失败)→ 非零退出码", async () => {
    const pluginInstaller = fakePluginInstaller({
      update: vi.fn(async () => ({
        ok: false,
        error: { code: "LIST_FAILED" as const, message: "pi list failed" },
      } as const)),
    });
    const code = await runSubcommand("update", [], { pluginInstaller, reporter: silentReporter() });
    expect(code).not.toBe(0);
  });

  // --- registry 通道(update 对齐补记,Req 4.8–4.10)---

  /** 在临时安装根植入一个带回执的 registry 安装目录,返回 { root, dir }。 */
  function plantRegistryInstall(receipt: Record<string, unknown>): { root: string; dir: string } {
    const root = mkdtempSync(join(tmpdir(), "pi-dispatch-upd-"));
    const dir = join(root, "acme_pack");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, ".pi-web-registry.json"), JSON.stringify(receipt));
    return { root, dir };
  }

  /** fake RegistryPort:resolve 恒返回给定版本(其余方法不参与 update 判定路径)。 */
  function fakeRegistryPort(version: string): RegistryPort {
    return {
      resolve: vi.fn(async (sourceId: string) => ({
        ok: true as const,
        value: { sourceId, version, origin: { type: "oss" as const, bundle: "b" }, manifest: { signature: "s" } },
      })),
      downloadBundle: vi.fn(),
      uploadBundle: vi.fn(),
      registerVersion: vi.fn(),
      setChannel: vi.fn(),
    } as unknown as RegistryPort;
  }

  it("★ 指定 packageId 命中 registry 台账 → 只走 registry 通道,plugin 通道不被打扰", async () => {
    const { root } = plantRegistryInstall({ sourceId: "acme/pack", version: "1.0.0" });
    const pluginUpdate = vi.fn();
    const pluginInstaller = fakePluginInstaller({ update: pluginUpdate });
    const code = await runSubcommand("update", ["acme/pack"], {
      pluginInstaller,
      registry: fakeRegistryPort("1.0.0"), // 与回执同版本 → skipped
      env: { PI_WEB_REGISTRY_INSTALL_DIR: root } as NodeJS.ProcessEnv,
      reporter: silentReporter(),
    });
    expect(code).toBe(0);
    expect(pluginUpdate).not.toHaveBeenCalled();
    rmSync(root, { recursive: true, force: true });
  });

  it("指定 packageId 未命中 registry 台账 → 落 plugin 通道(既有行为)", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-dispatch-upd-")); // 空安装根
    const pluginUpdate = vi.fn(async () => ({
      ok: true as const,
      value: { outcomes: [], hasFailures: false },
    }));
    const pluginInstaller = fakePluginInstaller({ update: pluginUpdate });
    const code = await runSubcommand("update", ["npm:foo"], {
      pluginInstaller,
      env: { PI_WEB_REGISTRY_INSTALL_DIR: root } as NodeJS.ProcessEnv,
      reporter: silentReporter(),
    });
    expect(code).toBe(0);
    expect(pluginUpdate).toHaveBeenCalledWith({ packageId: "npm:foo" });
    rmSync(root, { recursive: true, force: true });
  });

  it("★ 无 packageId → 两通道都跑;registry 通道失败时即便 plugin 全成功也非零退出", async () => {
    // registry 未配置(不注入 port、env 无 URL)但存在回执 → registry 通道逐项 failed
    const { root } = plantRegistryInstall({ sourceId: "acme/pack", version: "1.0.0" });
    const pluginUpdate = vi.fn(async () => ({
      ok: true as const,
      value: { outcomes: [{ id: "npm:foo", status: "updated" as const }], hasFailures: false },
    }));
    const pluginInstaller = fakePluginInstaller({ update: pluginUpdate });
    const code = await runSubcommand("update", [], {
      pluginInstaller,
      env: { PI_WEB_REGISTRY_INSTALL_DIR: root } as NodeJS.ProcessEnv,
      reporter: silentReporter(),
    });
    expect(code).not.toBe(0);
    expect(pluginUpdate).toHaveBeenCalled(); // 两通道都跑了
    rmSync(root, { recursive: true, force: true });
  });
});

describe("runSubcommand — publish(尚未接入,Wave 2)", () => {
  it("→ 非零退出码", async () => {
    const code = await runSubcommand("publish", ["--dry-run"], { reporter: silentReporter() });
    expect(code).not.toBe(0);
  });
});

describe("runSubcommand — 未知子命令 / 非法选项", () => {
  it("未知子命令 → 非零退出码", async () => {
    const code = await runSubcommand("bogus", [], { reporter: silentReporter() });
    expect(code).not.toBe(0);
  });

  it("子命令下的非法选项 → 非零退出码,无副作用(installer 未被调用)", async () => {
    const installer: Installer = {
      install: vi.fn(async () => ({
        ok: true,
        value: { kind: "plugin" as const, result: { id: "npm:foo", stdout: "" } },
      } as const)),
      uninstall: vi.fn(),
    };
    const code = await runSubcommand("install", ["npm:foo", "--bogus-option"], {
      installer,
      reporter: silentReporter(),
    });
    expect(code).not.toBe(0);
    expect(installer.install).not.toHaveBeenCalled();
  });
});
