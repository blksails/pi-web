// @vitest-environment node
/**
 * cli-agent-build 任务 4.3(Requirements 5.5/5.6/7.5)——
 * 三处「产物缺失/陈旧」发布提示统一指向 `pi-web build`。
 *
 * 覆盖面:
 *  - `manifest-compiler.compile()` 的陈旧产物告警(5.6,消费面①)。
 *  - `server/cli/index.ts` 的 `describeCompileError`(WEBEXT_SOURCE_WITHOUT_DIST,7.5,消费面②)。
 *  - `lib/app/publish-preview.ts` 的 `describeCompileError`(5.5,消费面③,GUI/预览侧)。
 *
 * 三处共用一个判据:文案须**含可直接复制执行的 `pi-web build`**,而不是仅陈述缺失/陈旧。
 * 不测「发布流程不自动构建」——那由既有 publish 单测(test/publish/publish-orchestrator.test.ts)
 * 通过「产物缺失时硬失败、零外部写」的既有断言覆盖,本文件不重造。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compile } from "@/server/cli/publish/manifest-compiler";
import { describeCompileError as describeCliError } from "@/server/cli/index";
import { describeCompileError as describePreviewError } from "@/lib/app/publish-preview";

const dirs: string[] = [];
function makePkg(manifest: object, files: Record<string, string> = {}): string {
  const d = mkdtempSync(join(tmpdir(), "pi-pub-compiler-"));
  dirs.push(d);
  writeFileSync(join(d, "pi-web.json"), JSON.stringify(manifest, null, 2));
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(join(d, p, ".."), { recursive: true });
    writeFileSync(join(d, p), c);
  }
  return d;
}
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

const AGENT = { id: "acme/build-hint", version: "1.0.0", kind: "agent" as const };
const DIST = ".pi/web/dist";
const SRC = ".pi/web/web.config.tsx";

describe("发布提示 → pi-web build(5.5/5.6/7.5)", () => {
  it("消费面①:产物早于源码 → compile() 的陈旧告警指向 pi-web build", async () => {
    const dir = makePkg(AGENT, {
      "index.ts": "// e",
      [SRC]: "// source",
      [`${DIST}/manifest.json`]: "{}",
    });
    const old = new Date(Date.now() - 86_400_000);
    utimesSync(join(dir, DIST, "manifest.json"), old, old);

    const c = await compile(dir);
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    expect(c.value.warnings.length).toBeGreaterThan(0);
    expect(c.value.warnings[0]).toContain("pi-web build");
  });

  it("消费面②:CLI 侧 WEBEXT_SOURCE_WITHOUT_DIST 文案指向 pi-web build", async () => {
    const dir = makePkg(AGENT, { "index.ts": "// e", [SRC]: "// source" });
    const c = await compile(dir);
    expect(c.ok).toBe(false);
    if (c.ok) return;
    expect(c.error.code).toBe("WEBEXT_SOURCE_WITHOUT_DIST");
    const rendered = describeCliError(c.error);
    expect(rendered).toContain("pi-web build");
  });

  it("消费面③:发布预览(GUI)侧 WEBEXT_SOURCE_WITHOUT_DIST hint 指向 pi-web build", async () => {
    const dir = makePkg(AGENT, { "index.ts": "// e", [SRC]: "// source" });
    const c = await compile(dir);
    expect(c.ok).toBe(false);
    if (c.ok) return;
    expect(c.error.code).toBe("WEBEXT_SOURCE_WITHOUT_DIST");
    const rendered = describePreviewError(c.error);
    expect(rendered.hint).toContain("pi-web build");
  });

  it("发布路径本身仍不触发任何构建动作(既有「不自动构建」行为不变)", async () => {
    // 产物缺失 → compile() 直接返回错误,期间不产生任何 dist 文件——即没有隐式构建发生。
    const dir = makePkg(AGENT, { "index.ts": "// e", [SRC]: "// source" });
    const before = await compile(dir);
    expect(before.ok).toBe(false);
    // 再次编译(模拟重试)依旧是同一个错误,产物目录没有被静默生成。
    const after = await compile(dir);
    expect(after.ok).toBe(false);
    if (!after.ok) expect(after.error.code).toBe("WEBEXT_SOURCE_WITHOUT_DIST");
  });
});
