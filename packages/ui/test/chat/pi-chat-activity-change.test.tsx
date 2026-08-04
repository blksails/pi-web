/**
 * PiChat × onActivityChange(spec session-meta-index, 任务 4.2 / Req 8.1-8.3)。
 *
 * ★ 本文件最要紧的一条是「忙态**上升**边沿也通知」—— 那是改造前**缺失**的触发点:
 *   既有 `onTurnEnd` 只在 busy 由真变假时触发,于是会话刚开始干活时列表没有任何刷新机会,
 *   转圈往往等到它已经不忙了才出现。
 *
 * 同时守住:`onTurnEnd` 的触发次数与语义**不得**因本次改动改变(另有消费者依赖其轮末语义)。
 */
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import type { UIMessage } from "ai";
import type { RpcExtensionUIRequest } from "@blksails/pi-web-protocol";
import type { UseExtensionUIResult } from "@blksails/pi-web-react";
import { PiChat } from "../../src/chat/pi-chat.js";
import { mockControls, mockSession } from "../fixtures/mock-session.js";

const CONVO: UIMessage[] = [
  { id: "u1", role: "user", parts: [{ type: "text", text: "hi" }] },
];

const CONFIRM: RpcExtensionUIRequest = {
  type: "extension_ui_request",
  id: "u1",
  method: "confirm",
  title: "Proceed?",
  message: "Run?",
};

/** 最小 extensionUI stub:只需 queue 与几个必填字段。 */
function extUI(queue: readonly RpcExtensionUIRequest[]): UseExtensionUIResult {
  return {
    queue,
    current: queue[0],
    respond: vi.fn(async () => undefined),
    error: undefined,
    pending: false,
    notifications: [],
    statuses: {},
    widgets: {},
    title: undefined,
    editorText: undefined,
    dismissNotification: vi.fn(),
  } as unknown as UseExtensionUIResult;
}

interface RenderOpts {
  readonly busy: boolean;
  readonly queue?: readonly RpcExtensionUIRequest[];
}

function renderChat(opts: RenderOpts, cbs: {
  onActivityChange: () => void;
  onTurnEnd: () => void;
}) {
  return render(
    <PiChat
      session={mockSession({ initialMessages: CONVO })}
      controls={mockControls({
        busy: opts.busy,
        session: { lifecycle: "ready", busy: opts.busy },
      })}
      extensionUI={extUI(opts.queue ?? [])}
      onActivityChange={cbs.onActivityChange}
      onTurnEnd={cbs.onTurnEnd}
    />,
  );
}

