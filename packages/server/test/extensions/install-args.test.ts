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
  it("npm 源:带 npm: scheme + --no-approve(对齐 pi 0.79.6)", () => {
    const src: ExtSource = {
      kind: "npm",
      scope: "@pi-web",
      name: "sample",
      version: "1.2.3",
    };
    const { args, env } = assembleInstallArgs(src);
    expect(args).toEqual([
      "install",
      "npm:@pi-web/sample@1.2.3",
      "--no-approve",
    ]);
    // npm 源不注入 git env。
    expect(env).toEqual({});
  });

  it("git 源:带 git: scheme@ref + --no-approve + 非交互 git env", () => {
    const src: ExtSource = {
      kind: "git",
      host: "github.com",
      repoPath: "acme/ext",
      ref: "v1.0.0",
    };
    const { args, env } = assembleInstallArgs(src);
    expect(args).toEqual([
      "install",
      "git:github.com/acme/ext@v1.0.0",
      "--no-approve",
    ]);
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
