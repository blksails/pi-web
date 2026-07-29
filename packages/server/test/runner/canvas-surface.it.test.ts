/**
 * 集成(真实 runner 子进程)— aigc-canvas 画廊物化视图 + A 档二创端到端(Task 8)。
 *
 * 真实 runner 装 `aigc-canvas-agent`(`extensions:[aigcExtension, canvasSurfaceExtension]`),经
 * `--session-id` 固定会话、经 spawn env 下发 attachment 存储配置(与本进程 seed 同 DIR+SECRET)。
 *
 * 覆盖:
 *  - **hydrate 重建**(8.2):预置带血缘 meta 的 image `att_` → 装配期 `hydrate` 经上游
 *    `listBySession`+`getMeta` 重建 → 推 `piweb_state`(key=`surface:canvas`)携资产 + 血缘还原;
 *  - **register(B 档)**(8.2):`run("register")` → setMeta+setState,`ui_rpc_response` ok + data.ids,
 *    **不调 provider**;
 *  - **sync reconcile**(8.2):落新 `att_` → `run("sync")` → 画廊出现新图;
 *  - **A 档 edit 端到端**(8.1):provider 经本地 mock(`DASHSCOPE_TOKENPLAN_BASE_URL` 指向 mock,
 *    model=`wan2.7-image-edit-bailian`)→ 新 `att_` + 血缘 meta 落库 → `ctx.setState` →
 *    `piweb_state`(key=`surface:canvas`)携新资产(含 `derivedFrom`);`ui_rpc_response` data.ids 非空。
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { protocolVersion } from "@blksails/pi-web-protocol";
import {
  attachmentStoreConfigFromEnv,
  ATTACHMENT_DIR_ENV,
  ATTACHMENT_SECRET_ENV,
} from "../../src/attachment/config.js";
import type { AttachmentStore } from "../../src/attachment/attachment-store.js";

const here = dirname(fileURLToPath(import.meta.url));
const serverPkgDir = join(here, "..", "..");
const runnerEntry = join(serverPkgDir, "src", "runner", "runner.ts");
const exampleAgent = join(serverPkgDir, "..", "..", "examples", "aigc-canvas-agent");

const SECRET = "canvas-integration-secret";

// 1x1 透明 PNG(供 seed 与 mock provider 回图)。
const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQBN4h0FAAAAAElFTkSuQmCC",
  "base64",
);

interface RunnerHandle {
  proc: ChildProcessWithoutNullStreams;
  frames: unknown[];
  stderr: () => string;
  send: (cmd: object) => void;
  waitForFrame: (predicate: (f: unknown) => boolean, timeoutMs?: number) => Promise<unknown>;
  dispose: () => void;
}

function launchRunner(sessionId: string, dir: string, extraEnv: NodeJS.ProcessEnv): RunnerHandle {
  const cwd = mkdtempSync(join(tmpdir(), "canvas-runner-cwd-"));
  const agentDir = mkdtempSync(join(tmpdir(), "canvas-runner-agentdir-"));
  const proc = spawn(
    process.execPath,
    [
      "--import",
      "jiti/register",
      runnerEntry,
      "--agent",
      exampleAgent,
      "--cwd",
      cwd,
      "--agent-dir",
      agentDir,
      "--session-id",
      sessionId,
    ],
    {
      cwd: serverPkgDir,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        [ATTACHMENT_DIR_ENV]: dir,
        [ATTACHMENT_SECRET_ENV]: SECRET,
        ...extraEnv,
      },
    },
  );

  const frames: unknown[] = [];
  let stdoutBuf = "";
  let stderrBuf = "";
  proc.stdout.setEncoding("utf8");
  proc.stdout.on("data", (chunk: string) => {
    stdoutBuf += chunk;
    let nl: number;
    while ((nl = stdoutBuf.indexOf("\n")) !== -1) {
      const line = stdoutBuf.slice(0, nl).trim();
      stdoutBuf = stdoutBuf.slice(nl + 1);
      if (line.length > 0) {
        try {
          frames.push(JSON.parse(line));
        } catch {
          /* 非 JSON 行忽略 */
        }
      }
    }
  });
  proc.stderr.setEncoding("utf8");
  proc.stderr.on("data", (chunk: string) => {
    stderrBuf += chunk;
  });

  const send = (cmd: object): void => {
    proc.stdin.write(`${JSON.stringify(cmd)}\n`);
  };
  const waitForFrame = (
    predicate: (f: unknown) => boolean,
    timeoutMs = 30000,
  ): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const existing = frames.find(predicate);
      if (existing !== undefined) return resolve(existing);
      const timer = setTimeout(() => {
        proc.stdout.off("data", onData);
        reject(new Error(`Timed out.\nframes=${JSON.stringify(frames)}\nstderr=${stderrBuf}`));
      }, timeoutMs);
      const onData = (): void => {
        const match = frames.find(predicate);
        if (match !== undefined) {
          clearTimeout(timer);
          proc.stdout.off("data", onData);
          resolve(match);
        }
      };
      proc.stdout.on("data", onData);
    });

  return {
    proc,
    frames,
    stderr: () => stderrBuf,
    send,
    waitForFrame,
    dispose: () => {
      proc.stdin.end();
      proc.kill("SIGKILL");
    },
  };
}

