/**
 * 线上源可运行 —— 端到端(desktop-online-source-runnable 任务 5.2)。
 *
 * 打通 **真实解析插件 + 真实安装实现 + 真实扫描/去重链路**:
 *   建会话(以 `sourceId@channel`)→ 授予 → 下载真实 tarball 字节 → 完整性复核 → 原子落盘
 *   → 写回执 → 扫描归一 → 列表恰一条 → 二次复用不再打注册表 → 登出后仍可解析。
 *
 * 复用既有夹具(不重造):`makeTarball` 与 `fakeRegistry` 的形态取自
 * `test/install/registry-install.test.ts`;能力端点以注入的 `getSourcesGrant` 替代
 * (与 P1 的 desktop-capabilities-client 测试同款注入思路)。
 *
 * ★ 只有这一层能证明各段接缝真的对得上 —— 单测里每段都绿,不等于串起来能跑
 *   (本特性实施期就踩到过:828 个单测全绿而 server 启动即崩)。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { computeIntegrity } from "@pi-clouds/registry-client";
import { installFromRegistry } from "@/server/cli/install/registry-install";
import type {
  RegistryPort,
  RegistryOrigin,
  SignedManifest,
  RegistryError,
} from "@/server/cli/registry/registry-port";
import { createRegistryInstallPort } from "@/lib/app/online-source/registry-install-port";
import { createRegistrySourceResolver } from "@/lib/app/online-source/registry-source-resolver";
import {
  createInstalledRegistryIndex,
  createScanSourceProvider,
  createCompositeSourceProvider,
  createRegistryHttpSourceProvider,
} from "@blksails/pi-web-server";
// 直引源码:该错误类是本轮新增,server 包的 dist 类型尚未重建,经 barrel 取会报「无此导出」。
import { OnlineSourceInstallError } from "../../packages/core/src/agent-source/online-source-errors.js";

const SOURCE_ID = "acme/canvas";
const REF = `${SOURCE_ID}@stable`;
const GRANT = { baseUrl: "https://reg.example", token: "consume-token-secret-xyz" };

let root: string;
const trash: string[] = [];

function scratch(prefix = "pi-e2e-"): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  trash.push(d);
  return d;
}

/** 真实 gzip tarball 字节(形态取自 test/install/registry-install.test.ts)。 */
function makeTarball(files: Record<string, string>): Uint8Array {
  const stage = scratch("pi-e2e-tar-");
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(join(stage, p, ".."), { recursive: true });
    writeFileSync(join(stage, p), c);
  }
  const tgz = join(scratch("pi-e2e-tgz-"), "b.tgz");
  execFileSync("tar", ["-czf", tgz, "-C", stage, "."]);
  return new Uint8Array(readFileSync(tgz));
}

/** 计次的 fake RegistryPort —— resolve/download 调用次数是「复用不重复下载」的判据。 */
function countingRegistry(cfg: {
  manifest: SignedManifest;
  bundleBytes: Uint8Array;
  origin?: RegistryOrigin;
  resolveErr?: RegistryError;
}): RegistryPort & { calls: { resolve: number; download: number } } {
  const calls = { resolve: 0, download: 0 };
  const port: RegistryPort = {
    async resolve(sourceId) {
      calls.resolve++;
      if (cfg.resolveErr) return { ok: false, error: cfg.resolveErr };
      return {
        ok: true,
        value: {
          sourceId,
          version: "1.0.0",
          origin: cfg.origin ?? { type: "oss", bundle: "bundles/x.tgz" },
          manifest: cfg.manifest,
        },
      };
    },
    async downloadBundle() {
      calls.download++;
      return { ok: true, value: cfg.bundleBytes };
    },
    async uploadBundle() {
      return { ok: false, error: { code: "OTHER", detail: "n/a" } };
    },
    async registerVersion() {
      return { ok: false, error: { code: "OTHER", detail: "n/a" } };
    },
    async setChannel() {
      return { ok: false, error: { code: "OTHER", detail: "n/a" } };
    },
  };
  return Object.assign(port, { calls });
}

/** 装配真实链路:安装端口 + 解析插件,注册表与授予可控。 */
function wire(opts: {
  registry: RegistryPort;
  grant?: typeof GRANT | undefined;
}) {
  const port = createRegistryInstallPort({
    getSourcesGrant: async () => opts.grant,
    targetRoot: root,
    deps: {
      // 真实 installFromRegistry;只把「注册表实例」换成可控的 fake(不改安装逻辑本身)。
      loadBackend: async () =>
        ({
          makeRegistry: () => opts.registry,
          installImpl: installFromRegistry,
        }) as never,
    },
  });
  return createRegistrySourceResolver({
    index: {
      lookup: (id) => createInstalledRegistryIndex({ roots: [root] }).lookup(id),
    },
    port,
  });
}

const ENTRY = "export default { name: 'canvas' }\n";

function goodBundle(): { manifest: SignedManifest; bytes: Uint8Array } {
  const bytes = makeTarball({ "index.ts": ENTRY, "README.md": "readme" });
  return {
    bytes,
    manifest: {
      name: SOURCE_ID,
      version: "1.0.0",
      kind: "agent",
      skills: [{ path: "index.ts", integrity: computeIntegrity(Buffer.from(ENTRY)) }],
      signature: "sig",
    } as SignedManifest,
  };
}

beforeEach(() => {
  root = scratch("pi-e2e-root-");
});

