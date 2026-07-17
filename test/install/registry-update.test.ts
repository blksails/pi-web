// @vitest-environment node
/**
 * registry-update(update 对齐补记,Req 4.8–4.10)—— `pi-web update` 的 registry 通道。
 * fake RegistryPort + 真实临时目录/tarball,不碰网络。覆盖:枚举回执、packageId 命中判别、
 * pinned 跳过(零网络调用)、已是最新跳过、版本跃迁真实重装 + 回执滚动、resolve 失败
 * 继续处理、registry 未配置逐项 failed。
 */
import { describe, it, expect, afterAll, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeIntegrity } from "@pi-clouds/registry-client";
import {
  listRegistryInstalls,
  findRegistryInstalls,
  updateRegistryInstalls,
} from "@/server/cli/install/registry-update";
import {
  readInstallReceipt,
  REGISTRY_RECEIPT_FILENAME,
  type RegistryInstallReceipt,
} from "@/server/cli/install/registry-install";
import type { RegistryPort, RegistryError, ResolvedRegistryEntry } from "@/server/cli/registry/registry-port";

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
const scratch = (): string => {
  const d = mkdtempSync(join(tmpdir(), "pi-upd-"));
  dirs.push(d);
  return d;
};

/** 在 root 下植入一个带回执的安装目录。 */
function plantInstall(root: string, dirName: string, receipt: RegistryInstallReceipt): string {
  const dir = join(root, dirName);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, REGISTRY_RECEIPT_FILENAME), JSON.stringify(receipt));
  return dir;
}

/** 把 {path: content} 打成 gzip tarball 字节(与 registry-install.test 同一 helper 形态)。 */
function makeTarball(files: Record<string, string>): Uint8Array {
  const stage = mkdtempSync(join(tmpdir(), "pi-upd-tar-"));
  dirs.push(stage);
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(join(stage, p, ".."), { recursive: true });
    writeFileSync(join(stage, p), c);
  }
  const tgz = join(mkdtempSync(join(tmpdir(), "pi-upd-tgz-")), "b.tgz");
  dirs.push(join(tgz, ".."));
  execFileSync("tar", ["-czf", tgz, "-C", stage, "."]);
  return new Uint8Array(readFileSync(tgz));
}