describe("忙态边沿(Req 8.1/8.2)", () => {
  it("★ 忙态由假变真(轮次开始)→ onActivityChange 被调用,而 onTurnEnd 不被调用", () => {
    const onActivityChange = vi.fn();
    const onTurnEnd = vi.fn();
    const view = renderChat({ busy: false }, { onActivityChange, onTurnEnd });
    const initialCalls = onActivityChange.mock.calls.length;

    view.rerender(
      <PiChat
        session={mockSession({ initialMessages: CONVO })}
        controls={mockControls({
          busy: true,
          session: { lifecycle: "ready", busy: true },
        })}
        extensionUI={extUI([])}
        onActivityChange={onActivityChange}
        onTurnEnd={onTurnEnd}
      />,
    );

    // 上升边沿通知了(改造前这里一次都不会被通知)
    expect(onActivityChange.mock.calls.length).toBeGreaterThan(initialCalls);
    // 既有轮末回调语义不变:轮次开始不是轮末
    expect(onTurnEnd).not.toHaveBeenCalled();
  });

  it("忙态由真变假(轮次结束)→ onActivityChange 与 onTurnEnd 都被调用", () => {
    const onActivityChange = vi.fn();
    const onTurnEnd = vi.fn();
    const view = renderChat({ busy: true }, { onActivityChange, onTurnEnd });
    const before = onActivityChange.mock.calls.length;

    view.rerender(
      <PiChat
        session={mockSession({ initialMessages: CONVO })}
        controls={mockControls({
          busy: false,
          session: { lifecycle: "ready", busy: false },
        })}
        extensionUI={extUI([])}
        onActivityChange={onActivityChange}
        onTurnEnd={onTurnEnd}
      />,
    );

    expect(onActivityChange.mock.calls.length).toBeGreaterThan(before);
    expect(onTurnEnd).toHaveBeenCalledTimes(1);
  });

  it("忙态不变时不重复通知(只在边沿通知,不是每次渲染)", () => {
    const onActivityChange = vi.fn();
    const onTurnEnd = vi.fn();
    const view = renderChat({ busy: true }, { onActivityChange, onTurnEnd });
    const after1st = onActivityChange.mock.calls.length;
    // 同样的 busy 再渲染两次
    for (let i = 0; i < 2; i += 1) {
      view.rerender(
        <PiChat
          session={mockSession({ initialMessages: CONVO })}
          controls={mockControls({
            busy: true,
            session: { lifecycle: "ready", busy: true },
          })}
          extensionUI={extUI([])}
          onActivityChange={onActivityChange}
          onTurnEnd={onTurnEnd}
        />,
      );
    }
    expect(onActivityChange.mock.calls.length).toBe(after1st);
  });
});

describe("交互挂起边沿(Req 8.3)", () => {
  it("挂起数 0 → 非0(开始等用户回应)→ onActivityChange 被调用", () => {
    const onActivityChange = vi.fn();
    const onTurnEnd = vi.fn();
    const view = renderChat({ busy: true, queue: [] }, { onActivityChange, onTurnEnd });
    const before = onActivityChange.mock.calls.length;

    view.rerender(
      <PiChat
        session={mockSession({ initialMessages: CONVO })}
        controls={mockControls({
          busy: true,
          session: { lifecycle: "ready", busy: true },
        })}
        extensionUI={extUI([CONFIRM])}
        onActivityChange={onActivityChange}
        onTurnEnd={onTurnEnd}
      />,
    );

    expect(onActivityChange.mock.calls.length).toBeGreaterThan(before);
    // 只是开始等用户,不是轮末
    expect(onTurnEnd).not.toHaveBeenCalled();
  });

  it("挂起数 非0 → 0(用户已回应)→ onActivityChange 被调用", () => {
    const onActivityChange = vi.fn();
    const onTurnEnd = vi.fn();
    const view = renderChat(
      { busy: true, queue: [CONFIRM] },
      { onActivityChange, onTurnEnd },
    );
    const before = onActivityChange.mock.calls.length;

    view.rerender(
      <PiChat
        session={mockSession({ initialMessages: CONVO })}
        controls={mockControls({
          busy: true,
          session: { lifecycle: "ready", busy: true },
        })}
        extensionUI={extUI([])}
        onActivityChange={onActivityChange}
        onTurnEnd={onTurnEnd}
      />,
    );

    expect(onActivityChange.mock.calls.length).toBeGreaterThan(before);
  });
});

describe("未提供回调时不影响既有行为", () => {
  it("不传 onActivityChange 也能正常渲染并照常触发 onTurnEnd", () => {
    const onTurnEnd = vi.fn();
    const view = render(
      <PiChat
        session={mockSession({ initialMessages: CONVO })}
        controls={mockControls({
          busy: true,
          session: { lifecycle: "ready", busy: true },
        })}
        onTurnEnd={onTurnEnd}
      />,
    );
    view.rerender(
      <PiChat
        session={mockSession({ initialMessages: CONVO })}
        controls={mockControls({
          busy: false,
          session: { lifecycle: "ready", busy: false },
        })}
        onTurnEnd={onTurnEnd}
      />,
    );
    expect(onTurnEnd).toHaveBeenCalledTimes(1);
  });
});
