/**
 * registry-install-port(desktop-online-source-runnable 任务 3.1)——
 * 取 P1 授予 → 构造消费面 adapter → 委托 installFromRegistry → 归一化失败分类。
 *
 * ★ 本端口**不自行实现**下载/解包/校验/落盘 —— 那些属 cli-package-commands 的
 *   installFromRegistry。本文件只验编排与失败归一,不重测既有实现的内部行为。
 *
 * ★ 凭据卫生是硬断言:无凭据时必须零网络调用;任何失败载荷不得含 token 字面量。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRegistryInstallPort } from "@/lib/app/online-source/registry-install-port";

const SECRET = "consume-token-do-not-leak-0123456789";
let root: string;
const created: string[] = [];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pi-install-port-"));
  created.push(root);
});

afterEach(() => {
  for (const d of created.splice(0)) rmSync(d, { recursive: true, force: true });
});

const REF = { sourceId: "acme/canvas", channel: "stable" } as const;

/** 断言整个结果树里不出现 token 字面量。 */
function expectNoToken(value: unknown): void {
  expect(JSON.stringify(value) ?? "").not.toContain(SECRET);
}

describe("createRegistryInstallPort — 授权前置", () => {
  it("无凭据 → NOT_AUTHENTICATED 且不构造 adapter、不调安装", async () => {
    const makeRegistry = vi.fn();
    const installImpl = vi.fn();
    const port = createRegistryInstallPort({
      getSourcesGrant: async () => undefined,
      targetRoot: root,
      deps: { makeRegistry, installImpl },
    });

    const r = await port.install(REF);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failure.code).toBe("NOT_AUTHENTICATED");
    expect(makeRegistry).not.toHaveBeenCalled();
    expect(installImpl).not.toHaveBeenCalled();
  });

  it("取授予时抛错 → GRANT_UNAVAILABLE 且不调安装", async () => {
    const installImpl = vi.fn();
    const port = createRegistryInstallPort({
      getSourcesGrant: async () => {
        throw new Error("capabilities down");
      },
      targetRoot: root,
      deps: { makeRegistry: vi.fn(), installImpl },
    });

    const r = await port.install(REF);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failure.code).toBe("GRANT_UNAVAILABLE");
    expect(installImpl).not.toHaveBeenCalled();
  });
});

describe("createRegistryInstallPort — 成功路径", () => {
  it("以消费面 token 构造 adapter,按 sourceId 派生目标目录", async () => {
    const makeRegistry = vi.fn(() => ({}) as never);
    const installImpl = vi.fn(async () => ({ ok: true as const, value: {} as never }));

    const port = createRegistryInstallPort({
      getSourcesGrant: async () => ({ baseUrl: "https://reg.example", token: SECRET }),
      targetRoot: root,
      deps: { makeRegistry, installImpl },
    });

    const r = await port.install(REF);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.dir).toBe(join(root, "acme__canvas"));

    // 消费面 token 而非发布面。
    expect(makeRegistry).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: "https://reg.example", consumeToken: SECRET }),
    );
    // channel 与 targetDir 如实透传。
    expect(installImpl).toHaveBeenCalledWith(
      expect.anything(),
      "acme/canvas",
      expect.objectContaining({ channel: "stable", targetDir: join(root, "acme__canvas") }),
    );
  });
});

describe("createRegistryInstallPort — 失败归一", () => {
  function portWith(error: unknown) {
    return createRegistryInstallPort({
      getSourcesGrant: async () => ({ baseUrl: "https://reg.example", token: SECRET }),
      targetRoot: root,
      deps: {
        makeRegistry: vi.fn(() => ({}) as never),
        installImpl: vi.fn(async () => ({ ok: false as const, error: error as never })),
      },
    });
  }

  it("RESOLVE_FAILED 且底层为 SOURCE_ABSENT → NOT_FOUND(可与其他失败区分)", async () => {
    const port = portWith({
      code: "RESOLVE_FAILED",
      detail: JSON.stringify({ code: "SOURCE_ABSENT", sourceId: "acme/canvas" }),
    });
    const r = await port.install(REF);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failure.code).toBe("NOT_FOUND");
  });

  it("RESOLVE_FAILED 但底层非 SOURCE_ABSENT → 不误报 NOT_FOUND", async () => {
    const port = portWith({
      code: "RESOLVE_FAILED",
      detail: JSON.stringify({ code: "UNREACHABLE", baseUrl: "https://reg.example" }),
    });
    const r = await port.install(REF);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failure.code).not.toBe("NOT_FOUND");
  });

  it("detail 不是合法 JSON 时不崩,降级为非 NOT_FOUND", async () => {
    const port = portWith({ code: "RESOLVE_FAILED", detail: "not json at all" });
    const r = await port.install(REF);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failure.code).not.toBe("NOT_FOUND");
  });

  it("UNSUPPORTED_ORIGIN → UNSUPPORTED_DISTRIBUTION", async () => {
    const port = portWith({ code: "UNSUPPORTED_ORIGIN", originType: "git" });
    const r = await port.install(REF);
    if (!r.ok) expect(r.failure.code).toBe("UNSUPPORTED_DISTRIBUTION");
  });

  it("各阶段失败按阶段区分", async () => {
    for (const [inCode, outCode] of [
      ["DOWNLOAD_FAILED", "DOWNLOAD_FAILED"],
      ["EXTRACT_FAILED", "EXTRACT_FAILED"],
      ["INTEGRITY_MISMATCH", "INTEGRITY_MISMATCH"],
    ] as const) {
      const port = portWith({ code: inCode, detail: "x", path: "/p" });
      const r = await port.install(REF);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.failure.code).toBe(outCode);
    }
  });

  it("任何失败载荷都不含 token 字面量(Req 4.5/5.4)", async () => {
    const port = portWith({ code: "DOWNLOAD_FAILED", detail: `boom ${SECRET}` });
    const r = await port.install(REF);
    expectNoToken(r);
  });
});

describe("createRegistryInstallPort — 目标位置保护", () => {
  it("目标已有非本通道安装(无回执) → TARGET_OCCUPIED 且不调安装", async () => {
    const occupied = join(root, "acme__canvas");
    mkdirSync(occupied, { recursive: true });
    writeFileSync(join(occupied, "index.ts"), "export default {}\n");

    const installImpl = vi.fn();
    const port = createRegistryInstallPort({
      getSourcesGrant: async () => ({ baseUrl: "https://reg.example", token: SECRET }),
      targetRoot: root,
      deps: { makeRegistry: vi.fn(() => ({}) as never), installImpl },
    });

    const r = await port.install(REF);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failure.code).toBe("TARGET_OCCUPIED");
    expect(installImpl).not.toHaveBeenCalled();
    // 用户原有内容原封不动。
    expect(existsSync(join(occupied, "index.ts"))).toBe(true);
  });

  it("目标是本通道的既有安装(有回执) → 允许重装", async () => {
    const dir = join(root, "acme__canvas");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, ".pi-web-registry.json"),
      JSON.stringify({ sourceId: "acme/canvas", channel: "stable" }),
    );

    const installImpl = vi.fn(async () => ({ ok: true as const, value: {} as never }));
    const port = createRegistryInstallPort({
      getSourcesGrant: async () => ({ baseUrl: "https://reg.example", token: SECRET }),
      targetRoot: root,
      deps: { makeRegistry: vi.fn(() => ({}) as never), installImpl },
    });

    const r = await port.install(REF);
    expect(r.ok).toBe(true);
    expect(installImpl).toHaveBeenCalledTimes(1);
  });
});
