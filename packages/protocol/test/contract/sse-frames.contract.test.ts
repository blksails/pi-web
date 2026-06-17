/**
 * 防漂移契约测试 — SSE 帧。
 *
 * 读取 test/fixtures/sse-sample-frames.json 的 `frames` 数组,逐帧用 SseFrameSchema
 * safeParse,断言全部 success;任一失败即报告帧索引、kind 与字段路径(暴露漂移)。
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SseFrameSchema } from "../../src/transport/sse-frame.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(__dirname, "..", "fixtures", "sse-sample-frames.json");

type Frame = { kind?: string } & Record<string, unknown>;

const doc = JSON.parse(readFileSync(fixturePath, "utf8")) as {
  frames: Frame[];
};

describe("SSE sample frames contract", () => {
  it("has frames to validate", () => {
    expect(Array.isArray(doc.frames)).toBe(true);
    expect(doc.frames.length).toBeGreaterThan(0);
  });

  it("validates every SSE frame against SseFrameSchema (no drift)", () => {
    const failures: string[] = [];
    doc.frames.forEach((frame, index) => {
      const res = SseFrameSchema.safeParse(frame);
      if (!res.success) {
        const paths = res.error.issues
          .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
          .join("; ");
        failures.push(`frame #${index} (kind=${frame.kind}) -> ${paths}`);
      }
    });
    expect(failures, failures.join("\n")).toEqual([]);
  });

  it("covers both uiMessageChunk and control kinds", () => {
    const kinds = new Set(doc.frames.map((f) => f.kind));
    expect(kinds.has("uiMessageChunk")).toBe(true);
    expect(kinds.has("control")).toBe(true);
  });

  it("every frame carries a protocolVersion", () => {
    for (const frame of doc.frames) {
      expect(frame).toHaveProperty("protocolVersion");
    }
  });

  it("fails (and would report a path) for a tampered frame", () => {
    const res = SseFrameSchema.safeParse({
      kind: "control",
      protocolVersion: "0.1.0",
      payload: { control: "telepathy" },
    });
    expect(res.success).toBe(false);
  });
});
