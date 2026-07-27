/**
 * registry-source-resolver(desktop-online-source-runnable 任务 3.2)——
 * `SourceResolverPlugin` 实现:先查已装索引复用,未命中才安装。
 *
 * ★ 「索引优先」是 Req 1.3(已装不重复下载)与 Req 2.2(离线可用)的实现基础:
 *   索引查找不依赖网络与登录态,故登出/断网后已装源仍解析得出。
 */
import { describe, it, expect, vi } from "vitest";
import { createRegistrySourceResolver } from "@/lib/app/online-source/registry-source-resolver";
import type { InstallOutcome } from "@/lib/app/online-source/registry-install-port";
import type {
  InstalledRegistryIndex,
  InstalledRegistryEntry,
} from "@blksails/pi-web-server";

function indexWith(entry?: InstalledRegistryEntry): InstalledRegistryIndex {
  return { lookup: () => entry };
}

function portReturning(outcome: InstallOutcome) {
  return { install: vi.fn(async () => outcome) };
}

const INSTALLED: InstalledRegistryEntry = {
  dir: "/agents/acme__canvas",
  receipt: { sourceId: "acme/canvas", channel: "stable" },
};

describe("canHandle — 与形态判别一致", () => {
  const resolver = createRegistrySourceResolver({
    index: indexWith(),
    port: portReturning({ ok: false, failure: { code: "NOT_AUTHENTICATED" } }),
  });

  it("线上形态命中", () => {
    expect(resolver.canHandle("acme/canvas@stable")).toBe(true);
  });

  it("本地路径 / git / builtin 不命中(不劫持既有源)", () => {
    expect(resolver.canHandle("/abs/agent")).toBe(false);
    expect(resolver.canHandle("./rel")).toBe(false);
    expect(resolver.canHandle("git:h/u/r@ref")).toBe(false);
    expect(resolver.canHandle("builtin:x")).toBe(false);
    expect(resolver.canHandle("acme/canvas")).toBe(false);
  });
});

describe("resolve — 索引优先", () => {
  it("已装 → 返回索引目录,且**不调用**安装端口(Req 1.3)", async () => {
    const port = portReturning({ ok: true, dir: "/should/not/be/used" });
    const resolver = createRegistrySourceResolver({ index: indexWith(INSTALLED), port });

    const r = await resolver.resolve("acme/canvas@stable", {});
    expect(r).toEqual({ localDir: "/agents/acme__canvas" });
    expect(port.install).not.toHaveBeenCalled();
  });

  it("已装时即使无凭据也能解析(Req 2.2 离线可用)", async () => {
    const port = portReturning({ ok: false, failure: { code: "NOT_AUTHENTICATED" } });
    const resolver = createRegistrySourceResolver({ index: indexWith(INSTALLED), port });

    const r = await resolver.resolve("acme/canvas@stable", {});
    expect(r.localDir).toBe("/agents/acme__canvas");
    expect(port.install).not.toHaveBeenCalled();
  });

  it("未装 → 调用安装端口恰一次并返回其目录", async () => {
    const port = portReturning({ ok: true, dir: "/agents/fresh" });
    const resolver = createRegistrySourceResolver({ index: indexWith(), port });

    const r = await resolver.resolve("acme/canvas@stable", {});
    expect(r).toEqual({ localDir: "/agents/fresh" });
    expect(port.install).toHaveBeenCalledTimes(1);
    expect(port.install).toHaveBeenCalledWith({ sourceId: "acme/canvas", channel: "stable" });
  });
});

describe("resolve — 失败即抛(create-session 据此不建会话,Req 4.4)", () => {
  it("未认证 → 抛出且错误可辨识分类与需登录语义", async () => {
    const port = portReturning({ ok: false, failure: { code: "NOT_AUTHENTICATED" } });
    const resolver = createRegistrySourceResolver({ index: indexWith(), port });

    await expect(resolver.resolve("acme/canvas@stable", {})).rejects.toMatchObject({
      failure: { code: "NOT_AUTHENTICATED" },
    });
  });

  it("各失败分类如实透传,不被压成同一种错误", async () => {
    for (const code of [
      "NOT_FOUND",
      "UNSUPPORTED_DISTRIBUTION",
      "DOWNLOAD_FAILED",
      "INTEGRITY_MISMATCH",
      "TARGET_OCCUPIED",
    ] as const) {
      const port = portReturning({ ok: false, failure: { code } as never });
      const resolver = createRegistrySourceResolver({ index: indexWith(), port });
      await expect(resolver.resolve("acme/canvas@stable", {})).rejects.toMatchObject({
        failure: { code },
      });
    }
  });

  it("传入非线上形态 → 抛出(调用方应先经 canHandle 过滤)", async () => {
    const port = portReturning({ ok: true, dir: "/x" });
    const resolver = createRegistrySourceResolver({ index: indexWith(), port });
    await expect(resolver.resolve("/abs/path", {})).rejects.toBeInstanceOf(Error);
    expect(port.install).not.toHaveBeenCalled();
  });
});
