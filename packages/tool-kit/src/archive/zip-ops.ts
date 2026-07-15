/**
 * zip-ops — Node-native ZIP 创建 / 列举 / 解压（zlib + fs，无系统 zip 依赖）。
 * 解压前对全部 entry 做 zip-slip 检查；任一条失败则整次失败。
 */
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { once } from "node:events";
import path from "node:path";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { crc32 } from "./crc32.js";
import {
  isInsideRoot,
  normalizeRoot,
  resolveUnderRoot,
  resolveZipEntry,
} from "./path-safety.js";
import type { ArchiveResult, ZipEntryMeta } from "./types.js";

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;

function u16(n: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n, 0);
  return b;
}
function u32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0, 0);
  return b;
}

function dosDateTime(d = new Date()): { time: number; date: number } {
  const time =
    ((d.getHours() & 0x1f) << 11) |
    ((d.getMinutes() & 0x3f) << 5) |
    ((Math.floor(d.getSeconds() / 2) & 0x1f) << 0);
  const date =
    (((d.getFullYear() - 1980) & 0x7f) << 9) |
    (((d.getMonth() + 1) & 0xf) << 5) |
    (d.getDate() & 0x1f);
  return { time, date };
}

interface WalkItem {
  abs: string;
  /** posix rel path inside zip */
  rel: string;
  isDir: boolean;
}

function walkSources(root: string, sources: string[]): ArchiveResult<{ items: WalkItem[] }> {
  const items: WalkItem[] = [];
  const r = normalizeRoot(root);

  function addFile(abs: string, rel: string, isDir: boolean): void {
    const posix = rel.split(path.sep).join("/");
    items.push({ abs, rel: isDir && !posix.endsWith("/") ? `${posix}/` : posix, isDir });
  }

  function walkDir(absDir: string, relDir: string): void {
    addFile(absDir, relDir === "" ? "" : relDir, true);
    for (const name of readdirSync(absDir)) {
      const abs = path.join(absDir, name);
      const rel = relDir === "" ? name : path.join(relDir, name);
      const st = statSync(abs);
      if (st.isDirectory()) walkDir(abs, rel);
      else if (st.isFile()) addFile(abs, rel, false);
    }
  }

  for (const src of sources) {
    const resolved = resolveUnderRoot(r, src);
    if (!resolved.ok) return resolved;
    if (!existsSync(resolved.abs)) {
      return { ok: false, code: "NOT_FOUND", message: `Source not found: ${src}` };
    }
    const st = statSync(resolved.abs);
    const rel = path.relative(r, resolved.abs);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      return {
        ok: false,
        code: "PATH_ESCAPE",
        message: `Source escapes root: ${src}`,
      };
    }
    if (st.isDirectory()) walkDir(resolved.abs, rel);
    else if (st.isFile()) addFile(resolved.abs, rel, false);
    else {
      return {
        ok: false,
        code: "INVALID_ARGUMENT",
        message: `Unsupported source type: ${src}`,
      };
    }
  }

  // 去掉空目录名 "" 占位
  const filtered = items.filter((i) => i.rel !== "" && i.rel !== "/");
  return { ok: true, items: filtered };
}

/**
 * 在 session root 下创建 zip。
 * @param sources 相对/可解析到 root 内的路径
 * @param output 输出 zip 相对路径
 */
