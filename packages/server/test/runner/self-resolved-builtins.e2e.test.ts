/**
 * e2e:内置扩展自解析(spec: runner-self-resolved-builtins,任务 3.1;Req 1.1, 1.2, 2.1, 4.4)。
 *
 * 核心命题:**不经任何 spawn env 下发路径**,runner 也能从自身安装树解析出内置扩展入口,
 * 且这些入口是真实存在、可被加载的文件。这正是 e2b 沙箱下失效的那一环 —— 本用例在本地
 * 语境证明机制成立;真实沙箱内解析取决于镜像是否装了 server(见文件末 SKIP 说明)。
 */
import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { resolveBuiltinExtensionEntries } from "../../src/runner/builtin-extensions.js";
import { collectExtensionPaths } from "../../src/runner/option-mapper.js";

describe("e2e:零 env 自解析(Req 1.2)", () => {
  it("env 完全为空时,三个内置扩展入口仍被解析出来", () => {
    // 变异判据:若自解析未接线、仍只读 env,此处会得到空数组 → 转红。
    const entries = collectExtensionPaths({});
    expect(entries).toHaveLength(3);
  });

  it("解析出的入口是**真实存在的文件**(可被 SDK 加载)", () => {
    for (const entry of resolveBuiltinExtensionEntries()) {
      expect(existsSync(entry), `${entry} should exist`).toBe(true);
    }
  });

  it("三个入口分别指向 extension-tools / auto-title / mcp 扩展文件", () => {
    const entries = resolveBuiltinExtensionEntries();
    expect(entries[0]).toMatch(/extension-tools/);
    expect(entries[1]).toMatch(/auto-title/);
    expect(entries[2]).toMatch(/mcp/);
  });
});

describe("e2e:与既有 env 机制共存(Req 3.3)", () => {
  it("外部仍设置旧 env 时不重复注入(去重),数量仍为三", () => {
    const selfResolved = resolveBuiltinExtensionEntries();
    const withEnv = collectExtensionPaths({
      PI_WEB_MCP_ENTRY: selfResolved[2] ?? "",
      PI_WEB_AUTO_TITLE_ENTRY: selfResolved[1] ?? "",
    });
    expect(withEnv).toHaveLength(3);
    expect(new Set(withEnv).size).toBe(3);
  });

  it("sandbox 入口仍可经 env 注入(不在自解析范围,范式不同)", () => {
    const out = collectExtensionPaths({ PI_WEB_SANDBOX_ENTRY: "/agent/pi-sandbox/index.ts" });
    expect(out).toContain("/agent/pi-sandbox/index.ts");
    expect(out).toHaveLength(4); // sandbox + 三个自解析
  });
});

describe("e2e:沙箱形态(环境边界)", () => {
  // 真实 e2b 沙箱内解析需要凭据与已重建的 base 镜像,本环境不具备。
  // 机制层面已由上面的用例证明:自解析不依赖主进程路径下发,故只要镜像内标准安装了
  // @blksails/pi-web-server(其运行时依赖已含 tool-kit),同一套逻辑即可解析到镜像内路径。
  it.skip("真实 e2b 沙箱内解析(需凭据 + 重建 base 镜像,超出本地验证边界)", () => {
    /* intentionally skipped */
  });
});
