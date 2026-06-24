/**
 * PiRpcProcess 单元测试:三类分发、response/id 关联、扩展 UI 子协议、诊断
 * (Req 4.1–4.6, 5.2, 5.4, 5.5, 7.2, 7.3)。
 *
 * 用可控的 echo 子进程(test/rpc-channel/fixtures/echo-process.mjs):它把 stdin
 * 收到的每行原样写回 stdout,使测试能把任意帧精确注入到 PiRpcProcess 的 stdout
 * 解析路径。命令帧本身会被 echo 回来(type 非 "response",当作事件丢弃,无害);
 * 测试通过 onLine 捕获命令帧的 id,再注入同 id 的 response 帧来兑现 Promise。
 */
import { describe, it, expect, afterEach } from "vitest";
import { fileURLToPath } from "node:url";
import { PiRpcProcess } from "../../src/rpc-channel/pi-rpc-process.js";
import type { SpawnSpec } from "@blksails/protocol";

const ECHO = fileURLToPath(
  new URL("./fixtures/echo-process.mjs", import.meta.url),
);

function echoSpec(): SpawnSpec {
  return {
    cmd: process.execPath,
    args: [ECHO],
    cwd: process.cwd(),
    env: { ...process.env } as Record<string, string>,
  };
}

/** 注入一条裸 stdout 行(经 echo 原样写回 stdout)。 */
function injectLine(proc: PiRpcProcess, line: string): void {
  proc.send(`__raw__:${line}`);
}

/** 捕获下一条经 onLine 经过的「命令帧」的 id(等待其回显)。 */
function captureNextId(proc: PiRpcProcess): Promise<string> {
  return new Promise<string>((resolve) => {
    const off = proc.onLine((line) => {
      try {
        const parsed = JSON.parse(line) as { id?: unknown; type?: unknown };
        if (typeof parsed.id === "string" && parsed.type !== "response") {
          off();
          resolve(parsed.id);
        }
      } catch {
        /* ignore non-JSON echo */
      }
    });
  });
}

let live: PiRpcProcess[] = [];
function track(p: PiRpcProcess): PiRpcProcess {
  live.push(p);
  return p;
}
afterEach(async () => {
  await Promise.all(live.map((p) => p.close()));
  live = [];
});

describe("PiRpcProcess — response/id correlation (Req 4.1, 5.2, 5.4, 7.2)", () => {
  it("resolves a command Promise when a response with the matching id arrives", async () => {
    const proc = track(new PiRpcProcess(echoSpec()));
    const idPromise = captureNextId(proc);
    const resultPromise = proc.prompt("hello");

    const id = await idPromise;
    injectLine(
      proc,
      JSON.stringify({ type: "response", id, command: "prompt", success: true }),
    );

    const res = await resultPromise;
    expect(res.command).toBe("prompt");
    expect(res.id).toBe(id);
    if (res.success) expect(res.success).toBe(true);
  });

  it("keeps multiple concurrent commands pending and resolves each by its own id (Req 5.4)", async () => {
    const proc = track(new PiRpcProcess(echoSpec()));
    const ids: string[] = [];
    const off = proc.onLine((line) => {
      try {
        const p = JSON.parse(line) as { id?: unknown; type?: unknown };
        if (typeof p.id === "string" && p.type !== "response") ids.push(p.id);
      } catch {
        /* ignore */
      }
    });

    const p1 = proc.getState();
    const p2 = proc.getCommands();
    // 等两个命令帧都回显出来。
    await vi_waitFor(() => ids.length >= 2);
    off();

    const [id1, id2] = ids;
    // 故意先回第二个,验证乱序也按 id 正确关联。
    injectLine(
      proc,
      JSON.stringify({
        type: "response",
        id: id2,
        command: "get_commands",
        success: true,
        data: { commands: [] },
      }),
    );
    injectLine(
      proc,
      JSON.stringify({
        type: "response",
        id: id1,
        command: "get_state",
        success: true,
        data: { model: null, thinkingLevel: "off", isProcessing: false, messageCount: 0 },
      }),
    );

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.command).toBe("get_state");
    expect(r2.command).toBe("get_commands");
  });

  it("drops an orphan response (no pending id) with a diagnostic, without crashing (Req 4.5)", async () => {
    const proc = track(new PiRpcProcess(echoSpec()));
    const diags: string[] = [];
    proc.onDiagnostic((d) => diags.push(d.kind));

    injectLine(
      proc,
      JSON.stringify({ type: "response", id: "no-such-id", command: "abort", success: true }),
    );
    await vi_waitFor(() => diags.includes("orphan_response"));
    expect(diags).toContain("orphan_response");
    // still alive
    expect(proc.health().alive).toBe(true);
  });

  it("skips an unparseable line with a diagnostic and continues processing later lines (Req 4.6)", async () => {
    const proc = track(new PiRpcProcess(echoSpec()));
    const diags: string[] = [];
    const events: string[] = [];
    proc.onDiagnostic((d) => diags.push(d.kind));
    proc.onEvent((e) => events.push(e.type));

    injectLine(proc, "this is not json {");
    injectLine(proc, JSON.stringify({ type: "agent_start" }));

    await vi_waitFor(() => events.includes("agent_start"));
    expect(diags).toContain("parse_error");
    expect(events).toContain("agent_start");
  });
});

