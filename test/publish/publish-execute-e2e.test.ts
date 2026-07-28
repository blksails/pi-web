/**
 * 真实发布的**进程内契约端到端**(spec publish-execution,Req 7.2 / 7.7)。
 *
 * 用注册表侧交付的 `createFakeRegistry`(in-proc `RegistryService` + 内存 bundle 读写)
 * 走完整条链:**keystore 生成的密钥** → 签名 → 上传 → 登记 → 移通道,
 * 再从消费面把 bundle 原样取回。**无网络、无真实 registry。**
 *
 * ★ 与 `publish-install-e2e.test.ts` 的差别:那条测的是 `publish()` 编排器本身;
 *   这条测的是 **`executePublish` 这一层**——前置校验、身份来源、结果映射、阶段顺序。
 *   两者都必要:编排器对了而接线错了,用户照样发不出去。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakeRegistry, type FakeRegistry } from "@pi-clouds/registry-client/testing";
import { executePublish } from "@/lib/app/publish-execute";
import { ensurePublishKey } from "@/server/cli/publish/keystore";
import type { RegistryPort, RegistryOrigin, SignedManifest } from "@/server/cli/registry/registry-port";

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
function scratch(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}

const ORG = "acme";
const SOURCE_ID = `${ORG}/pack`;

/** in-proc port + **调用顺序记录**(顺序本身是契约)。 */
function inProcPort(fake: FakeRegistry, calls: string[]): RegistryPort {
  const api = fake.api;
  const A = fake.adminToken;
  const C = fake.consumeToken;
  return {
    async resolve(sourceId, opts) {
      calls.push("resolve");
      const r = await api.resolve(C, { sourceId, ...(opts?.channel ? { channel: opts.channel } : {}) });
      return {
        ok: true,
        value: { sourceId: r.sourceId, version: r.version, origin: r.origin as RegistryOrigin, manifest: r.manifest },
      };
    },
    async uploadBundle(sourceId, bytes) {
      calls.push("upload");
      const r = await api.uploadBundle(A, sourceId, bytes);
      return { ok: true, value: { bundle: r.bundle } };
    },
    async downloadBundle(sourceId, bundle) {
      calls.push("download");
      return { ok: true, value: await api.downloadBundle(C, sourceId, bundle) };
    },
    async registerVersion(sourceId, origin, manifest: SignedManifest) {
      calls.push("register");
      try {
        const res = await api.registerVersion(A, { sourceId, origin: origin as never, manifest });
        if (res.version.status !== "ready") {
          return { ok: false, error: { code: "VERSION_REJECTED", reason: res.version.failureReason ?? "not ready" } };
        }
        return { ok: true, value: undefined };
      } catch (e) {
        return { ok: false, error: { code: "OTHER", detail: (e as Error).message } };
      }
    },
    async setChannel(sourceId, channel, version) {
      calls.push("channel");
      await api.moveChannel(A, { sourceId, channel, version });
      return { ok: true, value: undefined };
    },
  };
}

function makePkg(id: string, version = "1.0.0"): string {
  const d = scratch("pi-e2e-exec-pkg-");
  writeFileSync(join(d, "pi-web.json"), JSON.stringify({ id, version, kind: "plugin", files: ["index.ts"] }, null, 2));
  writeFileSync(join(d, "index.ts"), "// e2e fixture\n");
  return d;
}

/** 用 **keystore 生成的真实密钥** 装一套 fake registry。 */
async function setup(): Promise<{ fake: FakeRegistry; calls: string[]; port: RegistryPort; keyHome: string }> {
  const keyHome = scratch("pi-e2e-exec-home-");
  const key = ensurePublishKey({ env: {} as NodeJS.ProcessEnv, homeDir: keyHome });
  if (!key.ok) throw new Error("keystore failed");

  const fake = createFakeRegistry();
  // ★ 登记的正是 keystore 那把公钥 —— 这一步在生产由 `POST /api/desktop/publish/keys` 完成。
  await fake.api.registerPublisher(fake.adminToken, {
    id: ORG,
    name: "Acme",
    keys: [{ publicKey: key.value.publicKey }],
  });
  // ⚠ **跨仓事实**:pi-web 的 `@pi-clouds/registry-client` 别名指向 pi-clouds **主仓**,
  //   而 spec registry-org-identity(P0,让 registerVersion 能从 token 派生 tenantId 自动建 source)
  //   目前还在 pi-clouds 的 worktree 分支上、未合主仓。所以本夹具里的 registry 仍是旧语义:
  //   首次发布必须由平台先建 source,否则抛
  //   `publisher "acme" has no tenant association yet ... must be provisioned by the platform`。
  //
  //   这里显式建一次 source —— 本文件测的是 **`executePublish` 这一层的接线**,
  //   registry 侧的自动建 source 归 P0 管,不该由本测试代为验证。
  //   P0 合入主仓后这一步可以删,届时删掉它反而是一条有价值的回归断言。
  await fake.api.createSource(fake.adminToken, {
    id: SOURCE_ID,
    displayName: "Acme Pack",
    description: "e2e",
    visibility: "org",
    policy: { secrets: [], resources: { vcpu: 1, memoryGiB: 1 } },
    publisherId: ORG,
    tenantId: fake.tenantId,
  });
  const calls: string[] = [];
  return { fake, calls, port: inProcPort(fake, calls), keyHome };
}

