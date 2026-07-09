/**
 * `ensureRuntime` 的集成单测（spec shared-runtime-payload 任务 3.4）。
 *
 * 用**合成小载荷**（3 个文件，含 1 个可执行文件与 1 个 >100 字符路径），使每个用例
 * 都在毫秒级完成。真实 86MB 载荷的格式正确性由 evidence/payload-format-verification.md
 * 与 e2e 覆盖，此处只验语义。
 */
import { createHash } from "node:crypto";
import {
  chmodSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { constants, createZstdCompress } from "node:zlib";
import { create as tarCreate } from "tar";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MARKER, RuntimeError, ensureRuntime, gcRuntimeRoot } from "../../src/runtime/unpack.src.mjs";

/** 155 字符量级的深路径，覆盖 ustar name 字段 100 字符上限。 */
const LONG_REL = `deep/${"segment-".repeat(12)}tail.js`;

let tmpRoot: string;
let payloadDir: string;
let runtimeRoot: string;

/** 造一棵 3 文件的源树 → 打成 zstd 载荷 → 写 payload.json。返回载荷摘要。 */
async function buildSyntheticPayload(version = "9.9.9", body = "hi"): Promise<string> {
  const srcParent = join(tmpRoot, "src");
  const distDir = join(srcParent, "dist");
  rmSync(srcParent, { recursive: true, force: true });
  mkdirSync(join(distDir, "deep"), { recursive: true });
  writeFileSync(join(distDir, "server.mjs"), `console.log('${body}')\n`);
  writeFileSync(join(distDir, "runner.sh"), "#!/bin/sh\necho ok\n");
  chmodSync(join(distDir, "runner.sh"), 0o755);
  writeFileSync(join(distDir, LONG_REL), "export const x = 1\n");

  const archivePath = join(payloadDir, "dist.tar.zst");
  const hash = createHash("sha256");
  let entries = 0;

  await pipeline(
    tarCreate(
      {
        cwd: srcParent,
        follow: true,
        portable: true,
        noMtime: true,
        onWriteEntry: (e) => {
          if (e.type === "File") entries += 1;
        },
      },
      ["dist"],
    ),
    createZstdCompress({ params: { [constants.ZSTD_c_compressionLevel]: 3 } }),
    async function* (source) {
      for await (const c of source) {
        hash.update(c);
        yield c;
      }
    },
    createWriteStream(archivePath),
  );

  const digest = hash.digest("hex");
  writeFileSync(
    join(payloadDir, "payload.json"),
    JSON.stringify({
      schema: 1,
      version,
      archive: "dist.tar.zst",
      compression: "zstd",
      algorithm: "sha256",
      digest,
      bytes: statSync(archivePath).size,
      entries,
      root: "dist",
    }),
  );
  return digest;
}

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), "pi-web-rt-"));
  payloadDir = join(tmpRoot, "payload");
  runtimeRoot = join(tmpRoot, "runtime");
  mkdirSync(payloadDir, { recursive: true });
  await buildSyntheticPayload();
});

