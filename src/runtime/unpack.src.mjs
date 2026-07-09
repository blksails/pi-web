/**
 * 共享运行时的解包器（spec shared-runtime-payload，任务 1.1 / 3.1–3.3）。
 *
 * ★ 这是解包语义的**唯一实现**。CLI 直接 import 它；桌面壳（Rust）用随包 sidecar node
 *   执行它的 CLI 模式并只解析 stdout 最后一行 JSON。两侧绝不各写一份——本仓已有前车之鉴：
 *   就绪探针的语义靠 design 里的一张对照表在 bin/pi-web.mjs 与 ready_probe.rs 之间强行同步。
 *
 * 本文件是**源码**。经 scripts/build-unpacker.mjs 由 esbuild 打成零运行时依赖的
 * `payload/unpack.mjs` 后随包分发（npm files / tauri bundle.resources）。
 * 它不能放进 dist/——那正是它要解包的东西（chicken-and-egg）。
 *
 * 三条不变式：
 *   1. `.ok` 是整个解包过程**最后一个**写入的条目。任何失败路径的共同后置条件是
 *      「不存在带 .ok 的 target」。
 *   2. `rename(dir → 非空 dir)` 在 POSIX 报 ENOTEMPTY、Windows 直接失败 ⇒ 原子替换必须
 *      「先把旧目录移到 .trash-* 再 rename」。
 *   3. GC 只删名字匹配 `<semver>-<12位小写hex>` 的运行时目录。这是防灾条款：即便
 *      PI_WEB_RUNTIME_ROOT 被误设成 $HOME，也碰不到 Documents/。
 */
import { createHash, randomBytes } from "node:crypto";
import { createReadStream, realpathSync } from "node:fs";
import * as fsp from "node:fs/promises";
import { homedir, hostname } from "node:os";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import zlib from "node:zlib";
import { extract as tarExtract } from "tar";

/** 完整性标记的文件名。位于运行时目录下、与产物根 `dist/` 平级。 */
export const MARKER = ".ok";

/** 运行时目录名的形态：`<semver>-<12 位小写 hex>`。GC 的防灾守卫依赖它。 */
const RUNTIME_DIR_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?-[0-9a-f]{12}$/;

const DIGEST_PREFIX_LEN = 12;
const DEFAULT_LOCK_WAIT_MS = 120_000;
const LOCK_POLL_MS = 250;

/** 锁目录被判定为陈旧（持锁进程已死）的年龄。 */
export const STALE_LOCK_MS = 10 * 60 * 1000;
/** GC：保留除当前目录外最近使用的几个运行时目录。 */
export const GC_KEEP = 2;
/** GC：运行时目录的最小年龄，早于此才可能被删。 */
export const GC_MIN_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** GC：staging / trash 残留的最小年龄。 */
export const GC_TEMP_AGE_MS = 60 * 60 * 1000;

/**
 * 解包失败的判别式错误。`code` 是跨进程契约（Rust 侧据此映射到错误页文案），
 * `message` 只给人看。
 */
export class RuntimeError extends Error {
  /** @param {RuntimeErrorCode} code */
  constructor(code, message, options) {
    super(message, options);
    this.name = "RuntimeError";
    this.code = code;
  }
}

/**
 * @typedef {"payload-missing" | "payload-corrupt" | "zstd-unsupported"
 *   | "runtime-root-unwritable" | "disk-full" | "lock-timeout" | "extract-failed"} RuntimeErrorCode
 */

// ─────────────────────────── 纯函数（任务 1.1）───────────────────────────

/** 运行时目录名。摘要取前 12 位（48 bit，足以区分同版本的不同构建）。 */
export function runtimeDirName(version, digest) {
  return `${version}-${digest.slice(0, DIGEST_PREFIX_LEN)}`;
}

/** GC 的命名形态守卫。见文件头不变式 3。 */
export function isRuntimeDirName(name) {
  return RUNTIME_DIR_RE.test(name);
}

/** 文件系统 errno → 判别式错误码。未知 errno 归为 `extract-failed`。 */
export function classifyFsError(err) {
  switch (err?.code) {
    case "ENOSPC":
      return "disk-full";
    case "EACCES":
    case "EPERM":
    case "EROFS":
      return "runtime-root-unwritable";
    default:
      return "extract-failed";
  }
}