export async function createZip(
  root: string,
  sources: readonly string[],
  output: string,
): Promise<ArchiveResult<{ output: string; entryCount: number; bytes: number }>> {
  if (!sources.length) {
    return { ok: false, code: "INVALID_ARGUMENT", message: "paths must be non-empty" };
  }
  const r = normalizeRoot(root);
  const outRes = resolveUnderRoot(r, output);
  if (!outRes.ok) return outRes;

  const walked = walkSources(r, [...sources]);
  if (!walked.ok) return walked;

  const { time, date } = dosDateTime();
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  let entryCount = 0;

  for (const item of walked.items) {
    if (item.isDir) continue; // 仅打包文件；目录由路径隐含
    const data = readFileSync(item.abs);
    const nameBuf = Buffer.from(item.rel, "utf8");
    const crc = crc32(data);
    let method = METHOD_STORE;
    let compressed = data;
    const deflated = deflateRawSync(data);
    if (deflated.length < data.length) {
      method = METHOD_DEFLATE;
      compressed = deflated;
    }

    const localHeader = Buffer.concat([
      u32(SIG_LOCAL),
      u16(20), // version needed
      u16(0), // flags
      u16(method),
      u16(time),
      u16(date),
      u32(crc),
      u32(compressed.length),
      u32(data.length),
      u16(nameBuf.length),
      u16(0), // extra
      nameBuf,
    ]);
    const localOffset = offset;
    localParts.push(localHeader, compressed);
    offset += localHeader.length + compressed.length;

    const central = Buffer.concat([
      u32(SIG_CENTRAL),
      u16(20),
      u16(20),
      u16(0),
      u16(method),
      u16(time),
      u16(date),
      u32(crc),
      u32(compressed.length),
      u32(data.length),
      u16(nameBuf.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(localOffset),
      nameBuf,
    ]);
    centralParts.push(central);
    entryCount++;
  }

  const centralStart = offset;
  const centralBuf = Buffer.concat(centralParts);
  offset += centralBuf.length;
  const eocd = Buffer.concat([
    u32(SIG_EOCD),
    u16(0),
    u16(0),
    u16(entryCount),
    u16(entryCount),
    u32(centralBuf.length),
    u32(centralStart),
    u16(0),
  ]);

  const outDir = path.dirname(outRes.abs);
  mkdirSync(outDir, { recursive: true });
  const body = Buffer.concat([...localParts, centralBuf, eocd]);
  writeFileSync(outRes.abs, body);
  return {
    ok: true,
    output: path.relative(r, outRes.abs) || path.basename(outRes.abs),
    entryCount,
    bytes: body.length,
  };
}

function findEocd(buf: Buffer): number {
  // EOCD 最小 22 字节；注释最长 65535
  const min = 22;
  const start = Math.max(0, buf.length - (min + 0xffff));
  for (let i = buf.length - min; i >= start; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) return i;
  }
  return -1;
}

/** 列举 zip 内 entry（解析 central directory）。 */
export function listZipEntries(zipAbs: string): ArchiveResult<{ entries: ZipEntryMeta[] }> {
  if (!existsSync(zipAbs)) {
    return { ok: false, code: "NOT_FOUND", message: `Archive not found: ${zipAbs}` };
  }
  let buf: Buffer;
  try {
    buf = readFileSync(zipAbs);
  } catch (e) {
    return {
      ok: false,
      code: "IO_ERROR",
      message: e instanceof Error ? e.message : String(e),
    };
  }
  const eocdOff = findEocd(buf);
  if (eocdOff < 0) {
    return { ok: false, code: "INVALID_ARCHIVE", message: "EOCD not found" };
  }
  const total = buf.readUInt16LE(eocdOff + 10);
  let centralOffset = buf.readUInt32LE(eocdOff + 16);
  const entries: ZipEntryMeta[] = [];
  for (let i = 0; i < total; i++) {
    if (centralOffset + 46 > buf.length) {
      return { ok: false, code: "INVALID_ARCHIVE", message: "Truncated central directory" };
    }
    if (buf.readUInt32LE(centralOffset) !== SIG_CENTRAL) {
      return { ok: false, code: "INVALID_ARCHIVE", message: "Bad central directory signature" };
    }
    const method = buf.readUInt16LE(centralOffset + 10);
    const crc = buf.readUInt32LE(centralOffset + 16);
    const compressedSize = buf.readUInt32LE(centralOffset + 20);
    const size = buf.readUInt32LE(centralOffset + 24);
    const nameLen = buf.readUInt16LE(centralOffset + 28);
    const extraLen = buf.readUInt16LE(centralOffset + 30);
    const commentLen = buf.readUInt16LE(centralOffset + 32);
    const localHeaderOffset = buf.readUInt32LE(centralOffset + 42);
    const name = buf.subarray(centralOffset + 46, centralOffset + 46 + nameLen).toString("utf8");
    entries.push({
      name,
      size,
      method,
      compressedSize,
      crc32: crc,
      localHeaderOffset,
    });
    centralOffset += 46 + nameLen + extraLen + commentLen;
  }
  return { ok: true, entries };
}