function isType(f: unknown, type: string): boolean {
  return typeof f === "object" && f !== null && (f as { type?: unknown }).type === type;
}

async function waitReady(handle: RunnerHandle): Promise<void> {
  handle.send({ id: "probe", type: "get_commands" });
  await handle.waitForFrame(
    (f) =>
      typeof f === "object" &&
      f !== null &&
      (f as { command?: unknown }).command === "get_commands",
  );
}

function seedStore(dir: string): AttachmentStore {
  const { store } = attachmentStoreConfigFromEnv({
    [ATTACHMENT_DIR_ENV]: dir,
    [ATTACHMENT_SECRET_ENV]: SECRET,
  });
  return store;
}

async function putImage(
  store: AttachmentStore,
  sessionId: string,
  name: string,
  origin: "upload" | "tool-output",
) {
  return store.put({
    bytes: new Uint8Array(PNG_1x1),
    name,
    mimeType: "image/png",
    size: PNG_1x1.length,
    sessionId,
    origin,
  });
}

/** 断言 piweb_state 帧(key=surface:canvas)的谓词。 */
function isCanvasState(f: unknown, pred: (assets: Array<Record<string, unknown>>) => boolean): boolean {
  if (!isType(f, "piweb_state")) return false;
  const frame = f as { key?: unknown; value?: { assets?: unknown } };
  if (frame.key !== "surface:canvas") return false;
  const assets = frame.value?.assets;
  return Array.isArray(assets) && pred(assets as Array<Record<string, unknown>>);
}

