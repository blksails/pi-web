/**
 * PiSession 活跃态投影 + 标题变化通知(spec session-meta-index, 任务 3.1 / Req 1.2, 7.1-7.3, 7.5)。
 *
 * 这里验的是**接线**(会话把既有权威事实喂给派生函数、把 setTitle 转成回调),
 * 派生规则本身的穷举在 `derive-activity.test.ts`。
 */
import { describe, expect, it, vi } from "vitest";
import type { AgentEvent, RpcExtensionUIRequest } from "@blksails/pi-web-protocol";
import { PiSession } from "../../src/session/pi-session.js";
import { MockChannel } from "./mock-channel.js";
import { makeResolved } from "./fixtures.js";

const start = { type: "agent_start" } as AgentEvent;
const end = { type: "agent_end", messages: [] } as unknown as AgentEvent;

const CONFIRM: RpcExtensionUIRequest = {
  type: "extension_ui_request",
  id: "u1",
  method: "confirm",
  title: "Proceed?",
  message: "Run command?",
};

const NOTIFY: RpcExtensionUIRequest = {
  type: "extension_ui_request",
  id: "n1",
  method: "notify",
  message: "done",
};

const SET_TITLE: RpcExtensionUIRequest = {
  type: "extension_ui_request",
  id: "t1",
  method: "setTitle",
  title: "自动标题",
};

function newSession(
  ch: MockChannel,
  onTitleChanged?: (id: string, title: string) => void,
): PiSession {
  return new PiSession({
    id: "s1",
    resolved: makeResolved(),
    channel: ch,
    idleMs: 0,
    snapshotAuthority: true,
    ...(onTitleChanged !== undefined ? { onTitleChanged } : {}),
  });
}

describe("PiSession.activity", () => {
  it("新建会话空闲(无指示)", () => {
    expect(newSession(new MockChannel()).activity).toBeUndefined();
  });

  it("轮次进行中 → working;轮次结束 → 回到空闲", () => {
    const ch = new MockChannel();
    const s = newSession(ch);
    ch.emitEvent(start);
    expect(s.activity).toBe("working");
    ch.emitEvent(end);
    expect(s.activity).toBeUndefined();
  });

  it("交互类挂起 → awaiting-input;回复后回到 working", () => {
    const ch = new MockChannel();
    const s = newSession(ch);
    ch.emitEvent(start);
    ch.emitExtensionUIRequest(CONFIRM);
    expect(s.activity).toBe("awaiting-input");
    s.respondExtensionUI("u1", {
      type: "extension_ui_response",
      id: "u1",
      confirmed: true,
    });
    expect(s.activity).toBe("working");
  });

  it("★ 推送类挂起不产生 awaiting-input(挂起表确实会混入这类请求)", () => {
    const ch = new MockChannel();
    const s = newSession(ch);
    ch.emitExtensionUIRequest(NOTIFY);
    ch.emitExtensionUIRequest(SET_TITLE);
    // 两条推送类请求都已滞留在挂起表里 —— 这是服务端的真实行为
    expect(s.listPendingExtensionUI()).toEqual(["n1", "t1"]);
    // 但会话仍是空闲,不是「等待用户交互」
    expect(s.activity).toBeUndefined();
  });

  it("等待用户交互压过工作中", () => {
    const ch = new MockChannel();
    const s = newSession(ch);
    ch.emitEvent(start); // busy = true
    ch.emitExtensionUIRequest(CONFIRM);
    expect(s.activity).toBe("awaiting-input");
  });
});

describe("PiSession.onTitleChanged", () => {
  it("setTitle 请求触发回调并带会话标识与标题", () => {
    const ch = new MockChannel();
    const onTitleChanged = vi.fn();
    newSession(ch, onTitleChanged);
    ch.emitExtensionUIRequest(SET_TITLE);
    expect(onTitleChanged).toHaveBeenCalledTimes(1);
    expect(onTitleChanged).toHaveBeenCalledWith("s1", "自动标题");
  });

  it("非 setTitle 的请求不触发回调", () => {
    const ch = new MockChannel();
    const onTitleChanged = vi.fn();
    newSession(ch, onTitleChanged);
    ch.emitExtensionUIRequest(CONFIRM);
    ch.emitExtensionUIRequest(NOTIFY);
    expect(onTitleChanged).not.toHaveBeenCalled();
  });

  it("回调抛错被吞掉:会话仍正常登记挂起并广播(元数据故障不波及会话)", () => {
    const ch = new MockChannel();
    const s = newSession(ch, () => {
      throw new Error("index write blew up");
    });
    const frames: unknown[] = [];
    s.subscribe((f) => frames.push(f));
    expect(() => ch.emitExtensionUIRequest(SET_TITLE)).not.toThrow();
    expect(s.listPendingExtensionUI()).toEqual(["t1"]);
    expect(frames.length).toBeGreaterThan(0);
    // 会话仍可继续正常工作
    ch.emitEvent(start);
    expect(s.activity).toBe("working");
  });

  it("未提供回调时 setTitle 行为与改造前一致", () => {
    const ch = new MockChannel();
    const s = newSession(ch);
    expect(() => ch.emitExtensionUIRequest(SET_TITLE)).not.toThrow();
    expect(s.listPendingExtensionUI()).toEqual(["t1"]);
  });
});
