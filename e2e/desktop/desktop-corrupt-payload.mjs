#!/usr/bin/env node
/**
 * 打包态「载荷损坏」的失败呈现 e2e（spec shared-runtime-payload，Req 4.5/4.6）。
 *
 * 把**真实 `.app`** 复制一份、篡改其内嵌载荷一个字节，再启动它。要求：
 *   1. 进程**不静默退出** —— 它应停在既有的可重试错误页上等待用户操作
 *   2. 呈现可读的失败原因（判别式错误码 `payload-corrupt` → 「请重新安装应用」）
 *   3. 不落地任何带 `.ok` 的运行时目录（Req 4.5 的共同后置条件）
 *   4. 后端从未被拉起（端口保持空闲）
 *
 * ★ 为什么必须是 e2e 而非单测：Rust 侧的错误映射有单测覆盖，但「错误页而非静默退出」
 *   是 `main.rs` 里 `show_startup_error(...); return;` 与 `std::process::exit` 之间的
 *   一字之差，只有真实进程能证伪。此前这条只有一次人工验证、无任何可复现的产物。
 *
 * ⚠ 复制出的 `.app` **不能放在 `os.tmpdir()`**（macOS 是 `/var/folders/<hash>/T/`）：那里
 *   Tauri 的 `resource_dir()` 会失败，壳在触及载荷之前就报「缺少资源目录」，本 e2e 会测了个
 *   寂寞。实测 `/private/tmp`、`$HOME`、`/private/var/tmp` 均正常；**改造前的 `.app` 在
 *   `os.tmpdir()` 下同样失败**，故这是 Tauri 的既有行为，与本 spec 无关。此处落在 `target/` 下。
 *
 * 前置：`pnpm build:dist` + `tauri build --bundles app`
 * 跑法：`node e2e/desktop/desktop-corrupt-payload.mjs`
 */
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { connect as netConnect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT, check, reportAndExit } from "./shared.mjs";

const PORT = 34860;
const OBSERVE_MS = 15_000;
const APP = join(ROOT, "desktop/src-tauri/target/release/bundle/macos/pi-web.app");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function portFree(port) {
  return new Promise((res) => {
    const s = netConnect({ port, host: "127.0.0.1" });
    const done = (free) => {
      s.destroy();
      res(free);
    };
    s.once("connect", () => done(false));
    s.once("error", () => done(true));
    setTimeout(() => done(true), 800);
  });
}

async function main() {
  if (process.platform !== "darwin") {
    console.error("本 e2e 仅在 macOS 上有意义（.app 形态）。");
    process.exit(1);
  }
  if (!existsSync(join(APP, "Contents/MacOS/pi-web"))) {
    console.error(`✗ 缺少打包产物：${APP}\n  请先执行 tauri build --bundles app`);
    process.exit(1);
  }

  // ★ 见文件头：.app 不能落在 os.tmpdir()。运行时根落哪都行，仍用 tmpdir。
  const work = join(ROOT, "desktop/src-tauri/target", `e2e-corrupt-${process.pid}`);
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  const brokenApp = join(work, "pi-web.app");
  const runtimeRoot = mkdtempSync(join(tmpdir(), "pi-web-corrupt-rt-"));
  cpSync(APP, brokenApp, { recursive: true });

  // 篡改内嵌载荷的中间一个字节。
  const archive = join(brokenApp, "Contents/Resources/payload/dist.tar.zst");
  const buf = readFileSync(archive);
  const at = Math.floor(buf.length / 2);
  buf.writeUInt8(buf.readUInt8(at) ^ 0xff, at);
  writeFileSync(archive, buf);
  check("已篡改 .app 内嵌载荷一个字节", true);

  let stderr = "";
  const proc = spawn(join(brokenApp, "Contents/MacOS/pi-web"), [], {
    env: { ...process.env, PI_WEB_RUNTIME_ROOT: runtimeRoot, PI_WEB_DESKTOP_PORT: String(PORT) },
    stdio: ["ignore", "ignore", "pipe"],
  });
  proc.stderr.on("data", (d) => {
    stderr += d.toString();
  });

  let exitedEarly = false;
  proc.on("exit", () => {
    exitedEarly = true;
  });

  try {
    await sleep(OBSERVE_MS);

    // 0) 前置：必须真的走到了解包这一步。若壳在 resource_dir() 就失败，
    //    下面的断言就都是在测另一件事（见文件头的 os.tmpdir 坑）。
    check("壳成功定位到随包载荷（未卡在 resource_dir）", !/缺少资源目录/.test(stderr));

    // 1) 不静默退出 —— 停在可重试错误页
    check(`观察 ${OBSERVE_MS / 1000}s 后进程仍存活（停在可重试错误页，而非静默退出）`, !exitedEarly);

    // 2) 可读的失败原因
    check("stderr 呈现「无法准备运行时」", /无法准备运行时/.test(stderr));
    check("判别式错误码为 payload-corrupt", /payload-corrupt/.test(stderr));
    check("给出可操作的下一步（重新安装）", /重新安装应用/.test(stderr));

    // 3) 不留下带 .ok 的运行时目录（Req 4.5）
    const entries = existsSync(runtimeRoot) ? readdirSync(runtimeRoot) : [];
    const withMarker = entries.filter((e) => existsSync(join(runtimeRoot, e, ".ok")));
    check(`不留下任何带 .ok 的运行时目录（实际 ${withMarker.length} 个）`, withMarker.length === 0);
    const staging = entries.filter((e) => e.startsWith(".staging-"));
    check(`不留下 staging 残留（实际 ${staging.length} 个）`, staging.length === 0);

    // 4) 后端从未被拉起
    check("后端从未被拉起（端口保持空闲）", await portFree(PORT));
  } finally {
    proc.kill("SIGTERM");
    await sleep(2000);
    if (proc.exitCode === null && proc.signalCode === null) proc.kill("SIGKILL");
    rmSync(work, { recursive: true, force: true });
    rmSync(runtimeRoot, { recursive: true, force: true });
  }

  reportAndExit();
}
main();
