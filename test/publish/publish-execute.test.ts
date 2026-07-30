/**
 * 真实发布编排(spec publish-execution,Req 3/4/5/6 · 7.2–7.4/7.6)。
 *
 * ★ 本文件的重心不在"能发出去",而在**发不出去时不要烧掉版本号**:
 *   registry 的 `registerVersion` 失败会落一条 `failed` 记录并占住 `sourceId@version`,
 *   而版本不可删(DB 触发器)。所以每一条前置拒绝路径都断言 `createPort` **从未被调用** ——
 *   只断言"返回了错误"是不够的,那不排除它已经把一个版本号花掉了。
 */
import { describe, it, expect, vi, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executePublish, orgOf, DEFAULT_PUBLISH_CHANNEL } from "@/lib/app/publish-execute";
import type { PublishExecuteDeps } from "@/lib/app/publish-execute";
import type { PublishResult } from "@/server/cli/publish/publish-orchestrator";
import type { RegistryPort } from "@/server/cli/registry/registry-port";

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

const GRANT = {
  baseUrl: "https://registry.example",
  token: "GRANT-TOKEN-DO-NOT-LEAK",
  publisherId: "pub-1",
  org: "blksails",
} as const;

function makePkg(manifest: Record<string, unknown>): string {
  const d = mkdtempSync(join(tmpdir(), "pi-exec-pkg-"));
  dirs.push(d);
  writeFileSync(join(d, "pi-web.json"), JSON.stringify(manifest, null, 2));
  writeFileSync(join(d, "index.ts"), "// x\n");
  return d;
}
const PLUGIN_PKG = () => makePkg({ id: "blksails/x", version: "1.0.0", kind: "plugin" });

const KEY_OK = () => ({ ok: true, value: { path: "/k/publish.json", publicKey: "P", fingerprint: "ed25519:F", created: false } }) as never;

/** 记录 createPort 是否被调用 —— 「零外部写」的可断言载体。 */
function deps(over: Partial<PublishExecuteDeps> = {}) {
  const createPort = vi.fn((): RegistryPort => ({}) as RegistryPort);
  const base: PublishExecuteDeps = {
    getPublishGrant: async () => GRANT,
    ensureKey: KEY_OK,
    ensureKeyRegistered: async () => true,
    createPort,
    publishFn: async (): Promise<PublishResult> => ({
      ok: true,
      value: { kind: "published", sourceId: "blksails/x", version: "1.0.0", bundle: "bundles/a.tgz", channelMoved: true, warnings: [] },
    }),
    ...over,
  };
  return { deps: base, createPort: (over.createPort ?? createPort) as typeof createPort };
}

const run = (dir: string, d: PublishExecuteDeps, kind: "agent" | "plugin" = "plugin", channel?: string) =>
  executePublish({ packageDir: dir, expectedKind: kind, ...(channel !== undefined ? { channel } : {}) }, d);

describe("orgOf", () => {
  it("取命名空间段;无斜杠或以斜杠开头 → 空", () => {
    expect(orgOf("blksails/x")).toBe("blksails");
    expect(orgOf("noslash")).toBe("");
    expect(orgOf("/x")).toBe("");
  });
});

describe("★ 前置拒绝路径:全部零外部写(Req 3.2 / 7.3)", () => {
  it("无发布授予 → PUBLISH_NOT_AVAILABLE,且**连编译都不做**", async () => {
    const compileFn = vi.fn();
    const { deps: d, createPort } = deps({ getPublishGrant: async () => undefined, compileFn: compileFn as never });
    const r = await run("/nonexistent", d);
    expect(r.data.error?.code).toBe("PUBLISH_NOT_AVAILABLE");
    expect(compileFn).not.toHaveBeenCalled();
    expect(createPort).not.toHaveBeenCalled();
    // 无授予时仍是"预览语义"的两位皆 true —— 它确实什么都没做。
    expect(r.data.disclaimers).toEqual({ unsigned: true, grantNotChecked: true });
  });

  it("编译失败 → 编译错误码,零外部写", async () => {
    const { deps: d, createPort } = deps();
    const empty = mkdtempSync(join(tmpdir(), "pi-exec-empty-"));
    dirs.push(empty);
    const r = await run(empty, d);
    expect(r.data.ok).toBe(false);
    expect(r.data.error?.code).toBe("MANIFEST_MISSING");
    expect(createPort).not.toHaveBeenCalled();
  });

  it("kind 不符 → PUBLISH_KIND_MISMATCH,零外部写,且指路另一条命令", async () => {
    const { deps: d, createPort } = deps();
    const r = await run(PLUGIN_PKG(), d, "agent");
    expect(r.data.error?.code).toBe("PUBLISH_KIND_MISMATCH");
    expect(r.data.error?.hint).toContain("/plugin publish");
    expect(createPort).not.toHaveBeenCalled();
  });

  it("★ org 前缀不符 → PUBLISH_ORG_MISMATCH,零外部写,且说明可修复(不是「禁止访问」)", async () => {
    const { deps: d, createPort } = deps();
    const dir = makePkg({ id: "othercorp/x", version: "1.0.0", kind: "plugin" });
    const r = await run(dir, d);
    expect(r.data.error?.code).toBe("PUBLISH_ORG_MISMATCH");
    expect(r.data.error?.hint).toContain("blksails/");
    expect(createPort).not.toHaveBeenCalled();
  });

  it("密钥不可用 → keystore 错误码,零外部写", async () => {
    const { deps: d, createPort } = deps({
      ensureKey: () => ({ ok: false, error: { code: "KEY_MALFORMED", path: "/k/publish.json" } }) as never,
    });
    const r = await run(PLUGIN_PKG(), d);
    expect(r.data.error?.code).toBe("KEY_MALFORMED");
    expect(createPort).not.toHaveBeenCalled();
  });

  it("★ 公钥未登记 → 拒绝,零外部写(否则服务端验签必失败,白烧一个版本号)", async () => {
    const { deps: d, createPort } = deps({ ensureKeyRegistered: async () => false });
    const r = await run(PLUGIN_PKG(), d);
    expect(r.data.error?.code).toBe("PUBLISH_KEY_NOT_REGISTERED");
    expect(createPort).not.toHaveBeenCalled();
  });
});

