/**
 * publish 端到端(编译→签名→上传→登记→通道)—— 用真实临时包目录 + fake RegistryPort。
 * 覆盖:dry-run 零外部写、完整发布两步、commit-only、编译/签名错误、缺失声明路径、
 * 签名可被 registry 侧验签纯函数验证(任务 8.2 验收)。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateEd25519KeyPair, computeFingerprint, verifyManifest } from "@pi-clouds/registry-client";
import { publish } from "@/server/cli/publish/publish-orchestrator";
import { compile } from "@/server/cli/publish/manifest-compiler";
import { describeCompileError } from "@/server/cli/index";
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
    async downloadBundle() {
      return { ok: false, error: { code: "SOURCE_ABSENT", sourceId: "x" } };
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

  /**
   * ★ kind 契约(spec: publish-agent-entry-and-bundle,R4.1–R4.3)
   *
   * 本用例原先断言「缺 kind → schema 缺省 plugin → 发布清单仍显式写出」。该缺省已被**废除**:
   * pi-web 侧缺省 `plugin`、registry 侧 `deriveEffectiveKind` 缺省 `agent`,两侧相反 ⇒ 未声明
   * kind 的 agent 包会被发成 plugin,**发布成功但类型错**,运行时又按 agent 加载。
   * 现改为必填,消除推断本身。原意图(发布清单必须显式写出 kind)由第一条断言保留。
   */
  it("★ 显式写 kind:声明什么就编译出什么;缺 kind 则拒绝编译而非推断", async () => {
    const declared = makePkg({ id: "acme/x", version: "1.0.0", kind: "plugin", pi: { skills: ["s/*.md"] } }, { "s/a.md": "x" });
    const c = await compile(declared);
    expect(c.ok && c.value.kind).toBe("plugin");

    // 缺 kind → 专用错误码 + 列出可选取值(通用 MANIFEST_INVALID 无法告诉作者该填什么)
    const missing = makePkg({ id: "acme/x", version: "1.0.0", pi: { skills: ["s/*.md"] } }, { "s/a.md": "x" });
    const c2 = await compile(missing);
    expect(c2.ok).toBe(false);
    if (!c2.ok) {
      expect(c2.error.code).toBe("MANIFEST_KIND_REQUIRED");
      if (c2.error.code === "MANIFEST_KIND_REQUIRED") {
        expect(c2.error.allowed).toEqual(["agent", "plugin", "component"]);
      }
    }
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

/**
 * spec: publish-agent-entry-and-bundle —— 入口判定 / webext 通道 / 文件白名单。
 *
 * 共同前提:所有新增失败面都在 `compile()` 内,即**任何外部写之前** ⇒ 失败不消耗版本号。
 * 这是 #28 最痛的一点(每失败一次烧掉一个版本号)的结构性根治,故多条用例显式断言
 * `calls === {upload:0, register:0, channel:0}`。
 */
describe("publish — agent 入口与打包通道", () => {
  const AGENT = { id: "acme/a", version: "1.0.0", kind: "agent" as const };

  it("入口覆盖优先于约定,且 package.json 随包发布", async () => {
    const dir = makePkg(AGENT, {
      "index.ts": "// 约定入口(应被覆盖压过)",
      "src/agent.ts": "// 真入口",
      "package.json": JSON.stringify({ name: "a", "pi-web": { entry: "src/agent.ts" } }),
    });
    const c = await compile(dir);
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    expect(c.value.entry?.path).toBe("src/agent.ts");
    // package.json 必须入包:它是 entry 覆盖的唯一权威,不打包会导致安装后运行期
    // 回退到 index.ts,与发布期判定错位。
    expect(c.value.bundlePaths).toContain("package.json");
    expect(c.value.bundlePaths).toContain("src/agent.ts");
  });

  it("agent 无任何入口 → ENTRY_NOT_FOUND,且零外部写(不烧版本号)", async () => {
    const dir = makePkg(AGENT);
    const key = makeKey();
    const { port, calls } = fakeRegistry();
    const r = await publish(port, { packageDir: dir, keyPath: key.path });
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.stage === "compile") expect(r.error.error.code).toBe("ENTRY_NOT_FOUND");
    expect(calls).toEqual({ upload: 0, register: 0, channel: 0 });
  });

  it("入口覆盖指向包外 → ENTRY_OUTSIDE_PACKAGE,且零外部写", async () => {
    const dir = makePkg(AGENT, {
      "package.json": JSON.stringify({ name: "a", "pi-web": { entry: "../escape.ts" } }),
    });
    writeFileSync(join(dir, "..", "escape.ts"), "// 包外");
    const key = makeKey();
    const { port, calls } = fakeRegistry();
    const r = await publish(port, { packageDir: dir, keyPath: key.path });
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.stage === "compile") expect(r.error.error.code).toBe("ENTRY_OUTSIDE_PACKAGE");
    expect(calls).toEqual({ upload: 0, register: 0, channel: 0 });
  });

  it("演练模式施加与正式发布完全相同的编译期校验(否则演练即假演练)", async () => {
    const dir = makePkg(AGENT); // 无入口
    const key = makeKey();
    const dry = await publish(fakeRegistry().port, { packageDir: dir, keyPath: key.path, dryRun: true });
    const real = await publish(fakeRegistry().port, { packageDir: dir, keyPath: key.path });
    expect(dry.ok).toBe(false);
    expect(real.ok).toBe(false);
    if (!dry.ok && !real.ok && dry.error.stage === "compile" && real.error.stage === "compile") {
      expect(dry.error.error.code).toBe(real.error.error.code);
      expect(dry.error.error.code).toBe("ENTRY_NOT_FOUND");
    }
  });

  it("kind=plugin 即使存在 index.ts 也不产出 entry", async () => {
    const dir = makePkg({ id: "acme/p", version: "1.0.0", kind: "plugin" }, { "index.ts": "// x" });
    const c = await compile(dir);
    expect(c.ok && c.value.entry).toBeUndefined();
  });

  it("files 白名单:进 bundle 但不进 integrity 引用;零命中则失败", async () => {
    const dir = makePkg(
      { ...AGENT, files: ["routes/**/*.ts"] },
      { "index.ts": "// e", "routes/ping.ts": "// p", "routes/echo.ts": "// e" },
    );
    const c = await compile(dir);
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    expect(c.value.bundlePaths).toEqual(expect.arrayContaining(["routes/ping.ts", "routes/echo.ts"]));
    // 关键:白名单文件**不受完整性保护**(与 webext dist 非 manifest 文件同档)
    expect(c.value.refs.some((f) => f.path.startsWith("routes/"))).toBe(false);

    const empty = makePkg({ ...AGENT, files: ["nope/**/*.ts"] }, { "index.ts": "// e" });
    const c2 = await compile(empty);
    expect(c2.ok).toBe(false);
    if (!c2.ok) expect(c2.error.code).toBe("DECLARED_PATH_MISSING");
  });
});

