// @vitest-environment node
/**
 * `resolveAgentSource` 单测(spec cli-agent-build,任务 3.1,Req 1.3, 4.1, 5.1, 7.1)。
 *
 * 覆盖:两种既有 webext 源目录约定各自的「有源」定位、二者皆缺的「无源」报错(带期望位置)、
 * `pi-web.json#web.dist` 覆盖产物目录、无位置参数回落 `process.cwd()`、`pi-web.json` 缺失/
 * 非法时按未声明处理。真实临时目录读写(与 `test/cli/local-source-registry.test.ts` 同策略),
 * 不 mock 文件系统——探测逻辑本身就是「文件是否存在」,mock 掉就测不出真实回归。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { resolveAgentSource } from "@/server/cli/build/agent-source";
import { BuildError, describeBuildError } from "@/server/cli/build/errors";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "agent-source-test-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** 在 `dir` 下放一个约定入口文件(空内容即可,resolveAgentSource 只判定存在性)。 */
function seedEntry(dir: string, file: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, file), "export const config = {};\n");
}

describe("resolveAgentSource: 有源(约定 A · .pi/web)", () => {
  it("识别 .pi/web/web.config.tsx,定位出 webextEntryDir 与缺省 outDir", async () => {
    seedEntry(join(root, ".pi", "web"), "web.config.tsx");

    const loc = await resolveAgentSource(root);

    expect(loc.sourceRoot).toBe(resolve(root));
    expect(loc.webextEntryDir).toBe(join(root, ".pi", "web"));
    expect(loc.outDir).toBe(join(root, ".pi", "web", "dist"));
    expect(loc.manifest).toBeUndefined();
  });
});

describe("resolveAgentSource: 有源(约定 B · web/)", () => {
  it("识别 web/web.config.tsx(不在 .pi/web 下),缺省 outDir 仍是 .pi/web/dist", async () => {
    seedEntry(join(root, "web"), "web.config.tsx");

    const loc = await resolveAgentSource(root);

    expect(loc.webextEntryDir).toBe(join(root, "web"));
    expect(loc.outDir).toBe(join(root, ".pi", "web", "dist"));
  });

  it("index.ts 同样被识别为入口(非仅 web.config.*)", async () => {
    seedEntry(join(root, "web"), "index.ts");

    const loc = await resolveAgentSource(root);

    expect(loc.webextEntryDir).toBe(join(root, "web"));
  });
});

describe("resolveAgentSource: 两种约定都命中时,.pi/web 优先", () => {
  it("同时存在两处入口,取 .pi/web", async () => {
    seedEntry(join(root, ".pi", "web"), "web.config.tsx");
    seedEntry(join(root, "web"), "web.config.tsx");

    const loc = await resolveAgentSource(root);

    expect(loc.webextEntryDir).toBe(join(root, ".pi", "web"));
  });
});

describe("resolveAgentSource: 无源(Req 7.1)", () => {
  it("两种目录约定均无入口文件时,以 BuildError{stage:resolve} 终止并列出两种期望位置", async () => {
    mkdirSync(root, { recursive: true }); // 空目录:既无 .pi/web 也无 web

    await expect(resolveAgentSource(root)).rejects.toMatchObject({
      stage: "resolve",
      code: "BUILD_RESOLVE_SOURCE_NOT_FOUND",
    });

    try {
      await resolveAgentSource(root);
      expect.unreachable("应抛出 BuildError");
    } catch (e) {
      expect(e).toBeInstanceOf(BuildError);
      const err = e as BuildError;
      expect(err.detail).toContain(join(root, ".pi", "web"));
      expect(err.detail).toContain(join(root, "web"));
      // describeBuildError 把 path 也拼进最终呈现文案(供 reporter.fail 使用)。
      expect(describeBuildError(err)).toContain(resolve(root));
    }
  });

  it("目录存在但仅有无关文件(如 README.md)时同样判定无源", async () => {
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "README.md"), "# not an entry\n");

    await expect(resolveAgentSource(root)).rejects.toBeInstanceOf(BuildError);
  });
});

describe("resolveAgentSource: 无位置参数回落 process.cwd()(Req 1.3)", () => {
  it("传 undefined 时以当前工作目录为 source 根", async () => {
    seedEntry(join(root, ".pi", "web"), "index.ts");
    const originalCwd = process.cwd();
    process.chdir(root);
    try {
      // ★ macOS 上 `/tmp` 是到 `/private/tmp` 的符号链接:`process.chdir` 后
      //   `process.cwd()` 返回的是**内核解析后的真实路径**,而 `resolve(root)` 只做字符串
      //   规范化、不 realpath。判据须对齐 `process.cwd()` 本身,而非重新推导期望值。
      const loc = await resolveAgentSource(undefined);
      expect(loc.sourceRoot).toBe(process.cwd());
    } finally {
      process.chdir(originalCwd);
    }
  });
});

describe("resolveAgentSource: pi-web.json#web.dist 覆盖产物目录(Req 5.1)", () => {
  it("显式声明 web.dist 时,outDir 遵从该覆盖而非默认 .pi/web/dist", async () => {
    seedEntry(join(root, ".pi", "web"), "web.config.tsx");
    writeFileSync(
      join(root, "pi-web.json"),
      JSON.stringify({ id: "custom-dist-agent", version: "1.0.0", kind: "agent", web: { dist: "custom/out" } }),
    );

    const loc = await resolveAgentSource(root);

    expect(loc.outDir).toBe(resolve(root, "custom", "out"));
    expect(loc.manifest?.id).toBe("custom-dist-agent");
  });

  it("pi-web.json 存在但未声明 web.dist 时,仍用默认 outDir", async () => {
    seedEntry(join(root, ".pi", "web"), "web.config.tsx");
    writeFileSync(join(root, "pi-web.json"), JSON.stringify({ id: "plain-agent", version: "1.0.0", kind: "agent" }));

    const loc = await resolveAgentSource(root);

    expect(loc.outDir).toBe(join(root, ".pi", "web", "dist"));
    expect(loc.manifest?.id).toBe("plain-agent");
  });
});

describe("resolveAgentSource: pi-web.json 缺失或非法时按未声明处理", () => {
  it("pi-web.json 不存在:manifest 为 undefined,不报错", async () => {
    seedEntry(join(root, "web"), "web.config.tsx");

    const loc = await resolveAgentSource(root);

    expect(loc.manifest).toBeUndefined();
  });

  it("pi-web.json 是非法 JSON:忽略,不影响定位结果", async () => {
    seedEntry(join(root, "web"), "web.config.tsx");
    writeFileSync(join(root, "pi-web.json"), "{ not valid json");

    const loc = await resolveAgentSource(root);

    expect(loc.manifest).toBeUndefined();
    expect(loc.outDir).toBe(join(root, ".pi", "web", "dist"));
  });

  it("pi-web.json 结构不合法(缺必填 id):忽略,不影响定位结果", async () => {
    seedEntry(join(root, "web"), "web.config.tsx");
    writeFileSync(join(root, "pi-web.json"), JSON.stringify({ version: "1.0.0" }));

    const loc = await resolveAgentSource(root);

    expect(loc.manifest).toBeUndefined();
  });
});
