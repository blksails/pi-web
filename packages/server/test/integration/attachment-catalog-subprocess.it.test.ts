/**
 * 集成(真实 runner 子进程)— agent-attachment-catalog 目录全链(spec agent-attachment-catalog,
 * 任务 7.1;Req 3.1, 3.2, 3.3, 5.1)。
 *
 * 复用 `attachment-profile-subprocess.test.ts` 同一技术(真实 `runner.ts` 子进程,`PiRpcProcess` +
 * `PiSession`,`session.requestCatalog` 作为非 LLM 同步触发通道):
 *
 * - 声明 catalog 的 fixture → 主进程 list 拿到条目 → materialize 回 attachmentId → 主进程
 *   按同一拓扑 env 重建 store,按 id 签名分发可读。
 * - 重复 materialize 同 entryId(→ 同 version)→ 同一 attachmentId(端到端幂等,真实
 *   registry/meta 落盘,非 2.2 单测的内存假 store)。
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
import { makeResolved } from "../session/fixtures.js";

const here = dirname(fileURLToPath(import.meta.url));
const serverPkgDir = join(here, "..", "..");
const runnerEntry = join(serverPkgDir, "src", "runner", "runner.ts");
const fixture = join(serverPkgDir, "test", "runner", "fixtures", "attachment-catalog-e2e-agent.ts");

const SECRET = "attachment-catalog-subprocess-secret-0123456789";

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

let attachDir: string;
let cwdDir: string;
let agentDir: string;

const active: PiSession[] = [];

beforeAll(async () => {
  attachDir = await mkdtemp(join(tmpdir(), "attcatalog-store-"));
  cwdDir = await mkdtemp(join(tmpdir(), "attcatalog-cwd-"));
  agentDir = await mkdtemp(join(tmpdir(), "attcatalog-agentdir-"));
});

afterAll(async () => {
  for (const dir of [attachDir, cwdDir, agentDir]) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});

afterEach(async () => {
  for (const s of active.splice(0)) {
    await s.stop("shutdown").catch(() => undefined);
  }
});

function spawnRunner(): PiSession {
  const spec: SpawnSpec = {
    cmd: process.execPath,
    args: [
      "--import",
      "jiti/register",
      runnerEntry,
      "--agent",
      fixture,
      "--cwd",
      cwdDir,
      "--agent-dir",
      agentDir,
    ],
    cwd: serverPkgDir,
    env: {
      ...process.env,
      PI_WEB_ATTACHMENT_DIR: attachDir,
      PI_WEB_ATTACHMENT_SECRET: SECRET,
    } as Record<string, string>,
  };
  const channel = new PiRpcProcess(spec) as unknown as SessionChannel;
  const session = new PiSession({
    id: `attcatalog-${active.length}`,
    resolved: makeResolved(),
    channel,
    idleMs: 0,
    readinessHandshake: true,
    readinessProbeTimeoutMs: 10_000,
  });
  active.push(session);
  return session;
}

describe("agent-attachment-catalog — 真实子进程目录全链(Req 3.1-3.3/5.1)", () => {
  it("声明可用 → list 拿条目 → materialize 回 attachmentId → 按 id 签名分发可读", async () => {
    const session = spawnRunner();
    await waitFor(
      () => session.attachmentCatalogAvailable,
      "agent_attachment_catalog declaration frame cached",
    );

    const listRes = await session.requestCatalog({ op: "list", query: "" });
    expect(listRes.ok).toBe(true);
    expect(listRes.entries).toEqual([{ id: "entry-1", name: "Report", version: "v1" }]);

    const materializeRes = await session.requestCatalog({
      op: "materialize",
      entryId: "entry-1",
    });
    expect(materializeRes.ok).toBe(true);
    expect(materializeRes.attachmentId).toMatch(/^att_/);

    const { store } = attachmentStoreConfigFromEnv({
      PI_WEB_ATTACHMENT_DIR: attachDir,
      PI_WEB_ATTACHMENT_SECRET: SECRET,
    });
    const attachmentId = materializeRes.attachmentId!;
    const head = await store.head(attachmentId);
    expect(head?.name).toBe("report.txt");

    const url = await store.presignUrl(attachmentId);
    const params = new URL(url, "http://x").searchParams;
    expect(store.verifyUrl(attachmentId, Number(params.get("exp")), params.get("sig")!)).toBe(
      true,
    );

    const { stream } = await store.getReadStream(attachmentId);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).toString("utf8")).toBe("catalog content for entry-1\n");
  }, 45_000);

  it("重复 materialize 同 entryId → 同一 attachmentId(端到端幂等,真实落盘)", async () => {
    const session = spawnRunner();
    await waitFor(() => session.attachmentCatalogAvailable, "declaration frame cached");

    const first = await session.requestCatalog({ op: "materialize", entryId: "entry-1" });
    const second = await session.requestCatalog({ op: "materialize", entryId: "entry-1" });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(second.attachmentId).toBe(first.attachmentId);
  }, 45_000);
});
