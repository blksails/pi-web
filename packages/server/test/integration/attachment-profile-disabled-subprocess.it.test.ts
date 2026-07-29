/**
 * 集成(真实 runner 子进程)— agent-attachment-profile 关断双态(spec
 * agent-attachment-profile,任务 6.3;Req 5.1/5.2)。
 *
 * 关断经 `PI_WEB_AGENT_ATTACHMENT_PROFILE_DISABLED=1` 生效,但主/子两进程各自读自身 env
 * (design.md 行为规约),因此存在两个独立生效点,须分别覆盖:
 *
 * - **仅主进程设关断**:关断值只落在本测试(「主」)进程的 `process.env`,不下发进子进程 spawn
 *   env。子进程视角未关断 → 正常校验白名单并发出 `agent_attachment_profile` 帧;但主进程
 *   `pi-session.ts` 消费帧前先查自身 `isAttachmentProfileDisabled(process.env)` → 关断 → 丢帧
 *   不缓存 → 写入解析不到 profile → 落宿主默认(primary)。会话正常创建、不失败。
 * - **关断经 spawn 下发**(真实部署形态,对应 pi-handler 的 `attachmentSpawnEnv` 转发链路):
 *   关断值写进子进程 spawn env。子进程 `runner.ts` 装配期 `isAttachmentProfileDisabled(env)`
 *   优先于白名单校验命中 → 视同未声明 → 跳过校验、零帧发射(即使定义声明了合法 profile 名字)。
 *   会话正常创建、写入落宿主默认(primary)。
 *
 * 两态下,未声明 attachmentProfile 的 agent(`attachment-profile-undeclared-agent`)行为均
 * 不受影响 —— 全程无帧参与,写入照旧落 primary。
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { SpawnSpec } from "@blksails/pi-web-protocol";
import { PiRpcProcess } from "../../src/rpc-channel/pi-rpc-process.js";
import { PiSession } from "../../src/session/pi-session.js";
import type { SessionChannel } from "../../src/session/session.types.js";
import { attachmentStoreConfigFromEnv } from "../../src/attachment/config.js";
import { ATTACHMENT_PROFILE_DISABLED_ENV } from "../../src/attachment/backends-config.js";
import { makeResolved } from "../session/fixtures.js";

const here = dirname(fileURLToPath(import.meta.url));
const serverPkgDir = join(here, "..", "..");
const runnerEntry = join(serverPkgDir, "src", "runner", "runner.ts");
const validFixture = join(
  serverPkgDir,
  "test",
  "runner",
  "fixtures",
  "attachment-profile-e2e-agent",
);
const undeclaredFixture = join(
  serverPkgDir,
  "test",
  "runner",
  "fixtures",
  "attachment-profile-undeclared-agent.ts",
);

const SECRET = "attachment-profile-disabled-subprocess-secret-0123456789";

async function waitFor(
  pred: () => boolean,
  what: string,
  timeoutMs = 40_000,
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
  dirPrimary = await mkdtemp(join(tmpdir(), "attprofiledis-primary-"));
  dirSecondary = await mkdtemp(join(tmpdir(), "attprofiledis-secondary-"));
  cwdDir = await mkdtemp(join(tmpdir(), "attprofiledis-cwd-"));
  agentDir = await mkdtemp(join(tmpdir(), "attprofiledis-agentdir-"));
  topologyEnv = JSON.stringify({
    backends: [
      { kind: "local-fs", name: "primary", dir: dirPrimary },
      { kind: "local-fs", name: "secondary", dir: dirSecondary },
    ],
    write: "primary",
  });
  // 拓扑须同时落在本(主)测试进程 env,pi-session.ts 的防御性核对读的是主进程自身 env。
  process.env.PI_WEB_ATTACHMENT_BACKENDS = topologyEnv;
});

afterAll(async () => {
  delete process.env.PI_WEB_ATTACHMENT_BACKENDS;
  delete process.env[ATTACHMENT_PROFILE_DISABLED_ENV];
  for (const dir of [dirPrimary, dirSecondary, cwdDir, agentDir]) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});

afterEach(async () => {
  delete process.env[ATTACHMENT_PROFILE_DISABLED_ENV];
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
    id: `attprofiledis-${active.length}`,
    resolved: makeResolved(),
    channel,
    idleMs: 0,
    readinessHandshake: true,
    readinessProbeTimeoutMs: 10_000,
  });
  active.push(session);
  return session;
}

async function assertWroteToPrimary(attachmentId: string): Promise<void> {
  const { store } = attachmentStoreConfigFromEnv({
    PI_WEB_ATTACHMENT_DIR: dirPrimary,
    PI_WEB_ATTACHMENT_SECRET: SECRET,
    PI_WEB_ATTACHMENT_BACKENDS: topologyEnv,
  });
  const head = await store.head(attachmentId);
  expect(head?.backend).toBe("primary");
}

describe("agent-attachment-profile — 关断双态(Req 5.1/5.2)", () => {
  it("仅主进程设关断:子进程正常发帧,但主进程按自身关断丢帧不缓存 → 写入落宿主默认;会话不失败", async () => {
    process.env[ATTACHMENT_PROFILE_DISABLED_ENV] = "1"; // 只设在本(主)进程,不下发进子进程 spawn env

    const session = spawnRunner(validFixture);
    await waitFor(() => session.lifecycle === "ready", "session to become ready");

    // 给子进程一个稳定的观察窗口,断言主进程侧确实从未缓存 profile(关断丢帧生效)。
    await new Promise((r) => setTimeout(r, 200));
    expect(session.getAttachmentWriteProfile()).toBeUndefined();

    const res = await session.invokeAgentRoute("put-output", { method: "GET", query: {} });
    expect(res.ok).toBe(true);
    const result = res.result as { ok: boolean; attachmentId?: string };
    expect(result.ok).toBe(true);
    await assertWroteToPrimary(result.attachmentId!);
  }, 50_000);

  it("关断经 spawn 下发:子进程视同未声明,跳过校验且零帧发射 → 写入落宿主默认;会话不失败", async () => {
    const session = spawnRunner(validFixture, {
      [ATTACHMENT_PROFILE_DISABLED_ENV]: "1",
    });
    await waitFor(() => session.lifecycle === "ready", "session to become ready");

    await new Promise((r) => setTimeout(r, 200));
    expect(session.getAttachmentWriteProfile()).toBeUndefined();

    const res = await session.invokeAgentRoute("put-output", { method: "GET", query: {} });
    expect(res.ok).toBe(true);
    const result = res.result as { ok: boolean; attachmentId?: string };
    expect(result.ok).toBe(true);
    await assertWroteToPrimary(result.attachmentId!);
  }, 50_000);

  it("未声明 attachmentProfile 的 agent 在两种关断状态下行为均不受影响(写入照旧落 primary)", async () => {
    // 态一:仅主进程关断。
    process.env[ATTACHMENT_PROFILE_DISABLED_ENV] = "1";
    const sessionA = spawnRunner(undeclaredFixture);
    await waitFor(() => sessionA.lifecycle === "ready", "sessionA to become ready");
    const resA = await sessionA.invokeAgentRoute("put-output", { method: "GET", query: {} });
    expect(resA.ok).toBe(true);
    const resultA = resA.result as { ok: boolean; attachmentId?: string };
    await assertWroteToPrimary(resultA.attachmentId!);
    delete process.env[ATTACHMENT_PROFILE_DISABLED_ENV];

    // 态二:关断经 spawn 下发。
    const sessionB = spawnRunner(undeclaredFixture, {
      [ATTACHMENT_PROFILE_DISABLED_ENV]: "1",
    });
    await waitFor(() => sessionB.lifecycle === "ready", "sessionB to become ready");
    const resB = await sessionB.invokeAgentRoute("put-output", { method: "GET", query: {} });
    expect(resB.ok).toBe(true);
    const resultB = resB.result as { ok: boolean; attachmentId?: string };
    await assertWroteToPrimary(resultB.attachmentId!);
  }, 50_000);
});
