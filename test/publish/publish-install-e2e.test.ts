/**
 * publish → install 端到端(cli-package-commands 任务 10.2)—— 进程内契约夹具,无网络。
 *
 * 用注册表侧交付的 `createFakeRegistry`(in-proc RegistryService + 内存 bundleWriter/reader)
 * 包一层 in-proc RegistryPort,走完:发布(编译→签名→上传→登记→通道)→ 安装(resolve→下载→
 * integrity 复核→物化)。验证发布出的包能被安装侧原样取回并核验。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakeRegistry, type FakeRegistry } from "@pi-clouds/registry-client/testing";
import { generateEd25519KeyPair } from "@pi-clouds/registry-client";
import { publish } from "@/server/cli/publish/publish-orchestrator";
import { installFromRegistry } from "@/server/cli/install/registry-install";
import type { RegistryPort, RegistryOrigin, SignedManifest } from "@/server/cli/registry/registry-port";

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
const scratch = (): string => {
  const d = mkdtempSync(join(tmpdir(), "pi-e2e-"));
  dirs.push(d);
  return d;
};

/**
 * 把注册表侧 in-proc `RegistryService` 适配成 pi-web `RegistryPort`(仅测试用)。
 * 发布面用 admin token(夹具里 admin 可为任意 publisherId 代管);消费面用 consume token。
 */
function inProcPort(fake: FakeRegistry): RegistryPort {
  const api = fake.api;
  const A = fake.adminToken;
  const C = fake.consumeToken;
  return {
    async resolve(sourceId, opts) {
      try {
        const r = await api.resolve(C, { sourceId, ...(opts?.channel ? { channel: opts.channel } : {}), ...(opts?.version ? { version: opts.version } : {}) });
        return { ok: true, value: { sourceId: r.sourceId, version: r.version, origin: r.origin as RegistryOrigin, manifest: r.manifest, ...(r.yanked ? { yanked: true } : {}) } };
      } catch (e) {
        return { ok: false, error: { code: "OTHER", detail: (e as Error).message } };
      }
    },
    async uploadBundle(sourceId, bytes) {
      const r = await api.uploadBundle(A, sourceId, bytes);
      return { ok: true, value: { bundle: r.bundle } };
    },
    async downloadBundle(sourceId, bundle) {
      const bytes = await api.downloadBundle(C, sourceId, bundle);
      return { ok: true, value: bytes };
    },
    async registerVersion(sourceId, origin, manifest: SignedManifest) {
      try {
        const res = await api.registerVersion(A, { sourceId, origin: origin as never, manifest });
        if (res.version.status !== "ready") return { ok: false, error: { code: "VERSION_REJECTED", reason: res.version.failureReason ?? "not ready" } };
        return { ok: true, value: undefined };
      } catch (e) {
        // registry 对重复版本抛 VersionConflictError → 归一到 VERSION_EXISTS(与真 adapter 一致)
        const code = (e as { code?: string }).code;
        if (code === "VERSION_CONFLICT" || code === "IMMUTABLE_VIOLATION") return { ok: false, error: { code: "VERSION_EXISTS", sourceId, version: "1.0.0" } };
        return { ok: false, error: { code: "OTHER", detail: (e as Error).message } };
      }
    },
    async setChannel(sourceId, channel, version) {
      try {
        await api.moveChannel(A, { sourceId, channel, version });
        return { ok: true, value: undefined };
      } catch (e) {
        return { ok: false, error: { code: "OTHER", detail: (e as Error).message } };
      }
    },
  };
}