/** 这些 errno 表示「真的是文件系统出问题」，其余异常在解包途中一律视为载荷损坏。 */
const FS_ERRNOS = new Set([
  "ENOSPC", "EACCES", "EPERM", "EROFS", "EDQUOT",
  "EMFILE", "ENFILE", "EIO", "ENOENT", "EEXIST", "EBUSY", "EXDEV",
]);

/**
 * 解包途中的异常分类。zstd 帧损坏、tar 结构错乱都不带 fs errno，归为 payload-corrupt；
 * 带 fs errno 的交给 classifyFsError（磁盘满 / 无写权限 / 其余 IO）。
 */
export function classifyExtractError(err) {
  if (err?.code && FS_ERRNOS.has(err.code)) return classifyFsError(err);
  return "payload-corrupt";
}

/**
 * 挑选可回收的条目（纯函数，不碰文件系统）。
 *
 * @param {{name: string, mtimeMs: number}[]} entries 运行时根下的直接子项
 * @param {string} keepDir 当前正在使用的运行时目录名，永不入选
 * @param {number} now
 * @returns {string[]} 待删除的条目名
 */
export function selectGcVictims(entries, keepDir, now) {
  const victims = [];
  const runtimes = [];

  for (const entry of entries) {
    if (entry.name === keepDir) continue;

    if (isRuntimeDirName(entry.name)) {
      runtimes.push(entry);
    } else if (entry.name.startsWith(".staging-") || entry.name.startsWith(".trash-")) {
      if (now - entry.mtimeMs > GC_TEMP_AGE_MS) victims.push(entry.name);
    } else if (entry.name.startsWith(".lock-")) {
      if (now - entry.mtimeMs > STALE_LOCK_MS) victims.push(entry.name);
    }
    // 其余一律不碰。这条 else 的缺席是刻意的——防灾条款。
  }

  // 按最近使用降序，保留最近 GC_KEEP 个；其余满足最小年龄才删。
  runtimes.sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const entry of runtimes.slice(GC_KEEP)) {
    if (now - entry.mtimeMs > GC_MIN_AGE_MS) victims.push(entry.name);
  }
  return victims;
}

/** 运行时根目录：env 覆盖优先，否则 `~/.pi/web/runtime`。 */
export function defaultRuntimeRoot(env = process.env, home = homedir()) {
  const override = env.PI_WEB_RUNTIME_ROOT?.trim();
  if (override) return path.resolve(override);
  return path.join(home, ".pi", "web", "runtime");
}

// ─────────────────────────── ensureRuntime（任务 3.1–3.2）───────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** `maxRetries` 用于挡住 Windows 上常见的 EBUSY，以及 POSIX 上删除与写入的窄竞争。 */
const rmrf = (p) => fsp.rm(p, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });

/**
 * 等待流真正关闭。
 *
 * ★ `pipeline` 一旦 reject 就会 destroy 各流，但 tar 的 Unpack **仍可能有在途的
 *   `mkdir`/`open` 落盘**。若此时立刻 rm 掉 staging，那些在途写入会把目录重新造出来，
 *   于是「失败后不留半成品」的不变式被打破。实测：磁盘满时 staging 必残留一个。
 */
function streamSettled(stream, timeoutMs = 3000) {
  if (stream.closed) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(done, timeoutMs);
    stream.once("close", done);
    stream.once("error", () => {}); // 收尾期的二次 error 不得变成未捕获异常
  });
}

/** zstd 流 API 自 Node 22.15.0 起可用。缺失时给出可读报错而非底层 TypeError（Req 4.4）。 */
function assertZstdAvailable() {
  if (typeof zlib.createZstdDecompress !== "function") {
    throw new RuntimeError(
      "zstd-unsupported",
      `当前 Node ${process.version} 不支持 zstd 解压。请升级到 Node >= 22.15.0。`,
    );
  }
}

async function readMarker(targetDir) {
  try {
    return JSON.parse(await fsp.readFile(path.join(targetDir, MARKER), "utf8"));
  } catch {
    return undefined;
  }
}

