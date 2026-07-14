#!/usr/bin/env node
/**
 * 校验随包载荷与其元数据一致（spec shared-runtime-payload 任务 8.1，Req 11.3）。
 *
 * 载荷在 Ubuntu 上构建一次，作为工件分发给三平台的打包任务。任何一环（上传、下载、
 * 解压、Git LFS、换行转换）把字节动了，都必须在**打进安装包之前**炸掉，而不是等用户
 * 首次启动时才发现 `payload-corrupt`。
 *
 * 用法：`node scripts/verify-payload.mjs [payloadDir]`（默认仓库根的 `payload/`）
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const payloadDir = resolve(process.argv[2] ?? join(ROOT, "payload"));

function fail(msg) {
  console.error(`[verify-payload] ✗ ${msg}`);
  process.exit(1);
}

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

const metaPath = join(payloadDir, "payload.json");
let meta;
try {
  meta = JSON.parse(await readFile(metaPath, "utf8"));
} catch (err) {
  fail(`读取元数据失败 ${metaPath}: ${err.message}`);
}

for (const field of ["version", "archive", "digest", "algorithm", "bytes", "entries", "root"]) {
  if (meta[field] === undefined) fail(`元数据缺少字段 ${field}`);
}
if (meta.algorithm !== "sha256") fail(`不支持的摘要算法 ${meta.algorithm}`);

const archivePath = join(payloadDir, meta.archive);
const unpackerPath = join(payloadDir, "unpack.mjs");

const archiveStat = await stat(archivePath).catch(() => fail(`归档缺失 ${archivePath}`));
await stat(unpackerPath).catch(() => fail(`解包器缺失 ${unpackerPath}`));

if (archiveStat.size !== meta.bytes) {
  fail(`归档字节数不符：元数据 ${meta.bytes}，实际 ${archiveStat.size}`);
}

const actual = await sha256(archivePath);
if (actual !== meta.digest) {
  fail(`归档摘要不符：\n  期望 ${meta.digest}\n  实得 ${actual}`);
}

console.log(
  `[verify-payload] ✓ ${meta.archive} ${(meta.bytes / 1048576).toFixed(1)} MB / ` +
    `${meta.entries} 条目 / sha256 ${meta.digest.slice(0, 12)}…\n` +
    `[verify-payload] ✓ 运行时目录将是 ${meta.version}-${meta.digest.slice(0, 12)}`,
);
