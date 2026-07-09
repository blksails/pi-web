/**
 * 桌面壳:ServerSupervisor.start 集成测试(spec pi-web-desktop task 2.3)。
 * 真实子进程 happy-path + env 注入断言。失败矩阵(早退/无端口/停止无残留)见 task 4.1。
 * Req 1.1, 1.2, 1.4, 1.5, 4.4, 5.1, 5.2。
 */
import { describe, it, expect, afterEach, beforeAll } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// 复用 CLI 原语(与生产 main 注入同一实现)。
import { findFreePort, waitForReady } from "@/bin/pi-web.mjs";
import { ServerSupervisor } from "@/desktop/src/server-supervisor";

const deps = { findFreePort, waitForReady };

// 最小 fake server:回写它实际收到的 env 子集,再在 PORT 上响应 200(视为就绪)。
const FAKE_SERVER = `
import http from "node:http";
import { writeFileSync } from "node:fs";
const dump = process.env.ENV_DUMP_FILE;
if (dump) writeFileSync(dump, JSON.stringify({
  PI_WEB_NODE_BIN: process.env.PI_WEB_NODE_BIN ?? null,
  ELECTRON_RUN_AS_NODE: process.env.ELECTRON_RUN_AS_NODE ?? null,
  PORT: process.env.PORT ?? null,
  SOURCE: process.env.PI_WEB_DEFAULT_SOURCE ?? null,
}));
const port = Number(process.env.PORT);
http.createServer((_q, s) => s.end("ok")).listen(port, process.env.HOSTNAME || "127.0.0.1");
`;

let dir: string;
let serverJs: string;
let dumpFile: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "pi-desktop-sup-"));
  serverJs = join(dir, "fake-server.mjs");
  dumpFile = join(dir, "env-dump.json");
  writeFileSync(serverJs, FAKE_SERVER);
});

let sup: ServerSupervisor | undefined;
afterEach(async () => {
  await sup?.stop();
  sup = undefined;
});

describe("ServerSupervisor.start(受监管拉起 + 就绪)", () => {
  it("就绪 → ok,返回回环 url 与所选端口(Req 1.1/1.2/1.4/5.1/5.2)", async () => {
    sup = new ServerSupervisor(deps);
    const outcome = await sup.start({
      serverJs,
      host: "127.0.0.1",
      startPort: 34100,
      baseEnv: { ...process.env, ENV_DUMP_FILE: dumpFile, PI_WEB_DEFAULT_SOURCE: "/some/src" },
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.value.port).toBeGreaterThanOrEqual(34100);
      expect(outcome.value.url).toBe(`http://127.0.0.1:${outcome.value.port}`);
      expect(sup.port).toBe(outcome.value.port);
    }
  }, 15_000);

  it("注入 env:子进程带 PI_WEB_NODE_BIN=execPath 与 ELECTRON_RUN_AS_NODE=1,主进程不带(Req 4.4)", async () => {
    // 前置:主进程自身 env 不含 ELECTRON_RUN_AS_NODE(继承坑防回归)。
    expect(process.env.ELECTRON_RUN_AS_NODE).toBeUndefined();

    sup = new ServerSupervisor(deps);
    const outcome = await sup.start({
      serverJs,
      host: "127.0.0.1",
      startPort: 34200,
      baseEnv: { ...process.env, ENV_DUMP_FILE: dumpFile, PI_WEB_DEFAULT_SOURCE: "/some/src" },
    });
    expect(outcome.ok).toBe(true);
    expect(existsSync(dumpFile)).toBe(true);
    const dumped = JSON.parse(readFileSync(dumpFile, "utf8")) as Record<string, string | null>;
    expect(dumped.PI_WEB_NODE_BIN).toBe(process.execPath);
    expect(dumped.ELECTRON_RUN_AS_NODE).toBe("1");
    expect(dumped.SOURCE).toBe("/some/src"); // baseEnv 透传
    if (outcome.ok) expect(dumped.PORT).toBe(String(outcome.value.port));
  }, 15_000);
});
