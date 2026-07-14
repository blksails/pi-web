/**
 * PiCompletionPopover — refreshSignal 强制重查(spec agent-attachment-catalog,任务 5.3;
 * Req 4.2/4.3)。
 *
 * agent 主动推送(`control:"attachment"`)后,装配层递增 refreshSignal;浮层开启时应立即
 * 重新查询当前 token(即便 value/cursor 未变),使新条目免刷新可见。
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import * as React from "react";
import { PiCompletionPopover } from "../../src/completion/pi-completion-popover.js";
import type {
  CompletionItem,
  CompletionResponse,
  CompletionTriggersResponse,
} from "@blksails/pi-web-protocol";
import type { CompletionClient } from "../../src/completion/use-completion.js";

function catalogItem(id: string): CompletionItem {
  return {
    id,
    kind: "catalog",
    providerId: "attachment-catalog",
    label: id,
    insertText: `@catalog:${id}`,
  };
}

function makeClient(getCompletion: CompletionClient["getCompletion"]): CompletionClient {
  return {
    getCompletionTriggers: vi.fn(
      async (): Promise<CompletionTriggersResponse> => ({
        triggers: [{ trigger: "@", extract: "wordTail" }],
      }),
    ),
    getCompletion,
  };
}

function Harness({
  client,
  refreshSignal,
}: {
  client: CompletionClient;
  refreshSignal: number;
}): React.JSX.Element {
  const [value] = React.useState("@a");
  const inputRef = React.useRef<HTMLTextAreaElement | null>(null);
  return (
    <div>
      <textarea ref={inputRef} data-testid="ta" value={value} readOnly />
      <PiCompletionPopover
        value={value}
        cursor={value.length}
        onChange={() => {}}
        client={client}
        sessionId="s1"
        inputRef={inputRef}
        refreshSignal={refreshSignal}
      />
    </div>
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  cleanup();
});

/**
 * 先落定 getCompletionTriggers 的裸 microtask(独立 act 块,使 triggers 状态更新提交并重渲染),
 * 再推进 useCompletion 的 120ms 防抖 + fetch(第二个 act 块)。合并成一个 act 块会因两段异步
 * 提交时序耦合导致后段的 setTimeout 从未被调度(pi-completion-popover.test.tsx 同两段式先例)。
 */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(150);
  });
}

describe("PiCompletionPopover — refreshSignal", () => {
  it("value/cursor 不变,refreshSignal 递增 → 重新调用 getCompletion", async () => {
    let calls = 0;
    const getCompletion = vi.fn(async (): Promise<CompletionResponse> => {
      calls += 1;
      return { items: [catalogItem(`entry-${calls}`)], groups: [] };
    });
    const client = makeClient(getCompletion);
    const utils = render(<Harness client={client} refreshSignal={0} />);
    await flush();
    expect(getCompletion).toHaveBeenCalledTimes(1);

    utils.rerender(<Harness client={client} refreshSignal={1} />);
    await flush();
    expect(getCompletion).toHaveBeenCalledTimes(2);
  });

  it("refreshSignal 不变(同值 rerender)→ 不重复调用", async () => {
    let calls = 0;
    const getCompletion = vi.fn(async (): Promise<CompletionResponse> => {
      calls += 1;
      return { items: [catalogItem(`entry-${calls}`)], groups: [] };
    });
    const client = makeClient(getCompletion);
    const utils = render(<Harness client={client} refreshSignal={0} />);
    await flush();
    expect(getCompletion).toHaveBeenCalledTimes(1);

    utils.rerender(<Harness client={client} refreshSignal={0} />);
    await flush();
    expect(getCompletion).toHaveBeenCalledTimes(1);
  });
});
