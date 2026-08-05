/**
 * 单元:内置扩展单一清单 + 自解析(spec: runner-self-resolved-builtins,任务 1.2;
 * Req 1.1, 1.3, 1.4, 1.5, 5.2, 5.3)。
 */
import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import {
  BUILTIN_EXTENSIONS,
  resolveBuiltinExtensionEntries,
  type BuiltinExtensionSpec,
} from "../../src/runner/builtin-extensions.js";

const spec = (id: BuiltinExtensionSpec["id"], resolve: () => string | undefined): BuiltinExtensionSpec => ({
  id,
  resolve,
});

describe("BUILTIN_EXTENSIONS — 单一清单(Req 5.2)", () => {
  it("含四个 pi-web 自带扩展,顺序稳定(Req 1.5)", () => {
    expect(BUILTIN_EXTENSIONS.map((s) => s.id)).toEqual([
      "extension-tools",
      "auto-title",
      "mcp",
      "template-manager",
    ]);
  });

  it("★ 不含 sandbox —— 其入口在 agent 包内,范式不同(范围勘误)", () => {
    // 变异判据:若把 sandbox 并入清单,此断言转红。sandbox 须继续走 PI_WEB_SANDBOX_ENTRY。
    expect(BUILTIN_EXTENSIONS.map((s) => s.id)).not.toContain("sandbox");
  });

  it("真实清单在本仓语境下四项均可解析(Req 2.1)", () => {
    // 本地 monorepo 中四个 entry-path 都应指向真实存在的文件。
    const entries = resolveBuiltinExtensionEntries();
    expect(entries).toHaveLength(4);
    for (const p of entries) expect(p.length).toBeGreaterThan(0);
  });

  it("★ 默认清单在**新包**解析根下装载成功:4 条且每条真实存在(spec: runner-package-extraction,Req 4.1/4.3)", () => {
    // 判据取「4 条 + 每条 existsSync」——**不取**「没有 warn」:后者与「四个都解析不到
    // 但日志没人读」无法区分(design C4)。三个 entry-path 用自身 import.meta.url 推算,
    // 故本断言实测的是 tool-kit 是否为**本包**(runner)的可解析运行时依赖:
    // 把 packages/runner/package.json 的 @blksails/pi-web-tool-kit 摘掉,此处转红。
    const entries = resolveBuiltinExtensionEntries();
    expect(entries).toHaveLength(4);
    for (const p of entries) {
      expect(existsSync(p), `builtin extension entry should exist on disk: ${p}`).toBe(true);
    }
  });
});

/** 捕获式诊断出口(同时避免用例往真实 stderr 喷噪声)。 */
function sink(): { lines: string[]; write(s: string): void } {
  const lines: string[] = [];
  return { lines, write: (s: string) => void lines.push(s) };
}

