// @vitest-environment node
/**
 * ask-user-question-card 2.3 — stub 进程级 JSONL seam（不经过 HTTP/SSE）。
 *
 * 直接驱动 ext-askq sentinel，证明 stub 使用 protocol 共享 codec 发出富 select，
 * 并在收到富答案后解码、回显且结束本轮。最终 HTTP 闭环归任务 4.2。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import {
  ASK_TITLE_SENTINEL,
  decodeAskTitle,
  encodeAskAnswers,
} from "@blksails/pi-web-protocol";

const STUB_PATH = path.join(process.cwd(), "lib", "app", "stub-agent-process.mjs");
const SERVER_CWD = path.join(process.cwd(), "packages", "server");

type Frame = Record<string, unknown> & { type: string };

let child: ChildProcessWithoutNullStreams;
const frames: Frame[] = [];
const waiters = new Set<() => void>();

function send(obj: unknown): void {
  child.stdin.write(`${JSON.stringify(obj)}\n`);
}

function waitForFrame(
  predicate: (frame: Frame) => boolean,
  timeoutMs = 5000,
): Promise<Frame> {
  const existing = frames.find(predicate);
  if (existing !== undefined) return Promise.resolve(existing);

  return new Promise((resolve, reject) => {
    const onFrame = (): void => {
      const frame = frames.find(predicate);
      if (frame === undefined) return;
      clearTimeout(timer);
      waiters.delete(onFrame);
      resolve(frame);
    };
    const timer = setTimeout(() => {
      waiters.delete(onFrame);
      reject(
        new Error(
          `timed out waiting for frame; seen: ${frames.map((frame) => frame.type).join(", ")}`,
        ),
      );
    }, timeoutMs);
    waiters.add(onFrame);
  });
}

beforeAll(() => {
  child = spawn(process.execPath, ["--import", "jiti/register", STUB_PATH], {
    cwd: SERVER_CWD,
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdout.setEncoding("utf8");
  let buffer = "";
  child.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      const raw = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (raw.length > 0) frames.push(JSON.parse(raw) as Frame);
      newline = buffer.indexOf("\n");
    }
    for (const notify of [...waiters]) notify();
  });
});

afterAll(() => {
  child.kill("SIGTERM");
});

describe("stub-agent-process ext-askq sentinel", () => {
  it("emits a codec-backed rich select and decodes its answer before agent_end", async () => {
    send({ type: "prompt", id: "prompt-askq", message: "choose a path (ext-askq)" });

    const request = await waitForFrame(
      (frame) => frame.type === "extension_ui_request" && frame.id === "askq-1",
    );
    expect(request.method).toBe("select");
    expect(request.title).toContain(ASK_TITLE_SENTINEL);
    const group = decodeAskTitle(request.title as string);
    expect(group).toBeDefined();
    expect(request.options).toEqual(group!.questions[0]!.options.map(({ label }) => label));

    send({
      type: "extension_ui_response",
      id: "askq-1",
      value: encodeAskAnswers({
        answers: [
          {
            header: group!.questions[0]!.header,
            question: group!.questions[0]!.question,
            selected: [group!.questions[0]!.options[1]!.label],
            other: "Keep rollback ready",
          },
        ],
      }),
    });

    await waitForFrame((frame) => frame.type === "agent_end");
    const echoed = frames
      .filter(
        (frame) =>
          frame.type === "message_update" &&
          (frame.assistantMessageEvent as { type?: string } | undefined)?.type === "text_delta",
      )
      .map(
        (frame) =>
          (frame.assistantMessageEvent as { delta?: string }).delta ?? "",
      )
      .join("");
    expect(echoed).toContain(group!.questions[0]!.options[1]!.label);
    expect(echoed).toContain("Keep rollback ready");
  });
});