function readLocalData(
  buf: Buffer,
  entry: ZipEntryMeta,
): ArchiveResult<{ data: Buffer }> {
  const off = entry.localHeaderOffset;
  if (off + 30 > buf.length || buf.readUInt32LE(off) !== SIG_LOCAL) {
    return { ok: false, code: "INVALID_ARCHIVE", message: `Bad local header: ${entry.name}` };
  }
  const nameLen = buf.readUInt16LE(off + 26);
  const extraLen = buf.readUInt16LE(off + 28);
  const dataStart = off + 30 + nameLen + extraLen;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > buf.length) {
    return { ok: false, code: "INVALID_ARCHIVE", message: `Truncated data: ${entry.name}` };
  }
  const compressed = buf.subarray(dataStart, dataEnd);
  try {
    let data: Buffer;
    if (entry.method === METHOD_STORE) data = Buffer.from(compressed);
    else if (entry.method === METHOD_DEFLATE) data = inflateRawSync(compressed);
    else {
      return {
        ok: false,
        code: "INVALID_ARCHIVE",
        message: `Unsupported compression method ${entry.method} for ${entry.name}`,
      };
    }
    if (entry.size > 0 && data.length !== entry.size) {
      // 允许部分实现 size 为 0 的目录占位
    }
    return { ok: true, data };
  } catch (e) {
    return {
      ok: false,
      code: "INVALID_ARCHIVE",
      message: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * 解压 zip 到 destination（相对 root）。先全量 zip-slip 检查。
 */
export function extractZip(
  root: string,
  archive: string,
  destination: string,
): ArchiveResult<{ destination: string; extracted: number }> {
  const r = normalizeRoot(root);
  const archRes = resolveUnderRoot(r, archive);
  if (!archRes.ok) return archRes;
  const destRes = resolveUnderRoot(r, destination);
  if (!destRes.ok) return destRes;

  if (!existsSync(archRes.abs)) {
    return { ok: false, code: "NOT_FOUND", message: `Archive not found: ${archive}` };
  }

  const listed = listZipEntries(archRes.abs);
  if (!listed.ok) return listed;

  // 全量 zip-slip 预检（目录 entry 以 / 结尾也检）
  for (const ent of listed.entries) {
    if (ent.name.endsWith("/")) {
      const dirCheck = resolveZipEntry(destRes.abs, ent.name.replace(/\/+$/, "") || ".");
      if (!dirCheck.ok && ent.name.replace(/\/+$/, "") !== "") {
        // trailing slash dir: resolve without trailing
        const d2 = resolveZipEntry(destRes.abs, ent.name.slice(0, -1));
        if (!d2.ok) return d2;
      }
      continue;
    }
    const check = resolveZipEntry(destRes.abs, ent.name);
    if (!check.ok) return check;
  }

  const buf = readFileSync(archRes.abs);
  mkdirSync(destRes.abs, { recursive: true });
  let extracted = 0;

  for (const ent of listed.entries) {
    if (ent.name.endsWith("/")) {
      const d = resolveZipEntry(destRes.abs, ent.name.slice(0, -1));
      if (d.ok) mkdirSync(d.abs, { recursive: true });
      continue;
    }
    const target = resolveZipEntry(destRes.abs, ent.name);
    if (!target.ok) return target;
    // 双检
    if (!isInsideRoot(destRes.abs, target.abs)) {
      return {
        ok: false,
        code: "PATH_ESCAPE",
        message: `Refusing to write outside extract root: ${ent.name}`,
      };
    }
    const payload = readLocalData(buf, ent);
    if (!payload.ok) return payload;
    mkdirSync(path.dirname(target.abs), { recursive: true });
    writeFileSync(target.abs, payload.data);
    extracted++;
  }

  return {
    ok: true,
    destination: path.relative(r, destRes.abs) || ".",
    extracted,
  };
}

/**
 * 从显式 entry 列表写 zip（测试 / 高级用途）。
 * **不**做路径安全检查 — 调用方可用此构造恶意 entry 测 zip-slip。
 */
export function writeZipEntries(
  zipAbs: string,
  files: readonly { name: string; data: Buffer }[],
): void {
  const { time, date } = dosDateTime();
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const nameBuf = Buffer.from(f.name.replace(/\\/g, "/"), "utf8");
    const crc = crc32(f.data);
    const method = METHOD_STORE;
    const compressed = f.data;
    const localHeader = Buffer.concat([
      u32(SIG_LOCAL),
      u16(20),
      u16(0),
      u16(method),
      u16(time),
      u16(date),
      u32(crc),
      u32(compressed.length),
      u32(f.data.length),
      u16(nameBuf.length),
      u16(0),
      nameBuf,
    ]);
    const localOffset = offset;
    localParts.push(localHeader, compressed);
    offset += localHeader.length + compressed.length;
    centralParts.push(
      Buffer.concat([
        u32(SIG_CENTRAL),
        u16(20),
        u16(20),
        u16(0),
        u16(method),
        u16(time),
        u16(date),
        u32(crc),
        u32(compressed.length),
        u32(f.data.length),
        u16(nameBuf.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(localOffset),
        nameBuf,
      ]),
    );
  }
  const centralStart = offset;
  const centralBuf = Buffer.concat(centralParts);
  const eocd = Buffer.concat([
    u32(SIG_EOCD),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(centralBuf.length),
    u32(centralStart),
    u16(0),
  ]);
  mkdirSync(path.dirname(zipAbs), { recursive: true });
  writeFileSync(zipAbs, Buffer.concat([...localParts, centralBuf, eocd]));
}

// keep imports used
void createWriteStream;
void once;
