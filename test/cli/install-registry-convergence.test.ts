// @vitest-environment node
/**
 * CLI `pi-web install <registry-id>` 收敛到 `Installer` 的 registry 通道
 * (spec installer-registry-channel,任务 3.4,Req 4.1/4.2/4.3)。
 *
 * 收敛前 `runInstall` 里有一段**绕开 `Installer`** 的独立 registry 编排,且**零测试覆盖**
 * ——删掉它时没有任何用例变红,正是缺口的证据。本文件补上:
 *   1. registry 形态的实参确实进了 `installer.install()`(不再被前置分支截走);
 *   2. 成功输出与收敛前**等效**(id@版本 / 落点 / 复核文件数);
 *   3. 直连形态不回归;
 *   4. 端到端:不注入 `Installer`,只注入 `RegistryPort` 夹具,让真实的
 *      `createDefaultInstaller` → `createRegistryChannel` → `installFromRegistry` 全链路跑通。
 */
import { describe, it, expect, vi, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeIntegrity } from "@pi-clouds/registry-client";
import { runSubcommand } from "@/server/cli/index";
import type { Installer } from "@/server/cli/install/installer";
import type { RegistryPort } from "@/server/cli/registry/registry-port";

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
const scratch = (): string => {
  const d = mkdtempSync(join(tmpdir(), "pi-conv-"));
  dirs.push(d);
  return d;
};

function capturingReporter() {
  const completes: { stage: string; detail?: string }[] = [];
  const fails: { stage: string; error: { code: string; message: string } }[] = [];
  return {
    reporter: {
      start: vi.fn(),
      complete: vi.fn((stage: string, detail?: string) => {
        completes.push({ stage, ...(detail !== undefined ? { detail } : {}) });
      }),
      fail: vi.fn((stage: string, error: { code: string; message: string }) => {
        fails.push({ stage, error });
      }),
    },
    completes,
    fails,
  };
}

// ---------------------------------------------------------------------------
// 1–3:注入 Installer 替身,验分派与输出
// ---------------------------------------------------------------------------

describe("CLI install — registry 形态经 Installer", () => {
  it("registry 标识进入 installer.install(),不再被独立分支截走", async () => {
    const install = vi.fn(async () => ({
      ok: true as const,
      value: {
        kind: "agent" as const,
        result: { method: "registry" as const, location: "/root/acme_hello", created: true },
        registry: { sourceId: "acme/hello-cloud", version: "1.2.3", verifiedFiles: 7 },
      },
    }));
    const installer = { install, uninstall: vi.fn() } as unknown as Installer;
    const { reporter, completes } = capturingReporter();

    const code = await runSubcommand("install", ["acme/hello-cloud"], { installer, reporter });

    expect(code).toBe(0);
    expect(install).toHaveBeenCalledTimes(1);
    expect((install.mock.calls[0] as unknown as unknown[])[0]).toBe("acme/hello-cloud");
    // 输出与收敛前那段独立编排等效:id@版本 / 落点 / 复核文件数三项俱全。
    const detail = completes[0]?.detail ?? "";
    expect(detail).toContain("acme/hello-cloud@1.2.3");
    expect(detail).toContain("/root/acme_hello");
    expect(detail).toContain("7");
  });

  it("直连来源无溯源信息 → 沿用原本的结果摘要,不回归", async () => {
    const install = vi.fn(async () => ({
      ok: true as const,
      value: { kind: "plugin" as const, result: { id: "npm:foo", stdout: "" } },
    }));
    const installer = { install, uninstall: vi.fn() } as unknown as Installer;
    const { reporter, completes } = capturingReporter();

    const code = await runSubcommand("install", ["npm:foo@1.2.3"], { installer, reporter });

    expect(code).toBe(0);
    expect(completes[0]?.detail).toContain("plugin");
  });

  it("registry 通道不可用 → 非零退出 + REGISTRY_UNAVAILABLE", async () => {
    const installer = {
      install: vi.fn(async () => ({
        ok: false as const,
        error: { code: "REGISTRY_UNAVAILABLE" as const, message: "未配置 registry" },
      })),
      uninstall: vi.fn(),
    } as unknown as Installer;
    const { reporter, fails } = capturingReporter();

    const code = await runSubcommand("install", ["acme/hello-cloud"], { installer, reporter });

    expect(code).not.toBe(0);
    expect(fails[0]?.error.code).toBe("REGISTRY_UNAVAILABLE");
  });
});

