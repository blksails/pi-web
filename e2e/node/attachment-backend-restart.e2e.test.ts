/**
 * e2e:node — 端到端重启分发旅程(attachment-backend-pluggable spec,任务 7.3;Req 4.4)。
 *
 * 既有 `e2e:node` 基建(`_session-persistence-suite.ts` 等)在同一 vitest 进程内 in-process
 * 组装 route 模块,不驱动真实 OS server 进程的 kill/restart;本文件按 kiro-impl 指导以「node
 * 集成测试」形式实现同等断言(直接 spawn `server/index.ts` 两次,真实 kill + 重启),覆盖
 * design.md Testing Strategy #10 的关键旅程:
 *
 *   双 local-fs 拓扑(stub agent)→ 上传附件、会话引用签名 URL → **重启 server 进程**(SIGTERM
 *   杀掉第一个真实进程,以同一拓扑 env 起第二个真实进程)→ 历史附件签名分发仍返回 200,
 *   且会话本身已不存在(4.4:「无论该附件所属会话是否仍存在」)。
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const repoRoot = process.cwd();

let dirA: string;
let dirB: string;
const spawned: ChildProcess[] = [];

beforeEach(async () => {
  dirA = await mkdtemp(join(tmpdir(), "e2e-restart-a-"));
  dirB = await mkdtemp(join(tmpdir(), "e2e-restart-b-"));
});

afterEach(async () => {
  for (const p of spawned.splice(0)) {
    if (p.exitCode === null && p.signalCode === null) {
      p.kill("SIGKILL");
    }
  }
  await rm(dirA, { recursive: true, force: true });
  await rm(dirB, { recursive: true, force: true });
});

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const address = srv.address();
      if (address === null || typeof address === "string") {
        reject(new Error("failed to allocate a free port"));
        return;
      }
      const port = address.port;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

interface ServerHandle {
  proc: ChildProcess;
  port: number;
  baseUrl: string;
}

async function startServer(env: NodeJS.ProcessEnv): Promise<ServerHandle> {
  const port = await getFreePort();
  const proc = spawn(
    process.execPath,
    ["--import", "jiti/register", join(repoRoot, "server", "index.ts")],
    {
      // jiti is a devDependency of @blksails/pi-web-server (not hoisted to the repo
      // root); `--import jiti/register` must resolve it from that package's cwd
      // (same technique as `lib/app/pi-handler.ts`'s `stubSpawnSpec`). Module
      // resolution inside `server/index.ts` itself is relative to the file's own
      // path, not cwd, so its `./load-env.js`/`../lib/app/pi-handler.js` imports
      // are unaffected by this cwd choice.
      cwd: join(repoRoot, "packages", "server"),
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        ...env,
        PORT: String(port),
        HOST: "127.0.0.1",
        PI_WEB_STUB_AGENT: "1",
        PI_WEB_STUB_AGENT_PATH: join(repoRoot, "lib", "app", "stub-agent-process.mjs"),
      },
    },
  );
  spawned.push(proc);
  let stderr = "";
  proc.stderr?.setEncoding("utf8");
  proc.stderr?.on("data", (chunk: string) => (stderr += chunk));

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForReady(baseUrl, proc, () => stderr);
  return { proc, port, baseUrl };
}

async function waitForReady(
  baseUrl: string,
  proc: ChildProcess,
  stderrOf: () => string,
  maxMs = 20000,
): Promise<void> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) {
      throw new Error(`server process exited early (code ${proc.exitCode}): ${stderrOf()}`);
    }
    try {
      const res = await fetch(`${baseUrl}/api/sessions`, { method: "GET" });
      // 任意非连接错误的响应(含 404/405)即证明 HTTP 服务已就绪。
      if (res.status !== undefined) return;
    } catch {
      /* 连接被拒绝:服务器尚未监听,继续轮询 */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`server did not become ready within ${maxMs}ms: ${stderrOf()}`);
}

async function stopServer(handle: ServerHandle): Promise<void> {
  const exited = new Promise<void>((resolve) => {
    handle.proc.once("exit", () => resolve());
  });
  handle.proc.kill("SIGTERM");
  await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
}

describe("端到端重启分发旅程(attachment-backend-pluggable,Req 4.4)", () => {
  it("上传 → 会话引用 → 重启 server 进程 → 历史附件签名分发仍返回 200(会话已不复存在)", async () => {
    const topology = JSON.stringify({
      backends: [
        { kind: "local-fs", name: "primary", dir: dirA },
        { kind: "local-fs", name: "secondary", dir: dirB },
      ],
      write: "primary",
    });
    const attachmentEnv = {
      PI_WEB_ATTACHMENT_SECRET: "e2e-restart-secret-0123456789abcdef",
      PI_WEB_ATTACHMENT_BACKENDS: topology,
    };

    // ── 第一个真实进程:创建会话 + 上传附件 ──
    const server1 = await startServer(attachmentEnv);
    const sessionRes = await fetch(`${server1.baseUrl}/api/sessions`, {
      method: "POST",
      body: JSON.stringify({ source: "." }),
    });
    expect([200, 201]).toContain(sessionRes.status);
    const { sessionId } = (await sessionRes.json()) as { sessionId: string };

    const fileBytes = new TextEncoder().encode("restart-journey-payload");
    const form = new FormData();
    form.append("file", new Blob([fileBytes], { type: "text/plain" }), "journey.txt");
    const uploadRes = await fetch(
      `${server1.baseUrl}/api/sessions/${sessionId}/attachments`,
      { method: "POST", body: form },
    );
    expect(uploadRes.status).toBe(200);
    const { attachment, displayUrl } = (await uploadRes.json()) as {
      attachment: { id: string; backend?: string };
      displayUrl: string;
    };
    expect(attachment.id).toMatch(/^att_/);

    // 分发 URL 在第一个进程内即可用(健全性基线)。
    const firstFetch = await fetch(`${server1.baseUrl}${displayUrl}`);
    expect(firstFetch.status).toBe(200);
    expect(await firstFetch.text()).toBe("restart-journey-payload");

    // ── 真实重启:SIGTERM 杀掉进程 1,以同一拓扑 env 起进程 2(会话未恢复) ──
    await stopServer(server1);
    const server2 = await startServer(attachmentEnv);

    // 会话已不存在于新进程(内存 SessionManager,无 SESSION_STORE 持久化配置)。
    const missingSession = await fetch(
      `${server2.baseUrl}/api/sessions/${sessionId}/messages`,
    );
    expect(missingSession.status).toBeGreaterThanOrEqual(400);

    // 历史附件签名分发在新进程仍返回 200(Req 4.4:与会话存活状态无关)。
    const restartedFetch = await fetch(`${server2.baseUrl}${displayUrl}`);
    expect(restartedFetch.status).toBe(200);
    expect(await restartedFetch.text()).toBe("restart-journey-payload");

    await stopServer(server2);
  }, 60000);
});
