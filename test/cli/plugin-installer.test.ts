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
import {
  createPluginInstaller,
  normalizeExtSourceId,
  isExactSemver,
} from "@/server/cli/install/plugin-installer";

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

describe("PluginInstaller.listInstalled — empty vs error (Req 4.1, 4.2)", () => {
  it("returns ok:true with an empty array when nothing is installed (distinguishable from an error)", async () => {
    const { piCli } = makeStubPiCli({ ok: true, stdout: "", exitCode: 0 });
    const installer = createPluginInstaller({ piCli });

    const result = await installer.listInstalled();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual([]);
    }
  });

  it("still distinguishes a real failure (LIST_FAILED) from the empty-list case", async () => {
    const { piCli } = makeStubPiCli({ ok: false, stdout: "", exitCode: 1, errorSummary: "boom" });
    const installer = createPluginInstaller({ piCli });

    const result = await installer.listInstalled();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("LIST_FAILED");
    }
  });

  it("a non-empty listing reports id / version / scope / kind for each entry (Req 4.1)", async () => {
    const { piCli } = makeStubPiCli({
      ok: true,
      stdout: "npm:foo@1.0.0 (global)\ngit:github.com/org/bar@v2 (project)\n",
      exitCode: 0,
    });
    const installer = createPluginInstaller({ piCli });

    const result = await installer.listInstalled();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value[0]).toMatchObject({
        id: "npm:foo",
        version: "1.0.0",
        scope: "global",
        kind: "npm",
      });
      expect(result.value[1]).toMatchObject({
        id: "git:github.com/org/bar",
        version: "v2",
        scope: "project",
        kind: "git",
      });
    }
  });
});

describe("PluginInstaller.listInstalled({ outdated: true }) — Req 4.3 design gap, no fabricated data", () => {
  it("returns OUTDATED_NOT_SUPPORTED and never calls pi (no fabricated available-version data)", async () => {
    const { piCli, calls } = makeStubPiCli({ ok: true, stdout: "npm:foo@1.0.0 (global)\n", exitCode: 0 });
    const installer = createPluginInstaller({ piCli });

    const result = await installer.listInstalled({ outdated: true });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("OUTDATED_NOT_SUPPORTED");
      expect(result.error.message.length).toBeGreaterThan(0);
    }
    // The whole point: we must not silently return "all packages" as if they were outdated,
    // nor invent a fake "available version" — so pi must never even be invoked.
    expect(calls).toHaveLength(0);
  });
});

describe("PluginInstaller.update — no packageId updates all updatable packages (Req 4.4)", () => {
  it("updates every non-pinned installed package when no packageId is given", async () => {
    // 用浮动 range(`^1.0.0`)而非精确版本号,避免撞上 Req 4.6 的 npm 精确版本钉死
    // 判定(那部分场景由专门的 "skips pinned/immutable packages" 测试组覆盖)。
    const { piCli, calls } = makeStubPiCli((args) => {
      if (args[0] === "list") {
        return {
          ok: true,
          stdout: "npm:foo@^1.0.0 (global)\nnpm:bar@^2.0.0 (project)\n",
          exitCode: 0,
        };
      }
      return { ok: true, stdout: "updated\n", exitCode: 0 };
    });
    const installer = createPluginInstaller({ piCli });

    const result = await installer.update();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.hasFailures).toBe(false);
      expect(result.value.outcomes).toEqual([
        { id: "npm:foo", status: "updated" },
        { id: "npm:bar", status: "updated" },
      ]);
    }
    const updateCalls = calls.filter((c) => c.args[0] === "update");
    expect(updateCalls.map((c) => c.args)).toEqual([
      ["update", "npm:foo"],
      ["update", "npm:bar"],
    ]);
  });
});

