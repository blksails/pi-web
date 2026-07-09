/**
 * 桌面壳:ServerSupervisor 启动失败矩阵集成测试(spec pi-web-desktop task 4.1)。
 * 补 2.3(happy)/2.4(stop 树)未覆盖的三条判别式失败路径 + 失败即收尾。
 * Req 2.2, 4.4, 6.2, 6.3, 6.4。
 */
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findFreePort, waitForReady } from "@/bin/pi-web.mjs";
import { ServerSupervisor } from "@/desktop/src/server-supervisor";

const realDeps = { findFreePort, waitForReady };

/** 立即退出(不监听)的 fake server:触发 early-exit 路径。 */
const FAKE_EARLY_EXIT = `
process.stderr.write("boom: intentional early exit\\n");
process.exit(7);
`;

/** 长命 fake server(监听但我们注入超时探针 → 触发 ready-timeout,并验证 stop 收尾)。 */
const FAKE_ALIVE = `
import http from "node:http";
http.createServer((_q, s) => s.end("ok")).listen(Number(process.env.PORT), "127.0.0.1");
`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let dir: string;
let earlyExitJs: string;
let aliveJs: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "pi-desktop-fail-"));
  earlyExitJs = join(dir, "early-exit.mjs");
  aliveJs = join(dir, "alive.mjs");
  writeFileSync(earlyExitJs, FAKE_EARLY_EXIT);
  writeFileSync(aliveJs, FAKE_ALIVE);
});

let sup: ServerSupervisor | undefined;
afterEach(async () => {
  await sup?.stop();
  sup = undefined;
});

describe("ServerSupervisor 失败矩阵", () => {
  it("server 就绪前退出 → early-exit(带退出码与 stderr 线索),无遗留子进程(Req 2.2)", async () => {
    sup = new ServerSupervisor(realDeps);
    const outcome = await sup.start({
      serverJs: earlyExitJs,
      host: "127.0.0.1",
      startPort: 34500,
      baseEnv: { ...process.env },
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.kind).toBe("early-exit");
      if (outcome.error.kind === "early-exit") {
        expect(outcome.error.code).toBe(7);
        expect(outcome.error.stderrTail).toMatch(/boom/);
      }
    }
  }, 15_000);

  it("无空闲端口 → no-free-port,不 spawn 任何进程(Req 2.x)", async () => {
    // 注入 findFreePort 返回 undefined(模拟一段端口全被占),不真占 20 个端口。
    sup = new ServerSupervisor({
      findFreePort: async () => undefined,
      waitForReady,
    });
    const outcome = await sup.start({
      serverJs: aliveJs,
      host: "127.0.0.1",
      startPort: 34600,
      baseEnv: { ...process.env },
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.kind).toBe("no-free-port");
      if (outcome.error.kind === "no-free-port") {
        expect(outcome.error.triedFrom).toBe(34600);
      }
    }
    expect(sup.port).toBeUndefined();
  }, 15_000);

  it("就绪超时 → ready-timeout,且已收尾拉起的(仍存活的)server(Req 6.x)", async () => {
    // 注入 reject 的探针(模拟超时),server 实际存活 → exited=false → ready-timeout;
    // 断言 start 的失败分支已 stop 收尾:端口释放(server 被杀)。
    const spyDeps = {
      findFreePort,
      waitForReady: async () => {
        // 给子进程时间起来,以便断言它确实被 stop 杀掉(而非从未起)。
        await sleep(300);
        throw new Error("ready timeout (injected)");
      },
    };
    sup = new ServerSupervisor(spyDeps);
    const outcome = await sup.start({
      serverJs: aliveJs,
      host: "127.0.0.1",
      startPort: 34700,
      baseEnv: { ...process.env },
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.kind).toBe("ready-timeout");
    // 收尾后端口应释放(server 被 stop 杀掉)。
    await sleep(300);
    const free = await findFreePort("127.0.0.1", 34700, 1);
    expect(free).toBe(34700);
  }, 15_000);
});
