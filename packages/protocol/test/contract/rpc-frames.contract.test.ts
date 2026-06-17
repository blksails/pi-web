/**
 * 防漂移契约测试 — RPC 帧。
 *
 * 读取 test/fixtures/rpc-sample-frames.jsonl(代表性或真实采集),逐帧用对应 schema
 * safeParse:`type:"response"` → RpcResponseSchema,其余 → AgentEventSchema。
 * 任一帧不通过即失败,并报告该帧索引、type 与字段路径(暴露 schema 与真实协议的漂移)。
 *
 * 链路覆盖断言:fixtures 必须含 prompt 响应 → text_delta → tool_execution start/update/end → agent_end。
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AgentEventSchema } from "../../src/rpc/event.js";
import { RpcResponseSchema } from "../../src/rpc/response.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(__dirname, "..", "fixtures", "rpc-sample-frames.jsonl");

type Frame = { type?: string } & Record<string, unknown>;

function loadFrames(): Frame[] {
  const raw = readFileSync(fixturePath, "utf8");
  return raw
    .split("\n")
    .map((l) => l.replace(/\r$/, "").trim())
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as Frame)
    .filter((f) => f._note === undefined);
}

describe("RPC sample frames contract", () => {
  const frames = loadFrames();

  it("has frames to validate", () => {
    expect(frames.length).toBeGreaterThan(0);
  });

  it("validates every frame against its schema (no drift)", () => {
    const failures: string[] = [];
    frames.forEach((frame, index) => {
      const schema =
        frame.type === "response" ? RpcResponseSchema : AgentEventSchema;
      const res = schema.safeParse(frame);
      if (!res.success) {
        const paths = res.error.issues
          .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
          .join("; ");
        failures.push(`frame #${index} (type=${frame.type}) -> ${paths}`);
      }
    });
    expect(failures, failures.join("\n")).toEqual([]);
  });

  it("covers the required prompt -> text_delta -> tool_* -> agent_end chain", () => {
    const types = frames.map((f) => f.type);
    const subTypes = frames
      .filter((f) => f.type === "message_update")
      .map((f) => (f.assistantMessageEvent as { type?: string } | undefined)?.type);
    expect(types).toContain("response");
    expect(subTypes).toContain("text_delta");
    expect(types).toContain("tool_execution_start");
    expect(types).toContain("tool_execution_update");
    expect(types).toContain("tool_execution_end");
    expect(types).toContain("agent_end");
  });

  it("fails (and would report a path) for a tampered frame", () => {
    const tampered = { type: "tool_execution_end", toolCallId: "t1", toolName: "bash", result: "x" };
    const res = AgentEventSchema.safeParse(tampered);
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(JSON.stringify(res.error.issues)).toContain("isError");
    }
  });
});