describe("PluginInstaller.update — packageId updates only that package (Req 4.5)", () => {
  it("only calls pi update for the named package", async () => {
    // 浮动 range,理由同上("no packageId" 用例)。
    const { piCli, calls } = makeStubPiCli((args) => {
      if (args[0] === "list") {
        return {
          ok: true,
          stdout: "npm:foo@^1.0.0 (global)\nnpm:bar@^2.0.0 (project)\n",
          exitCode: 0,
        };
      }
      return { ok: true, stdout: "updated\n", exitCode: 0 };
    });
    const installer = createPluginInstaller({ piCli });

    const result = await installer.update({ packageId: "npm:bar" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.outcomes).toEqual([{ id: "npm:bar", status: "updated" }]);
    }
    const updateCalls = calls.filter((c) => c.args[0] === "update");
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]?.args).toEqual(["update", "npm:bar"]);
  });

  it("accepts a versioned spec for packageId (normalized the same way as uninstall's id)", async () => {
    // 台账里的实际版本用浮动 range(与本用例意图无关的实现细节,理由同上);
    // `packageId` 入参本身带一个具体版本号,这里只测试它按 id 归一化后能匹配到台账条目,
    // 与该条目是否被判定为 pinned 无关。
    const { piCli, calls } = makeStubPiCli((args) => {
      if (args[0] === "list") {
        return { ok: true, stdout: "npm:foo@^1.0.0 (global)\n", exitCode: 0 };
      }
      return { ok: true, stdout: "updated\n", exitCode: 0 };
    });
    const installer = createPluginInstaller({ piCli });

    const result = await installer.update({ packageId: "npm:foo@1.0.0" });

    expect(result.ok).toBe(true);
    const updateCalls = calls.filter((c) => c.args[0] === "update");
    expect(updateCalls[0]?.args).toEqual(["update", "npm:foo"]);
  });

  it("returns NOT_INSTALLED and never calls pi update when the named package is not installed", async () => {
    const { piCli, calls } = makeStubPiCli((args) => {
      if (args[0] === "list") {
        return { ok: true, stdout: "npm:foo@1.0.0 (global)\n", exitCode: 0 };
      }
      return { ok: true, stdout: "updated\n", exitCode: 0 };
    });
    const installer = createPluginInstaller({ piCli });

    const result = await installer.update({ packageId: "npm:not-installed" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("NOT_INSTALLED");
    }
    expect(calls.some((c) => c.args[0] === "update")).toBe(false);
  });
});

describe("PluginInstaller.update — skips pinned/immutable packages with a real reason (Req 4.6)", () => {
  it("skips a git-kind entry (immutable pinned ref) without invoking pi update, and states why", async () => {
    const { piCli, calls } = makeStubPiCli((args) => {
      if (args[0] === "list") {
        return { ok: true, stdout: "git:github.com/org/bar@v2 (global)\n", exitCode: 0 };
      }
      return { ok: true, stdout: "updated\n", exitCode: 0 };
    });
    const installer = createPluginInstaller({ piCli });

    const result = await installer.update();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.outcomes).toHaveLength(1);
      expect(result.value.outcomes[0]?.status).toBe("skipped");
      expect(result.value.outcomes[0]?.reason?.length).toBeGreaterThan(0);
      expect(result.value.hasFailures).toBe(false);
    }
    expect(calls.some((c) => c.args[0] === "update")).toBe(false);
  });

  it("skips a local-kind entry without invoking pi update, and states why", async () => {
    const { piCli, calls } = makeStubPiCli((args) => {
      if (args[0] === "list") {
        // parseListLine 判定本地来源的启发式规则是"以 /（绝对）或 .（相对）开头"，不含
        // "local:" 前缀（pi list 原样输出注册在 settings.json 里的磁盘路径，见 pi-cli.ts）。
        return { ok: true, stdout: "/abs/path (global)\n", exitCode: 0 };
      }
      return { ok: true, stdout: "updated\n", exitCode: 0 };
    });
    const installer = createPluginInstaller({ piCli });

    const result = await installer.update();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.outcomes[0]?.status).toBe("skipped");
      expect(result.value.outcomes[0]?.reason?.length).toBeGreaterThan(0);
    }
    expect(calls.some((c) => c.args[0] === "update")).toBe(false);
  });
});