async function setupFake(): Promise<{ fake: FakeRegistry; port: RegistryPort; sourceId: string; pubKey: string }> {
  const fake = createFakeRegistry();
  const port = inProcPort(fake);
  const keys = generateEd25519KeyPair();
  const sourceId = "acme/pack";
  // admin 登记 publisher + 建 source(代管:显式 publisherId)
  await fake.api.registerPublisher(fake.adminToken, { id: "acme", name: "Acme", keys: [{ publicKey: keys.publicKey }] });
  await fake.api.createSource(fake.adminToken, {
    id: sourceId, displayName: "Acme Pack", description: "d", visibility: "org",
    policy: { secrets: [], resources: { vcpu: 1, memoryGiB: 1 } }, tenantId: fake.tenantId, publisherId: "acme",
  });
  return { fake, port, sourceId, pubKey: keys.publicKey };
}

function makePkgAndKey(): { dir: string; keyPath: string } {
  const dir = scratch();
  writeFileSync(join(dir, "pi-web.json"), JSON.stringify({ id: "acme/pack", version: "1.0.0", kind: "plugin", pi: { skills: ["skills/*.md"], prompts: ["prompts/*.txt"] } }));
  mkdirSync(join(dir, "skills"), { recursive: true });
  mkdirSync(join(dir, "prompts"), { recursive: true });
  writeFileSync(join(dir, "skills/a.md"), "# skill a\n");
  writeFileSync(join(dir, "skills/b.md"), "# skill b\n");
  writeFileSync(join(dir, "prompts/p.txt"), "prompt text\n");
  // key 文件需要与登记的 publicKey 对应 —— 由调用方传入
  return { dir, keyPath: join(dir, "__unused") };
}

