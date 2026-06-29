/**
 * 单元:纯扩展命令历史持久化 seam wireCommandMarkerPersistence
 * (spec plugin-system-unification R13)。
 *
 * 以可控的假 session(messages 数组 + isStreaming + prompt)与 appendCustomEntry spy 覆盖
 * 注册表无关检测:纯命令(prompt 后 message 不变且非 streaming)→ 标记;普通消息(增 message)/
 * 触发 turn(streaming)/ 非斜杠 → 不标记;原 prompt 抛错 → 外抛且不标记。
 */
import { describe, it, expect, vi } from "vitest";
import {
  wireCommandMarkerPersistence,
  PIWEB_COMMAND_CUSTOM_TYPE,
} from "../../src/runner/command-marker.js";

/** 构造一个可编排 prompt 行为的假 session + appendCustomEntry spy。 */
function makeFakeSession(opts?: {
  /** prompt 执行期间对 messages / isStreaming 的副作用(模拟 SDK 行为)。 */
  onPrompt?: (state: { messages: unknown[]; isStreaming: boolean }) => void;
  /** prompt 抛错。 */
  throwOnPrompt?: boolean;
}) {
  const state = { messages: [] as unknown[], isStreaming: false };
  const session = {
    get messages() {
      return state.messages;
    },
    get isStreaming() {
      return state.isStreaming;
    },
    prompt: vi.fn(async (_text: string) => {
      if (opts?.throwOnPrompt) throw new Error("prompt failed");
      opts?.onPrompt?.(state);
    }),
  };
  const appendCustomEntry = vi.fn();
  return { session, state, appendCustomEntry: { appendCustomEntry } };
}

describe("wireCommandMarkerPersistence — 纯命令检测与标记持久化", () => {
  it("纯命令(prompt 后 message 不变且非 streaming)→ 写 piweb.command 标记", async () => {
    const { session, appendCustomEntry } = makeFakeSession(); // prompt 无副作用 = 纯命令
    wireCommandMarkerPersistence(session, appendCustomEntry);
    await session.prompt("/review");
    expect(appendCustomEntry.appendCustomEntry).toHaveBeenCalledTimes(1);
    expect(appendCustomEntry.appendCustomEntry).toHaveBeenCalledWith(
      PIWEB_COMMAND_CUSTOM_TYPE,
      { text: "/review" },
    );
  });

  it("普通消息(prompt 新增 message)→ 不标记", async () => {
    const { session, appendCustomEntry } = makeFakeSession({
      onPrompt: (s) => s.messages.push({ role: "user" }, { role: "assistant" }),
    });
    wireCommandMarkerPersistence(session, appendCustomEntry);
    await session.prompt("hello");
    expect(appendCustomEntry.appendCustomEntry).not.toHaveBeenCalled();
  });

  it("触发 turn 的命令(prompt 后进入 streaming)→ 不标记", async () => {
    const { session, appendCustomEntry } = makeFakeSession({
      onPrompt: (s) => {
        s.isStreaming = true;
      },
    });
    wireCommandMarkerPersistence(session, appendCustomEntry);
    await session.prompt("/start-turn");
    expect(appendCustomEntry.appendCustomEntry).not.toHaveBeenCalled();
  });

  it("非斜杠输入 → 不标记(即使 message 不变)", async () => {
    const { session, appendCustomEntry } = makeFakeSession();
    wireCommandMarkerPersistence(session, appendCustomEntry);
    await session.prompt("just text");
    expect(appendCustomEntry.appendCustomEntry).not.toHaveBeenCalled();
  });

  it("原 prompt 抛错 → 外抛且不标记", async () => {
    const { session, appendCustomEntry } = makeFakeSession({ throwOnPrompt: true });
    wireCommandMarkerPersistence(session, appendCustomEntry);
    await expect(session.prompt("/review")).rejects.toThrow("prompt failed");
    expect(appendCustomEntry.appendCustomEntry).not.toHaveBeenCalled();
  });

  it("还原函数解除包裹(prompt 恢复原实现,不再标记)", async () => {
    const { session, appendCustomEntry } = makeFakeSession();
    const restore = wireCommandMarkerPersistence(session, appendCustomEntry);
    restore();
    await session.prompt("/review");
    expect(appendCustomEntry.appendCustomEntry).not.toHaveBeenCalled();
  });
});