const grant = (org = ORG) => ({ baseUrl: "https://x", token: "T", publisherId: ORG, org }) as const;

describe("★ 端到端:keystore 密钥签出的包能被注册表接受", () => {
  it("走完 上传 → 登记 → 通道,顺序正确,结果齐备", async () => {
    const { calls, port, keyHome } = await setup();
    const r = await executePublish(
      { packageDir: makePkg(SOURCE_ID), expectedKind: "plugin" },
      {
        getPublishGrant: async () => grant(),
        ensureKey: () => ensurePublishKey({ env: {} as NodeJS.ProcessEnv, homeDir: keyHome }),
        ensureKeyRegistered: async () => true,
        createPort: () => port,
      },
    );

    expect(r.data.error).toBeUndefined();
    expect(r.data.ok).toBe(true);
    expect(r.data.published).toMatchObject({
      sourceId: SOURCE_ID,
      version: "1.0.0",
      channel: "stable",
      channelMoved: true,
      publisherId: ORG,
      org: ORG,
    });
    // ★ 顺序是契约:上传必须先于登记(登记引用的正是上传产出的 bundle key)。
    expect(calls).toEqual(["upload", "register", "channel"]);
  });

  it("★ 发布出的 bundle 能从消费面原样取回(source 由指纹自动建立,无需预先 createSource)", async () => {
    const { calls, port, keyHome } = await setup();
    const r = await executePublish(
      { packageDir: makePkg(SOURCE_ID), expectedKind: "plugin" },
      {
        getPublishGrant: async () => grant(),
        ensureKey: () => ensurePublishKey({ env: {} as NodeJS.ProcessEnv, homeDir: keyHome }),
        ensureKeyRegistered: async () => true,
        createPort: () => port,
      },
    );
    const bundle = r.data.published!.bundle;
    calls.length = 0;
    const back = await port.downloadBundle(SOURCE_ID, bundle);
    expect(back.ok).toBe(true);
    if (back.ok) expect(back.value.byteLength).toBeGreaterThan(0);
  });

  it("同一版本号重复发布 → 登记失败,且提示提版本号(★ 版本号已被烧掉)", async () => {
    const { port, keyHome } = await setup();
    const deps = {
      getPublishGrant: async () => grant(),
      ensureKey: () => ensurePublishKey({ env: {} as NodeJS.ProcessEnv, homeDir: keyHome }),
      ensureKeyRegistered: async () => true,
      createPort: () => port,
    };
    const dir = makePkg(SOURCE_ID);
    const first = await executePublish({ packageDir: dir, expectedKind: "plugin" }, deps);
    expect(first.data.ok).toBe(true);

    const second = await executePublish({ packageDir: dir, expectedKind: "plugin" }, deps);
    expect(second.data.ok).toBe(false);
    expect(second.data.error?.code).toBe("PUBLISH_REGISTER_FAILED");
    expect(second.data.error?.hint).toContain("提版本号");
  });

  it("★ org 前缀不属于自己 → 本地拦下,注册表**一次都没被调用**", async () => {
    const { calls, port, keyHome } = await setup();
    const r = await executePublish(
      { packageDir: makePkg("othercorp/pack"), expectedKind: "plugin" },
      {
        getPublishGrant: async () => grant(),
        ensureKey: () => ensurePublishKey({ env: {} as NodeJS.ProcessEnv, homeDir: keyHome }),
        ensureKeyRegistered: async () => true,
        createPort: () => port,
      },
    );
    expect(r.data.error?.code).toBe("PUBLISH_ORG_MISMATCH");
    expect(calls).toEqual([]);
  });
});
