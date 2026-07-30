/**
 * 单元:pi-cli 适配器的可单测部分——CLI 入口解析(经 @earendil-works/pi-coding-agent,
 * 非全局 pi)与 `pi list` 输出解析(Req 1.1/9.4/10.5)。子进程 IO 本身由集成/e2e 经注入
 * 替身覆盖(不在单测打真实网络)。
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parsePiList, resolvePiCliEntry } from "../../src/extensions/cli/pi-cli.js";

const PI_PACKAGE = "@earendil-works/pi-coding-agent";

describe("resolvePiCliEntry", () => {
  it("resolves dist/cli.js from @earendil-works/pi-coding-agent (not global pi)", () => {
    const entry = resolvePiCliEntry();
    expect(entry).toMatch(/@earendil-works[/\\]pi-coding-agent[/\\]dist[/\\]cli\.js$/);
    // ★ 判据取「返回的路径真实存在」而非「没抛错」:解析是逐级向上拼字符串,
    //   拼出一条不存在的路径同样不抛错。
    expect(existsSync(entry)).toBe(true);
  });

  /**
   * ★ 静态断言:agent SDK 必须声明在**本包自己的清单**里。
   *
   * 为什么上面那条运行断言守不住这件事(实测,adapters-package-extraction 任务 3.3):
   * 把 `@earendil-works/pi-coding-agent` 从本包 `peerDependencies` 里摘掉,
   * `resolvePiCliEntry()` 仍然返回真实存在的路径、上面那条断言仍然 4 passed ——
   * 因为 `locatePackageDir()` 只按字符串逐级向上找 `node_modules`,**从不读清单**,
   * 而 pnpm 早先装好的 `packages/adapters/node_modules/@earendil-works/` 链接
   * 不会因为清单被改而消失(不重装就一直在)。⇒ 在本仓「能解析出来」近乎恒真。
   *
   * 为何要紧:清单才是**真实安装树**的唯一依据。沙箱镜像 / standalone 产物只装本包时,
   * 漏声明 ⇒ 装不出 SDK ⇒ `resolvePiCliEntry()` 逐级向上一无所获、抛
   * "Cannot locate @earendil-works/pi-coding-agent",全部 pi CLI 扩展操作
   * (install / list / remove)在真机上整体失效 —— 而本仓的测试全绿。
   *
   * 声明位置是 `peerDependencies`(且不标 optional):宿主提供 agent 运行时,
   * 本包不得把它硬绑成 `dependencies`(否则装出两份 SDK)。故此处查 peerDeps,
   * 并同时钉住「不得退化成硬依赖」。
   */
  it("declares the agent SDK in this package's own manifest (peerDependencies)", () => {
    const manifestPath = path.join(fileURLToPath(new URL("../../", import.meta.url)), "package.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
      peerDependenciesMeta?: Record<string, { optional?: boolean }>;
    };

    expect(
      manifest.peerDependencies?.[PI_PACKAGE],
      `${PI_PACKAGE} 必须声明在 packages/adapters/package.json 的 peerDependencies 里。` +
        "解析器只按字符串向上找 node_modules、从不读清单,故本仓漏声明也照样解析成功;" +
        "但沙箱/standalone 只装本包时会装不出 SDK,pi CLI 扩展操作(install/list/remove)整体失效。",
    ).toBeDefined();

    // 不得退化成硬依赖或 devDependency:宿主提供 agent 运行时,硬绑会装出两份 SDK。
    expect(manifest.dependencies?.[PI_PACKAGE]).toBeUndefined();
    expect(manifest.devDependencies?.[PI_PACKAGE]).toBeUndefined();
    // 不标 optional:本包的 pi CLI 代码路径无条件需要它(任务 1.1 定的)。
    expect(manifest.peerDependenciesMeta?.[PI_PACKAGE]?.optional).not.toBe(true);
  });
});

describe("parsePiList", () => {
  it("returns an empty list for empty output", () => {
    expect(parsePiList("")).toEqual([]);
    expect(parsePiList("   \n  ")).toEqual([]);
  });

  it("parses a JSON array form with scope and version", () => {
    const out = JSON.stringify([
      { id: "@pi-web/a", kind: "npm", version: "1.0.0", scope: "project" },
      { name: "acme/ext", kind: "git", version: "v1", scope: "global" },
    ]);
    const parsed = parsePiList(out);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({ id: "@pi-web/a", scope: "project", kind: "npm" });
    expect(parsed[1]).toMatchObject({ id: "acme/ext", scope: "global", kind: "git" });
  });

  it("parses a line-based form with (scope) suffix", () => {
    const out = "@pi-web/a@1.2.3 (project)\nsome-pkg@2.0.0 (global)\n# comment";
    const parsed = parsePiList(out);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({ id: "@pi-web/a", version: "1.2.3", scope: "project" });
    expect(parsed[1]).toMatchObject({ id: "some-pkg", version: "2.0.0", scope: "global" });
  });
});
