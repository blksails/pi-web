import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as suiteModule from "../src/workspace/testing/index.js";

/**
 * host-contract-ports 任务 6.3 —— 一致性套件的子路径导出(Req 8.1)。
 *
 * ## 本守卫验的是哪一层,验不到哪一层(先说清楚,别高估它)
 *
 * `package.json` 的 `exports` 是 **Node/打包器解析层**的东西,不是 TS 类型层:
 *  - `tsc` 走 `tsconfig` 的 `paths`,`exports` 配错**未必**转红;
 *  - **alias 会绕开 `exports` 整个机制**——在配了 alias 的环境里「import 得通」什么也证明不了。
 *    本仓根 `vitest.config.ts` 对**部分** `@blksails/*` 包配了指向 `src` 的 alias
 *    (`logger`/`agent-kit`/`tool-kit` 及其四条子路径/`canvas-kit`/`canvas-ui`,见该文件
 *    `resolve.alias` 段);**本包 `@blksails/pi-web-server` 当前不在其中**。且根配置的
 *    `include` 只覆盖**根级** `test/`,本文件由 `packages/server/vitest.config.ts`(无任何
 *    alias)运行 —— 故本文件避开 alias 不是靠写法取巧,是**结构上就到不了**那份配置。
 *
 * 因此第 1 层刻意**不**用 `import "@blksails/pi-web-server/testing"` 这种写法,而是直接调用
 * **Node 自己的解析算法**(`createRequire().resolve()`):它读 `node_modules` 里那份真实的
 * `package.json`(pnpm workspace 下是指向本包的符号链接,与将来发布的是同一份),`exports`
 * 缺条目时报 `ERR_PACKAGE_PATH_NOT_EXPORTED`。**开工前实测过现状确实报这个错**,所以这条
 * 断言的红是真的,不是假想。
 *
 * **验不到的部分(如实列出,不要据本文件宣称跨仓可用)**:
 *  - **打包器各自的解析器**(vite / webpack / esbuild)。它们大体遵循 `exports`,但各有取舍,
 *    且消费方常用 alias 覆盖;
 *  - **发布后的产物形态**。本仓 `files: ["src", …]` 使 `src` 会被打进 tarball,下面第 3 条
 *    据此断言目标落在 `src/` 内,但真正的证明需要 `npm pack` 级别的验证;
 *  - **跨仓消费方的 alias 顺序**(子路径须列在裸包名之前,见根 `vitest.config.ts` 与
 *    `./src/workspace/testing/index.ts` 的注释)。那是消费方配置,本仓测不到。
 */

const require_ = createRequire(import.meta.url);
const PKG_ROOT = resolvePath(fileURLToPath(import.meta.url), "../..");
const SUBPATH = "@blksails/pi-web-server/testing";

describe("包清单 · 一致性套件子路径导出", () => {
  it("Node 解析算法能解析该子路径,且落到套件出口本身", () => {
    // 未配 exports 条目时,这一行抛 ERR_PACKAGE_PATH_NOT_EXPORTED —— 即本用例的红。
    const resolved = realpathSync(require_.resolve(SUBPATH));
    const expected = realpathSync(
      resolvePath(PKG_ROOT, "src/workspace/testing/index.ts"),
    );
    expect(resolved).toBe(expected);
  });

  it("子路径解析结果落在会被发布的 `src/` 内(否则发布后消费方拿不到)", () => {
    const resolved = realpathSync(require_.resolve(SUBPATH));
    const srcDir = realpathSync(resolvePath(PKG_ROOT, "src"));
    expect(resolved.startsWith(srcDir)).toBe(true);
    // 「落在 src/」只有在 `src` 确实随包发布时才等价于「消费方拿得到」。缺了这条,
    // 有人把 "src" 从 files 里拿掉后本用例照样绿,而它自述的目的已不成立。
    const pkg = require_(resolvePath(PKG_ROOT, "package.json")) as { files?: string[] };
    expect(pkg.files).toContain("src");
  });

  it("经子路径可取到套件入口符号,且与套件出口是同一实现", async () => {
    const viaSubpath = (await import(SUBPATH)) as typeof suiteModule;
    expect(typeof viaSubpath.runWorkspaceConformance).toBe("function");
    expect(viaSubpath.runWorkspaceConformance).toBe(suiteModule.runWorkspaceConformance);
    // 出口面无漏项:清单从套件出口自身派生,将来新增符号自动跟上。
    expect(Object.keys(viaSubpath).sort()).toEqual(Object.keys(suiteModule).sort());
  });

  it("主入口(`.`)不受影响 —— 新增子路径不得改动既有解析", () => {
    const mainResolved = realpathSync(require_.resolve("@blksails/pi-web-server"));
    expect(mainResolved).toBe(realpathSync(resolvePath(PKG_ROOT, "src/index.ts")));
  });
});