describe("PluginInstaller.update — npm pinned to an exact semver version is skipped (Req 4.6, review defect fix)", () => {
  it("skips npm:foo@1.2.3 (exact semver) without invoking pi update, and states the real reason", async () => {
    const { piCli, calls } = makeStubPiCli((args) => {
      if (args[0] === "list") {
        return { ok: true, stdout: "npm:foo@1.2.3 (global)\n", exitCode: 0 };
      }
      return { ok: true, stdout: "Updated npm:foo@1.2.3\n", exitCode: 0 };
    });
    const installer = createPluginInstaller({ piCli });

    const result = await installer.update();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.outcomes).toEqual([
        {
          id: "npm:foo",
          status: "skipped",
          reason: expect.stringContaining("1.2.3"),
        },
      ]);
      expect(result.value.hasFailures).toBe(false);
    }
    // The core assertion: pi update must never even be invoked for a pinned npm package —
    // pi's own CLI would print "Updated" unconditionally and exit 0 even if it silently
    // skipped internally, so we must not rely on trying it.
    expect(calls.some((c) => c.args[0] === "update")).toBe(false);
  });

  it("attempts pi update for npm:foo@^1.0.0 (floating range, not an exact version)", async () => {
    const { piCli, calls } = makeStubPiCli((args) => {
      if (args[0] === "list") {
        return { ok: true, stdout: "npm:foo@^1.0.0 (global)\n", exitCode: 0 };
      }
      return { ok: true, stdout: "updated\n", exitCode: 0 };
    });
    const installer = createPluginInstaller({ piCli });

    const result = await installer.update();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.outcomes).toEqual([{ id: "npm:foo", status: "updated" }]);
    }
    const updateCalls = calls.filter((c) => c.args[0] === "update");
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]?.args).toEqual(["update", "npm:foo"]);
  });

  it("attempts pi update for npm:foo (no version at all)", async () => {
    const { piCli, calls } = makeStubPiCli((args) => {
      if (args[0] === "list") {
        return { ok: true, stdout: "npm:foo (global)\n", exitCode: 0 };
      }
      return { ok: true, stdout: "updated\n", exitCode: 0 };
    });
    const installer = createPluginInstaller({ piCli });

    const result = await installer.update();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.outcomes).toEqual([{ id: "npm:foo", status: "updated" }]);
    }
    const updateCalls = calls.filter((c) => c.args[0] === "update");
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]?.args).toEqual(["update", "npm:foo"]);
  });
});

describe("isExactSemver — boundary cases (equivalent to pi's semver.valid() !== null)", () => {
  it.each([
    ["1.2.3", true],
    ["0.0.1", true],
    ["1.2.3-beta.1", true],
    ["1.2.3+build.5", true],
    ["1.2.3-rc.1+exp", true],
    ["v1.2.3", true], // semver.valid() strips a leading v/V before validating.
    ["^1.0.0", false],
    ["~1.2", false],
    [">=1.0.0", false],
    ["1.x", false],
    ["latest", false],
    ["1.2", false], // missing patch
    ["v1", false], // missing minor/patch
    ["", false],
  ])("isExactSemver(%j) === %p", (input, expected) => {
    expect(isExactSemver(input)).toBe(expected);
  });
});

