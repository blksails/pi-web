#!/usr/bin/env node
/**
 * 共享运行时的**失败模式与自愈** e2e（spec shared-runtime-payload 任务 7.2）。
 *
 * 这些是本 spec 引入的、今天不存在的失败模式，也是它值得单独立 spec 的理由。
 * 单测覆盖了语义（合成小载荷、同进程），此处用**真实载荷 + 真实子进程**覆盖单测碰不到的部分：
 * 跨进程的中断残留、`rename` 的跨平台行为、真实文件系统的 ENOSPC / EACCES。
 *
 * 用例（Req 3.4/3.5/4.1/4.2/4.3/4.5）：
 *   1. 中断    —— 解包途中 SIGKILL ⇒ 无 `.ok`；下次启动重新解包成功
 *   2. 损坏 A  —— 目录存在但缺 `.ok` ⇒ 判为损坏并重解
 *   3. 损坏 B  —— 篡改归档字节 ⇒ payload-corrupt，且**不留下带 `.ok` 的目录**
 *   4. 只读    —— runtimeRoot 不可写 ⇒ runtime-root-unwritable
 *   5. 磁盘满  —— 真实的小容量磁盘映像 ⇒ disk-full，且 staging 被清除
 *
 * 用例 5 仅 macOS（`hdiutil`）。其他平台无可移植的 ENOSPC 模拟手段，**如实跳过并登记为盲区**，
 * 不以「代码看起来会处理」冒充验证。
 *
 * 前置：`pnpm build:dist`。
 */
import { execFile, execFileSync, spawn } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PAYLOAD_DIR = join(ROOT, "payload");
const UNPACKER = join(PAYLOAD_DIR, "unpack.mjs");

