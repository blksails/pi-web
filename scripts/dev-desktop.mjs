#!/usr/bin/env node
// 开发态单入口：基座(API+Vite)就绪后，再启动指向同一 Vite 地址的 Tauri 壳。
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const desktopRoot = path.join(root, "desktop");
const webappRoot = process.env.PI_WEB_DEV_WEBAPP_DIR?.trim()
  ? path.resolve(root, process.env.PI_WEB_DEV_WEBAPP_DIR)
  : undefined;
const webappUrl = process.env.PI_LABS_WEBAPP_URL
  ?? process.env.PI_WEB_DEV_WEBAPP_URL
  ?? "http://127.0.0.1:4000";
// PI_WEB_DEV_SKIP_CLOUD=1：不 spawn cloud（已在外部起 4100 时用）；仍可按 CLOUD_URL 注 capabilities。
const skipCloudSpawn = process.env.PI_WEB_DEV_SKIP_CLOUD === "1"
  || process.env.PI_WEB_DEV_SKIP_CLOUD === "true";
const cloudRoot = !skipCloudSpawn && process.env.PI_WEB_DEV_CLOUD_DIR?.trim()
  ? path.resolve(root, process.env.PI_WEB_DEV_CLOUD_DIR)
  : undefined;
const cloudUrl = process.env.PI_WEB_DEV_CLOUD_URL ?? "http://127.0.0.1:4100";
const cloudPort = new URL(cloudUrl).port || "4100";
const useExternalCloud = skipCloudSpawn
  || process.env.PI_WEB_DEV_CLOUD_URL?.trim()
  || process.env.PI_CLOUDS_DESKTOP_CAPABILITIES_URL?.trim();
const devUrl = process.env.PI_WEB_DESKTOP_DEV_URL
  ?? `http://127.0.0.1:${process.env.PI_WEB_DEV_CLIENT_PORT ?? 5173}`;
const apiUrl = process.env.PI_WEB_DEV_API_URL
  ?? `http://127.0.0.1:${process.env.PORT ?? 3000}`;
// Desktop development owns local pi sessions.  Do not make the sidebar depend
// on an optional Docker/Postgres service inherited from .env.local; callers can
// opt back into another backend explicitly when they need shared persistence.
const desktopSessionStore = process.env.PI_WEB_DEV_SESSION_STORE?.trim() || "fs";
const webviewCdpPort = process.env.PI_WEB_DEV_WEBVIEW_CDP_PORT ?? "9223";
const webviewArgs = process.env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS ?? "";
const noProxy = [...new Set([
  ...(process.env.NO_PROXY ?? process.env.no_proxy ?? "").split(",").filter(Boolean),
  "127.0.0.1",
  "localhost",
])].join(",");
const devEnv = {
  ...process.env,
  NO_PROXY: noProxy,
  no_proxy: noProxy,
  PI_WEB_DEV_CLIENT_HOST: process.env.PI_WEB_DEV_CLIENT_HOST ?? "127.0.0.1",
  PI_WEB_DEV_API_URL: apiUrl,
  PI_WEB_NATIVE_CHILD_WEBVIEWS: process.env.PI_WEB_NATIVE_CHILD_WEBVIEWS ?? "1",
  SESSION_STORE: desktopSessionStore,
  PI_WEB_SHELL_TOKEN: process.env.PI_WEB_SHELL_TOKEN ?? randomBytes(32).toString("hex"),
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: webviewArgs.includes("--remote-debugging-port=")
    ? webviewArgs
    : `${webviewArgs} --remote-debugging-port=${webviewCdpPort}`.trim(),
  ...(webappRoot !== undefined ? { PI_LABS_WEBAPP_URL: webappUrl } : {}),
  ...((cloudRoot !== undefined || useExternalCloud) ? {
    PI_WEB_CLOUD_LOGIN_EGRESS_BASE: process.env.PI_WEB_CLOUD_LOGIN_EGRESS_BASE
      ?? `${cloudUrl.replace(/\/+$/, "")}/api/desktop/egress/v1`,
    PI_CLOUDS_DESKTOP_CAPABILITIES_URL: process.env.PI_CLOUDS_DESKTOP_CAPABILITIES_URL
      ?? `${cloudUrl.replace(/\/+$/, "")}/api/desktop/capabilities`,
  } : {}),
};
const children = [];
let closing = false;