async function readPayloadMeta(payloadDir) {
  const metaPath = path.join(payloadDir, "payload.json");
  let raw;
  try {
    raw = await fsp.readFile(metaPath, "utf8");
  } catch (err) {
    throw new RuntimeError("payload-missing", `载荷元数据缺失：${metaPath}`, { cause: err });
  }

  let meta;
  try {
    meta = JSON.parse(raw);
  } catch (err) {
    throw new RuntimeError("payload-corrupt", `载荷元数据不是合法 JSON：${metaPath}`, { cause: err });
  }

  for (const field of ["version", "archive", "digest", "root"]) {
    if (typeof meta[field] !== "string" || meta[field] === "") {
      throw new RuntimeError("payload-corrupt", `载荷元数据缺少字段 ${field}：${metaPath}`);
    }
  }

  const archivePath = path.join(payloadDir, meta.archive);
  try {
    await fsp.access(archivePath);
  } catch (err) {
    throw new RuntimeError("payload-missing", `载荷归档缺失：${archivePath}`, { cause: err });
  }
  return { meta, archivePath };
}

/** 递归统计目录下的**真实落盘文件数**。 */
async function countFilesOnDisk(dir) {
  let count = 0;
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of await fsp.readdir(current, { withFileTypes: true })) {
      if (entry.isDirectory()) stack.push(path.join(current, entry.name));
      else if (entry.isFile()) count += 1;
    }
  }
  return count;
}

/**
 * 解包到 staging，并**流式**校验载荷字节的 sha256。
 * 任何失败都先清除 staging 再抛错——保证「不留下半成品」。
 *
 * ★ `strict: true` 不是洁癖，是必需的。tar 默认把**写盘错误当作可恢复的 warning 丢掉**
 *   （`unpack.js`：“Other errors are warnings, which raise the error in strict”）。
 *   实测：在 20MB 的卷上解 89MB 的树，tar 写满 1437 个文件后**正常返回**，摘要校验也通过
 *   （读载荷不受磁盘满影响），最终在写 `.ok` 时才炸。若那点残余空间刚好够写 `.ok`，
 *   就会落地一个带合法完整性标记、却只有 1437/9284 个文件的运行时——正是 Req 4.5 的噩梦。
 */
async function extractToStaging(archivePath, staging, meta) {
  await fsp.mkdir(staging, { recursive: true });

  const hash = createHash("sha256");
  const unpack = tarExtract({ cwd: staging, strict: true });

  try {
    await pipeline(
      createReadStream(archivePath),
      new Transform({
        transform(chunk, _enc, cb) {
          hash.update(chunk);
          cb(null, chunk);
        },
      }),
      zlib.createZstdDecompress(),
      unpack,
    );
  } catch (err) {
    // 必须等在途落盘停下来，否则上层的 rm 会删到一半又被重新写出来。
    await streamSettled(unpack);
    throw err;
  }

  const actual = hash.digest("hex");
  if (actual !== meta.digest) {
    throw new RuntimeError(
      "payload-corrupt",
      `载荷摘要不匹配：期望 ${meta.digest.slice(0, 12)}… 实得 ${actual.slice(0, 12)}…`,
    );
  }

  // ★ 必须数**磁盘上的**文件，而不是从归档里读出的条目数——后者与写盘成败无关，
  //   兜不住任何写盘故障。这是防止「摘要正确但落盘不全」的最后一道闸。
  if (typeof meta.entries === "number") {
    const onDisk = await countFilesOnDisk(staging);
    if (onDisk !== meta.entries) {
      throw new RuntimeError(
        "payload-corrupt",
        `落盘文件数不符：期望 ${meta.entries} 实得 ${onDisk}（解包不完整）`,
      );
    }
  }
}

/** 锁目录内记录持有者身份的文件。 */
const LOCK_OWNER = "owner.json";

/**
 * 持锁进程是否还活着。
 *
 * `kill(pid, 0)` 不发信号，只做存在性与权限探测：`ESRCH` = 进程不存在；`EPERM` = 存在但
 * 属于他人（视为存活）。误判方向是**安全的**：
 *   - 把活的当死的 → 会误接管（危险）。仅当 pid 已被回收复用时可能发生，而那要求同一 pid
 *     在极短时间内被重新分配；此时 `kill(0)` 返回存活，我们选择**等待**，不接管。
 *   - 把死的当活的 → 只是多等一会儿，最终由年龄阈值兜底（安全）。
 */
export function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}

async function readLockOwner(lockDir) {
  try {
    return JSON.parse(await fsp.readFile(path.join(lockDir, LOCK_OWNER), "utf8"));
  } catch {
    return undefined;
  }
}

