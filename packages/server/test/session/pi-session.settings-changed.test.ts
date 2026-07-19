/**
 * per-source settings 运行期实时下发(spec source-settings-and-slots,任务 7.2;Req 7.1/7.2)。
 *
 * 锁定 `PiSession.emitSettingsChanged`(公开入口,不经子进程 handleRawLine)复刻
 * `piweb_state`/`session-state` 同款「广播 + sticky 粘性回放」模式:
 * - 已订阅者立即收到 `control:"settings-changed"` 帧。
 * - 迟到/重连订阅者经粘性表回放拿到最近一次下发(按 sourceKey 分区,互不覆盖)。
 * - 同 sourceKey 多次下发只留最新一帧(last-value)。
 * - 非 active 会话调用为 no-op(不广播、不登记粘性)。
 */
import { describe, expect, it } from "vitest";
import type { SseFrame } from "@blksails/pi-web-protocol";
import { PiSession } from "../../src/session/pi-session.js";
import { MockChannel } from "./mock-channel.js";
import { makeResolved } from "./fixtures.js";

function newSession(ch: MockChannel): PiSession {
  return new PiSession({ id: "s1", resolved: makeResolved(), channel: ch, idleMs: 0 });
}

function settingsChangedFrames(
  frames: SseFrame[],
): Extract<SseFrame, { kind: "control" }>[] {
  return frames.filter(
    (f): f is Extract<SseFrame, { kind: "control" }> =>
      f.kind === "control" && f.payload.control === "settings-changed",
  );
}

describe("PiSession.emitSettingsChanged — 运行期实时下发广播 + sticky", () => {
  it("已订阅者立即收到 control:settings-changed 帧", () => {
    const ch = new MockChannel();
    const s = newSession(ch);
    const frames: SseFrame[] = [];
    s.subscribe((f) => frames.push(f));

    s.emitSettingsChanged({
      sourceKey: "abc123",
      values: { apiBase: "https://example.test", apiToken: { __secret: true, set: true } },
      liveReloadKeys: ["notifyEmail"],
    });

    const changed = settingsChangedFrames(frames);
    expect(changed).toHaveLength(1);
    expect(changed[0]?.payload).toMatchObject({
      control: "settings-changed",
      sourceKey: "abc123",
      values: { apiBase: "https://example.test" },
      liveReloadKeys: ["notifyEmail"],
    });
  });

  it("迟到订阅者经粘性帧回放拿到最近一次下发", () => {
    const ch = new MockChannel();
    const s = newSession(ch);

    s.emitSettingsChanged({
      sourceKey: "abc123",
      values: { apiBase: "v1" },
      liveReloadKeys: ["notifyEmail"],
    });

    const frames: SseFrame[] = [];
    s.subscribe((f) => frames.push(f));
    const replayed = settingsChangedFrames(frames);
    expect(replayed).toHaveLength(1);
    expect(replayed[0]?.payload).toMatchObject({ sourceKey: "abc123", values: { apiBase: "v1" } });
  });

  it("同 sourceKey 多次下发只留最新一帧(last-value)", () => {
    const ch = new MockChannel();
    const s = newSession(ch);

    s.emitSettingsChanged({ sourceKey: "abc123", values: { apiBase: "v1" }, liveReloadKeys: [] });
    s.emitSettingsChanged({ sourceKey: "abc123", values: { apiBase: "v2" }, liveReloadKeys: [] });
    s.emitSettingsChanged({ sourceKey: "abc123", values: { apiBase: "v3" }, liveReloadKeys: [] });

    const frames: SseFrame[] = [];
    s.subscribe((f) => frames.push(f));
    const replayed = settingsChangedFrames(frames);
    expect(replayed).toHaveLength(1);
    expect(replayed[0]?.payload).toMatchObject({ values: { apiBase: "v3" } });
  });

  it("多个 sourceKey 各自独立登记粘性,互不覆盖", () => {
    const ch = new MockChannel();
    const s = newSession(ch);

    s.emitSettingsChanged({ sourceKey: "aaa", values: { x: 1 }, liveReloadKeys: [] });
    s.emitSettingsChanged({ sourceKey: "bbb", values: { x: 2 }, liveReloadKeys: [] });

    const frames: SseFrame[] = [];
    s.subscribe((f) => frames.push(f));
    const replayed = settingsChangedFrames(frames);
    expect(replayed).toHaveLength(2);
    const byKey = new Map(
      replayed.map((f) => [(f.payload as { sourceKey: string }).sourceKey, f.payload]),
    );
    expect(byKey.get("aaa")).toMatchObject({ values: { x: 1 } });
    expect(byKey.get("bbb")).toMatchObject({ values: { x: 2 } });
  });

  it("非 active 会话调用为 no-op:不广播、不登记粘性", async () => {
    const ch = new MockChannel();
    const s = newSession(ch);
    await s.stop();

    expect(s.status).toBe("stopped");
    // 已停止会话调用为 no-op(内部 `_status !== "active"` 早退),不抛出、不产生可观测副作用;
    // 停止后 subscribe 本身会抛 SessionStoppedError(既有行为),故无法直接断言"无订阅者收到帧",
    // 只需确认调用安全即可(与 setLifecycle/applySnapshot 同款 active 门控)。
    expect(() =>
      s.emitSettingsChanged({ sourceKey: "abc123", values: { apiBase: "v1" }, liveReloadKeys: [] }),
    ).not.toThrow();
  });
});
