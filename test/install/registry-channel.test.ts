/**
 * registry-channel(spec installer-registry-channel,任务 1.3)。
 *
 * 用真实 tarball + 进程内 `RegistryPort` 夹具,不触网。重点覆盖三件在设计里被反复强调的事:
 *  1. **清单 kind 是权威**——`expectedKind` 只能校验,不能覆盖它;
 *  2. **kind 门在下载之前**——错配时 `downloadBundle` 必须**零调用**(夹具计数断言);
 *  3. **缺省值不可猜**——清单缺 kind 一律 `MANIFEST_KIND_UNKNOWN`(两侧缺省相反)。
 */
import { describe, it, expect, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeIntegrity } from "@pi-clouds/registry-client";
import { createRegistryChannel, parseRegistrySpec, readManifestKind } from "@/server/cli/install/registry-channel";
import { REGISTRY_RECEIPT_FILENAME } from "@/server/cli/install/registry-install";
import type { RegistryPort, RegistryError, SignedManifest } from "@/server/cli/registry/registry-port";

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
const scratch = (prefix = "pi-regch-"): string => {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
};

function makeTarball(files: Record<string, string>): Uint8Array {
  const stage = scratch("pi-regch-tar-");
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(join(stage, p, ".."), { recursive: true });
    writeFileSync(join(stage, p), c);
  }
  const tgz = join(scratch("pi-regch-tgz-"), "b.tgz");
  execFileSync("tar", ["-czf", tgz, "-C", stage, "."]);
  return new Uint8Array(readFileSync(tgz));
}

const ENTRY_CONTENT = "export default {};\n";

/** 一份自洽的清单 + bundle:entry 的 integrity 与真实字节匹配,复核必过。 */
function fixture(kind: string | undefined): {
  manifest: SignedManifest;
  bundle: Uint8Array;
} {
  const files = { "index.ts": ENTRY_CONTENT };
  return {
    manifest: {
      ...(kind !== undefined ? { kind } : {}),
      entry: {
        path: "index.ts",
        integrity: computeIntegrity(new TextEncoder().encode(ENTRY_CONTENT)),
      },
    },
    bundle: makeTarball(files),
  };
}

interface FakeRegistry {
  port: RegistryPort;
  /** downloadBundle 被调用的次数 —— 「kind 门在下载之前」的可执行证据。 */
  downloads: () => number;
}

function fakeRegistry(cfg: {
  manifest?: SignedManifest;
  bundle?: Uint8Array;
  resolveErr?: RegistryError;
}): FakeRegistry {
  let downloads = 0;
  const port: RegistryPort = {
    async resolve(sourceId) {
      if (cfg.resolveErr) return { ok: false, error: cfg.resolveErr };
      return {
        ok: true,
        value: {
          sourceId,
          version: "1.2.3",
          origin: { type: "oss", bundle: "sha256-fake-key" },
          manifest: cfg.manifest!,
        },
      };
    },
    async downloadBundle() {
      downloads += 1;
      return { ok: true, value: cfg.bundle! };
    },
    async uploadBundle() {
      throw new Error("not used");
    },
    async registerVersion() {
      throw new Error("not used");
    },
    async setChannel() {
      throw new Error("not used");
    },
  };
  return { port, downloads: () => downloads };
}

function channelFor(reg: FakeRegistry | undefined, agentRoot: string, pluginRoot?: string) {
  return createRegistryChannel({
    getRegistry: async () => reg?.port,
    agentTargetRoot: agentRoot,
    pluginTargetRoot: pluginRoot ?? join(agentRoot, "__plugins"),
  });
}