/**
 * 取锁。返回 `"acquired"`（本进程负责解包）或 `"reused"`（他人已完成，直接用）。
 *
 * `mkdir` 的原子性在 POSIX 与 Windows 上语义一致，故不引入额外依赖。
 *
 * ★ 陈旧锁的判据是**持有者是否还活着**，而非锁的年龄。只按年龄判断会导致：解包途中崩溃
 *   （或被 SIGKILL）后，残留的锁在 10 分钟内都被视为「新鲜」，下一次启动要空等满
 *   `lockWaitMs` 才报 lock-timeout —— 崩一次，应用两分钟起不来。实测踩过。
 *   年龄阈值仍作为兜底：跨主机（共享盘）或 owner 文件缺失时无法探测存活。
 */
async function acquireLock(lockDir, targetDir, digest, waitMs) {
  const deadline = Date.now() + waitMs;
  let takeovers = 0;

  for (;;) {
    try {
      await fsp.mkdir(lockDir);
      // 身份写在锁内，供后来者探测存活。写失败不致命——退回年龄判据。
      await fsp
        .writeFile(
          path.join(lockDir, LOCK_OWNER),
          JSON.stringify({ pid: process.pid, host: hostname(), at: Date.now() }),
        )
        .catch(() => {});
      return "acquired";
    } catch (err) {
      if (err.code !== "EEXIST") {
        throw new RuntimeError(classifyFsError(err), `无法创建锁目录 ${lockDir}：${err.message}`, {
          cause: err,
        });
      }
    }

    // 锁被他人持有。若对方已完成，直接复用其结果（Req 3.3）。
    const marker = await readMarker(targetDir);
    if (marker?.digest === digest) return "reused";

    if (takeovers < 2 && (await isLockStale(lockDir))) {
      takeovers += 1;
      await rmrf(lockDir).catch(() => {});
      continue; // 重新竞争；两个进程同时接管也无妨——原子落地保证最终一致
    }

    if (Date.now() >= deadline) {
      throw new RuntimeError(
        "lock-timeout",
        `等待其他进程完成解包超时（${waitMs}ms）：${lockDir}`,
      );
    }
    await sleep(LOCK_POLL_MS);
  }
}

/** 锁是否可被接管：持有者已死（同主机），或锁已超过年龄阈值。 */
async function isLockStale(lockDir) {
  const owner = await readLockOwner(lockDir);
  if (owner && owner.host === hostname() && !isProcessAlive(owner.pid)) return true;

  const stat = await fsp.stat(lockDir).catch(() => undefined);
  return Boolean(stat && Date.now() - stat.mtimeMs > STALE_LOCK_MS);
}

/**
 * 确保共享运行时就绪，返回产物根与入口。
 *
 * 快路径（已解包）：只 stat/read 两个小文件，不读取载荷、不重算摘要（Req 10.1）。
 */
export async function ensureRuntime({ payloadDir, runtimeRoot, lockWaitMs = DEFAULT_LOCK_WAIT_MS }) {
  const startedAt = Date.now();
  assertZstdAvailable();

  const { meta, archivePath } = await readPayloadMeta(payloadDir);
  const root = runtimeRoot ? path.resolve(runtimeRoot) : defaultRuntimeRoot();
  const dirName = runtimeDirName(meta.version, meta.digest);
  const targetDir = path.join(root, dirName);

  const result = (unpacked) => ({
    runtimeRoot: root,
    runtimeDir: dirName,
    distRoot: path.join(targetDir, meta.root),
    serverJs: path.join(targetDir, meta.root, "server.mjs"),
    unpacked,
    elapsedMs: Date.now() - startedAt,
  });

  try {
    await fsp.mkdir(root, { recursive: true });
  } catch (err) {
    throw new RuntimeError(classifyFsError(err), `无法创建运行时根目录 ${root}：${err.message}`, {
      cause: err,
    });
  }

  // 快路径：命中已解包目录。touch `.ok` 的 mtime，供 GC 判活。
  const existing = await readMarker(targetDir);
  if (existing?.digest === meta.digest) {
    await touchMarker(targetDir);
    return result(false);
  }

  const lockDir = path.join(root, `.lock-${meta.digest.slice(0, DIGEST_PREFIX_LEN)}`);
  if ((await acquireLock(lockDir, targetDir, meta.digest, lockWaitMs)) === "reused") {
    await touchMarker(targetDir);
    return result(false);
  }

  try {
    // 取锁与首次检查之间，他人可能已完成。
    const again = await readMarker(targetDir);
    if (again?.digest === meta.digest) {
      await touchMarker(targetDir);
      return result(false);
    }

    const suffix = `${process.pid}-${randomBytes(4).toString("hex")}`;
    const staging = path.join(root, `.staging-${meta.digest.slice(0, DIGEST_PREFIX_LEN)}-${suffix}`);

    // ★ 整条慢路径共用一个清理边界。此前只有 extractToStaging 内部清理 staging，
    //   于是「写 .ok 失败」「rename 失败」都会把半成品留在磁盘上——磁盘满时尤其致命，
    //   那 20MB 残骸正是用户最需要回收的空间。
    try {
      await extractToStaging(archivePath, staging, meta);

      // ★ `.ok` 最后写入。在此之前进程被杀 ⇒ staging 是垃圾，target 不存在或无标记。
      await fsp.writeFile(
        path.join(staging, MARKER),
        `${JSON.stringify({
          schema: 1,
          version: meta.version,
          digest: meta.digest,
          entries: meta.entries,
          unpackedAt: new Date().toISOString(),
        }, null, 2)}\n`,
      );

      await landAtomically(staging, targetDir, root);
    } catch (err) {
      await rmrf(staging).catch(() => {});
      if (err instanceof RuntimeError) throw err;
      const code = classifyExtractError(err);
      throw new RuntimeError(code, `解包失败（${code}）：${err.message}`, { cause: err });
    }
    return result(true);
  } finally {
    await rmrf(lockDir).catch(() => {});
  }
}

