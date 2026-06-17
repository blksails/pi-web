/**
 * 单元:pi 命令参数装配 + 非交互 git env(Req 2.5/9.2/9.3/10.1)。
 */
import { describe, expect, it } from "vitest";
import {
  assembleInstallArgs,
  assembleRemoveArgs,
} from "../../src/extensions/install/install-args.js";
import type { ExtSource } from "../../src/extensions/ext.types.js";

describe("assembleInstallArgs", () => {
  it("always includes --ignore-scripts for npm sources", () => {
    const src: ExtSource = {
      kind: "npm",
      scope: "@pi-web",
      name: "sample",
      version: "1.2.3",
    };
    const { args, env } = assembleInstallArgs(src);
    expect(args).toEqual([
      "install",
      "@pi-web/sample@1.2.3",
      "--ignore-scripts",
    ]);
    // npm 源不注入 git env。
    expect(env).toEqual({});
  });

  it("injects non-interactive git env for git sources and keeps --ignore-scripts", () => {
    const src: ExtSource = {
      kind: "git",
      host: "github.com",
      repoPath: "acme/ext",
      ref: "v1.0.0",
    };
    const { args, env } = assembleInstallArgs(src);
    expect(args).toContain("--ignore-scripts");
    expect(args[0]).toBe("install");
    expect(env["GIT_TERMINAL_PROMPT"]).toBe("0");
    expect(env["GIT_SSH_COMMAND"]).toMatch(/BatchMode=yes/);
    expect(env["GCM_INTERACTIVE"]).toBe("never");
  });

  it("does not leak credentials into args/env (canonical source carries no token)", () => {
    const src: ExtSource = {
      kind: "git",
      host: "github.com",
      repoPath: "acme/ext",
      ref: "v1.0.0",
    };
    const { args, env } = assembleInstallArgs(src);
    const blob = JSON.stringify({ args, env });
    expect(blob).not.toMatch(/token|secret|password|:[^/@]+@/i);
  });
});

describe("assembleRemoveArgs", () => {
  it("assembles a remove command", () => {
    const { args, env } = assembleRemoveArgs("@pi-web/sample@1.2.3");
    expect(args).toEqual(["remove", "@pi-web/sample@1.2.3"]);
    expect(env).toEqual({});
  });
});
