// @vitest-environment node
/**
 * 子命令实现产物的构建接缝单测(spec cli-package-commands,任务 1.1,Req 10.6)。
 *
 * 覆盖:
 * - `distCliCommandsJs()` 纯函数与 `distServerJs()` 同处产物根(同一目录)。
 * - `distCliCommandsJs()` 尊重 `PI_WEB_DIST_DIR` 环境变量(与 `distServerJs()` 行为一致)。
 * - `scripts/build-server.mjs` 导出的第二构建入口指向 `server/cli/index.ts`,
 *   outfile 命名为 `cli-commands.mjs` 且落在产物根(与 `EXTERNAL` 同处该模块)。
 */
import { describe, it, expect, afterEach } from "vitest";
import { dirname, join } from "node:path";
import { distServerJs, distCliCommandsJs } from "@/bin/pi-web.mjs";
import { EXTERNAL, CLI_COMMANDS_OUT_FILE } from "../../scripts/build-server.mjs";

const ORIGINAL_DIST_DIR = process.env.PI_WEB_DIST_DIR;

afterEach(() => {
  if (ORIGINAL_DIST_DIR === undefined) delete process.env.PI_WEB_DIST_DIR;
  else process.env.PI_WEB_DIST_DIR = ORIGINAL_DIST_DIR;
});

describe("distCliCommandsJs", () => {
  it("与 distServerJs() 同处产物根(同一目录)", () => {
    expect(dirname(distCliCommandsJs())).toBe(dirname(distServerJs()));
  });

  it("文件名为 cli-commands.mjs", () => {
    expect(distCliCommandsJs().endsWith("cli-commands.mjs")).toBe(true);
  });

  it("尊重 PI_WEB_DIST_DIR 环境变量,与 distServerJs() 行为一致", () => {
    process.env.PI_WEB_DIST_DIR = "custom-dist";
    expect(dirname(distCliCommandsJs())).toBe(dirname(distServerJs()));
    expect(distCliCommandsJs()).toContain(join("custom-dist"));
  });
});

describe("build-server.mjs 第二构建入口", () => {
  it("EXTERNAL 清单存在(供两个入口复用)", () => {
    expect(Array.isArray(EXTERNAL)).toBe(true);
    expect(EXTERNAL.length).toBeGreaterThan(0);
  });

  it("CLI_COMMANDS_OUT_FILE 落在产物根(未设 PI_WEB_DIST_DIR 时与 distServerJs() 同目录)", () => {
    expect(CLI_COMMANDS_OUT_FILE.endsWith("cli-commands.mjs")).toBe(true);
    delete process.env.PI_WEB_DIST_DIR;
    expect(dirname(CLI_COMMANDS_OUT_FILE)).toBe(dirname(distServerJs()));
  });
});
