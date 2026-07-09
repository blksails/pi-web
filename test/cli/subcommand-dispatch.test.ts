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
import { runSubcommand, type RunSubcommandDeps, type ScaffoldResult } from "@/server/cli/index";
import type { Installer } from "@/server/cli/install/installer";
import type { PluginInstaller } from "@/server/cli/install/plugin-installer";
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