afterEach(() => {
  // 只读目录的用例会让 rm 失败，先恢复权限。
  try {
    chmodSync(runtimeRoot, 0o755);
  } catch {
    /* 目录可能不存在 */
  }
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("ensureRuntime 首解与命中", () => {
  it("首次解包 unpacked=true，二次命中 unpacked=false", async () => {
    const digest = await buildSyntheticPayload();

    const first = await ensureRuntime({ payloadDir, runtimeRoot });
    expect(first.unpacked).toBe(true);
    expect(first.runtimeDir).toBe(`9.9.9-${digest.slice(0, 12)}`);
    expect(existsSync(first.serverJs)).toBe(true);

    const second = await ensureRuntime({ payloadDir, runtimeRoot });
    expect(second.unpacked).toBe(false);
    expect(second.distRoot).toBe(first.distRoot);
  });

  it("保留可执行位，并承载 >100 字符路径", async () => {
    const { distRoot } = await ensureRuntime({ payloadDir, runtimeRoot });
    expect(LONG_REL.length).toBeGreaterThan(100);
    expect(readFileSync(join(distRoot, LONG_REL), "utf8")).toContain("export const x");
    // eslint-disable-next-line no-bitwise
    expect(statSync(join(distRoot, "runner.sh")).mode & 0o111).toBeGreaterThan(0);
  });

  it("`.ok` 记录完整摘要，且 CLI 与桌面版同摘要 → 同一目录", async () => {
    const digest = await buildSyntheticPayload();
    const a = await ensureRuntime({ payloadDir, runtimeRoot });
    const b = await ensureRuntime({ payloadDir, runtimeRoot });
    expect(a.runtimeDir).toBe(b.runtimeDir);

    const marker = JSON.parse(readFileSync(join(runtimeRoot, a.runtimeDir, MARKER), "utf8"));
    expect(marker.digest).toBe(digest);
    expect(marker.entries).toBe(3);
  });

  it("不同摘要 → 不同目录，既有目录不被覆盖", async () => {
    await buildSyntheticPayload("9.9.9", "first");
    const first = await ensureRuntime({ payloadDir, runtimeRoot });

    await buildSyntheticPayload("9.9.9", "second"); // 同版本，内容不同 → 新摘要
    const second = await ensureRuntime({ payloadDir, runtimeRoot });

    expect(second.runtimeDir).not.toBe(first.runtimeDir);
    expect(second.unpacked).toBe(true);
    // 旧目录仍完好——这正是 dev 反复重建 dist 时不会命中陈旧运行时的保证。
    expect(existsSync(join(runtimeRoot, first.runtimeDir, MARKER))).toBe(true);
    expect(readFileSync(first.serverJs, "utf8")).toContain("first");
    expect(readFileSync(second.serverJs, "utf8")).toContain("second");
  });
});

describe("ensureRuntime 损坏与自愈", () => {
  it("target 存在但缺 `.ok` → 判为损坏并重新解包", async () => {
    const first = await ensureRuntime({ payloadDir, runtimeRoot });
    rmSync(join(runtimeRoot, first.runtimeDir, MARKER));

    const second = await ensureRuntime({ payloadDir, runtimeRoot });
    expect(second.unpacked).toBe(true);
    expect(existsSync(join(runtimeRoot, second.runtimeDir, MARKER))).toBe(true);
    expect(existsSync(second.serverJs)).toBe(true);
  });

  it("篡改归档一字节 → payload-corrupt，且不留下带 `.ok` 的目录", async () => {
    const archivePath = join(payloadDir, "dist.tar.zst");
    const buf = readFileSync(archivePath);
    const at = Math.floor(buf.length / 2);
    buf.writeUInt8(buf.readUInt8(at) ^ 0xff, at);
    writeFileSync(archivePath, buf);

    await expect(ensureRuntime({ payloadDir, runtimeRoot })).rejects.toMatchObject({
      code: "payload-corrupt",
    });

    // 关键后置条件：不存在任何带 `.ok` 的运行时目录，也没有 staging 残留。
    const names = existsSync(runtimeRoot) ? readdirSync(runtimeRoot) : [];
    for (const n of names) {
      expect(existsSync(join(runtimeRoot, n, MARKER))).toBe(false);
    }
    expect(names.filter((n) => n.startsWith(".staging-"))).toEqual([]);
  });

  it("载荷缺失 → payload-missing", async () => {
    rmSync(join(payloadDir, "dist.tar.zst"), { force: true });
    await expect(ensureRuntime({ payloadDir, runtimeRoot })).rejects.toMatchObject({
      code: "payload-missing",
    });
  });

  it("元数据缺失 → payload-missing", async () => {
    rmSync(join(payloadDir, "payload.json"), { force: true });
    await expect(ensureRuntime({ payloadDir, runtimeRoot })).rejects.toMatchObject({
      code: "payload-missing",
    });
  });

  it("运行时根不可写 → runtime-root-unwritable", async () => {
    mkdirSync(runtimeRoot, { recursive: true });
    chmodSync(runtimeRoot, 0o555);
    const err = await ensureRuntime({ payloadDir, runtimeRoot }).catch((e) => e);
    expect(err).toBeInstanceOf(RuntimeError);
    expect(err.code).toBe("runtime-root-unwritable");
  });

  it("持锁进程已死 → 立即接管，不空等 lockWaitMs", async () => {
    // ★ 回归防护：陈旧判据必须看**持有者是否存活**，而非锁的年龄。只看年龄的话，
    //   解包途中崩溃留下的锁在 10 分钟内都算「新鲜」，下次启动要空等满 lockWaitMs
    //   才报 lock-timeout —— 崩一次，应用两分钟起不来。实测踩过。
    const digest = await buildSyntheticPayload();
    mkdirSync(runtimeRoot, { recursive: true });
    const lockDir = join(runtimeRoot, `.lock-${digest.slice(0, 12)}`);
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(
      join(lockDir, "owner.json"),
      JSON.stringify({ pid: 4_194_303, host: hostname(), at: Date.now() }),
    );

    const startedAt = Date.now();
    const res = await ensureRuntime({ payloadDir, runtimeRoot, lockWaitMs: 30_000 });
    expect(res.unpacked).toBe(true);
    // 若退化为按年龄判断，这里会耗尽 30s 并抛 lock-timeout。
    expect(Date.now() - startedAt).toBeLessThan(5_000);
  });

  it("持锁进程仍存活 → 不接管，等待至超时", async () => {
    const digest = await buildSyntheticPayload();
    mkdirSync(runtimeRoot, { recursive: true });
    const lockDir = join(runtimeRoot, `.lock-${digest.slice(0, 12)}`);
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(
      join(lockDir, "owner.json"),
      JSON.stringify({ pid: process.pid, host: hostname(), at: Date.now() }),
    );

    await expect(ensureRuntime({ payloadDir, runtimeRoot, lockWaitMs: 600 })).rejects.toMatchObject({
      code: "lock-timeout",
    });
  });

  it("落盘文件数与元数据不符 → payload-corrupt，不落地", async () => {
    // ★ 回归防护：这道闸拦的是「摘要正确但写盘不全」。实测中 tar 默认把写盘错误当作
    //   可恢复 warning 丢掉，磁盘满时会写出残缺的树却一路「成功」到写 `.ok`。
    await buildSyntheticPayload();
    const metaPath = join(payloadDir, "payload.json");
    const meta = JSON.parse(readFileSync(metaPath, "utf8"));
    meta.entries = 999; // 谎报条目数，模拟落盘不全
    writeFileSync(metaPath, JSON.stringify(meta));

    await expect(ensureRuntime({ payloadDir, runtimeRoot })).rejects.toMatchObject({
      code: "payload-corrupt",
    });
    const names = existsSync(runtimeRoot) ? readdirSync(runtimeRoot) : [];
    for (const n of names) expect(existsSync(join(runtimeRoot, n, MARKER))).toBe(false);
    expect(names.filter((n) => n.startsWith(".staging-"))).toEqual([]);
  });

  it("锁被他人持有且始终无 `.ok` → lock-timeout", async () => {
    const digest = await buildSyntheticPayload();
    mkdirSync(runtimeRoot, { recursive: true });
    mkdirSync(join(runtimeRoot, `.lock-${digest.slice(0, 12)}`), { recursive: true });

    await expect(
      ensureRuntime({ payloadDir, runtimeRoot, lockWaitMs: 600 }),
    ).rejects.toMatchObject({ code: "lock-timeout" });
  });
});

describe("gcRuntimeRoot", () => {
  it("不删当前目录；不删命名形态不符的条目；异常不抛出", async () => {
    const cur = await ensureRuntime({ payloadDir, runtimeRoot });
    mkdirSync(join(runtimeRoot, "Documents"), { recursive: true });

    const report = await gcRuntimeRoot(runtimeRoot, cur.runtimeDir);
    expect(report.removed).toEqual([]);
    expect(existsSync(join(runtimeRoot, cur.runtimeDir, MARKER))).toBe(true);
    expect(existsSync(join(runtimeRoot, "Documents"))).toBe(true);
  });

  it("运行时根不存在时静默返回空报告", async () => {
    const report = await gcRuntimeRoot(join(tmpRoot, "nope"), "x");
    expect(report).toEqual({ removed: [], failed: [] });
  });

  it("回收超龄的 staging 残留", async () => {
    mkdirSync(join(runtimeRoot, ".staging-old-1-aa"), { recursive: true });
    const twoHoursAgo = Date.now() + 2 * 60 * 60 * 1000;
    const report = await gcRuntimeRoot(runtimeRoot, "", twoHoursAgo);
    expect(report.removed).toEqual([".staging-old-1-aa"]);
    expect(existsSync(join(runtimeRoot, ".staging-old-1-aa"))).toBe(false);
  });
});