describe("PluginInstaller.update — partial failure: continues processing, aggregates, non-zero-worthy (Req 4.7, observable)", () => {
  it("processes a pinned package + a failing package + a succeeding package, all three, aggregating the failure", async () => {
    // will-fail/will-succeed 用浮动 range,避免撞上 Req 4.6 的 npm 精确版本钉死判定
    // (那部分场景由专门的 "npm exact version pin" 用例覆盖,见下方新增测试组)。
    const { piCli, calls } = makeStubPiCli((args) => {
      if (args[0] === "list") {
        return {
          ok: true,
          stdout:
            "git:github.com/org/pinned@v1 (global)\n" +
            "npm:will-fail@^1.0.0 (global)\n" +
            "npm:will-succeed@^2.0.0 (global)\n",
          exitCode: 0,
        };
      }
      if (args[0] === "update" && args[1] === "npm:will-fail") {
        return {
          ok: false,
          stdout: "",
          exitCode: 1,
          errorSummary: "network error: Authorization: Bearer sk-abcdef1234567890",
        };
      }
      return { ok: true, stdout: "updated\n", exitCode: 0 };
    });
    const installer = createPluginInstaller({ piCli });

    const result = await installer.update();

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // All three packages were processed — the mid-list failure did not abort the rest.
    expect(result.value.outcomes).toHaveLength(3);
    expect(result.value.outcomes).toEqual([
      {
        id: "git:github.com/org/pinned",
        status: "skipped",
        reason: expect.stringContaining("不可变"),
      },
      {
        id: "npm:will-fail",
        status: "failed",
        reason: expect.stringContaining("[redacted]"),
      },
      { id: "npm:will-succeed", status: "updated" },
    ]);
    // The failure summary must never leak the raw secret.
    expect(result.value.outcomes[1]?.reason).not.toContain("sk-abcdef1234567890");
    // hasFailures is the signal the future `update` subcommand (task 6.1) uses to pick a
    // non-zero exit code; it must be true even though the overall call succeeded (ok:true)
    // and even though one package was merely skipped (not failed).
    expect(result.value.hasFailures).toBe(true);

    // The succeeding + failing packages were both actually attempted via pi; the pinned one
    // was not.
    const updateCalls = calls.filter((c) => c.args[0] === "update");
    expect(updateCalls.map((c) => c.args[1])).toEqual(["npm:will-fail", "npm:will-succeed"]);
  });
});

describe("PluginInstaller — PiCliNotFoundError also applies to update", () => {
  it("maps a PiCliNotFoundError to an actionable PI_CLI_NOT_FOUND error for update()", async () => {
    const installer = createPluginInstaller({
      piCliFactory: () => {
        throw new PiCliNotFoundError();
      },
    });

    const result = await installer.update();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("PI_CLI_NOT_FOUND");
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

describe("PluginInstaller.install scope option(任务 4.5 缺口 2:project 追加 -l)", () => {
  it("install(source) 不传 scope -> args 不含 '-l'(4.3 既有行为逐字节不变)", async () => {
    const { piCli, calls } = makeStubPiCli({ ok: true, stdout: "installed\n", exitCode: 0 });
    const installer = createPluginInstaller({ piCli });

    const result = await installer.install({ kind: "npm", name: "some-plugin", version: "1.2.3" });

    expect(result.ok).toBe(true);
    expect(calls[0]?.args).toEqual(["install", "npm:some-plugin@1.2.3", "--no-approve"]);
    expect(calls[0]?.args).not.toContain("-l");
  });

  it("install(source, { scope: 'project' }) -> 传给 pi 的 args 含 '-l'", async () => {
    const { piCli, calls } = makeStubPiCli({ ok: true, stdout: "installed\n", exitCode: 0 });
    const installer = createPluginInstaller({ piCli });

    const result = await installer.install(
      { kind: "npm", name: "some-plugin", version: "1.2.3" },
      { scope: "project" },
    );

    expect(result.ok).toBe(true);
    expect(calls[0]?.args).toEqual(["install", "npm:some-plugin@1.2.3", "--no-approve", "-l"]);
  });

  it("install(source, { scope: 'user' }) -> 显式 user 与不传 scope 行为一致,不含 '-l'", async () => {
    const { piCli, calls } = makeStubPiCli({ ok: true, stdout: "installed\n", exitCode: 0 });
    const installer = createPluginInstaller({ piCli });

    const result = await installer.install(
      { kind: "npm", name: "some-plugin", version: "1.2.3" },
      { scope: "user" },
    );

    expect(result.ok).toBe(true);
    expect(calls[0]?.args).not.toContain("-l");
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
