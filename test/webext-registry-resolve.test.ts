/**
 * webext 静态注册表的源匹配契约(构建期集成车道)。
 *
 * 上提自源仓库 aigc-agent iteration-8 目标 2 的真 bug 修复(其壳与本壳同源 fork,同病):
 * 原实现用**子串**匹配,而源仓库目录名恰为 `aigc-agent`,与规则 `{ match: "aigc-agent" }`
 * 同名——点选 `C:\...\aigc-agent\agents\aigc` 会错拿 examples 范例扩展;叠加 Windows
 * 反斜杠路径,效果是「手动点选必坏、e2e 必绿」。
 *
 * 故此文件钉的是:匹配语义 = **路径段尾**;反斜杠与 `.git` 后缀、尾斜杠先归一;
 * match 键全部带路径段(`examples/…`),防同名仓库根误配。
 */
import { describe, expect, it } from "vitest";
import {
  resolveExtensionForSource,
  REGISTRY_MATCHES,
} from "../lib/app/webext-registry.js";

describe("resolveExtensionForSource · 段尾匹配", () => {
  it("examples/aigc-agent 的各种路径写法都解析到 aigc-studio", () => {
    for (const source of [
      "C:\\workcode\\pi-web\\examples\\aigc-agent",
      "/home/u/pi-web/examples/aigc-agent",
      "./examples/aigc-agent",
      "examples/aigc-agent",
      "./examples/aigc-agent/",
    ]) {
      expect(resolveExtensionForSource(source)?.manifestId, source).toBe(
        "aigc-studio",
      );
    }
  });

  it("迁移期对照:源仓库 agents/aigc 路径解析到同一 aigc-studio(同一 agent 两个住址)", () => {
    for (const source of [
      "C:\\workcode\\aigc-agent\\agents\\aigc",
      "./agents/aigc",
    ]) {
      expect(resolveExtensionForSource(source)?.manifestId, source).toBe(
        "aigc-studio",
      );
    }
  });

  it("同名仓库根不匹配任何扩展(裸目录名时代的根因断言)", () => {
    expect(resolveExtensionForSource("C:\\workcode\\aigc-agent")).toBeUndefined();
    expect(resolveExtensionForSource("/srv/aigc-agent")).toBeUndefined();
  });

  it("邻名例子互不误配(段尾全段比较,无顺序依赖)", () => {
    expect(
      resolveExtensionForSource("/r/examples/aigc-canvas-agent")?.manifestId,
    ).toBe("aigc-canvas");
    expect(
      resolveExtensionForSource("/r/examples/aigc-canvas-nosurface-agent")
        ?.manifestId,
    ).toBe("aigc-canvas-nosurface");
  });

  it("未知源与 undefined 回落宿主默认 UI(运行时 resolve 车道兜底)", () => {
    expect(resolveExtensionForSource(undefined)).toBeUndefined();
    expect(resolveExtensionForSource("/tmp/some-other-agent")).toBeUndefined();
  });

  it("git 源去 .git 后缀后按段尾匹配", () => {
    expect(
      resolveExtensionForSource(
        "https://example.com/x/pi-web/examples/aigc-agent.git",
      )?.manifestId,
    ).toBe("aigc-studio");
  });

  it("注册表全量约束:match 键均带路径段,且以任意绝对前缀均可命中", () => {
    for (const match of REGISTRY_MATCHES) {
      expect(match, `裸目录名会撞同名仓库根:${match}`).toContain("/");
      expect(
        resolveExtensionForSource(`/abs/prefix/${match}`),
        match,
      ).toBeDefined();
    }
  });
});
