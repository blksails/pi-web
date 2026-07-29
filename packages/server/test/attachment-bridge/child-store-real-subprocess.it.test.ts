/**
 * attachment-bridge · 主/子进程真实子进程集成测试(attachment-backend-pluggable spec,任务 7.2;
 * Req 6.1, 6.2, 6.3)。
 *
 * 真实 OS 子进程(`node --import jiti/register fixtures/child-put-tool-output.ts`,与
 * `test/runner/canvas-surface.integration.test.ts` 同一「真实子进程 + jiti 跑 TS 源码」技术),
 * 覆盖:
 * - 拓扑生效下(spawn env 下发 `PI_WEB_ATTACHMENT_BACKENDS` + 引用的凭据变量)子进程工具
 *   `createChildAttachmentStore` 落库 → 主进程(同拓扑 env)按 id 完成描述符读取与签名分发
 *   (Req 6.1/6.2);
 * - env 不下发(DIR 与 BACKENDS 均缺席)→ 子进程侧既有降级语义(`available:false`,不崩溃,Req 6.3)。
 */
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { attachmentStoreConfigFromEnv } from "../../src/attachment/config.js";

const here = dirname(fileURLToPath(import.meta.url));
const serverPkgDir = join(here, "..", "..");
const fixtureScript = join(here, "fixtures", "child-put-tool-output.ts");

const SECRET = "real-subprocess-secret-0123456789";

let dirA: string;
let dirB: string;

beforeEach(async () => {
  dirA = await mkdtemp(join(tmpdir(), "realsub-a-"));
  dirB = await mkdtemp(join(tmpdir(), "realsub-b-"));
});
afterEach(async () => {
  await rm(dirA, { recursive: true, force: true });
  await rm(dirB, { recursive: true, force: true });
});

/** 只透传测试显式指定的 env(不继承 process.env 里可能残留的 PI_WEB_ATTACHMENT_* 变量)。 */
function runChild(extraEnv: Record<string, string>): Promise<{ stdout: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      process.execPath,
      ["--import", "jiti/register", fixtureScript],
      {
        cwd: serverPkgDir,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          PATH: process.env["PATH"] ?? "",
          ...extraEnv,
        },
      },
    );
    let stdout = "";
    let stderr = "";
    proc.stdout.setEncoding("utf8");
    proc.stdout.on("data", (chunk: string) => (stdout += chunk));
    proc.stderr.setEncoding("utf8");
    proc.stderr.on("data", (chunk: string) => (stderr += chunk));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code !== 0 && stdout.trim() === "") {
        reject(new Error(`child exited ${code}: ${stderr}`));
        return;
      }
      resolve({ stdout, code });
    });
  });
}

describe("真实子进程 — 拓扑生效:子进程落库 → 主进程按 id 完成描述符读取与签名分发(Req 6.1/6.2)", () => {
  it("双 local-fs 拓扑:子进程 put(tool-output) → 主进程 head/getReadStream/presignUrl 均命中", async () => {
    const topology = JSON.stringify({
      backends: [
        { kind: "local-fs", name: "primary", dir: dirA },
        { kind: "local-fs", name: "secondary", dir: dirB },
      ],
      write: "secondary",
    });
    const { stdout } = await runChild({
      PI_WEB_ATTACHMENT_SECRET: SECRET,
      PI_WEB_ATTACHMENT_BACKENDS: topology,
      TEST_SESSION_ID: "sess-real-subprocess-1",
    });
    const line = stdout.trim().split("\n").filter(Boolean).pop()!;
    const out = JSON.parse(line) as { available: boolean; id?: string; backend?: string | null };
    expect(out.available).toBe(true);
    expect(out.id).toMatch(/^att_/);
    expect(out.backend).toBe("secondary");

    // 主进程按同一拓扑 env 重建 store,按子进程返回的 id 完成读取与签名分发。
    const { store: main } = attachmentStoreConfigFromEnv({
      PI_WEB_ATTACHMENT_SECRET: SECRET,
      PI_WEB_ATTACHMENT_BACKENDS: topology,
    });
    const head = await main.head(out.id!);
    expect(head?.origin).toBe("tool-output");
    expect(head?.backend).toBe("secondary");

    const { stream, meta } = await main.getReadStream(out.id!);
    expect(meta.size).toBe(4);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    expect([...Buffer.concat(chunks)]).toEqual([1, 2, 3, 4]);

    const url = await main.presignUrl(out.id!);
    const params = new URL(url, "http://x").searchParams;
    expect(
      main.verifyUrl(out.id!, Number(params.get("exp")), params.get("sig")!),
    ).toBe(true);
  }, 20000);
}, 20000);

describe("真实子进程 — env 不下发(既有降级语义,Req 6.3)", () => {
  it("DIR 与 BACKENDS 均未下发 → 子进程侧能力不可用(available:false,不崩溃)", async () => {
    const { stdout, code } = await runChild({
      PI_WEB_ATTACHMENT_SECRET: SECRET,
      // 不下发 PI_WEB_ATTACHMENT_DIR / PI_WEB_ATTACHMENT_BACKENDS
    });
    expect(code).toBe(0);
    const line = stdout.trim().split("\n").filter(Boolean).pop()!;
    const out = JSON.parse(line) as { available: boolean };
    expect(out.available).toBe(false);
  }, 20000);
}, 20000);
