// @vitest-environment node
/**
 * 子命令实现产物的构建接缝单测(spec cli-package-commands,任务 1.1,Req 10.6;
 * spec cli-agent-build,任务 1.2,Req 1.7)。
 *
 * 覆盖:
 * - `distCliCommandsJs()` 纯函数与 `distServerJs()` 同处产物根(同一目录)。
 * - `distCliCommandsJs()` 尊重 `PI_WEB_DIST_DIR` 环境变量(与 `distServerJs()` 行为一致)。
 * - `resolveCliCommandsJs()`:direct 命中即用(快路径,不触发多余解析);direct 缺失时
 *   回落注入的 `resolveRuntimeFn`(判别式:证明确实改用了回落结果,而非仍返回 direct)。
 *   分发解包形态下真正触发 `resolveRuntime()` 解包分支的场景,专由
 *   `e2e/cli/cli-reloc.mjs` 的 F1 守卫(spec cli-agent-build 任务 1.1)覆盖。
 * - `scripts/build-server.mjs` 导出的第二构建入口指向 `server/cli/index.ts`,
 *   outfile 命名为 `cli-commands.mjs` 且落在产物根(与 `EXTERNAL` 同处该模块)。
 */
import { describe, it, expect, afterEach } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { distServerJs, distCliCommandsJs, resolveCliCommandsJs } from "@/bin/pi-web.mjs";
import { EXTERNAL, CLI_COMMANDS_OUT_FILE } from "../../scripts/build-server.mjs";
import { PACKAGE_ROOT_FILES } from "../../scripts/pack-dist.mjs";

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

describe("resolveCliCommandsJs (spec cli-agent-build 任务 1.2,Req 1.7)", () => {
  it("direct 存在时不调用 resolveRuntimeFn(快路径,验证不做多余解析)", async () => {
    let called = false;
    const { cliCommandsJs } = await resolveCliCommandsJs({
      existsFn: () => true,
      resolveRuntimeFn: async () => {
        called = true;
        return { serverJs: "/should/not/be/used/server.mjs" };
      },
    });
    expect(cliCommandsJs).toBe(distCliCommandsJs());
    expect(called).toBe(false);
  });

  it("direct 缺失时回落注入的 resolveRuntimeFn 结果(判别式:证明确实改用了回落解析而非仍返回 direct)", async () => {
    // ★ 判别式设计:direct 路径与回落路径故意构造为不同字符串。若实现忘记回落(仍返回
    //   distCliCommandsJs() 的结果),本断言必红;只有真的调用 resolveRuntimeFn() 并据其
    //   产物根重新拼接 cli-commands.mjs,才会得到 fake 路径 —— 对本任务的修复有区分度。
    const fakeServerJs = join("/fake/unpacked-runtime/dist", "server.mjs");
    const fakeRuntime = { runtimeRoot: "/fake/unpacked-runtime-root", runtimeDir: "1.2.3-abc" };
    const { cliCommandsJs, runtime } = await resolveCliCommandsJs({
      existsFn: () => false,
      resolveRuntimeFn: async () => ({ serverJs: fakeServerJs, runtime: fakeRuntime }),
    });
    expect(cliCommandsJs).toBe(join("/fake/unpacked-runtime/dist", "cli-commands.mjs"));
    expect(cliCommandsJs).not.toBe(distCliCommandsJs());
    expect(runtime).toEqual(fakeRuntime);
  });

  it("不传 deps 时默认走真实 existsSync/resolveRuntime,direct 命中(开发态 dist 已构建)", async () => {
    expect(existsSync(distCliCommandsJs())).toBe(true);
    const { cliCommandsJs, runtime } = await resolveCliCommandsJs();
    expect(cliCommandsJs).toBe(distCliCommandsJs());
    expect(runtime).toBeUndefined();
  });
});

describe("build-server.mjs 第二构建入口", () => {
  it("EXTERNAL 清单存在(供两个入口复用)", () => {
    expect(Array.isArray(EXTERNAL)).toBe(true);
    expect(EXTERNAL.length).toBeGreaterThan(0);
  });

  it("EXTERNAL 含 pi-web build 的构建工具链四项(spec cli-agent-build 任务 1.3,Req 4.2/4.4):esbuild/postcss/tailwindcss/autoprefixer 不得被静态内联", () => {
    for (const pkg of ["esbuild", "postcss", "tailwindcss", "autoprefixer"]) {
      expect(EXTERNAL).toContain(pkg);
    }
  });

  it("CLI_COMMANDS_OUT_FILE 落在产物根(未设 PI_WEB_DIST_DIR 时与 distServerJs() 同目录)", () => {
    expect(CLI_COMMANDS_OUT_FILE.endsWith("cli-commands.mjs")).toBe(true);
    delete process.env.PI_WEB_DIST_DIR;
    expect(dirname(CLI_COMMANDS_OUT_FILE)).toBe(dirname(distServerJs()));
  });
});

describe("pack-dist.mjs 包根散装文件清单(spec cli-agent-build 任务 1.4,Req 4.5)", () => {
  it("PACKAGE_ROOT_FILES 含 ui/tailwind-preset.ts,使该预设文件随分发树拷贝(不再只靠 files 字段进 npm 包)", () => {
    expect(Array.isArray(PACKAGE_ROOT_FILES)).toBe(true);
    expect(PACKAGE_ROOT_FILES).toContain("ui/tailwind-preset.ts");
  });

  it("清单登记的每一项物理文件在源码树中确实存在(防止清单登记了不存在的文件而拷贝静默跳过)", () => {
    for (const relPath of PACKAGE_ROOT_FILES) {
      const abs = join(__dirname, "..", "..", "packages", relPath);
      expect(existsSync(abs)).toBe(true);
    }
  });

  it("packages/ui/package.json 的 exports 暴露 './tailwind-preset' 子路径出口(取代反向相对路径引用,Req 4.5)", () => {
    const pkgJson = JSON.parse(
      readFileSync(join(__dirname, "..", "..", "packages", "ui", "package.json"), "utf8"),
    );
    expect(pkgJson.exports["./tailwind-preset"]).toBe("./tailwind-preset.ts");
  });
});
