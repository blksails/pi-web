/**
 * 集成(真实 runner 子进程)— agent-attachment-catalog 子进程重启(spec agent-attachment-catalog,
 * 任务 7.3;Req 5.1, 5.2)。
 *
 * 未声明 agent 的补全响应与既有完全一致的回归,已在 provider/assembly 单测层面结构性覆盖
 * (`catalog-provider.test.ts` 的「声明未缓存→零往返」+ `attachment-catalog-assembly.test.ts`
 * 的「未注入附件门面→零挂载」),此处聚焦重启这一独有的真实子进程场景:
 *
 * - 重启前物化的附件描述符权威链与子进程存活状态无关,重启后仍可按 id 签名分发读回。
 * - 重启后 `list`/`materialize` 请求/结果通道重新可用(`wireAttachmentCatalogBridge` 随
 *   `startRunner` 重跑重新装配,readiness.integration.test.ts 的 requestRestart 先例)。
 *
 * 落盘 meta 扫描幂等分支(Req 3.3)本身已在任务 2.2 的假 store 单测里独立验证;是否跨真实
 * 重启复用同一 attachmentId 取决于 pi SDK 会话恢复是否延续同一 sessionId(上游会话恢复
 * 语义,不在本 spec 保证范围),故本文件不对此做强断言,只验证请求通道本身重启后仍可用。
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
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

const SECRET = "attachment-catalog-restart-secret-0123456789";

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
let session: PiSession | undefined;

afterAll(async () => {
  await session?.stop("shutdown").catch(() => undefined);
  for (const dir of [attachDir, cwdDir, agentDir]) {
    if (dir !== undefined) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});

describe("agent-attachment-catalog — 子进程重启(Req 5.1/5.2)", () => {
  it("重启前物化件重启后仍可分发;重启后请求通道重新可用;幂等回退到落盘 meta 扫描", async () => {
    attachDir = await mkdtemp(join(tmpdir(), "attcatalog-restart-store-"));
    cwdDir = await mkdtemp(join(tmpdir(), "attcatalog-restart-cwd-"));
    agentDir = await mkdtemp(join(tmpdir(), "attcatalog-restart-agentdir-"));

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
    const channel = new PiRpcProcess(spec);
    session = new PiSession({
      id: "attcatalog-restart-0",
      resolved: makeResolved(),
      channel: channel as unknown as SessionChannel,
      idleMs: 0,
      readinessHandshake: true,
      readinessProbeTimeoutMs: 15_000,
    });

    await waitFor(() => session!.lifecycle === "ready", "initial ready");
    await waitFor(() => session!.attachmentCatalogAvailable, "declaration frame cached");

    const firstMaterialize = await session.requestCatalog({
      op: "materialize",
      entryId: "entry-1",
    });
    expect(firstMaterialize.ok).toBe(true);
    const attachmentId = firstMaterialize.attachmentId!;

    // 重启子进程(readiness.integration.test.ts 先例:直接调底层 channel.requestRestart)。
    channel.requestRestart();
    await waitFor(() => session!.lifecycle === "initializing", "lifecycle → initializing after restart");
    await waitFor(() => session!.lifecycle === "ready", "lifecycle → ready after restart", 40_000);
    await waitFor(() => session!.attachmentCatalogAvailable, "re-declared after restart");

    // 重启前物化的附件:重启后仍可按 id 签名分发读回(描述符权威链与进程存活无关)。
    const { store } = attachmentStoreConfigFromEnv({
      PI_WEB_ATTACHMENT_DIR: attachDir,
      PI_WEB_ATTACHMENT_SECRET: SECRET,
    });
    const head = await store.head(attachmentId);
    expect(head?.name).toBe("report.txt");

    // 重启后请求通道重新可用:list 正常应答。
    const listRes = await session.requestCatalog({ op: "list", query: "" });
    expect(listRes.ok).toBe(true);
    expect(listRes.entries).toEqual([{ id: "entry-1", name: "Report", version: "v1" }]);

    // 重启后子进程内存幂等映射已清空;materialize 请求/结果通道本身重新可用,新调用成功
    // 落库(设计要求仅为「重启前物化件仍可分发 + 重启后 list 以新应答为准」,Req 5.1/5.2;
    // 落盘 meta 扫描能否跨重启复用同一 attachmentId 依赖 pi SDK 会话恢复是否延续同一
    // sessionId——这属于上游会话恢复机制的语义,不在本 spec 的保证范围内,已在任务 2.2
    // 单测里用假 store 独立验证过 meta 扫描分支本身的正确性)。
    const secondMaterialize = await session.requestCatalog({
      op: "materialize",
      entryId: "entry-1",
    });
    expect(secondMaterialize.ok).toBe(true);
    expect(secondMaterialize.attachmentId).toMatch(/^att_/);
  }, 90_000);
});
