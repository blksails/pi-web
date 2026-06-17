/**
 * 单元:pi-cli 适配器的可单测部分——CLI 入口解析(经 @earendil-works/pi-coding-agent,
 * 非全局 pi)与 `pi list` 输出解析(Req 1.1/9.4/10.5)。子进程 IO 本身由集成/e2e 经注入
 * 替身覆盖(不在单测打真实网络)。
 */
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parsePiList, resolvePiCliEntry } from "../../src/extensions/cli/pi-cli.js";

describe("resolvePiCliEntry", () => {
  it("resolves dist/cli.js from @earendil-works/pi-coding-agent (not global pi)", () => {
    const entry = resolvePiCliEntry();
    expect(entry).toMatch(/@earendil-works[/\\]pi-coding-agent[/\\]dist[/\\]cli\.js$/);
    expect(existsSync(entry)).toBe(true);
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