function run(command, args, env = devEnv, cwd = root) {
  const child = spawn(command, args, {
    cwd,
    env,
    stdio: "inherit",
    shell: false,
  });
  children.push(child);
  child.once("exit", (code) => stop(code ?? 0));
  return child;
}

function stop(code) {
  if (closing) return;
  closing = true;
  for (const child of children) {
    if (child.exitCode === null) child.kill("SIGTERM");
  }
  process.exitCode = code;
}

async function waitForBase() {
  const webUrl = `${devUrl}/`;
  const apiReadyUrl = new URL("/api/bootstrap", apiUrl);
  const timeoutMs = Number(process.env.PI_WEB_DEV_READY_TIMEOUT_MS ?? 90_000);
  const until = Date.now() + timeoutMs;
  const probes = [
    { url: webUrl },
    { url: apiReadyUrl.toString() },
    ...(webappRoot !== undefined ? [{ url: webappUrl }] : []),
    // 外部已起的 cloud 也纳入 ready 门闩。
    ...((cloudRoot !== undefined || skipCloudSpawn) ? [{ url: cloudUrl }] : []),
  ];
  while (Date.now() < until) {
    try {
      const responses = await Promise.all(probes.map((p) => fetch(p.url, { redirect: "manual" })));
      for (let i = 0; i < probes.length; i++) probes[i].status = responses[i].status;
      if (responses.every((response) => response.status < 500)) return;
    } catch {
      // Vite 或 API 尚未就绪。
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  const detail = probes.map((p) => `${p.url} -> ${p.status ?? "unreachable"}`).join("; ");
  throw new Error(`Timed out waiting for base after ${timeoutMs}ms. ${detail}`);
}

process.once("SIGINT", () => stop(0));
process.once("SIGTERM", () => stop(0));

if (webappRoot !== undefined) {
  const pnpmCli = process.env.npm_execpath;
  if (pnpmCli === undefined || pnpmCli === "") {
    throw new Error("PI_WEB_DEV_WEBAPP_DIR requires launching through pnpm dev:desktop");
  }
  run(
    process.execPath,
    [pnpmCli, "--dir", webappRoot, "--filter", process.env.PI_WEB_DEV_WEBAPP_FILTER ?? "web", "dev"],
    devEnv,
    webappRoot,
  );
}
if (cloudRoot !== undefined) {
  const pnpmCli = process.env.npm_execpath;
  if (pnpmCli === undefined || pnpmCli === "") {
    throw new Error("PI_WEB_DEV_CLOUD_DIR requires launching through pnpm dev:desktop");
  }
  const cloudEnvFiles = [
    path.join(cloudRoot, "apps", "cloud", ".env.local"),
    path.join(cloudRoot, "apps", "cloud", ".env"),
    path.join(cloudRoot, ".env.local"),
    path.join(cloudRoot, ".env"),
  ];
  const childCloudHasToken = cloudEnvFiles.some((file) => {
    try {
      return /^\s*PI_CLOUDS_DESKTOP_TOKEN_SECRET\s*=\s*[^#\r\n]+/m.test(readFileSync(file, "utf8"));
    } catch {
      return false;
    }
  });
  if ((process.env.PI_CLOUDS_DESKTOP_TOKEN_SECRET ?? "").trim() === "" && !childCloudHasToken) {
    throw new Error("PI_WEB_DEV_CLOUD_DIR requires PI_CLOUDS_DESKTOP_TOKEN_SECRET");
  }
  run(
    process.execPath,
    [pnpmCli, "--dir", cloudRoot, "--filter", process.env.PI_WEB_DEV_CLOUD_FILTER ?? "@pi-clouds/cloud", "dev"],
    { ...devEnv, PORT: cloudPort },
    cloudRoot,
  );
}
run(process.execPath, ["scripts/dev-all.mjs"]);
try {
  await waitForBase();
  run(
    process.execPath,
    [
      path.join(desktopRoot, "node_modules", "@tauri-apps", "cli", "tauri.js"),
      "dev",
      "--config",
      JSON.stringify({ build: { devUrl } }),
    ],
    { ...devEnv, PI_WEB_DESKTOP_DEV_URL: devUrl },
    desktopRoot,
  );
} catch (error) {
  console.error(error);
  stop(1);
}
