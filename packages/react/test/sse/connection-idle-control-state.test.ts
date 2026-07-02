/**
 * PiSessionConnection.openControlOnlyStream 的帧过滤契约 —— 空闲控制流必须承载
 * control:"state" 帧(状态注入桥 / agent-authoritative-surface / aigc-canvas 的下行镜像)。
 *
 * surface 命令在**空闲期**触发(不在 per-prompt 轮次内),其权威快照回流帧
 * (control:"state",key=surface:<domain>)只能由本空闲流承载并应用进 ControlStore.states。
 * 回归:此前过滤器漏放 "state" → slot 组件收不到快照(增量停初值 / 画廊种子不 hydrate)。
 */
import { describe, it, expect, vi } from "vitest";
import { PiSessionConnection } from "../../src/sse/connection.js";
import { makeSseResponse, controlFrameText } from "../fixtures/sse-samples.js";

describe("PiSessionConnection.openControlOnlyStream — control:state", () => {
  it("空闲控制流应用 control:\"state\" 帧进 ControlStore.states", async () => {
    const body =
      controlFrameText(
        { control: "state", key: "surface:demo", value: { count: 1 }, rev: 1 },
        "e0",
      ) +
      controlFrameText(
        {
          control: "state",
          key: "surface:canvas",
          value: { assets: [{ attachmentId: "att_seed" }] },
          rev: 1,
        },
        "e1",
      );
    const conn = new PiSessionConnection({
      baseUrl: "http://api.test",
      sessionId: "s1",
      fetchImpl: vi.fn(async () => makeSseResponse(body)) as unknown as typeof fetch,
      onError: vi.fn(),
    });

    const close = conn.openControlOnlyStream({ applyAmbient: true });
    // 让 pump 消费流。
    await vi.waitFor(() => {
      const states = conn.controlStore.getSnapshot().states;
      expect(states["surface:demo"]?.value).toEqual({ count: 1 });
      expect(states["surface:canvas"]?.value).toEqual({
        assets: [{ attachmentId: "att_seed" }],
      });
    });
    close();
  });
});
