#!/usr/bin/env node
/**
 * Tauri WebView e2e：渲染层经能力桥调用 pickDirectory
 * （spec electron-to-tauri 任务 6.1，Req 10.1/10.4）。
 *
 * ★ 为什么只在 Linux 跑：`tauri-driver` **官方不支持 macOS**（无 WKWebView driver），
 *   仅支持 Windows(msedgedriver) 与 Linux(WebKitWebDriver)。因此 macOS 的三条黑盒 e2e
 *   覆盖不到「渲染层经桥拿到路径」这条路径，由本脚本在 Linux CI 上补齐。
 *
 * 本脚本额外承担一项职责：**在真实严格 CSP 下复验 `invoke` 可用**。
 *   macOS 的 WKWebView 通过 messageHandlers 做 IPC，不受页面 `connect-src` 约束（已实测）；
 *   Linux 的 WebKitGTK 与 Windows 的 WebView2 机制不同，可能走自定义协议 + fetch 而被
 *   `connect-src` 拦截。本脚本是该风险的**唯一自动化证据**（design 的风险 R1）。
 *
 * 前置（Linux）：
 *   cargo install tauri-driver --locked
 *   sudo apt-get install -y webkit2gtk-driver xvfb
 *   pnpm build:dist && node scripts/fetch-node-sidecar.mjs
 *   pnpm --filter @blksails/pi-web-desktop exec tauri build --bundles deb   # 或直接用 debug 二进制
 *   pnpm add -D webdriverio        # 未列入 devDeps：仅 Linux e2e 需要
 *
 * 跑法：`xvfb-run -a node e2e/desktop/webdriver/bridge.e2e.mjs`
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT, SHELL_BIN, check, reportAndExit, sleep } from "../shared.mjs";

const TAURI_DRIVER_PORT = 4444;

if (process.platform !== "linux") {
  // 不假装通过：明确说明该平台无法运行，并以非零码退出，避免被误读为「已覆盖」。
  console.error(
    `✗ 本 e2e 仅能在 Linux 运行（tauri-driver 不支持 ${process.platform}）。\n` +
      `  macOS 的等价覆盖见 e2e/desktop/desktop-{real,no-node,packaged}.mjs（黑盒），\n` +
      `  但它们**测不到**「渲染层经桥调用 pickDirectory」。该路径只由本脚本覆盖。`,
  );
  process.exit(2);
}

async function loadWebdriverIO() {
  try {
    return await import("webdriverio");
  } catch {
    console.error("✗ 缺少 webdriverio。请先执行：pnpm add -D webdriverio");
    process.exit(1);
  }
}

async function main() {
  if (!existsSync(SHELL_BIN)) {
    console.error(`✗ 缺少壳二进制：${SHELL_BIN}`);
    process.exit(1);
  }
  const { remote } = await loadWebdriverIO();

  // stub 目录：pick_directory 读到非空 PI_WEB_DESKTOP_STUB_PICK_DIR 时直接返回它，不弹对话框。
  // 这是替代 Electron 时代 `app.evaluate` 猴补 dialog 的可测接缝（Tauri 下对话框在 Rust 侧）。
  const stubDir = mkdtempSync(join(tmpdir(), "pi-web-stub-pick-"));

  const driver = spawn("tauri-driver", ["--port", String(TAURI_DRIVER_PORT)], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  driver.stderr.on("data", (d) => process.stderr.write(d));
  await sleep(1500);

  let browser;
  try {
    browser = await remote({
      hostname: "127.0.0.1",
      port: TAURI_DRIVER_PORT,
      capabilities: {
        browserName: "wry",
        "tauri:options": {
          application: SHELL_BIN,
          env: {
            PI_WEB_DESKTOP_STUB_PICK_DIR: stubDir,
            PI_WEB_DESKTOP_PORT: "34830",
            PI_WEB_DEFAULT_SOURCE: join(ROOT, "examples", "hello-agent"),
            PI_WEB_DEFAULT_CWD: ROOT,
          },
        },
      },
      logLevel: "warn",
    });

    // 等窗口导航到回环 UI（壳先加载随包加载页，就绪后 navigate）。
    await browser.waitUntil(
      async () => /^http:\/\/127\.0\.0\.1:/.test(await browser.getUrl()),
      { timeout: 90_000, interval: 500, timeoutMsg: "窗口未导航到本地回环 UI" },
    );
    check("Tauri 窗口导航到本地回环 UI", true);

    // ★ 严格 CSP 下 __TAURI__ 是否注入（远端页面 + withGlobalTauri + remote.urls）。
    const hasGlobal = await browser.execute(() => typeof window.__TAURI__ !== "undefined");
    check("远端回环页面下 window.__TAURI__ 已注入(上游 #11934 不复现)", hasGlobal === true);

    // ★ 严格 CSP 下 invoke 是否可用（WebKitGTK 的 IPC 机制与 WKWebView 不同 — 风险 R1）。
    const picked = await browser.executeAsync((done) => {
      const bridge = window.__TAURI__?.core?.invoke;
      if (typeof bridge !== "function") return done({ error: "invoke 不可用" });
      bridge("pick_directory").then(
        (v) => done({ value: v }),
        (e) => done({ error: String(e) }),
      );
    });
    check(
      `严格 CSP 下 invoke('pick_directory') 可用(风险 R1 的唯一自动化证据) — ${JSON.stringify(picked)}`,
      picked?.error === undefined,
    );
    check("渲染层经桥拿到被选目录的绝对路径", picked?.value === stubDir);

    // 前端访问器合成的桥（desktop-bridge.ts 的实际产物）也应工作。
    const viaBridge = await browser.executeAsync((done) => {
      // 页面已加载 pi-web 前端，其 getPiWebDesktopBridge 已在模块内；此处直接复现其逻辑。
      const invoke = window.__TAURI__?.core?.invoke;
      if (typeof invoke !== "function") return done(null);
      invoke("pick_directory").then(
        (v) => done(typeof v === "string" && v.length > 0 ? v : null),
        () => done(null),
      );
    });
    check("合成桥的 pickDirectory 语义与 Rust 侧一致", viaBridge === stubDir);
  } finally {
    if (browser) await browser.deleteSession().catch(() => {});
    driver.kill("SIGTERM");
    rmSync(stubDir, { recursive: true, force: true });
  }
  reportAndExit();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