/** `.ok` 的 mtime 即「最近使用时间」，GC 据此判活（启发式，见 design D-3）。 */
async function touchMarker(targetDir) {
  const now = new Date();
  await fsp.utimes(path.join(targetDir, MARKER), now, now).catch(() => {});
}

/**
 * 原子落地。见文件头不变式 2：不能直接 rename 覆盖已存在的非空目录。
 */
async function landAtomically(staging, targetDir, root) {
  let trash;
  try {
    await fsp.access(targetDir);
    trash = path.join(root, `.trash-${randomBytes(6).toString("hex")}`);
    await fsp.rename(targetDir, trash);
  } catch (err) {
    if (err.code !== "ENOENT") {
      await rmrf(staging);
      throw new RuntimeError(classifyFsError(err), `无法移开损坏的运行时目录：${err.message}`, {
        cause: err,
      });
    }
    // targetDir 不存在，正常路径。
  }

  try {
    await fsp.rename(staging, targetDir);
  } catch (err) {
    await rmrf(staging);
    throw new RuntimeError(classifyFsError(err), `无法落地运行时目录：${err.message}`, {
      cause: err,
    });
  }

  if (trash) await rmrf(trash).catch(() => {});
}

// ─────────────────────────── GC（任务 3.3）───────────────────────────

/**
 * 回收旧运行时目录与残留。**尽力而为**：任何失败都被吞掉并计入报告，绝不抛出（Req 5.4）。
 * 调用方必须在后端进程拉起**之后**触发（Req 5.5）。
 */
export async function gcRuntimeRoot(runtimeRoot, keepDir, now = Date.now()) {
  const report = { removed: [], failed: [] };

  let names;
  try {
    names = await fsp.readdir(runtimeRoot);
  } catch {
    return report;
  }

  const entries = [];
  for (const name of names) {
    const full = path.join(runtimeRoot, name);
    try {
      // 运行时目录按 `.ok` 的 mtime 判活；其余按自身 mtime。
      const markerStat = isRuntimeDirName(name)
        ? await fsp.stat(path.join(full, MARKER)).catch(() => undefined)
        : undefined;
      const stat = markerStat ?? (await fsp.stat(full));
      entries.push({ name, mtimeMs: stat.mtimeMs });
    } catch {
      // 条目在枚举与 stat 之间消失，跳过。
    }
  }

  for (const victim of selectGcVictims(entries, keepDir, now)) {
    try {
      await rmrf(path.join(runtimeRoot, victim));
      report.removed.push(victim);
    } catch (err) {
      report.failed.push({ name: victim, message: err.message });
    }
  }
  return report;
}

// ─────────────────────────── CLI 模式（供桌面壳 spawn）───────────────────────────