describe("resolveBuiltinExtensionEntries — 解析与降级(Req 1.3, 1.4, 5.3)", () => {
  it("按清单顺序返回可解析入口", () => {
    const diag = sink();
    const entries = resolveBuiltinExtensionEntries(
      [
        spec("extension-tools", () => "/a/ext.ts"),
        spec("auto-title", () => "/a/title.ts"),
        spec("mcp", () => "/a/mcp.ts"),
      ],
      diag,
    );
    expect(entries).toEqual(["/a/ext.ts", "/a/title.ts", "/a/mcp.ts"]);
    // 全部解析成功 → 零诊断(正常路径不该有输出)。
    expect(diag.lines).toEqual([]);
  });

  it("解析不到的条目被跳过,其余照常返回(Req 1.4)", () => {
    const diag = sink();
    const entries = resolveBuiltinExtensionEntries(
      [
        spec("extension-tools", () => undefined),
        spec("auto-title", () => "/a/title.ts"),
        spec("mcp", () => ""),
      ],
      diag,
    );
    // 变异判据:若不过滤 undefined/空串,长度会变 3 → 转红。
    expect(entries).toEqual(["/a/title.ts"]);
  });

  it("单个条目抛错被吞掉,不影响其余、不外溢(Req 1.4)", () => {
    const diag = sink();
    const entries = resolveBuiltinExtensionEntries(
      [
        spec("extension-tools", () => {
          throw new Error("boom");
        }),
        spec("mcp", () => "/a/mcp.ts"),
      ],
      diag,
    );
    expect(entries).toEqual(["/a/mcp.ts"]);
  });

  it("全部不可解析 → 空数组,不抛出(降级为无内置扩展)", () => {
    const diag = sink();
    expect(() =>
      resolveBuiltinExtensionEntries([spec("mcp", () => undefined)], diag),
    ).not.toThrow();
    expect(resolveBuiltinExtensionEntries([spec("mcp", () => undefined)], diag)).toEqual(
      [],
    );
  });

  describe("能力缺失必须无条件可见(不因日志默认关闭而静音)", () => {
    it("解析不到 → 诊断出口收到含 id 的一行", () => {
      const diag = sink();
      resolveBuiltinExtensionEntries([spec("mcp", () => undefined)], diag);
      expect(diag.lines).toHaveLength(1);
      expect(diag.lines[0]).toContain("mcp");
      expect(diag.lines[0]).toContain("not resolvable");
    });

    it("resolve 抛错 → 诊断出口收到含 id 与错误原文的一行", () => {
      const diag = sink();
      resolveBuiltinExtensionEntries(
        [
          spec("auto-title", () => {
            throw new Error("boom");
          }),
        ],
        diag,
      );
      expect(diag.lines).toHaveLength(1);
      expect(diag.lines[0]).toContain("auto-title");
      expect(diag.lines[0]).toContain("boom");
    });

    it("多个条目缺失 → 每个各记一行(不合并、不只报第一个)", () => {
      const diag = sink();
      resolveBuiltinExtensionEntries(
        [spec("extension-tools", () => undefined), spec("mcp", () => "")],
        diag,
      );
      expect(diag.lines).toHaveLength(2);
      expect(diag.lines.join("")).toContain("extension-tools");
      expect(diag.lines.join("")).toContain("mcp");
    });
  });
});

describe("内置扩展的依赖声明(spec: runner-package-extraction 任务 5.1,Req 4.1)", () => {
  /**
   * ★ 为什么单独要这一条,上面那条「默认清单解析出 3 条」不够:
   *
   * 三个 entry-path 用自身 `import.meta.url` 推算,而 Node 解析会**向上走目录**。
   * 在本 monorepo 里,即便把 `@blksails/pi-web-tool-kit` 从本包 `dependencies` 里摘掉、
   * 连 `packages/runner/node_modules` 下的链接也一并删除,解析**仍会命中仓库根的
   * `node_modules/@blksails/pi-web-tool-kit`**,于是照样返回 3 条。**实测如此。**
   *
   * 也就是说:那条解析断言在本地**恒真**,守不住「依赖声明漏了」——
   * 而真实安装树(沙箱镜像 / standalone,只装 runner 包、没有仓库根那层)恰恰会炸,
   * 表现是三个内置扩展**静默不可用**(`resolve()` 返回 undefined → 记 warn → 跳过)。
   * 该失效模式历史上已发生过一次(见 `builtin-extensions.ts` 文件头)。
   *
   * 故此处改测**声明本身**:它是静态事实,摘掉即红,不受 monorepo 提升的干扰。
   */
  it("tool-kit 必须声明在 runner 包自己的 dependencies 里(monorepo 提升会掩盖遗漏)", async () => {
    const { readFile } = await import("node:fs/promises");
    const pkgUrl = new URL("../../package.json", import.meta.url);
    const pkg = JSON.parse(await readFile(pkgUrl, "utf8")) as {
      dependencies?: Record<string, string>;
    };
    expect(
      pkg.dependencies?.["@blksails/pi-web-tool-kit"],
      "内置扩展的三个入口都来自 tool-kit;它必须是**本包**的运行时依赖。" +
        "仅靠仓库根的提升能在本地跑通,但沙箱与 standalone 只装本包,届时扩展会静默不可用。",
    ).toBeDefined();
  });
});