describe("PiRpcProcess — event broadcast (Req 4.2)", () => {
  it("broadcasts a parsed event to all onEvent listeners", async () => {
    const proc = track(new PiRpcProcess(echoSpec()));
    const a: string[] = [];
    const b: string[] = [];
    proc.onEvent((e) => a.push(e.type));
    proc.onEvent((e) => b.push(e.type));

    injectLine(
      proc,
      JSON.stringify({ type: "agent_end", messages: [], willRetry: false }),
    );
    await vi_waitFor(() => a.length > 0 && b.length > 0);
    expect(a).toContain("agent_end");
    expect(b).toContain("agent_end");
  });
});

describe("PiRpcProcess — extension_ui hold & respond (Req 4.3, 4.4, 5.5, 7.3)", () => {
  it("holds an extension_ui_request as pending, notifies listeners, then respondExtensionUI writes a reply over stdin and clears pending", async () => {
    const proc = track(new PiRpcProcess(echoSpec()));
    const requests: string[] = [];
    proc.onExtensionUIRequest((r) => requests.push(r.id));

    // 注入扩展 UI 请求。
    injectLine(
      proc,
      JSON.stringify({
        type: "extension_ui_request",
        id: "ext-1",
        method: "confirm",
        title: "Proceed?",
        message: "Are you sure?",
      }),
    );
    await vi_waitFor(() => requests.includes("ext-1"));
    expect(requests).toContain("ext-1");

    // respondExtensionUI 应把回复经 stdin 写出(echo 会把它回显到 stdout)。
    const seen: string[] = [];
    const off = proc.onLine((line) => seen.push(line));
    proc.respondExtensionUI("ext-1", {
      type: "extension_ui_response",
      id: "ext-1",
      confirmed: true,
    });
    await vi_waitFor(() =>
      seen.some((l) => l.includes('"extension_ui_response"') && l.includes("ext-1")),
    );
    off();

    // 再次回复同 id 应被诊断为 orphan(已清除待决)。
    const diags: string[] = [];
    proc.onDiagnostic((d) => diags.push(d.kind));
    proc.respondExtensionUI("ext-1", {
      type: "extension_ui_response",
      id: "ext-1",
      confirmed: false,
    });
    expect(diags).toContain("orphan_response");
  });
});

/** 轻量 polling 等待(避免引入 vitest fake timers)。 */
async function vi_waitFor(
  cond: () => boolean,
  timeoutMs = 5000,
  stepMs = 5,
): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitFor timed out");
    }
    await new Promise((r) => setTimeout(r, stepMs));
  }
}