// ---------------------------------------------------------------------------
// 4:端到端 —— 真实 createDefaultInstaller / 真实通道 / 真实 installFromRegistry
// ---------------------------------------------------------------------------

const ENTRY = "export default {};\n";

function makeBundle(): Uint8Array {
  const stage = scratch();
  writeFileSync(join(stage, "index.ts"), ENTRY);
  const tgz = join(scratch(), "b.tgz");
  execFileSync("tar", ["-czf", tgz, "-C", stage, "."]);
  return new Uint8Array(readFileSync(tgz));
}

function fixtureRegistry(kind: string): RegistryPort {
  const bundle = makeBundle();
  return {
    async resolve(sourceId) {
      return {
        ok: true,
        value: {
          sourceId,
          version: "2.0.0",
          origin: { type: "oss", bundle: "k" },
          manifest: {
            kind,
            entry: { path: "index.ts", integrity: computeIntegrity(new TextEncoder().encode(ENTRY)) },
          },
        },
      };
    },
    async downloadBundle() {
      return { ok: true, value: bundle };
    },
    async uploadBundle() {
      throw new Error("unused");
    },
    async registerVersion() {
      throw new Error("unused");
    },
    async setChannel() {
      throw new Error("unused");
    },
  };
}

describe("CLI install — 端到端经真实通道(不注入 Installer)", () => {
  it("registry agent 包装到 PI_WEB_REGISTRY_INSTALL_DIR 下,输出含版本与复核数", async () => {
    const installRoot = scratch();
    const { reporter, completes, fails } = capturingReporter();

    const code = await runSubcommand("install", ["acme/hello-cloud"], {
      registry: fixtureRegistry("agent"),
      env: { PI_WEB_REGISTRY_INSTALL_DIR: installRoot } as NodeJS.ProcessEnv,
      cwd: scratch(),
      reporter,
    });

    expect(fails).toEqual([]);
    expect(code).toBe(0);
    // 落点与收敛前逐字节一致(registryInstallDirName 的 sanitize 规则未变)。
    const dir = join(installRoot, "acme_hello-cloud");
    expect(existsSync(join(dir, "index.ts"))).toBe(true);
    // 回执必须写下 —— `pi-web update` 的 registry 通道靠它判定跟踪对象。
    expect(existsSync(join(dir, ".pi-web-registry.json"))).toBe(true);
    const detail = completes[0]?.detail ?? "";
    expect(detail).toContain("acme/hello-cloud@2.0.0");
    expect(detail).toContain("复核 1 文件");
  });

  it("清单 kind=plugin 但用 --kind agent 安装 → 拒绝,且不落进 agent 落点", async () => {
    const installRoot = scratch();
    const { reporter, fails } = capturingReporter();

    const code = await runSubcommand("install", ["acme/some-plugin", "--kind", "agent"], {
      registry: fixtureRegistry("plugin"),
      env: { PI_WEB_REGISTRY_INSTALL_DIR: installRoot } as NodeJS.ProcessEnv,
      cwd: scratch(),
      reporter,
    });

    expect(code).not.toBe(0);
    expect(fails[0]?.error.code).toBe("REGISTRY_KIND_MISMATCH");
    expect(fails[0]?.error.message).toContain("/plugin install");
    expect(existsSync(join(installRoot, "acme_some-plugin"))).toBe(false);
  });

  it("清单未声明 kind → MANIFEST_KIND_UNKNOWN,不猜缺省", async () => {
    const installRoot = scratch();
    const { reporter, fails } = capturingReporter();

    const code = await runSubcommand("install", ["acme/no-kind"], {
      registry: fixtureRegistry("__absent__"), // 非法取值,等价于未声明
      env: { PI_WEB_REGISTRY_INSTALL_DIR: installRoot } as NodeJS.ProcessEnv,
      cwd: scratch(),
      reporter,
    });

    expect(code).not.toBe(0);
    expect(fails[0]?.error.message).toContain("MANIFEST_KIND_UNKNOWN");
  });
});