describe("parseRegistrySpec", () => {
  it("裸标识(命令面主用法)可解析,并补上默认 channel", () => {
    // channel 恒有值:裸标识补默认 "stable" —— 服务端不接受两者皆缺的 resolve。
    expect(parseRegistrySpec("acme/hello-cloud")).toEqual({
      sourceId: "acme/hello-cloud",
      channel: "stable",
    });
  });

  it("带 channel 的标识拆成 id + channel", () => {
    expect(parseRegistrySpec("acme/hello-cloud@stable")).toEqual({
      sourceId: "acme/hello-cloud",
      channel: "stable",
    });
  });

  it("路径穿越形态被拒(字符集校验复用 isValidSourceId)", () => {
    expect(parseRegistrySpec("../evil")).toBeUndefined();
    expect(parseRegistrySpec("a/../b")).toBeUndefined();
    expect(parseRegistrySpec("")).toBeUndefined();
  });
});

describe("readManifestKind", () => {
  it("只认三个合法取值,其余一律 undefined(不猜缺省)", () => {
    expect(readManifestKind({ kind: "agent" })).toBe("agent");
    expect(readManifestKind({ kind: "plugin" })).toBe("plugin");
    expect(readManifestKind({ kind: "component" })).toBe("component");
    expect(readManifestKind({})).toBeUndefined();
    expect(readManifestKind({ kind: "AGENT" })).toBeUndefined();
    expect(readManifestKind({ kind: 42 })).toBeUndefined();
  });
});

describe("createRegistryChannel · kind 门", () => {
  it("清单 kind 与 expectedKind 不符 → KIND_MISMATCH,且**零下载**", async () => {
    const f = fixture("plugin");
    const reg = fakeRegistry({ manifest: f.manifest, bundle: f.bundle });
    const res = await channelFor(reg, scratch()).materialize("acme/x", { expectedKind: "agent" });

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toEqual({ code: "KIND_MISMATCH", actual: "plugin", expected: "agent" });
    // 拒绝路径不应触碰网络下载 —— 这是本设计「kind 门前置」的可执行证据。
    expect(reg.downloads()).toBe(0);
  });

  it("清单缺 kind → MANIFEST_KIND_UNKNOWN(两侧缺省相反,不可推断)", async () => {
    const f = fixture(undefined);
    const reg = fakeRegistry({ manifest: f.manifest, bundle: f.bundle });
    const res = await channelFor(reg, scratch()).materialize("acme/x", {});

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("MANIFEST_KIND_UNKNOWN");
    expect(reg.downloads()).toBe(0);
  });

  it("清单 kind=component → KIND_COMPONENT_UNSUPPORTED", async () => {
    const f = fixture("component");
    const reg = fakeRegistry({ manifest: f.manifest, bundle: f.bundle });
    const res = await channelFor(reg, scratch()).materialize("acme/x", {});

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("KIND_COMPONENT_UNSUPPORTED");
  });

  it("不给 expectedKind 时,清单说什么就是什么(CLI 无 --kind 的场景)", async () => {
    const f = fixture("plugin");
    const reg = fakeRegistry({ manifest: f.manifest, bundle: f.bundle });
    const res = await channelFor(reg, scratch(), scratch()).materialize("acme/x", {});

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.kind).toBe("plugin");
  });
});

