// @vitest-environment node
/**
 * SourceResolver 单测(spec cli-package-commands,任务 4.2,Req 3.4, 8.1, 8.2)。
 *
 * 覆盖:
 *   - Req 8.1 判别表:全部样例(带前缀 / 协议头 / scp 简写 / 路径形态 / host 简写 vs
 *     裸标识)各自归类正确。
 *   - Req 3.4 白名单拒绝:浮动版本 npm、非白名单 git host → `ALLOWLIST_REJECTED`,
 *     不抛异常。
 *   - 观察态:白名单拒绝路径下 stub 全局 `fetch` 断言零调用(证明无网络请求)。
 *   - 本地路径:相对 / 绝对 / `~` 展开的行为,以及 `kind` 从 `pi-web.json` 读取。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  classifySourceForm,
  resolveSource,
  CLI_ALLOWLIST,
} from "@/server/cli/install/source-resolver";

describe("classifySourceForm (Req 8.1)", () => {
  const directCases: readonly string[] = [
    "npm:foo@1.2.3",
    "git:github.com/u/r@v1",
    "https://github.com/u/r@v1",
    "ssh://git@github.com/u/r@v1",
    "git@github.com:u/r",
    "./rel/dir",
    "../up",
    "/abs/dir",
    "~/home/dir",
    "C:\\win\\path",
    "github.com/u/r@v1",
  ];

  const registryCases: readonly string[] = ["org/name", "org/name@stable", "bare-name"];

  it.each(directCases)("classifies %s as direct", (spec) => {
    expect(classifySourceForm(spec)).toBe("direct");
  });

  it.each(registryCases)("classifies %s as registry", (spec) => {
    expect(classifySourceForm(spec)).toBe("registry");
  });
});

describe("resolveSource — registry branch (not implemented, Req 8.1)", () => {
  it("returns REGISTRY_NOT_IMPLEMENTED for bare registry identifiers", async () => {
    const result = await resolveSource("org/name@stable");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({
        code: "REGISTRY_NOT_IMPLEMENTED",
        spec: "org/name@stable",
      });
    }
  });
});

describe("resolveSource — allowlist rejection (Req 3.4)", () => {
  it("rejects npm source with floating version range, no throw", async () => {
    const result = await resolveSource("npm:evil@^1.0.0");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ALLOWLIST_REJECTED");
    }
  });

  it("rejects git source with non-allowlisted host", async () => {
    const result = await resolveSource("git:evil-host.example/u/r@abc1234abc1234abc1234abc1234abc1234abcd");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ALLOWLIST_REJECTED");
    }
  });

  it("does not throw for malformed direct source syntax", async () => {
    await expect(resolveSource("npm:")).resolves.toMatchObject({ ok: false });
  });
});

describe("resolveSource — observable: no network request on rejection path", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("never calls fetch when rejecting an unpinned npm version", async () => {
    const result = await resolveSource("npm:evil@^1.0.0");
    expect(result.ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("never calls fetch when rejecting a non-allowlisted git host", async () => {
    const result = await resolveSource("https://evil-host.example/u/r@abc1234abc1234abc1234abc1234abc1234abcd");
    expect(result.ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("never calls fetch for the registry-identifier placeholder branch either", async () => {
    const result = await resolveSource("org/name@stable");
    expect(result.ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("resolveSource — local path handling", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "source-resolver-test-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("resolves a relative path against the provided cwd, defaulting kind to agent", async () => {
    const targetDir = join(root, "my-agent");
    mkdirSync(targetDir, { recursive: true });

    const result = await resolveSource("./my-agent", { cwd: root });
    expect(result.ok).toBe(true);
    if (result.ok && result.value.via === "direct") {
      expect(result.value.kind).toBe("agent");
      expect(result.value.source).toEqual({ kind: "local", path: targetDir });
    }
  });

  it("resolves an absolute path as-is", async () => {
    const targetDir = join(root, "abs-agent");
    mkdirSync(targetDir, { recursive: true });

    const result = await resolveSource(targetDir);
    expect(result.ok).toBe(true);
    if (result.ok && result.value.via === "direct") {
      expect(result.value.source).toEqual({ kind: "local", path: targetDir });
    }
  });

  it("expands ~ against the provided homeDir", async () => {
    const targetDir = join(root, "home-agent");
    mkdirSync(targetDir, { recursive: true });

    const result = await resolveSource("~/home-agent", { homeDir: root });
    expect(result.ok).toBe(true);
    if (result.ok && result.value.via === "direct") {
      expect(result.value.source).toEqual({ kind: "local", path: targetDir });
    }
  });

  it("reads kind from pi-web.json when present", async () => {
    const targetDir = join(root, "plugin-dir");
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(
      join(targetDir, "pi-web.json"),
      JSON.stringify({ id: "x", version: "1.0.0", kind: "plugin" }),
    );

    const result = await resolveSource(targetDir);
    expect(result.ok).toBe(true);
    if (result.ok && result.value.via === "direct") {
      expect(result.value.kind).toBe("plugin");
    }
  });

  it("rejects local paths when allowLocal is false", async () => {
    const targetDir = join(root, "no-local-agent");
    mkdirSync(targetDir, { recursive: true });

    const result = await resolveSource(targetDir, {
      allowlistConfig: { ...CLI_ALLOWLIST, allowLocal: false },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ALLOWLIST_REJECTED");
    }
  });
});
