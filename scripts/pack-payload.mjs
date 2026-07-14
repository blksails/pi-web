/**
 * 由自包含产物 `dist/` 生成随包压缩载荷（spec shared-runtime-payload 任务 2.2）。
 *
 * 产出 `payload/dist.tar.zst` + `payload/payload.json`，两者随 npm 包与 .app 分发，
 * 首次启动时由 `payload/unpack.mjs` 解包到共享运行时目录。`dist/` 本身不再随包。
 *
 * ★ `follow: true` 是必需的，不是优化：`dist/node_modules/@blksails/pi-web-*` 是指向
 *   `../../packages/*` 的符号链接（POSIX 上）。载荷在 Ubuntu 上构建一次分发到三平台，
 *   若归档里留着符号链接，Windows 解包会重演既有的 realpath EPERM 坑。
 *   代价：`packages/*` 被复制一份 ⇒ 解包树比 `dist/` 多约 489 个文件 / 4MB。
 *
 * ★ 摘要取**载荷字节**而非内容树：内容树摘要要 hash 近万个文件，而字节摘要可在解包时
 *   边读边算，零额外 IO。它无法覆盖「归档正确但写盘出错」，由 `entries` 计数兜底。
 *
 * 压缩级别 19（实测 9.4MB / 打包 21s；级别 3 为 13.2MB / 1.2s）。21 秒是每次发布构建的
 * 一次性成本，3.8MB 是每次用户下载的重复成本。
 */
import { createHash } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { constants, createZstdCompress } from "node:zlib";
import { create as tarCreate } from "tar";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST_DIR_NAME = "dist";
const PAYLOAD_DIR = join(ROOT, "payload");
const ARCHIVE_NAME = "dist.tar.zst";
const ZSTD_LEVEL = 19;

async function main() {
  const distRoot = join(ROOT, DIST_DIR_NAME);
  const entryPath = join(distRoot, "server.mjs");
  if (!existsSync(entryPath)) {
    console.error(
      `[pack-payload] 未找到自包含产物入口 ${entryPath}\n` +
        "  请先执行 `pnpm build:dist`（本脚本消费它的产物）。",
    );
    process.exit(1);
  }

  const version = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8")).version;
  if (typeof version !== "string" || version === "") {
    console.error("[pack-payload] 根 package.json 缺少 version");
    process.exit(1);
  }

  mkdirSync(PAYLOAD_DIR, { recursive: true });
  const archivePath = join(PAYLOAD_DIR, ARCHIVE_NAME);
  rmSync(archivePath, { force: true });

  const hash = createHash("sha256");
  let fileEntries = 0;
  const startedAt = Date.now();

  await pipeline(
    tarCreate(
      {
        cwd: ROOT,
        // ★ 见文件头：符号链接必须展开成实体。
        follow: true,
        // 剥除 uid/gid/mtime，使同一输入在不同机器上产出尽量一致的字节流。
        portable: true,
        noMtime: true,
        onWriteEntry: (entry) => {
          if (entry.type === "File") fileEntries += 1;
        },
      },
      [DIST_DIR_NAME],
    ),
    createZstdCompress({ params: { [constants.ZSTD_c_compressionLevel]: ZSTD_LEVEL } }),
    // 摘要对**压缩后的字节流**取，与解包时的流式校验同口径。
    new Transform({
      transform(chunk, _enc, cb) {
        hash.update(chunk);
        cb(null, chunk);
      },
    }),
    createWriteStream(archivePath),
  );

  const digest = hash.digest("hex");
  const bytes = statSync(archivePath).size;

  const meta = {
    schema: 1,
    version,
    archive: ARCHIVE_NAME,
    compression: "zstd",
    algorithm: "sha256",
    digest,
    bytes,
    entries: fileEntries,
    root: DIST_DIR_NAME,
  };
  await writeFile(join(PAYLOAD_DIR, "payload.json"), `${JSON.stringify(meta, null, 2)}\n`);

  const mb = (n) => (n / 1048576).toFixed(1);
  console.log(
    `[pack-payload] ${ARCHIVE_NAME} ${mb(bytes)} MB（${fileEntries} 个文件条目，zstd-${ZSTD_LEVEL}，` +
      `${((Date.now() - startedAt) / 1000).toFixed(1)}s）\n` +
      `[pack-payload] sha256 ${digest.slice(0, 12)}… → 运行时目录 ${version}-${digest.slice(0, 12)}`,
  );
}

main().catch((err) => {
  console.error(`[pack-payload] 失败: ${err?.stack ?? err}`);
  process.exit(1);
});
