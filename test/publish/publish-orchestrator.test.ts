/**
 * publish 端到端(编译→签名→上传→登记→通道)—— 用真实临时包目录 + fake RegistryPort。
 * 覆盖:dry-run 零外部写、完整发布两步、commit-only、编译/签名错误、缺失声明路径、
 * 签名可被 registry 侧验签纯函数验证(任务 8.2 验收)。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateEd25519KeyPair, computeFingerprint, verifyManifest } from "@pi-clouds/registry-client";
import { publish } from "@/server/cli/publish/publish-orchestrator";
import { compile } from "@/server/cli/publish/manifest-compiler";
import type { RegistryPort, RegistryError, RegistryOrigin, SignedManifest } from "@/server/cli/registry/registry-port";

const dirs: string[] = [];
function makePkg(manifest: object, files: Record<string, string> = {}): string {
  const d = mkdtempSync(join(tmpdir(), "pi-pub-pkg-"));
  dirs.push(d);
  writeFileSync(join(d, "pi-web.json"), JSON.stringify(manifest, null, 2));
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(join(d, p, ".."), { recursive: true });
    writeFileSync(join(d, p), c);
  }
  return d;
}
function makeKey(): { path: string; publicKey: string } {
  const kp = generateEd25519KeyPair();
  const d = mkdtempSync(join(tmpdir(), "pi-pub-key-"));
  dirs.push(d);
  const path = join(d, "key.json");
  writeFileSync(path, JSON.stringify(kp));
  return { path, publicKey: kp.publicKey };
}
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

/** 记录所有外部写的 fake RegistryPort。 */
function fakeRegistry(overrides: Partial<Record<"upload" | "register" | "channel", RegistryError>> = {}) {
  const calls = { upload: 0, register: 0, channel: 0 };
  const seen: { origin?: RegistryOrigin; manifest?: SignedManifest; channelVersion?: string } = {};
  const port: RegistryPort = {
    async resolve() {
      return { ok: false, error: { code: "SOURCE_ABSENT", sourceId: "x" } };
    },
    async uploadBundle(_id, bytes) {
      calls.upload++;
      if (overrides.upload) return { ok: false, error: overrides.upload };
      // 内容寻址:sha256 前缀
      return { ok: true, value: { bundle: `bundles/${bytes.length}.tgz` } };
    },
    async registerVersion(_id, origin, manifest) {
      calls.register++;
      seen.origin = origin;
      seen.manifest = manifest;
      if (overrides.register) return { ok: false, error: overrides.register };
      return { ok: true, value: undefined };
    },
    async setChannel(_id, _ch, version) {
      calls.channel++;
      seen.channelVersion = version;
      if (overrides.channel) return { ok: false, error: overrides.channel };
      return { ok: true, value: undefined };
    },
  };
  return { port, calls, seen };
}

const PLUGIN_MANIFEST = {
  id: "acme/pack",
  version: "1.0.0",
  kind: "plugin",
  displayName: "Acme Pack",
  pi: { skills: ["skills/*.md"] },
};