describe("publish — webext 产物通道", () => {
  const AGENT = { id: "acme/w", version: "1.0.0", kind: "agent" as const };
  const DIST = ".pi/web/dist";
  const SRC = ".pi/web/web.config.tsx";

  it("未声明 web.dist 但存在约定产物 → 自动纳入(追平运行时语义)", async () => {
    const dir = makePkg(AGENT, {
      "index.ts": "// e",
      [`${DIST}/manifest.json`]: "{}",
      [`${DIST}/web-extension.mjs`]: "// x",
    });
    const c = await compile(dir);
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    expect(c.value.webextDist).toBe(DIST);
    expect(c.value.bundlePaths).toEqual(
      expect.arrayContaining([`${DIST}/manifest.json`, `${DIST}/web-extension.mjs`]),
    );
  });

  it("★ 有 webext 源却无产物 → 硬失败并给出构建命令(不再静默跳过)", async () => {
    // 这正是生产上 canvas 面板失效的成因:发布期静默跳过 ⇒ 包发出去 hasWebext:false,
    // registry 与 cloud 一路 fail-closed 到默认 UI,没有任何一环提示「这个包本该有面板」。
    const dir = makePkg(AGENT, { "index.ts": "// e", [SRC]: "// source" });
    const key = makeKey();
    const { port, calls } = fakeRegistry();
    const r = await publish(port, { packageDir: dir, keyPath: key.path });
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.stage === "compile") {
      expect(r.error.error.code).toBe("WEBEXT_SOURCE_WITHOUT_DIST");
      const rendered = describeCompileError(r.error.error);
      expect(rendered).toContain("build"); // 文案必须含可执行的构建指引,而非仅陈述缺失
      expect(rendered).toContain(SRC);
    }
    expect(calls).toEqual({ upload: 0, register: 0, channel: 0 });
  });

  it("产物早于源码 → 发布成功但产出陈旧告警(警告不阻断)", async () => {
    const dir = makePkg(AGENT, {
      "index.ts": "// e",
      [SRC]: "// source",
      [`${DIST}/manifest.json`]: "{}",
    });
    const old = new Date(Date.now() - 86_400_000);
    utimesSync(join(dir, DIST, "manifest.json"), old, old);
    const c = await compile(dir);
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    expect(c.value.warnings.length).toBeGreaterThan(0);
    expect(c.value.warnings[0]).toContain(DIST);
  });

  it("autoDetectDist:false → 跳过探测,且有源无产物也不失败", async () => {
    const dir = makePkg({ ...AGENT, web: { autoDetectDist: false } }, {
      "index.ts": "// e",
      [SRC]: "// source", // 有源
      [`${DIST}/manifest.json`]: "{}", // 也有产物,但显式关闭探测
    });
    const c = await compile(dir);
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    expect(c.value.webextDist).toBeUndefined();
    expect(c.value.warnings).toEqual([]);
  });

  it("显式声明 web.dist → 行为与变更前一致", async () => {
    const dir = makePkg({ ...AGENT, web: { dist: DIST } }, {
      "index.ts": "// e",
      [`${DIST}/manifest.json`]: "{}",
    });
    const c = await compile(dir);
    expect(c.ok && c.value.webextDist).toBe(DIST);
  });
});
