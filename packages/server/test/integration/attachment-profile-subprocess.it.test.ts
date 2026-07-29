/**
 * 集成(真实 runner 子进程)— agent-attachment-profile 双态全闭环(spec
 * agent-attachment-profile,任务 6.1;Req 2.2/3.2)。
 *
 * 复用 `agent-routes-subprocess.test.ts` 同一技术(真实 `runner.ts` 子进程,`PiRpcProcess` +
 * `PiSession` 消费,`invokeAgentRoute` 作为非 LLM 同步触发通道):
 *
 * - **有效 profile**:fixture `attachment-profile-e2e-agent` 声明 `attachmentProfile:"secondary"`,
 *   拓扑含 primary/secondary 两个 local-fs 后端。子进程装配期白名单校验通过 → 发
 *   `agent_attachment_profile` 帧(PiSession 缓存)→ `put-output` route 触发子进程内
 *   `ctx.putOutput` → 产物落 secondary 后端且描述符固化该名(主进程按同一拓扑 env 重建 store 验证)。
 * - **未注册 profile**:fixture `attachment-profile-invalid-agent` 声明的名字不在同一拓扑声明集合
 *   中 → runner 装配期抛 `InvalidAgentDefinitionError` → 进程 ready 前退出 → PiSession
 *   lifecycle 收敛为 `error{code:"exit-before-ready"}`(exit code ≠ 0)。
 */
import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { SpawnSpec, SseFrame } from "@blksails/pi-web-protocol";
import { PiRpcProcess } from "../../src/rpc-channel/pi-rpc-process.js";
import { PiSession } from "../../src/session/pi-session.js";
import type { SessionChannel } from "../../src/session/session.types.js";
import { attachmentStoreConfigFromEnv } from "../../src/attachment/config.js";
import { makeResolved } from "../session/fixtures.js";

const here = dirname(fileURLToPath(import.meta.url));
// test/integration -> packages/server
const serverPkgDir = join(here, "..", "..");
const runnerEntry = join(serverPkgDir, "src", "runner", "runner.ts");
const validFixture = join(
  serverPkgDir,
  "test",
  "runner",
  "fixtures",
  "attachment-profile-e2e-agent",
);
const invalidFixture = join(
  serverPkgDir,
  "test",
  "runner",
  "fixtures",
  "attachment-profile-invalid-agent.ts",
);

const SECRET = "attachment-profile-subprocess-secret-0123456789";

async function waitFor(
  pred: () => boolean,
  what: string,
  timeoutMs = 20_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!pred()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

let dirPrimary: string;
let dirSecondary: string;
let cwdDir: string;
let agentDir: string;
let topologyEnv: string;

const active: PiSession[] = [];

beforeAll(async () => {
  dirPrimary = await mkdtemp(join(tmpdir(), "attprofile-primary-"));
  dirSecondary = await mkdtemp(join(tmpdir(), "attprofile-secondary-"));
  cwdDir = await mkdtemp(join(tmpdir(), "attprofile-cwd-"));
  agentDir = await mkdtemp(join(tmpdir(), "attprofile-agentdir-"));
  topologyEnv = JSON.stringify({
    backends: [
      { kind: "local-fs", name: "primary", dir: dirPrimary },
      { kind: "local-fs", name: "secondary", dir: dirSecondary },
    ],
    write: "primary",
  });
  // pi-session.ts 的防御性核对读的是**主进程自身** process.env(不是子进程的),
  // 须把同一拓扑也设进本测试进程的 env,否则 handleRawLine 会判定「本进程视角无拓扑」而丢帧
  // (design.md §行为规约:主/子两侧各自读自身 env,这正是本测试要覆盖的真实部署形态)。
  process.env.PI_WEB_ATTACHMENT_BACKENDS = topologyEnv;
});

afterAll(async () => {
  delete process.env.PI_WEB_ATTACHMENT_BACKENDS;
  for (const dir of [dirPrimary, dirSecondary, cwdDir, agentDir]) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});

afterEach(async () => {
  for (const s of active.splice(0)) {
    await s.stop("shutdown").catch(() => undefined);
  }
});

function spawnRunner(agentPath: string, extraEnv: Record<string, string> = {}): PiSession {
  const spec: SpawnSpec = {
    cmd: process.execPath,
    args: [
      "--import",
      "jiti/register",
      runnerEntry,
      "--agent",
      agentPath,
      "--cwd",
      cwdDir,
      "--agent-dir",
      agentDir,
    ],
    cwd: serverPkgDir,
    env: {
      ...process.env,
      PI_WEB_ATTACHMENT_DIR: dirPrimary,
      PI_WEB_ATTACHMENT_SECRET: SECRET,
      PI_WEB_ATTACHMENT_BACKENDS: topologyEnv,
      ...extraEnv,
    } as Record<string, string>,
  };
  const channel = new PiRpcProcess(spec) as unknown as SessionChannel;
  const session = new PiSession({
    id: `attprofile-${active.length}`,
    resolved: makeResolved(),
    channel,
    idleMs: 0,
    readinessHandshake: true,
    readinessProbeTimeoutMs: 15000,
  });
  active.push(session);
  return session;
}

describe("agent-attachment-profile — 真实子进程双态(Req 2.2/3.2)", () => {
  it("有效 profile:白名单通过 → 帧被主进程缓存 → 子进程产物落 profile 后端且描述符固化该名", async () => {
    const session = spawnRunner(validFixture);

    // 就绪锚点:装配期声明帧(agent_attachment_profile)已被 PiSession 缓存。
    await waitFor(
      () => session.getAttachmentWriteProfile() === "secondary",
      "agent_attachment_profile declaration frame cached",
    );

    const res = await session.invokeAgentRoute("put-output", {
      method: "GET",
      query: {},
    });
    expect(res.ok).toBe(true);
    const result = res.result as { ok: boolean; attachmentId?: string };
    expect(result.ok).toBe(true);
    expect(result.attachmentId).toMatch(/^att_/);

    // 主进程按同一拓扑 env 重建 store,按 id 读回描述符,断言 backend 固化为 "secondary"。
    const { store } = attachmentStoreConfigFromEnv({
      PI_WEB_ATTACHMENT_DIR: dirPrimary,
      PI_WEB_ATTACHMENT_SECRET: SECRET,
      PI_WEB_ATTACHMENT_BACKENDS: topologyEnv,
    });
    const head = await store.head(result.attachmentId!);
    expect(head?.backend).toBe("secondary");
  }, 30_000);

  it("未注册 profile:装配期白名单校验失败 → 子进程 ready 前退出(exit-before-ready)", async () => {
    const session = spawnRunner(invalidFixture);
    const frames: SseFrame[] = [];
    session.subscribe((f) => frames.push(f));

    await waitFor(() => session.lifecycle === "error", "lifecycle to become error");
    const statuses = frames.filter(
      (f) =>
        f.kind === "control" &&
        (f as { payload?: { control?: string } }).payload?.control === "session-status",
    );
    const last = statuses[statuses.length - 1] as
      | { payload: { state: string; code?: string } }
      | undefined;
    expect(last?.payload.state).toBe("error");
    expect(last?.payload.code).toBe("exit-before-ready");
  }, 30_000);
});