const fails = [];
const skips = [];
const check = (name, ok) => {
  console.log(`${ok ? "✓" : "✗"} ${name}`);
  if (!ok) fails.push(name);
};
const skip = (name, why) => {
  console.log(`⊘ ${name} —— 跳过：${why}`);
  skips.push(`${name}（${why}）`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function runtimeDirName(payloadDir = PAYLOAD_DIR) {
  const meta = JSON.parse(readFileSync(join(payloadDir, "payload.json"), "utf8"));
  return `${meta.version}-${meta.digest.slice(0, 12)}`;
}

/** 跑一次解包器；返回解析出的 JSON（成功或失败都返回，不抛）。 */
async function runUnpacker(runtimeRoot, payloadDir = PAYLOAD_DIR, extraArgs = []) {
  const args = [UNPACKER, "--payload-dir", payloadDir, "--runtime-root", runtimeRoot, "--json", ...extraArgs];
  try {
    const { stdout } = await execFileAsync(process.execPath, args);
    return JSON.parse(stdout.trim().split("\n").at(-1));
  } catch (err) {
    // 退出码 1 时 stdout 仍带一行 {"ok":false,...}
    const out = (err.stdout ?? "").trim();
    if (out) return JSON.parse(out.split("\n").at(-1));
    return { ok: false, code: "no-output", message: err.message };
  }
}

const tmp = (p) => mkdtempSync(join(tmpdir(), p));

// ───────────────── 1. 中断 ─────────────────
async function caseInterrupted() {
  const runtimeRoot = tmp("pi-web-interrupt-");
  const target = join(runtimeRoot, runtimeDirName());
  try {
    // 解包真实载荷约 5-6s；1.2s 后 SIGKILL 必然落在解包中途。
    const child = spawn(process.execPath, [UNPACKER, "--payload-dir", PAYLOAD_DIR, "--runtime-root", runtimeRoot, "--json"], {
      stdio: "ignore",
    });
    await sleep(1200);
    child.kill("SIGKILL");
    await new Promise((r) => child.on("exit", r));

    check("中断后不存在带 .ok 的运行时目录", !existsSync(join(target, ".ok")));

    // 中断必须真的发生在解包途中：staging 存在、且残留的锁记录着已死的持有者。
    // 若断言写成 `residue.length >= 0` 就是恒真的，等于什么也没验证。
    const staging = readdirSync(runtimeRoot).filter((e) => e.startsWith(".staging-"));
    check(`SIGKILL 确实落在解包途中（staging 残留 ${staging.length} 个）`, staging.length === 1);
    const locks = readdirSync(runtimeRoot).filter((e) => e.startsWith(".lock-"));
    check(`崩溃留下了未释放的锁（${locks.length} 个）`, locks.length === 1);

    const again = await runUnpacker(runtimeRoot);
    check("中断后下次启动重新解包成功（死者持有的锁被接管）", again.ok === true && again.unpacked === true);
    check("重解后完整性标记就位", existsSync(join(target, ".ok")));

    // 死者接管必须是**立即**的。若退化为按锁的年龄判断，这里会空等满 lockWaitMs。
    check(`接管未空等（实际 ${again.elapsedMs} ms < 30s）`, again.elapsedMs < 30_000);
  } finally {
    rmSync(runtimeRoot, { recursive: true, force: true });
  }
}

// ───────────────── 2. 目录存在但缺 .ok ─────────────────
async function caseMissingMarker() {
  const runtimeRoot = tmp("pi-web-nomarker-");
  const target = join(runtimeRoot, runtimeDirName());
  try {
    const first = await runUnpacker(runtimeRoot);
    if (!first.ok) return check("缺 .ok：前置解包失败", false);

    rmSync(join(target, ".ok"));
    const second = await runUnpacker(runtimeRoot);
    check("缺 .ok 的目录被判为损坏并重新解包", second.ok === true && second.unpacked === true);
    check("重解后完整性标记就位", existsSync(join(target, ".ok")));
    check("重解后入口可用", existsSync(join(target, "dist", "server.mjs")));
    const residue = readdirSync(runtimeRoot).filter((e) => e.startsWith(".trash-") || e.startsWith(".staging-"));
    check(`重解后无 trash / staging 残留（实际 ${residue.join(",") || "无"}）`, residue.length === 0);
  } finally {
    rmSync(runtimeRoot, { recursive: true, force: true });
  }
}

// ───────────────── 3. 归档损坏 ─────────────────
async function caseCorruptPayload() {
  const runtimeRoot = tmp("pi-web-corrupt-");
  const payloadDir = tmp("pi-web-badpayload-");
  try {
    cpSync(PAYLOAD_DIR, payloadDir, { recursive: true });
    const archive = join(payloadDir, "dist.tar.zst");
    const buf = readFileSync(archive);
    const at = Math.floor(buf.length / 2);
    buf.writeUInt8(buf.readUInt8(at) ^ 0xff, at);
    writeFileSync(archive, buf);

    const res = await runUnpacker(runtimeRoot, payloadDir);
    check(`篡改归档 → payload-corrupt（实际 ${res.code}）`, res.ok === false && res.code === "payload-corrupt");

    const dirs = existsSync(runtimeRoot) ? readdirSync(runtimeRoot) : [];
    const withMarker = dirs.filter((d) => existsSync(join(runtimeRoot, d, ".ok")));
    check("损坏时不留下任何带 .ok 的目录", withMarker.length === 0);
    check(`损坏时清除 staging（实际残留 ${dirs.filter((d) => d.startsWith(".staging-")).length} 个）`,
      dirs.filter((d) => d.startsWith(".staging-")).length === 0);

    // 载荷缺失
    rmSync(archive);
    const missing = await runUnpacker(runtimeRoot, payloadDir);
    check(`载荷缺失 → payload-missing（实际 ${missing.code}）`, missing.ok === false && missing.code === "payload-missing");
  } finally {
    rmSync(runtimeRoot, { recursive: true, force: true });
    rmSync(payloadDir, { recursive: true, force: true });
  }
}

// ───────────────── 4. 只读运行时根 ─────────────────
async function caseReadOnlyRoot() {
  const runtimeRoot = tmp("pi-web-readonly-");
  try {
    chmodSync(runtimeRoot, 0o555);
    const res = await runUnpacker(runtimeRoot);
    check(`只读运行时根 → runtime-root-unwritable（实际 ${res.code}）`,
      res.ok === false && res.code === "runtime-root-unwritable");
    check("失败消息含路径", typeof res.message === "string" && res.message.includes(runtimeRoot));
  } finally {
    chmodSync(runtimeRoot, 0o755);
    rmSync(runtimeRoot, { recursive: true, force: true });
  }
}

// ───────────────── 5. 磁盘满（真实小容量磁盘映像，仅 macOS）─────────────────
async function caseDiskFull() {
  if (process.platform !== "darwin") {
    return skip("磁盘满 → disk-full", `${process.platform} 无可移植的 ENOSPC 模拟手段`);
  }
  const dmg = join(tmpdir(), `pi-web-full-${process.pid}.dmg`);
  const mount = `/Volumes/piwebfull${process.pid}`;
  let mounted = false;
  try {
    // 20MB 卷装不下 89MB 的解包树，但装得下 9.4MB 载荷的读取。
    execFileSync("hdiutil", ["create", "-quiet", "-size", "20m", "-fs", "HFS+", "-volname", `piwebfull${process.pid}`, dmg]);
    execFileSync("hdiutil", ["attach", "-quiet", "-mountpoint", mount, dmg]);
    mounted = true;

    const res = await runUnpacker(mount);
    check(`磁盘满 → disk-full（实际 ${res.code}）`, res.ok === false && res.code === "disk-full");

    const dirs = readdirSync(mount).filter((d) => d.startsWith(".staging-"));
    check(`磁盘满时 staging 被清除（实际残留 ${dirs.length} 个）`, dirs.length === 0);
    const withMarker = readdirSync(mount).filter((d) => existsSync(join(mount, d, ".ok")));
    check("磁盘满时不留下任何带 .ok 的目录", withMarker.length === 0);
  } catch (e) {
    check(`磁盘满用例执行失败：${e.message}`, false);
  } finally {
    if (mounted) execFileSync("hdiutil", ["detach", "-quiet", "-force", mount]);
    rmSync(dmg, { force: true });
  }
}

async function main() {
  if (!existsSync(UNPACKER)) {
    console.error(`✗ 缺少解包器：${UNPACKER}\n  请先执行：pnpm build:dist`);
    process.exit(1);
  }
  console.log("失败模式与自愈（真实载荷 + 真实子进程）\n");
  console.log("— 1. 解包中途被杀"); await caseInterrupted();
  console.log("\n— 2. 目录存在但缺完整性标记"); await caseMissingMarker();
  console.log("\n— 3. 载荷损坏 / 缺失"); await caseCorruptPayload();
  console.log("\n— 4. 运行时根只读"); await caseReadOnlyRoot();
  console.log("\n— 5. 磁盘空间不足"); await caseDiskFull();

  if (skips.length) console.log(`\n盲区（如实登记，未验证）：\n  - ${skips.join("\n  - ")}`);
  console.log(fails.length ? `\nFAIL: ${fails.length} 项` : "\nPASS: 全部通过");
  process.exit(fails.length ? 1 : 0);
}
main();