describe("成功路径(Req 2.5 / 4.4)", () => {
  it("全成功 → published 齐备,disclaimers 两位皆 false(它不是预览)", async () => {
    const { deps: d } = deps();
    const r = await run(PLUGIN_PKG(), d);
    expect(r.data.ok).toBe(true);
    expect(r.data.disclaimers).toEqual({ unsigned: false, grantNotChecked: false });
    expect(r.data.published).toEqual({
      sourceId: "blksails/x",
      version: "1.0.0",
      bundle: "bundles/a.tgz",
      channel: DEFAULT_PUBLISH_CHANNEL,
      channelMoved: true,
      publisherId: "pub-1",
      org: "blksails",
    });
    expect(r.message).toContain("不可更改");
  });

  it("指定 channel 被透传到编排器与结果", async () => {
    const publishFn = vi.fn(async (): Promise<PublishResult> => ({
      ok: true,
      value: { kind: "published", sourceId: "blksails/x", version: "1.0.0", bundle: "b", channelMoved: true, warnings: [] },
    }));
    const { deps: d } = deps({ publishFn: publishFn as never });
    const r = await run(PLUGIN_PKG(), d, "plugin", "beta");
    expect((publishFn.mock.calls[0] as unknown[])[1]).toMatchObject({ channel: "beta" });
    expect(r.data.published?.channel).toBe("beta");
  });
});

describe("★ 阶段化失败:register 与 channel 给出相反的重试指导(Req 5.1/5.2/5.4)", () => {
  it("上传失败 → 失败,且明说可用**同一版本号**重试", async () => {
    const { deps: d } = deps({
      publishFn: async (): Promise<PublishResult> => ({
        ok: false,
        error: { stage: "upload", error: { code: "UNREACHABLE", baseUrl: "https://registry.example" } },
      }),
    });
    const r = await run(PLUGIN_PKG(), d);
    expect(r.data.ok).toBe(false);
    expect(r.data.error?.code).toBe("PUBLISH_UPLOAD_FAILED");
    expect(r.data.error?.hint).toContain("同一版本号");
    expect(r.data.published).toBeUndefined();
  });

  it("★ 登记失败 → 失败,且明说版本号**已被占用**、需提版本号", async () => {
    const { deps: d } = deps({
      publishFn: async (): Promise<PublishResult> => ({
        ok: false,
        error: { stage: "register", error: { code: "VERSION_REJECTED", reason: "duplicate" } },
      }),
    });
    const r = await run(PLUGIN_PKG(), d);
    expect(r.data.error?.code).toBe("PUBLISH_REGISTER_FAILED");
    expect(r.data.error?.hint).toContain("blksails/x@1.0.0");
    expect(r.data.error?.hint).toContain("提版本号");
  });

  it("★ 通道失败 → **ok: true** 且 channelMoved=false(部分成功不否定已登记的版本)", async () => {
    const { deps: d } = deps({
      publishFn: async (): Promise<PublishResult> => ({
        ok: false,
        error: {
          stage: "channel",
          error: { code: "UNREACHABLE", baseUrl: "https://registry.example" },
          registered: { sourceId: "blksails/x", version: "1.0.0", bundle: "bundles/a.tgz" },
        },
      }),
    });
    const r = await run(PLUGIN_PKG(), d);
    expect(r.data.ok).toBe(true);
    expect(r.data.published?.channelMoved).toBe(false);
    // ★ 与登记失败**相反**的指导:别改版本号。
    expect(r.message).toContain("不要改版本号");
  });
});

describe("凭据卫生(Req 6.1 / 6.2 / 7.6)", () => {
  it("★ 授予 token 不出现在结果的任何字段", async () => {
    const { deps: d } = deps();
    const r = await run(PLUGIN_PKG(), d);
    expect(JSON.stringify(r)).not.toContain(GRANT.token);
  });

  it("★ RegistryError 的 detail 不外泄(它可能内嵌带凭据的 URL)", async () => {
    const { deps: d } = deps({
      publishFn: async (): Promise<PublishResult> => ({
        ok: false,
        error: { stage: "register", error: { code: "OTHER", detail: "https://u:LEAKED@h/x failed" } },
      }),
    });
    const r = await run(PLUGIN_PKG(), d);
    expect(JSON.stringify(r)).not.toContain("LEAKED");
  });

  it("成功结果里也不含 baseUrl 之外的部署细节 —— token 尤其不在", async () => {
    const { deps: d } = deps();
    const r = await run(PLUGIN_PKG(), d);
    expect(JSON.stringify(r.data)).not.toContain("GRANT-TOKEN");
  });
});