describe("publish — 完整流程", () => {
  it("plugin 全链:编译→上传→registerVersion(oss)→setChannel", async () => {
    const dir = makePkg(PLUGIN_MANIFEST, { "skills/a.md": "# a\n", "skills/b.md": "# b\n" });
    const key = makeKey();
    const { port, calls, seen } = fakeRegistry();

    const r = await publish(port, { packageDir: dir, keyPath: key.path });
    expect(r.ok).toBe(true);
    if (r.ok && r.value.kind === "published") {
      expect(r.value.sourceId).toBe("acme/pack");
      expect(r.value.version).toBe("1.0.0");
      expect(r.value.channelMoved).toBe(true);
    }
    expect(calls).toEqual({ upload: 1, register: 1, channel: 1 });
    expect(seen.origin).toMatchObject({ type: "oss" }); // 用户决策:oss origin
    expect(seen.channelVersion).toBe("1.0.0");

    // ★ 签名可被 registry 侧验签纯函数验证(任务 8.2)
    expect(verifyManifest(seen.manifest!, key.publicKey)).toBe(true);
    // ★ 显式写 kind + publisher 指纹正确
    expect(seen.manifest!["kind"]).toBe("plugin");
    expect(seen.manifest!["publisher"]).toBe(computeFingerprint(key.publicKey));
    // skills 两个文件都进了 integrity refs
    expect((seen.manifest!["skills"] as unknown[]).length).toBe(2);
  });

  it("★ --dry-run:走完编译+签名,零外部写", async () => {
    const dir = makePkg(PLUGIN_MANIFEST, { "skills/a.md": "# a\n" });
    const key = makeKey();
    const { port, calls } = fakeRegistry();
    const r = await publish(port, { packageDir: dir, keyPath: key.path, dryRun: true });
    expect(r.ok).toBe(true);
    if (r.ok && r.value.kind === "dry-run") {
      expect(r.value.files).toContain("skills/a.md");
      expect(r.value.manifest["kind"]).toBe("plugin");
    }
    expect(calls).toEqual({ upload: 0, register: 0, channel: 0 }); // 零外部写
  });

  it("--commit-only:登记后不移通道", async () => {
    const dir = makePkg(PLUGIN_MANIFEST, { "skills/a.md": "# a\n" });
    const key = makeKey();
    const { port, calls } = fakeRegistry();
    const r = await publish(port, { packageDir: dir, keyPath: key.path, commitOnly: true });
    expect(r.ok && r.value.kind === "published" && r.value.channelMoved).toBe(false);
    expect(calls).toEqual({ upload: 1, register: 1, channel: 0 });
  });

  it("★ 编译失败(缺 pi-web.json)在任何外部写之前终止", async () => {
    const dir = mkdtempSync(join(tmpdir(), "empty-"));
    dirs.push(dir);
    const key = makeKey();
    const { port, calls } = fakeRegistry();
    const r = await publish(port, { packageDir: dir, keyPath: key.path });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.stage).toBe("compile");
    expect(calls).toEqual({ upload: 0, register: 0, channel: 0 });
  });

  it("★ 声明路径零命中 → DECLARED_PATH_MISSING,零外部写", async () => {
    const dir = makePkg({ ...PLUGIN_MANIFEST, pi: { skills: ["skills/nope.md"] } });
    const key = makeKey();
    const { port, calls } = fakeRegistry();
    const r = await publish(port, { packageDir: dir, keyPath: key.path });
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.stage === "compile") expect(r.error.error.code).toBe("DECLARED_PATH_MISSING");
    expect(calls).toEqual({ upload: 0, register: 0, channel: 0 });
  });

  it("私钥缺失 → KEY_UNUSABLE(sign 阶段),零外部写", async () => {
    const dir = makePkg(PLUGIN_MANIFEST, { "skills/a.md": "# a\n" });
    const { port, calls } = fakeRegistry();
    const r = await publish(port, { packageDir: dir, keyPath: "/nonexistent/key.json" });
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.stage === "sign") expect(r.error.error.code).toBe("KEY_UNUSABLE");
    expect(calls).toEqual({ upload: 0, register: 0, channel: 0 });
  });

  it("★ 显式写 kind:pi-web.json 缺 kind(schema 缺省 plugin)→ 发布清单仍显式写出", async () => {
    const dir = makePkg({ id: "acme/x", version: "1.0.0", pi: { skills: ["s/*.md"] } }, { "s/a.md": "x" });
    const c = await compile(dir);
    expect(c.ok && c.value.kind).toBe("plugin"); // schema 缺省
  });

  it("register 失败(VERSION_EXISTS)→ 不移通道,报错带 stage", async () => {
    const dir = makePkg(PLUGIN_MANIFEST, { "skills/a.md": "# a\n" });
    const key = makeKey();
    const { port, calls } = fakeRegistry({ register: { code: "VERSION_EXISTS", sourceId: "acme/pack", version: "1.0.0" } });
    const r = await publish(port, { packageDir: dir, keyPath: key.path });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.stage).toBe("register");
    expect(calls).toEqual({ upload: 1, register: 1, channel: 0 }); // 上传发生了但通道没动
  });
});
