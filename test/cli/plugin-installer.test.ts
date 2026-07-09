// @vitest-environment node
/**
 * PluginInstaller 单测(spec cli-package-commands,任务 4.3,Req 3.5, 3.7, 3.8, 3.9)。
 *
 * 全程注入 `PiCli` 替身,绝不真的 spawn `pi` 子进程。覆盖:
 *   - Req 3.5/3.7(观察态):安装调用的参数恰为 pi 的非交互安装形态
 *     (`["install", <source>, "--no-approve"]`),不断言 `--ignore-scripts`(pi 无此 flag)。
 *   - Req 3.8:卸载成功 → 输出被移除的包标识;替身收到的 args 为 `["remove", <id>]`。
 *   - Req 3.9:卸载一个未安装的包 → 返回判别联合错误(不抛异常),不调用 `pi remove`。
 *   - `listInstalled()`:复用 `parsePiList` 解析固定 stdout。
 *   - pi 子进程失败(`ok:false`)→ 映射为判别联合错误,消息脱敏。
 *   - `PiCliNotFoundError` → 可操作错误(pi 安装指引)。
 */
import { describe, it, expect } from "vitest";
import { PiCliNotFoundError, type PiCli, type PiCommandResult } from "@blksails/pi-web-server";
import { createPluginInstaller, normalizeExtSourceId } from "@/server/cli/install/plugin-installer";

interface RecordedCall {
  readonly args: readonly string[];
  readonly env: Record<string, string>;
}

function makeStubPiCli(
  runResult: PiCommandResult | ((args: readonly string[]) => PiCommandResult),
): { piCli: PiCli; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const piCli: PiCli = {
    async runPiCommand(args, env) {
      calls.push({ args, env });
      return typeof runResult === "function" ? runResult(args) : runResult;
    },
    async listExtensions() {
      throw new Error("listExtensions() should not be used directly by PluginInstaller");
    },
  };
  return { piCli, calls };
}

describe("PluginInstaller.install (Req 3.5, 3.7)", () => {
  it("calls pi with the non-interactive install shape: [\"install\", <source>, \"--no-approve\"]", async () => {
    const { piCli, calls } = makeStubPiCli({ ok: true, stdout: "installed\n", exitCode: 0 });
    const installer = createPluginInstaller({ piCli });

    const result = await installer.install({
      kind: "npm",
      name: "some-plugin",
      version: "1.2.3",
    });

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toEqual(["install", "npm:some-plugin@1.2.3", "--no-approve"]);
    // 明确不断言 --ignore-scripts:pi 0.79.6 没有该 flag(见 requirements 3.5 裁定)。
    expect(calls[0]?.args).not.toContain("--ignore-scripts");
    if (result.ok) {
      // 返回的 id 是台账形态(不含版本),与 listInstalled()/parsePiList 的 id 语义
      // 对齐,而非传给 pi 的完整来源串(见 normalizeExtSourceId)。
      expect(result.value.id).toBe("npm:some-plugin");
    }
  });

  it("maps a failed pi install invocation to a discriminated PI_COMMAND_FAILED error (redacted)", async () => {
    const { piCli } = makeStubPiCli({
      ok: false,
      stdout: "",
      exitCode: 1,
      errorSummary: 'failed: Authorization: Bearer sk-abcdef1234567890',
    });
    const installer = createPluginInstaller({ piCli });

    const result = await installer.install({ kind: "npm", name: "bad-plugin", version: "1.0.0" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("PI_COMMAND_FAILED");
      expect(result.error.message).not.toContain("sk-abcdef1234567890");
      expect(result.error.message).toContain("[redacted]");
    }
  });
});

describe("PluginInstaller.uninstall (Req 3.8, 3.9)", () => {
  it("removes an installed package: outputs the removed id, args are [\"remove\", <id>]", async () => {
    // parsePiList 的 `id` 不含版本号(见 pi-cli.ts parseListLine:最后一个 "@" 之后是 version),
    // 故此处台账条目与 uninstall() 的入参都用不带版本的规范标识,与解析器真实行为对齐。
    const { piCli, calls } = makeStubPiCli((args) => {
      if (args[0] === "list") {
        return { ok: true, stdout: "npm:some-plugin@1.2.3 (global)\n", exitCode: 0 };
      }
      return { ok: true, stdout: "removed\n", exitCode: 0 };
    });
    const installer = createPluginInstaller({ piCli });

    const result = await installer.uninstall("npm:some-plugin");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBe("npm:some-plugin");
    }
    const removeCall = calls.find((c) => c.args[0] === "remove");
    expect(removeCall?.args).toEqual(["remove", "npm:some-plugin"]);
  });

  it("round-trip: uninstalling the id returned by install() itself succeeds (regression for the id-shape mismatch found in review)", async () => {
    // 复核发现的缺陷:install() 曾把「传给 pi 的完整来源串(含版本)」当作返回的 id,
    // 而 uninstall() 按台账形态(不含版本)精确匹配 —— 二者形态不对称,导致把
    // install() 自己返回的 id 喂回 uninstall() 会被误判为 NOT_INSTALLED。
    // 本测试驱动真实的 install() → uninstall() 往返,而非分别构造两半输入。
    const { piCli } = makeStubPiCli((args) => {
      if (args[0] === "list") {
        // 台账里的形态(parsePiList 产出):不含版本号。
        return { ok: true, stdout: "npm:some-plugin (global)\n", exitCode: 0 };
      }
      return { ok: true, stdout: "ok\n", exitCode: 0 };
    });
    const installer = createPluginInstaller({ piCli });

    const installResult = await installer.install({
      kind: "npm",
      name: "some-plugin",
      version: "1.2.3",
    });
    expect(installResult.ok).toBe(true);
    if (!installResult.ok) return;

    const uninstallResult = await installer.uninstall(installResult.value.id);

    expect(uninstallResult.ok).toBe(true);
  });

  it("uninstalling a package that is not installed returns NOT_INSTALLED and never calls pi remove", async () => {
    const { piCli, calls } = makeStubPiCli((args) => {
      if (args[0] === "list") {
        return { ok: true, stdout: "npm:other-plugin@2.0.0 (global)\n", exitCode: 0 };
      }
      return { ok: true, stdout: "removed\n", exitCode: 0 };
    });
    const installer = createPluginInstaller({ piCli });

    const result = await installer.uninstall("npm:not-installed");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("NOT_INSTALLED");
    }
    expect(calls.some((c) => c.args[0] === "remove")).toBe(false);
  });

  it("propagates a LIST_FAILED error (redacted) when the pre-check listing itself fails, without calling remove", async () => {
    const { piCli, calls } = makeStubPiCli({
      ok: false,
      stdout: "",
      exitCode: 1,
      errorSummary: "boom apiKey=super-secret-value",
    });
    const installer = createPluginInstaller({ piCli });

    const result = await installer.uninstall("npm:some-plugin");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("LIST_FAILED");
      expect(result.error.message).not.toContain("super-secret-value");
    }
    expect(calls.some((c) => c.args[0] === "remove")).toBe(false);
  });
});

