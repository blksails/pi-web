/**
 * [真机] 线上 e2e:pi-web publish → install 打真实部署的 pi-registry(任务 10.3)。
 * 默认 skip;设 REGISTRY_E2E=1 + ADMIN_TOKEN/CONSUME_TOKEN 运行。
 *
 *   REGISTRY_E2E=1 REGISTRY_URL=https://pi-registry.apps.blksails.cn \
 *   ADMIN_TOKEN=... CONSUME_TOKEN=... npx vitest run test/publish/registry-e2e-online.test.ts
 *
 * 证明 CLI 的注册→发布(代理上传)→安装(代理下载+复核)闭环对真实 registry 成立,
 * 且 pi-web 全程不接触 OSS 凭据。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RegistryHttpClient, generateEd25519KeyPair } from "@pi-clouds/registry-client";
import { HttpRegistryAdapter } from "@/server/cli/registry/http-registry-adapter";
import { publish } from "@/server/cli/publish/publish-orchestrator";
import { installFromRegistry } from "@/server/cli/install/registry-install";

const RUN = process.env["REGISTRY_E2E"] === "1";
const BASE = process.env["REGISTRY_URL"] ?? "https://pi-registry.apps.blksails.cn";
const ADMIN = process.env["ADMIN_TOKEN"] ?? "";
const CONSUME = process.env["CONSUME_TOKEN"] ?? "";
const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

describe.runIf(RUN)("[真机] pi-web publish → install 打线上 registry", () => {
  it("注册→发布(代理上传)→安装(代理下载+integrity 复核)全链,pi-web 无 OSS 凭据", async () => {
    const ORG = `piweb${Date.now().toString(36)}`;
    const SOURCE_ID = `${ORG}/pack`;
    const keys = generateEd25519KeyPair();

    // admin 代管:登记 publisher + 建 source(orchestrator 不做这步)
    const client = new RegistryHttpClient({ baseUrl: BASE });
    await client.registerPublisher(ADMIN, { id: ORG, name: "PiWeb E2E", keys: [{ publicKey: keys.publicKey }] });
    await client.createSource(ADMIN, {
      id: SOURCE_ID, displayName: "PiWeb Pack", description: "e2e", visibility: "org",
      policy: { secrets: [], resources: { vcpu: 1, memoryGiB: 1 } }, tenantId: "1", publisherId: ORG,
    });

    // 造包 + key
    const pkgDir = mkdtempSync(join(tmpdir(), "piweb-e2e-")); dirs.push(pkgDir);
    writeFileSync(join(pkgDir, "pi-web.json"), JSON.stringify({ id: SOURCE_ID, version: "1.0.0", kind: "plugin", pi: { skills: ["skills/*.md"] } }));
    mkdirSync(join(pkgDir, "skills"), { recursive: true });
    const CONTENT = "# hello from pi-web publish\n";
    writeFileSync(join(pkgDir, "skills/hello.md"), CONTENT);
    const keyPath = join(pkgDir, "key.json");
    writeFileSync(keyPath, JSON.stringify(keys));

    const registry = new HttpRegistryAdapter({ baseUrl: BASE, publishToken: ADMIN, consumeToken: CONSUME });

    // dry-run 零外部写
    const dry = await publish(registry, { packageDir: pkgDir, keyPath, dryRun: true });
    expect(dry.ok && dry.value.kind === "dry-run").toBe(true);

    // 正式发布(代理上传 OSS → registerVersion → setChannel)
    const pub = await publish(registry, { packageDir: pkgDir, keyPath });
    expect(pub.ok, JSON.stringify(pub)).toBe(true);
    if (!pub.ok || pub.value.kind !== "published") throw new Error("publish failed");
    expect(pub.value.bundle).toMatch(/^bundles\/[0-9a-f]{64}\.tgz$/); // registry 内容寻址
    expect(pub.value.channelMoved).toBe(true);

    // 安装(代理下载 → integrity 复核 → 物化)
    const target = join(pkgDir, "installed");
    const inst = await installFromRegistry(registry, SOURCE_ID, { channel: "stable", targetDir: target });
    expect(inst.ok, JSON.stringify(inst)).toBe(true);
    if (!inst.ok) throw new Error("install failed");
    expect(inst.value.version).toBe("1.0.0");
    expect(inst.value.verifiedFiles).toBe(1);

    // 物化内容与发布原文逐字节一致
    expect(readFileSync(join(target, "skills/hello.md"), "utf8")).toBe(CONTENT);
  }, 60_000);
});