describe("aigc-canvas — 真实 runner 子进程:物化视图 hydrate/sync/register + A 档端到端 (Task 8)", () => {
  let handle: RunnerHandle | undefined;
  let mock: Server | undefined;
  afterEach(async () => {
    handle?.dispose();
    handle = undefined;
    if (mock !== undefined) {
      await new Promise<void>((r) => mock!.close(() => r()));
      mock = undefined;
    }
  });

  it("hydrate:预置带血缘 image att_ → 装配期重建 → piweb_state 携资产 + 血缘还原 (8.2)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "canvas-store-"));
    const sid = `canvas-hy-${Date.now()}`;
    const store = seedStore(dir);
    const root = await putImage(store, sid, "root.png", "upload");
    const child = await putImage(store, sid, "child.png", "tool-output");
    await store.setMeta(child.id, { derivedFrom: root.id, genParams: { prompt: "p" } });

    handle = launchRunner(sid, dir, {});
    await waitReady(handle);

    const frame = (await handle.waitForFrame((f) =>
      isCanvasState(f, (assets) => assets.length === 2 && assets.some((a) => a.derivedFrom === root.id)),
    )) as { value: { assets: Array<Record<string, unknown>> } };
    const derived = frame.value.assets.find((a) => a.attachmentId === child.id);
    expect(derived?.derivedFrom).toBe(root.id);
    // 探针存在 → available(get_commands 响应帧的 data.commands)。
    const cmds = handle.frames.find(
      (f) => typeof f === "object" && f !== null && (f as { command?: unknown }).command === "get_commands",
    ) as { data?: { commands?: Array<{ name?: string }> } } | undefined;
    expect((cmds?.data?.commands ?? []).some((c) => c.name === "surface:canvas")).toBe(true);
  }, 60000);

  it("register(B 档):run → setMeta+setState,ui_rpc_response ok + data.ids,不调 provider (8.2)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "canvas-store-"));
    const sid = `canvas-reg-${Date.now()}`;
    const store = seedStore(dir);
    const root = await putImage(store, sid, "root.png", "upload");
    const client = await putImage(store, sid, "client.png", "tool-output");

    handle = launchRunner(sid, dir, {});
    await waitReady(handle);

    handle.send({
      type: "ui_rpc",
      request: {
        correlationId: "reg-1",
        point: "command",
        action: "execute",
        payload: {
          domain: "canvas",
          action: "register",
          args: { attachmentId: client.id, derivedFrom: root.id, genParams: { op: "crop" } },
        },
        protocolVersion,
      },
    });

    const resp = (await handle.waitForFrame(
      (f) =>
        isType(f, "ui_rpc_response") &&
        (f as { response?: { correlationId?: unknown } }).response?.correlationId === "reg-1",
    )) as { response: { ok: boolean; result: { ok: boolean; data?: { ids?: string[] } } } };
    expect(resp.response.result.ok).toBe(true);
    expect(resp.response.result.data?.ids).toContain(client.id);

    await handle.waitForFrame((f) =>
      isCanvasState(f, (assets) => assets.some((a) => a.attachmentId === client.id && a.derivedFrom === root.id)),
    );
    // register 落库不调 provider:setMeta 已写(hydrate 再验),此处 ok 即证不经 provider。
    const persisted = await store.getMeta(client.id);
    expect(persisted?.derivedFrom).toBe(root.id);
  }, 60000);

  it("sync:落新 att_ → run('sync') → 画廊出现新图 (8.2)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "canvas-store-"));
    const sid = `canvas-sync-${Date.now()}`;
    const store = seedStore(dir);
    await putImage(store, sid, "seed.png", "upload");

    handle = launchRunner(sid, dir, {});
    await waitReady(handle);
    // 等初始 hydrate(1 张)。
    await handle.waitForFrame((f) => isCanvasState(f, (assets) => assets.length === 1));

    // 模拟触发源 ①:落新 att_(store 侧,runner 未知)。
    const late = await putImage(store, sid, "late.png", "tool-output");
    handle.send({
      type: "ui_rpc",
      request: {
        correlationId: "sync-1",
        point: "command",
        action: "execute",
        payload: { domain: "canvas", action: "sync" },
        protocolVersion,
      },
    });

    await handle.waitForFrame((f) =>
      isCanvasState(f, (assets) => assets.some((a) => a.attachmentId === late.id)),
    );
  }, 60000);

  it("A 档 edit 端到端:provider mock → 新 att_ + 血缘 → piweb_state + ui_rpc data.ids (8.1)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "canvas-store-"));
    const sid = `canvas-edit-${Date.now()}`;
    const store = seedStore(dir);
    const src = await putImage(store, sid, "src.png", "upload");

    // 本地 mock provider:POST 多模态生成 → 回图 URL;GET 图 → PNG 字节。
    const port = await new Promise<number>((resolve) => {
      mock = createServer((req, res) => {
        if (req.method === "POST") {
          const chunks: Buffer[] = [];
          req.on("data", (c) => chunks.push(c as Buffer));
          req.on("end", () => {
            res.setHeader("content-type", "application/json");
            res.end(
              JSON.stringify({
                output: {
                  choices: [
                    { message: { content: [{ image: `http://127.0.0.1:${port}/img.png` }] } },
                  ],
                },
              }),
            );
          });
          return;
        }
        // GET /img.png
        res.setHeader("content-type", "image/png");
        res.end(PNG_1x1);
      });
      mock.listen(0, "127.0.0.1", () => {
        const addr = mock!.address();
        resolve(typeof addr === "object" && addr !== null ? addr.port : 0);
      });
    });

    handle = launchRunner(sid, dir, {
      DASHSCOPE_API_KEY: "mock-key",
      DASHSCOPE_TOKENPLAN_BASE_URL: `http://127.0.0.1:${port}/api/v1`,
    });
    await waitReady(handle);

    handle.send({
      type: "ui_rpc",
      request: {
        correlationId: "edit-1",
        point: "command",
        action: "execute",
        payload: {
          domain: "canvas",
          action: "edit",
          args: { image: src.id, prompt: "make it warmer", model: "wan2.7-image-edit-bailian" },
        },
        protocolVersion,
      },
    });

    const resp = (await handle.waitForFrame(
      (f) =>
        isType(f, "ui_rpc_response") &&
        (f as { response?: { correlationId?: unknown } }).response?.correlationId === "edit-1",
      45000,
    )) as { response: { result: { ok: boolean; data?: { ids?: string[] }; error?: { code?: string } } } };
    expect(resp.response.result.ok).toBe(true);
    expect((resp.response.result.data?.ids ?? []).length).toBeGreaterThan(0);
    const newId = resp.response.result.data!.ids![0]!;

    await handle.waitForFrame((f) =>
      isCanvasState(f, (assets) => assets.some((a) => a.attachmentId === newId && a.derivedFrom === src.id)),
    );
    // 血缘落库(getMeta 还原)。
    const meta = await store.getMeta(newId);
    expect(meta?.derivedFrom).toBe(src.id);
  }, 90000);
});