/** fake RegistryPort:resolve/downloadBundle 可编程,记录调用。 */
function fakeRegistry(cfg: {
  resolve?: (sourceId: string, opts?: { channel?: string; version?: string }) =>
    | { ok: true; value: ResolvedRegistryEntry }
    | { ok: false; error: RegistryError };
  bundleBytes?: Uint8Array;
}) {
  const resolveSpy = vi.fn(async (sourceId: string, opts?: { channel?: string; version?: string }) =>
    cfg.resolve!(sourceId, opts),
  );
  const port: RegistryPort = {
    resolve: resolveSpy,
    async downloadBundle() {
      return { ok: true, value: cfg.bundleBytes! };
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
  return { port, resolveSpy };
}

const resolvedEntry = (version: string, manifest: Record<string, unknown>): ResolvedRegistryEntry => ({
  sourceId: "acme/pack",
  version,
  origin: { type: "oss", bundle: "b" },
  manifest: { ...manifest, signature: "s" },
});

describe("listRegistryInstalls / findRegistryInstalls", () => {
  it("根不存在 → 空列表;混合内容只取带有效回执的子目录", () => {
    expect(listRegistryInstalls(join(scratch(), "ghost"))).toEqual([]);

    const root = scratch();
    plantInstall(root, "acme_pack", { sourceId: "acme/pack", version: "1.0.0" });
    mkdirSync(join(root, "no-receipt")); // 无回执目录:不属于本通道
    writeFileSync(join(root, "stray-file"), "x"); // 非目录
    const entries = listRegistryInstalls(root);
    expect(entries.map((e) => e.receipt.sourceId)).toEqual(["acme/pack"]);
  });

  it("findRegistryInstalls:按 sourceId 或 sanitize 后目录名命中", () => {
    const root = scratch();
    plantInstall(root, "acme_pack", { sourceId: "acme/pack", version: "1.0.0" });
    plantInstall(root, "other_pkg", { sourceId: "other/pkg", version: "2.0.0" });
    const entries = listRegistryInstalls(root);

    expect(findRegistryInstalls(entries, "acme/pack").map((e) => e.receipt.sourceId)).toEqual(["acme/pack"]);
    // 目录名匹配:packageId 经同一 sanitize 规则(/ → _)后与目录名一致也命中
    expect(findRegistryInstalls(entries, "other/pkg")).toHaveLength(1);
    expect(findRegistryInstalls(entries, "nobody/home")).toEqual([]);
  });
});

describe("updateRegistryInstalls", () => {
  it("★ pinned 安装 → skipped(带原因),不发起任何 resolve", async () => {
    const root = scratch();
    plantInstall(root, "acme_pack", { sourceId: "acme/pack", version: "1.0.0", pinnedVersion: "1.0.0" });
    const { port, resolveSpy } = fakeRegistry({ resolve: () => ({ ok: true, value: resolvedEntry("2.0.0", {}) }) });

    const res = await updateRegistryInstalls(port, listRegistryInstalls(root));
    expect(res.hasFailures).toBe(false);
    expect(res.outcomes).toHaveLength(1);
    expect(res.outcomes[0]!.status).toBe("skipped");
    expect(res.outcomes[0]!.reason).toContain("钉死");
    expect(resolveSpy).not.toHaveBeenCalled();
  });

  it("★ registry 未配置但存在本通道安装 → 逐项 failed(不静默掠过)", async () => {
    const root = scratch();
    plantInstall(root, "acme_pack", { sourceId: "acme/pack", version: "1.0.0" });

    const res = await updateRegistryInstalls(undefined, listRegistryInstalls(root));
    expect(res.hasFailures).toBe(true);
    expect(res.outcomes[0]!.status).toBe("failed");
    expect(res.outcomes[0]!.reason).toContain("PI_WEB_REGISTRY_URL");
  });

  it("channel 指向与回执版本相同 → skipped 已是最新;resolve 收到回执的 channel", async () => {
    const root = scratch();
    plantInstall(root, "acme_pack", { sourceId: "acme/pack", version: "1.0.0", channel: "beta" });
    const { port, resolveSpy } = fakeRegistry({ resolve: () => ({ ok: true, value: resolvedEntry("1.0.0", {}) }) });

    const res = await updateRegistryInstalls(port, listRegistryInstalls(root));
    expect(res.hasFailures).toBe(false);
    expect(res.outcomes[0]!.status).toBe("skipped");
    expect(res.outcomes[0]!.reason).toContain("已是最新");
    expect(resolveSpy).toHaveBeenCalledWith("acme/pack", { channel: "beta" });
  });

  it("★ channel 前移 → 真实重装:落盘内容更新、回执滚动到新版本、outcome 记录版本跃迁", async () => {
    const root = scratch();
    const v1 = "# v1\n";
    const dir = plantInstall(root, "acme_pack", { sourceId: "acme/pack", version: "1.0.0", channel: "stable" });
    writeFileSync(join(dir, "skill.md"), v1); // 旧内容

    const v2 = "# v2\n";
    const bundle = makeTarball({ "skill.md": v2 });
    const manifest = { skills: [{ path: "skill.md", integrity: computeIntegrity(Buffer.from(v2)) }] };
    const { port } = fakeRegistry({
      resolve: () => ({ ok: true, value: resolvedEntry("2.0.0", manifest) }),
      bundleBytes: bundle,
    });

    const res = await updateRegistryInstalls(port, listRegistryInstalls(root));
    expect(res.hasFailures).toBe(false);
    expect(res.outcomes[0]).toEqual({ id: "acme/pack", status: "updated", reason: "1.0.0 → 2.0.0" });
    expect(readFileSync(join(dir, "skill.md"), "utf8")).toBe(v2);
    // 回执滚动:version 前移到 2.0.0,channel 保留,无 pinnedVersion
    expect(readInstallReceipt(dir)).toEqual({ sourceId: "acme/pack", version: "2.0.0", channel: "stable" });
  });

  it("★ resolve 失败 → failed,继续处理其余条目,hasFailures=true(Req 4.7 精神)", async () => {
    const root = scratch();
    plantInstall(root, "bad_pack", { sourceId: "bad/pack", version: "1.0.0" });
    plantInstall(root, "good_pack", { sourceId: "good/pack", version: "1.0.0" });
    const { port } = fakeRegistry({
      resolve: (sourceId) =>
        sourceId === "bad/pack"
          ? { ok: false, error: { code: "SOURCE_ABSENT", sourceId } }
          : { ok: true, value: { ...resolvedEntry("1.0.0", {}), sourceId } },
    });

    const res = await updateRegistryInstalls(port, listRegistryInstalls(root));
    expect(res.hasFailures).toBe(true);
    expect(res.outcomes.map((o) => [o.id, o.status])).toEqual([
      ["bad/pack", "failed"],
      ["good/pack", "skipped"], // 失败不中断:第二个条目照常处理
    ]);
  });
});