describe("createRegistryChannel · 落点", () => {
  it("agent 落到 agentTargetRoot 内,并带上回执", async () => {
    const f = fixture("agent");
    const reg = fakeRegistry({ manifest: f.manifest, bundle: f.bundle });
    const root = scratch();
    const res = await channelFor(reg, root).materialize("acme/hello-cloud", {
      expectedKind: "agent",
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.dir).toBe(join(root, "acme_hello-cloud"));
    expect(res.value.version).toBe("1.2.3");
    expect(res.value.verifiedFiles).toBe(1);
    expect(existsSync(join(res.value.dir, REGISTRY_RECEIPT_FILENAME))).toBe(true);
    expect(readFileSync(join(res.value.dir, "index.ts"), "utf8")).toBe(ENTRY_CONTENT);
  });

  it("plugin 落到 pluginTargetRoot(与 agent 扫描根分开),且是长期位置", async () => {
    const f = fixture("plugin");
    const reg = fakeRegistry({ manifest: f.manifest, bundle: f.bundle });
    const agentRoot = scratch();
    const pluginRoot = scratch();
    const res = await channelFor(reg, agentRoot, pluginRoot).materialize("acme/some-plugin", {
      expectedKind: "plugin",
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.dir).toBe(join(pluginRoot, "acme_some-plugin"));
    // 关键:plugin 绝不能落进 agent 扫描根,否则会被源枚举当成 agent 源列出来。
    expect(res.value.dir.startsWith(agentRoot)).toBe(false);
    expect(existsSync(join(res.value.dir, "index.ts"))).toBe(true);
    // 回执两种 kind 都写(pi 只记路径不拷内容,故回执随目录长期存在)。
    expect(existsSync(join(res.value.dir, REGISTRY_RECEIPT_FILENAME))).toBe(true);
  });

  it("目标目录已存在且非本通道安装 → TARGET_OCCUPIED,不覆盖", async () => {
    const f = fixture("agent");
    const reg = fakeRegistry({ manifest: f.manifest, bundle: f.bundle });
    const root = scratch();
    const occupied = join(root, "acme_hello-cloud");
    mkdirSync(occupied, { recursive: true });
    writeFileSync(join(occupied, "mine.txt"), "用户手放的目录");

    const res = await channelFor(reg, root).materialize("acme/hello-cloud", {});

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toEqual({ code: "TARGET_OCCUPIED", dir: occupied });
    // 原内容必须原封不动。
    expect(readFileSync(join(occupied, "mine.txt"), "utf8")).toBe("用户手放的目录");
  });
});

describe("createRegistryChannel · 失败归一", () => {
  it("取不到 RegistryPort → NOT_AUTHENTICATED,且不做任何解析", async () => {
    const res = await channelFor(undefined, scratch()).materialize("acme/x", {});
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("NOT_AUTHENTICATED");
  });

  it("registry 报 SOURCE_ABSENT → NOT_FOUND", async () => {
    const reg = fakeRegistry({ resolveErr: { code: "SOURCE_ABSENT", sourceId: "acme/x" } });
    const res = await channelFor(reg, scratch()).materialize("acme/x", {});
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toEqual({ code: "NOT_FOUND", sourceId: "acme/x" });
  });

  it("registry 不可达 → RESOLVE_FAILED/unreachable(不谎称未登录),且**不泄露底层 detail**", async () => {
    const reg = fakeRegistry({
      resolveErr: {
        code: "UNREACHABLE",
        baseUrl: "https://reg.example.com",
        detail: "https://reg.example.com?token=SUPER_SECRET",
      },
    });
    const res = await channelFor(reg, scratch()).materialize("acme/x", {});
    expect(res.ok).toBe(false);
    if (res.ok) return;
    // ★ 真机实测教训:早先这里归一为 GRANT_UNAVAILABLE(「登录已过期」),会把用户引向
    //   完全错误的排查方向。现按语义分开。
    expect(res.error).toEqual({ code: "RESOLVE_FAILED", reason: "unreachable" });
    // 凭据卫生:归一后的错误对象里不得出现任何底层文本。
    expect(JSON.stringify(res.error)).not.toContain("SUPER_SECRET");
  });

  it("无权访问(FORBIDDEN)→ GRANT_UNAVAILABLE(这才是真的授予问题)", async () => {
    const reg = fakeRegistry({ resolveErr: { code: "FORBIDDEN", detail: "no access" } });
    const res = await channelFor(reg, scratch()).materialize("acme/x", {});
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toEqual({ code: "GRANT_UNAVAILABLE" });
  });

  it("标识形态非法 → NOT_FOUND(不泄露解析细节)", async () => {
    const f = fixture("agent");
    const reg = fakeRegistry({ manifest: f.manifest, bundle: f.bundle });
    const res = await channelFor(reg, scratch()).materialize("../evil", {});
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("NOT_FOUND");
  });
});
