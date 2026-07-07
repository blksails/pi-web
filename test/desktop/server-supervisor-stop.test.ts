/**
 * 桌面壳:ServerSupervisor.stop 进程树收尾集成测试(spec pi-web-desktop task 2.4)。
 * 真实子进程 + 孙进程:stop 整组终止(触达孙进程)、端口释放、幂等。Req 6.1/6.2/6.3/6.4。
 */
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findFreePort, waitForReady } from "@/bin/pi-web.mjs";
import { ServerSupervisor } from "@/desktop/src/server-supervisor";

const deps = { findFreePort, waitForReady };

// fake server 自身再 spawn 一个长命孙进程(模拟 runner);回写 server/孙进程 pid。
// 孙进程未 detached → 继承 server 进程组,故对组长发负 pid 信号可触达它。
const FAKE_SERVER_WITH_CHILD = `
import http from "node:http";
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
const gc = spawn(process.execPath, ["-e", "setInterval(() => {}, 1e9)"], { stdio: "ignore" });
const dump = process.env.TREE_DUMP_FILE;
if (dump) writeFileSync(dump, JSON.stringify({ serverPid: process.pid, grandchildPid: gc.pid }));
http.createServer((_q, s) => s.end("ok")).listen(Number(process.env.PORT), "127.0.0.1");
`;

/** 进程是否存活(信号 0 探测);ESRCH 抛错 → 已死。 */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let dir: string;
let serverJs: string;
let dumpFile: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "pi-desktop-stop-"));
  serverJs = join(dir, "fake-server-tree.mjs");
  dumpFile = join(dir, "tree-dump.json");
  writeFileSync(serverJs, FAKE_SERVER_WITH_CHILD);
});

let sup: ServerSupervisor | undefined;
afterEach(async () => {
  await sup?.stop();
  sup = undefined;
});

describe("ServerSupervisor.stop(进程树收尾)", () => {
  it("stop 后 server 与孙进程都不存活、端口释放、可再次占用(Req 6.1/6.2/6.4)", async () => {
    sup = new ServerSupervisor(deps);
    const outcome = await sup.start({
      serverJs,
      host: "127.0.0.1",
      startPort: 34300,
      baseEnv: { ...process.env, TREE_DUMP_FILE: dumpFile },
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const port = outcome.value.port;

    expect(existsSync(dumpFile)).toBe(true);
    const { serverPid, grandchildPid } = JSON.parse(readFileSync(dumpFile, "utf8")) as {
      serverPid: number;
      grandchildPid: number;
    };
    expect(alive(serverPid)).toBe(true);
    expect(alive(grandchildPid)).toBe(true);

    await sup.stop();
    await sleep(300); // 给 OS 回收进程

    expect(alive(serverPid)).toBe(false);
    expect(alive(grandchildPid)).toBe(false); // 整组 kill 触达孙进程(不留孤儿)

    // 端口释放:findFreePort 从该端口起应立即返回该端口本身(未被占用)。
    const free = await findFreePort("127.0.0.1", port, 1);
    expect(free).toBe(port);
  }, 20_000);

  it("stop 幂等:重复调用不抛错(Req 6.x)", async () => {
    sup = new ServerSupervisor(deps);
    const outcome = await sup.start({
      serverJs,
      host: "127.0.0.1",
      startPort: 34400,
      baseEnv: { ...process.env, TREE_DUMP_FILE: dumpFile },
    });
    expect(outcome.ok).toBe(true);
    await sup.stop();
    await expect(sup.stop()).resolves.toBeUndefined();
    await expect(sup.stop()).resolves.toBeUndefined();
  }, 20_000);
});
