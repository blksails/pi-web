#!/usr/bin/env node
/**
 * 取得随包 Node 二进制（Tauri sidecar），供 `bundle.externalBin` 使用
 * （spec electron-to-tauri 任务 2.1，Req 5.1/9.3/9.4）。
 *
 * Tauri 要求 externalBin 的磁盘文件名带 target triple 后缀（`node-aarch64-apple-darwin`），
 * 打包时后缀被剥离、落到主可执行同目录。**该文件在 `cargo build` 期即被校验存在**
 * （不止 `tauri build`），故本脚本是编译的前置步骤而非仅打包步骤。
 *
 * 信任模型：期望的 sha256 记在 `desktop/node-sidecar.lock.json`（入库、可 code review），
 * **不信任下载来的 `SHASUMS256.txt`** —— 它与二进制同源，上游被篡改时会被一并改掉。
 * 校验对象是官方压缩包（解压后的 bin/node 会因 tar 实现与 strip 而变，不稳定）。
 *
 * 用法：
 *   node scripts/fetch-node-sidecar.mjs                      # 本机 triple
 *   node scripts/fetch-node-sidecar.mjs --target <triple>    # 指定 triple（CI 交叉构建）
 *   node scripts/fetch-node-sidecar.mjs --force              # 忽略幂等跳过，强制重取
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LOCK_PATH = join(ROOT, "desktop", "node-sidecar.lock.json");
const OUT_DIR = join(ROOT, "desktop", "src-tauri", "binaries");

/** 失败即以非零码退出，使 CI 构建随之失败（Req 9.4）。 */
function fail(msg) {
  console.error(`[sidecar] ✗ ${msg}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { target: undefined, force: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--target") args.target = argv[++i];
    else if (argv[i] === "--force") args.force = true;
  }
  return args;
}

/** 本机 target triple：优先问 rustc（权威），失败则由 process 推断。 */
function hostTriple() {
  try {
    const out = execFileSync("rustc", ["-vV"], { encoding: "utf8" });
    const m = out.match(/^host:\s*(\S+)$/m);
    if (m) return m[1];
  } catch {
    // rustc 不可用 → 退回推断
  }
  const byPlatform = {
    "darwin:arm64": "aarch64-apple-darwin",
    "darwin:x64": "x86_64-apple-darwin",
    "linux:x64": "x86_64-unknown-linux-gnu",
    "linux:arm64": "aarch64-unknown-linux-gnu",
    "win32:x64": "x86_64-pc-windows-msvc",
  };
  const key = `${process.platform}:${process.arch}`;
  const triple = byPlatform[key];
  if (!triple) fail(`无法推断本机 target triple（${key}）；请显式传 --target`);
  return triple;
}

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

/** 目标文件名：Windows 需 .exe 后缀。 */
function outName(triple) {
  return triple.includes("windows") ? `node-${triple}.exe` : `node-${triple}`;
}

/** 已存在且能报出正确版本 → 跳过（幂等）。不比对 sha256：strip 后的二进制哈希与压缩包无关。 */
function alreadyGood(outPath, expectVersion) {
  if (!existsSync(outPath)) return false;
  try {
    const v = execFileSync(outPath, ["--version"], { encoding: "utf8" }).trim();
    return v === expectVersion;
  } catch {
    return false;
  }
}

/**
 * 把下载到的归档解开到 `workDir`。
 *
 * ★ **不能一律用 `tar`**。CI 实测（GitHub Actions，`shell: bash`）连踩两层：
 *   ① `tar` 解析到的是 Git Bash 的 **GNU tar**，而非 System32 的 bsdtar。GNU tar 把
 *      `C:\...` 当成 `host:path` 的远程归档 → `Cannot connect to C: resolve failed`。
 *   ② 绕开盘符后，GNU tar 又**读不了 zip** → `This does not look like a tar archive`。
 *      而 Windows 的 Node 发行包恰恰是 `.zip`。
 *   故 zip 分道处理：Windows 宿主用 PowerShell 的 `Expand-Archive`（系统自带，行为确定）；
 *   其他宿主用 `unzip`。`.tar.xz` 仍走 `tar`，且以「cwd + 相对文件名」规避盘符。
 */
function extractArchive(archivePath, workDir) {
  const name = basename(archivePath);
  if (name.endsWith(".zip")) {
    if (process.platform === "win32") {
      execFileSync(
        "powershell",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `Expand-Archive -LiteralPath '${archivePath}' -DestinationPath '${workDir}' -Force`,
        ],
        { stdio: "inherit" },
      );
    } else {
      execFileSync("unzip", ["-q", name], { cwd: workDir, stdio: "inherit" });
    }
    return;
  }
  execFileSync("tar", ["-xf", name], { cwd: workDir, stdio: "inherit" });
}

/** 解压出 node 可执行文件，返回其临时路径。 */
function extractNode(archivePath, workDir, triple) {
  extractArchive(archivePath, workDir);
  const isWin = triple.includes("windows");
  const stem = archivePath
    .split(/[\\/]/)
    .pop()
    .replace(/\.tar\.xz$|\.zip$/, "");
  const inner = isWin
    ? join(workDir, stem, "node.exe")
    : join(workDir, stem, "bin", "node");
  if (!existsSync(inner)) fail(`解压后未找到 node 可执行文件：${inner}`);
  return inner;
}

/**
 * 剥符号表：实测 macOS arm64 由 107MB 降至 86MB。Windows 无对应工具，跳过。
 *
 * ★ macOS 上 `strip` 会使 Node 官方二进制内嵌的代码签名失效，内核随即以 SIGKILL(137)
 * 拒绝执行它。必须紧接着做一次 ad-hoc 重签名（`codesign --force --sign -`）。
 * 这不影响「未签名分发」的现状：ad-hoc 签名只是让二进制自洽可执行，不涉及开发者身份。
 */
function stripBinary(path, triple) {
  if (triple.includes("windows")) return;
  const isApple = triple.includes("apple");
  try {
    execFileSync("strip", isApple ? ["-x", path] : [path], { stdio: "pipe" });
  } catch (err) {
    // strip 不可用不致命（只是包更大），但要让使用者看见。
    console.warn(`[sidecar] ! strip 失败，二进制未瘦身：${err.message}`);
    return;
  }
  if (!isApple) return;
  try {
    execFileSync("codesign", ["--force", "--sign", "-", path], { stdio: "pipe" });
  } catch (err) {
    fail(
      `strip 后 ad-hoc 重签名失败，二进制将无法执行（macOS 会以 SIGKILL 拒绝）：${err.message}`,
    );
  }
}

const mib = (n) => (n / 1048576).toFixed(1);

async function main() {
  const { target, force } = parseArgs(process.argv.slice(2));
  const triple = target ?? hostTriple();

  if (!existsSync(LOCK_PATH)) fail(`缺少锁文件：${LOCK_PATH}`);
  const lock = JSON.parse(readFileSync(LOCK_PATH, "utf8"));
  const entry = lock.targets[triple];
  if (!entry) {
    fail(
      `锁文件中无该 target：${triple}\n  已知：${Object.keys(lock.targets).join(", ")}`,
    );
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const outPath = join(OUT_DIR, outName(triple));

  if (!force && alreadyGood(outPath, lock.nodeVersion)) {
    console.log(`[sidecar] ✓ 已存在且版本正确，跳过：${outName(triple)} (${lock.nodeVersion})`);
    return;
  }

  const url = `${lock.baseUrl}/${lock.nodeVersion}/${entry.archive}`;
  console.log(`[sidecar] 下载 ${url}`);
  const res = await fetch(url);
  if (!res.ok) fail(`下载失败：HTTP ${res.status} ${url}`);
  const archive = Buffer.from(await res.arrayBuffer());

  // ★ 校验和门：只比对入库值。不匹配即中止，绝不产出未经校验的二进制。
  const actual = sha256(archive);
  if (actual !== entry.sha256) {
    fail(
      `校验和不匹配（拒绝使用该二进制）\n` +
        `  target : ${triple}\n` +
        `  archive: ${entry.archive}\n` +
        `  期望   : ${entry.sha256}\n` +
        `  实际   : ${actual}`,
    );
  }
  console.log(`[sidecar] ✓ sha256 匹配入库值 (${mib(archive.length)} MB 压缩包)`);

  const workDir = mkdtempSync(join(tmpdir(), "pi-web-sidecar-"));
  try {
    const archivePath = join(workDir, entry.archive);
    writeFileSync(archivePath, archive);
    const inner = extractNode(archivePath, workDir, triple);
    const before = statSync(inner).size;
    stripBinary(inner, triple);
    const after = statSync(inner).size;
    copyFileSync(inner, outPath);
    chmodSync(outPath, 0o755);
    console.log(
      `[sidecar] ✓ 产出 ${outName(triple)}：${mib(before)} MB → ${mib(after)} MB (strip)`,
    );

    // 产出自检：只对本机 triple 有意义（交叉构建时无法执行异架构二进制）。
    // 曾踩：macOS strip 破坏签名 → 内核 SIGKILL(137)。宁可在此炸掉，也不要留到壳启动时。
    if (triple === hostTriple()) {
      if (!alreadyGood(outPath, lock.nodeVersion)) {
        fail(
          `产出的二进制无法执行或版本不符（期望 ${lock.nodeVersion}）。\n` +
            `  macOS 上常见原因：strip 使代码签名失效，需 ad-hoc 重签名。`,
        );
      }
      console.log(`[sidecar] ✓ 自检通过：${outPath} --version → ${lock.nodeVersion}`);
    } else {
      console.log(`[sidecar] · 交叉构建（${triple} ≠ 本机），跳过执行自检`);
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

main().catch((err) => fail(err?.stack ?? String(err)));
