/**
 * Tests for session-readiness-handshake task 1.1:
 * SessionLifecycleState 枚举 + control:session-status 帧并入 ControlPayload 判别联合。
 * 覆盖需求 2.3(帧区分各状态)、6.3(增量帧并入不破坏既有判别)。
 */
import { describe, expect, it } from "vitest";
import {
  SseFrameSchema,
  makeControlFrame,
} from "../../src/transport/sse-frame.js";
import {
  SessionLifecycleStateSchema,
  SessionStatusControlSchema,
} from "../../src/transport/session-status.js";

describe("SessionLifecycleStateSchema", () => {
  it("接受全部四个枚举值", () => {
    for (const s of ["initializing", "ready", "error", "ended"] as const) {
      expect(SessionLifecycleStateSchema.parse(s)).toBe(s);
    }
  });

  it("拒绝未知状态", () => {
    expect(SessionLifecycleStateSchema.safeParse("booting").success).toBe(false);
  });
});

describe("control:session-status SSE frame", () => {
  it("构造并解析最小帧(仅 state)", () => {
    const frame = makeControlFrame({
      control: "session-status",
      state: "initializing",
    });
    const parsed = SseFrameSchema.parse(frame);
    expect(parsed.kind).toBe("control");
    if (parsed.kind === "control" && parsed.payload.control === "session-status") {
      expect(parsed.payload.state).toBe("initializing");
      expect(parsed.payload.detail).toBeUndefined();
      expect(parsed.payload.code).toBeUndefined();
    }
  });

  it("解析 ready 帧", () => {
    const parsed = SseFrameSchema.parse(
      makeControlFrame({ control: "session-status", state: "ready" }),
    );
    expect(parsed.kind).toBe("control");
  });

  it("解析带 detail/code 的 error 帧", () => {
    const frame = makeControlFrame({
      control: "session-status",
      state: "error",
      detail: "readiness probe timed out",
      code: "probe-timeout",
    });
    const parsed = SseFrameSchema.parse(frame);
    if (parsed.kind === "control" && parsed.payload.control === "session-status") {
      expect(parsed.payload.code).toBe("probe-timeout");
      expect(parsed.payload.detail).toContain("timed out");
    }
  });

  it("SessionStatusControlSchema 独立解析合法负载", () => {
    expect(
      SessionStatusControlSchema.parse({
        control: "session-status",
        state: "ended",
      }).state,
    ).toBe("ended");
  });

  it("拒绝缺 state 的帧", () => {
    const res = SseFrameSchema.safeParse({
      kind: "control",
      protocolVersion: "1.0.0",
      payload: { control: "session-status" },
    });
    expect(res.success).toBe(false);
  });

  it("拒绝非法 state 的帧", () => {
    const res = SseFrameSchema.safeParse({
      kind: "control",
      protocolVersion: "1.0.0",
      payload: { control: "session-status", state: "spawning" },
    });
    expect(res.success).toBe(false);
  });
});

describe("既有 control 帧判别回归(6.3)", () => {
  it("新增分支后 control:error 仍正常解析", () => {
    expect(
      SseFrameSchema.parse(makeControlFrame({ control: "error", message: "x" }))
        .kind,
    ).toBe("control");
  });

  it("新增分支后 control:queue 仍正常解析", () => {
    expect(
      SseFrameSchema.parse(
        makeControlFrame({ control: "queue", steering: [], followUp: [] }),
      ).kind,
    ).toBe("control");
  });
});