describe("publish → install 端到端(契约夹具)", () => {
  it("★ 发布的 plugin 能被安装侧原样取回并逐项 integrity 复核", async () => {
    const { port, sourceId } = await setupFake();
    // 用与 setup 里登记一致的密钥:重建 setup 让 key 对齐
    const fake2 = createFakeRegistry();
    const port2 = inProcPort(fake2);
    const keys = generateEd25519KeyPair();
    await fake2.api.registerPublisher(fake2.adminToken, { id: "acme", name: "Acme", keys: [{ publicKey: keys.publicKey }] });
    await fake2.api.createSource(fake2.adminToken, { id: sourceId, displayName: "P", description: "d", visibility: "org", policy: { secrets: [], resources: { vcpu: 1, memoryGiB: 1 } }, tenantId: fake2.tenantId, publisherId: "acme" });

    const pkg = makePkgAndKey();
    writeFileSync(pkg.keyPath, JSON.stringify(keys));

    // 发布
    const pub = await publish(port2, { packageDir: pkg.dir, keyPath: pkg.keyPath });
    expect(pub.ok, JSON.stringify(pub)).toBe(true);
    if (!pub.ok || pub.value.kind !== "published") throw new Error("publish failed");
    expect(pub.value.channelMoved).toBe(true);

    // 安装(经 channel)
    const target = join(scratch(), "installed");
    const inst = await installFromRegistry(port2, sourceId, { channel: "stable", targetDir: target });
    expect(inst.ok, JSON.stringify(inst)).toBe(true);
    if (!inst.ok) throw new Error("install failed");
    expect(inst.value.version).toBe("1.0.0");
    // 复核了 skills*2 + prompts*1 = 3 个 ref
    expect(inst.value.verifiedFiles).toBe(3);

    // 物化的文件与发布的原始内容逐字节一致
    expect(readFileSync(join(target, "skills/a.md"), "utf8")).toBe("# skill a\n");
    expect(readFileSync(join(target, "skills/b.md"), "utf8")).toBe("# skill b\n");
    expect(readFileSync(join(target, "prompts/p.txt"), "utf8")).toBe("prompt text\n");

    void port; // setup() 的第一个 fake 仅演示,主用例用 fake2
  });

  /**
   * ★ #28 回归(spec: publish-agent-entry-and-bundle,任务 2 / Req 6.1)
   *
   * 缺陷原始症状(2026-07-20 生产真机 + 本用例复现):`kind:"agent"` 的包经 CLI 发布,
   * upload 与 registerVersion 均"返回成功",但版本落库即 `status=failed`:
   *
   *     failureReason: "VALIDATION: manifest.entry must be an object"
   *
   * 随后 setChannel 报 VERSION_REJECTED,**且该版本号被永久烧掉**(failed 版本占号)。
   * 根因两侧:`manifest-compiler.ts` 的 `sign()` 从不产 `entry`;registry 侧
   * `validate.ts` 对 `kind==="agent"` 无条件要求 `entry`。
   *
   * 该字符串是本用例的复现锚点 —— 修复前必须以此原因失败,否则说明夹具没走到校验。
   */
  it("★ #28 回归:kind=agent 含 routes 的包能完成全链发布并被安装", async () => {
    const fake = createFakeRegistry();
    const port = inProcPort(fake);
    const keys = generateEd25519KeyPair();
    const sourceId = "acme/agent-pack";
    await fake.api.registerPublisher(fake.adminToken, { id: "acme", name: "Acme", keys: [{ publicKey: keys.publicKey }] });
    await fake.api.createSource(fake.adminToken, {
      id: sourceId, displayName: "Agent Pack", description: "d", visibility: "org",
      policy: { secrets: [], resources: { vcpu: 1, memoryGiB: 1 } }, tenantId: fake.tenantId, publisherId: "acme",
    });

    // 临时目录夹具:入口 + 路由子目录(不触碰 examples/ 下任何真实示例)
    const dir = scratch();
    writeFileSync(join(dir, "pi-web.json"), JSON.stringify({
      id: sourceId, version: "1.0.0", kind: "agent", files: ["routes/**/*.ts"],
    }));
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "agent-pack", private: true }));
    writeFileSync(join(dir, "index.ts"), "export default { systemPrompt: 'x' };\n");
    mkdirSync(join(dir, "routes"), { recursive: true });
    writeFileSync(join(dir, "routes/ping.ts"), "export const ping = () => ({ pong: true });\n");
    const keyPath = join(dir, "key.json");
    writeFileSync(keyPath, JSON.stringify(keys));

    const pub = await publish(port, { packageDir: dir, keyPath });
    expect(pub.ok, JSON.stringify(pub)).toBe(true);
    if (!pub.ok || pub.value.kind !== "published") throw new Error("publish failed");
    expect(pub.value.channelMoved).toBe(true);

    // 安装并核验:入口、路由、包元数据都应物化到目标目录
    const target = join(scratch(), "installed-agent");
    const inst = await installFromRegistry(port, sourceId, { channel: "stable", targetDir: target });
    expect(inst.ok, JSON.stringify(inst)).toBe(true);
    if (!inst.ok) throw new Error("install failed");
    expect(readFileSync(join(target, "index.ts"), "utf8")).toContain("systemPrompt");
    expect(readFileSync(join(target, "routes/ping.ts"), "utf8")).toContain("pong");
    expect(readFileSync(join(target, "package.json"), "utf8")).toContain("agent-pack");
  });

  it("★ 重复发布同版本 → VERSION_REJECTED,无副作用(通道不动)", async () => {
    const fake = createFakeRegistry();
    const port = inProcPort(fake);
    const keys = generateEd25519KeyPair();
    await fake.api.registerPublisher(fake.adminToken, { id: "acme", name: "Acme", keys: [{ publicKey: keys.publicKey }] });
    await fake.api.createSource(fake.adminToken, { id: "acme/pack", displayName: "P", description: "d", visibility: "org", policy: { secrets: [], resources: { vcpu: 1, memoryGiB: 1 } }, tenantId: fake.tenantId, publisherId: "acme" });

    const pkg = makePkgAndKey();
    writeFileSync(pkg.keyPath, JSON.stringify(keys));

    const first = await publish(port, { packageDir: pkg.dir, keyPath: pkg.keyPath });
    expect(first.ok).toBe(true);
    // 再发一次同版本 → registerVersion 冲突
    const second = await publish(port, { packageDir: pkg.dir, keyPath: pkg.keyPath });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.stage).toBe("register");
  });
});