/** 错误码 → 面向用户的补充说明。Rust 侧不解析这些文案，只用 code。 */
export function describeErrorCode(code) {
  switch (code) {
    case "runtime-root-unwritable":
      return "运行时目录不可写。请检查该路径的权限，或经 PI_WEB_RUNTIME_ROOT 指定其他位置。";
    case "disk-full":
      return "磁盘空间不足，无法解包运行时。请清理磁盘后重试。";
    case "payload-missing":
    case "payload-corrupt":
      return "随包运行时载荷缺失或已损坏。请重新安装。";
    case "zstd-unsupported":
      return "当前 Node 版本过低，不支持 zstd 解压。";
    case "lock-timeout":
      return "等待其他进程完成运行时解包超时。请确认没有其他实例卡住，然后重试。";
    default:
      return "解包运行时失败。";
  }
}

function parseArgs(argv) {
  const opts = { json: false, gc: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") opts.json = true;
    else if (a === "--gc") opts.gc = true;
    else if (a === "--help" || a === "-h") opts.help = true;
    else if (a === "--payload-dir") opts.payloadDir = argv[++i];
    else if (a === "--runtime-root") opts.runtimeRoot = argv[++i];
    else if (a === "--keep") opts.keep = argv[++i];
    else if (a === "--lock-wait-ms") opts.lockWaitMs = Number(argv[++i]);
  }
  return opts;
}

const USAGE = `用法:
  unpack.mjs [--payload-dir <dir>] [--runtime-root <dir>] [--lock-wait-ms <n>] [--json]
  unpack.mjs --gc --runtime-root <dir> --keep <runtimeDirName>

--json  在 stdout 输出**恰好一行** JSON；诊断信息一律走 stderr。
        成功: {"ok":true,"distRoot":…,"serverJs":…,"unpacked":…,"elapsedMs":…}
        失败: {"ok":false,"code":…,"message":…}  且退出码为 1
`;

async function main(argv) {
  const opts = parseArgs(argv);
  if (opts.help) {
    process.stdout.write(USAGE);
    return 0;
  }

  // 默认载荷目录 = 本文件所在目录（打包后即 payload/）。
  const payloadDir = opts.payloadDir ?? path.dirname(fileURLToPath(import.meta.url));

  if (opts.gc) {
    const root = opts.runtimeRoot ?? defaultRuntimeRoot();
    const report = await gcRuntimeRoot(root, opts.keep ?? "");
    if (opts.json) process.stdout.write(`${JSON.stringify({ ok: true, ...report })}\n`);
    else process.stderr.write(`[unpack] 回收 ${report.removed.length} 项，失败 ${report.failed.length} 项\n`);
    return 0;
  }

  try {
    const res = await ensureRuntime({
      payloadDir,
      runtimeRoot: opts.runtimeRoot,
      ...(Number.isFinite(opts.lockWaitMs) ? { lockWaitMs: opts.lockWaitMs } : {}),
    });
    if (opts.json) process.stdout.write(`${JSON.stringify({ ok: true, ...res })}\n`);
    else process.stderr.write(`[unpack] ${res.unpacked ? "已解包" : "命中"} ${res.distRoot}（${res.elapsedMs}ms）\n`);
    return 0;
  } catch (err) {
    const code = err instanceof RuntimeError ? err.code : "extract-failed";
    if (opts.json) {
      process.stdout.write(`${JSON.stringify({ ok: false, code, message: err.message })}\n`);
    } else {
      process.stderr.write(`[unpack] 失败（${code}）：${err.message}\n${describeErrorCode(code)}\n`);
    }
    return 1;
  }
}

/**
 * 入口守卫。
 *
 * ★ `process.argv[1]` 可能含符号链接（macOS 的 `/var` → `/private/var`、经符号链接安装的
 *   `/Applications`、npm link 等），而 `import.meta.url` 恒为**已解析的真实路径**。直接比较
 *   会不等 ⇒ `main()` 不执行 ⇒ CLI 模式静默输出空，桌面壳把它误判成 extract-failed。
 *   必须先 realpath 再比。`bin/pi-web.mjs` 早有同款守卫，此处照做。
 */
function invokedAsMain() {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  let resolved = argv1;
  try {
    resolved = realpathSync(argv1);
  } catch {
    /* 路径不可解析时退回原值 */
  }
  return import.meta.url === pathToFileURL(resolved).href;
}

// 仅在作为程序入口执行时触发副作用；被 import 时保持纯净。
if (invokedAsMain()) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      process.stderr.write(`[unpack] 未预期的错误: ${err?.stack ?? err}\n`);
      process.exitCode = 1;
    },
  );
}
