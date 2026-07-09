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
 * 平台差异（**如实跳过并登记为盲区，不以「代码看起来会处理」冒充验证**）：
 *   - 用例 4（只读根）仅 POSIX：`chmod 555` 在 Windows 上对目录是 no-op，解包会照常成功，
 *     那条断言必然假失败——若强行保留，等于在 Windows 上测了个反向结论。
 *   - 用例 5（磁盘满）仅 macOS：其他平台无可移植的 ENOSPC 模拟手段。
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
    // ★ 不用固定 sleep：不同机器上解包的启动延迟差异极大（CI 的 Windows 慢一个量级）。
    //   轮询到 staging 出现再 SIGKILL，才能确定性地把中断打在解包**途中**。
    const child = spawn(process.execPath, [UNPACKER, "--payload-dir", PAYLOAD_DIR, "--runtime-root", runtimeRoot, "--json"], {
      stdio: "ignore",
    });
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const started = existsSync(runtimeRoot) && readdirSync(runtimeRoot).some((e) => e.startsWith(".staging-"));
      if (started) break;
      await sleep(50);
    }
    await sleep(300); // 让它真的写进去一些文件
    child.kill("SIGKILL");
    await new Promise((r) => child.on("exit", r));

    check("中断后不存在带 .ok 的运行时目录", !existsSync(join(target, ".ok")));

    // 中断必须真的发生在解包途中：staging 存在、且残留的锁记录着已死的持有者。
    // 若断言写成 `residue.length >= 0` 就是恒真的，等于什么也没验证。
    const staging = readdirSync(runtimeRoot).filter((e) => e.startsWith(".staging-"));
    check(`SIGKILL 确实落在解包途中（staging 残留 ${staging.length} 个）`, staging.length === 1);
    const locks = readdirSync(runtimeRoot).filter((e) => e.startsWith(".lock-"));
    check(`崩溃留下了未释放的锁（${locks.length} 个）`, locks.length === 1);

    // ★ 死者接管必须是**立即**的。但这里**不能**用 `elapsedMs < 阈值` 去断言：
    //   `elapsedMs` 是整个 ensureRuntime 的耗时，**包含真实解包**（CI 实测 Windows 近 100s），
    //   拿它当「接管延迟」是把两件事混为一谈，会在慢机器上假失败。
    //   改用与机器快慢无关的判据：把无推进窗口压到 2s。若接管退化为按锁的年龄判断，
    //   崩溃留下的锁还很「新鲜」，必然在 2s 内报 lock-timeout；接管成功则解包成功。
    const again = await runUnpacker(runtimeRoot, PAYLOAD_DIR, ["--lock-wait-ms", "2000"]);
    check(
      `死者持有的锁被立即接管（无推进窗口仅 2s，退化即 lock-timeout；实际 ${again.code ?? "ok"}）`,
      again.ok === true && again.unpacked === true,
    );
    check("重解后完整性标记就位", existsSync(join(target, ".ok")));
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

// ───────────────── 4. 只读运行时根（仅 POSIX）─────────────────
async function caseReadOnlyRoot() {
  if (process.platform === "win32") {
    return skip("只读运行时根 → runtime-root-unwritable", "Windows 上 chmod 对目录是 no-op");
  }
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
    // ★ 清理失败**绝不能**判测试失败。CI 实测 `hdiutil detach` 会因卷忙返回 status 16，
    //   而此时全部断言都已通过 —— 让 finally 抛异常等于用清理噪声掩盖了一次成功的验证。
    if (mounted) detachWithRetry(mount);
    rmSync(dmg, { force: true });
  }
}

/** 卷可能仍被内核短暂占用（status 16）。重试若干次；始终失败也只警告，不影响判定。 */
function detachWithRetry(mount, attempts = 6) {
  for (let i = 0; i < attempts; i++) {
    try {
      execFileSync("hdiutil", ["detach", "-quiet", "-force", mount], { stdio: "ignore" });
      return;
    } catch {
      try {
        execFileSync("sleep", ["1"]);
      } catch {
        /* ignore */
      }
    }
  }
  console.warn(`⚠ 无法卸载测试卷 ${mount}（不影响断言结果）`);
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