describe("PluginInstaller.listInstalled", () => {
  it("parses a fixed stdout via the shared parsePiList (reused, not reimplemented)", async () => {
    const { piCli } = makeStubPiCli({
      ok: true,
      stdout: "npm:foo@1.0.0 (global)\ngit:github.com/org/bar@v2 (project)\n",
      exitCode: 0,
    });
    const installer = createPluginInstaller({ piCli });

    const result = await installer.listInstalled();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(2);
      // parsePiList 的 `id` 不含版本号(见 pi-cli.ts parseListLine),版本另存在 `version` 字段。
      expect(result.value[0]?.id).toBe("npm:foo");
      expect(result.value[0]?.version).toBe("1.0.0");
      expect(result.value[1]?.scope).toBe("project");
    }
  });
});

describe("normalizeExtSourceId (id-shape normalization, complement/root-cause fix for the review's Defect 1)", () => {
  it("strips the version from a plain npm source: npm:foo@1.2.3 -> npm:foo", () => {
    expect(normalizeExtSourceId("npm:foo@1.2.3")).toBe("npm:foo");
  });

  it("strips only the trailing version from a scoped npm source (splits on the LAST '@'): npm:@scope/pkg@1.2.3 -> npm:@scope/pkg", () => {
    expect(normalizeExtSourceId("npm:@scope/pkg@1.2.3")).toBe("npm:@scope/pkg");
  });

  it("strips the version from a git source: git:github.com/u/r@abc1234def -> git:github.com/u/r", () => {
    expect(normalizeExtSourceId("git:github.com/u/r@abc1234def")).toBe("git:github.com/u/r");
  });

  it("leaves a local source (no '@' at all) unchanged: local:/abs/path", () => {
    expect(normalizeExtSourceId("local:/abs/path")).toBe("local:/abs/path");
  });

  it("is idempotent on an id that is already version-free: npm:foo -> npm:foo", () => {
    expect(normalizeExtSourceId("npm:foo")).toBe("npm:foo");
  });
});

describe("PluginInstaller — PiCliNotFoundError", () => {
  it("maps a PiCliNotFoundError from the piCli factory to an actionable PI_CLI_NOT_FOUND error", async () => {
    const installer = createPluginInstaller({
      piCliFactory: () => {
        throw new PiCliNotFoundError();
      },
    });

    const result = await installer.install({ kind: "npm", name: "foo", version: "1.0.0" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("PI_CLI_NOT_FOUND");
      expect(result.error.message.length).toBeGreaterThan(0);
    }
  });

  it("also applies to uninstall and listInstalled", async () => {
    const installer = createPluginInstaller({
      piCliFactory: () => {
        throw new PiCliNotFoundError();
      },
    });

    const uninstallResult = await installer.uninstall("npm:foo@1.0.0");
    const listResult = await installer.listInstalled();

    expect(uninstallResult.ok).toBe(false);
    expect(listResult.ok).toBe(false);
    if (!uninstallResult.ok) expect(uninstallResult.error.code).toBe("PI_CLI_NOT_FOUND");
    if (!listResult.ok) expect(listResult.error.code).toBe("PI_CLI_NOT_FOUND");
  });
});