afterEach(() => {
  for (const d of trash.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("E2E 主路径:选中线上源 → 安装 → 可解析 → 列表恰一条", () => {
  it("首次解析即完成真实安装并落盘(含回执)", async () => {
    const { manifest, bytes } = goodBundle();
    const registry = countingRegistry({ manifest, bundleBytes: bytes });
    const resolver = wire({ registry, grant: GRANT });

    const r = await resolver.resolve(REF, {});

    // 真实落盘:目录、内容、回执俱全(Req 1.1/2.1/7.1/7.2)
    expect(r.localDir).toBe(join(root, "acme__canvas"));
    expect(readFileSync(join(r.localDir, "index.ts"), "utf8")).toBe(ENTRY);
    const receipt = JSON.parse(
      readFileSync(join(r.localDir, ".pi-web-registry.json"), "utf8"),
    ) as { sourceId: string; channel: string };
    expect(receipt.sourceId).toBe(SOURCE_ID);
    expect(receipt.channel).toBe("stable");
    expect(registry.calls.download).toBe(1);
  });

  it("装后列表恰一条,且可提交标识为 sourceId@channel(Req 3.1/3.2)", async () => {
    const { manifest, bytes } = goodBundle();
    const resolver = wire({ registry: countingRegistry({ manifest, bundleBytes: bytes }), grant: GRANT });
    await resolver.resolve(REF, {});

    // 线上一路(mock)∪ 本机扫描一路 —— 正是装完后的真实列表形态。
    const online = createRegistryHttpSourceProvider({
      getGrant: async () => GRANT,
      fetchImpl: async () => ({
        status: 200,
        async text() {
          return JSON.stringify({
            sources: [{ id: SOURCE_ID, displayName: "Canvas", kind: "agent" }],
          });
        },
      }),
    });
    const composite = createCompositeSourceProvider(
      online,
      createScanSourceProvider({ roots: [root] }),
    );

    const records = await composite.list();
    const mine = records.filter((x) => x.id === SOURCE_ID);
    expect(mine).toHaveLength(1); // ← 归一前这里会是 2 条
    expect(mine[0]!.source).toBe(REF);
  });
});

describe("E2E 复用与离线", () => {
  it("二次解析不再打注册表(Req 1.3)", async () => {
    const { manifest, bytes } = goodBundle();
    const registry = countingRegistry({ manifest, bundleBytes: bytes });
    const resolver = wire({ registry, grant: GRANT });

    await resolver.resolve(REF, {});
    expect(registry.calls.download).toBe(1);

    await resolver.resolve(REF, {});
    expect(registry.calls.download).toBe(1); // 未再下载
    expect(registry.calls.resolve).toBe(1); // 也未再解析
  });

  it("登出(无授予)后仍能解析已装源(Req 2.2/2.3)", async () => {
    const { manifest, bytes } = goodBundle();
    const registry = countingRegistry({ manifest, bundleBytes: bytes });
    await wire({ registry, grant: GRANT }).resolve(REF, {});

    // 凭据清空 —— 模拟登出。
    const offline = wire({ registry, grant: undefined });
    const r = await offline.resolve(REF, {});
    expect(r.localDir).toBe(join(root, "acme__canvas"));
    expect(registry.calls.download).toBe(1); // 全程只下载过那一次
  });
});

describe("E2E 失败路径", () => {
  it("字节被篡改 → 完整性失败、不留半成品目录(Req 4.1/4.2)", async () => {
    const declared = "# original\n";
    const bytes = makeTarball({ "index.ts": "TAMPERED" });
    const manifest = {
      name: SOURCE_ID,
      version: "1.0.0",
      kind: "agent",
      skills: [{ path: "index.ts", integrity: computeIntegrity(Buffer.from(declared)) }],
      signature: "sig",
    } as SignedManifest;
    const resolver = wire({ registry: countingRegistry({ manifest, bundleBytes: bytes }), grant: GRANT });

    await expect(resolver.resolve(REF, {})).rejects.toMatchObject({
      failureCode: "INTEGRITY_MISMATCH",
    });
    // 关键:目标位置不得残留半成品。
    expect(existsSync(join(root, "acme__canvas"))).toBe(false);
  });

  it("未登录 → NOT_AUTHENTICATED 且注册表零请求(Req 5.1)", async () => {
    const { manifest, bytes } = goodBundle();
    const registry = countingRegistry({ manifest, bundleBytes: bytes });
    const resolver = wire({ registry, grant: undefined });

    await expect(resolver.resolve(REF, {})).rejects.toBeInstanceOf(OnlineSourceInstallError);
    expect(registry.calls.resolve).toBe(0);
    expect(registry.calls.download).toBe(0);
    expect(existsSync(join(root, "acme__canvas"))).toBe(false);
  });

  it("目标被用户手放的同名目录占用 → 明确失败且不覆盖(Req 4.3)", async () => {
    const occupied = join(root, "acme__canvas");
    mkdirSync(occupied, { recursive: true });
    writeFileSync(join(occupied, "mine.ts"), "user content\n");

    const { manifest, bytes } = goodBundle();
    const registry = countingRegistry({ manifest, bundleBytes: bytes });
    const resolver = wire({ registry, grant: GRANT });

    await expect(resolver.resolve(REF, {})).rejects.toMatchObject({
      failureCode: "TARGET_OCCUPIED",
    });
    expect(readFileSync(join(occupied, "mine.ts"), "utf8")).toBe("user content\n");
    expect(registry.calls.download).toBe(0);
  });
});
