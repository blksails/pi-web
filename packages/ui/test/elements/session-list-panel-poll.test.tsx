/**
 * SessionListPanel × 状态轮询(spec session-meta-index, Req 8.6-8.9)。
 *
 * 补的是这个缺口:列表刷新只由宿主的边沿信号触发,所以「**别的**会话开始忙」没有任何
 * 触发点 —— 用户不动就看不到。轮询只在「已有非空闲项 + 页面可见」时跑,全空闲即停。
 *
 * ★ 最要紧的一条是 Req 8.8:轮询**不得**改变列表长度、顺序与已加载的分页内容 ——
 *   若图省事复用「重拉首页」,用户点过「加载更多」后每 5 秒就会被打回第一页。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import type {
  ListSessionsRequest,
  ListSessionsResponse,
  SessionListItem,
} from "@blksails/pi-web-protocol";
import { SessionListPanel } from "../../src/elements/session-list-panel.js";

function item(
  over: Partial<SessionListItem> & { sessionId: string },
): SessionListItem {
  return { cwd: "/work", createdAt: "2026-06-30T00:00:00.000Z", ...over };
}

const resp = (sessions: SessionListItem[]): ListSessionsResponse => ({
  sessions,
  scope: "cwd",
  globalEnabled: false,
});

/** 依次返回给定各页;用完后重复最后一页。 */
function sequencedList(pages: SessionListItem[][]) {
  let i = 0;
  const fn = vi.fn(async (_req: ListSessionsRequest) => {
    const page = pages[Math.min(i, pages.length - 1)]!;
    i += 1;
    return resp(page);
  });
  return fn;
}

function renderPanel(
  listSessions: ReturnType<typeof sequencedList>,
  activityPollMs?: number,
) {
  return render(
    <SessionListPanel
      listSessions={listSessions}
      onResume={vi.fn()}
      currentCwd="/work"
      globalEnabled={false}
      showSource
      {...(activityPollMs !== undefined ? { activityPollMs } : {})}
    />,
  );
}

const activityOf = (sessionId: string): string | null =>
  document
    .querySelector(
      `[data-pi-session-list-item="${sessionId}"] [data-pi-session-list-item-activity]`,
    )
    ?.getAttribute("data-pi-session-list-item-activity") ?? null;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("轮询的启停条件(Req 8.6/8.7/8.9)", () => {
  it("列表中有非空闲项 → 周期性重新查询", async () => {
    const listSessions = sequencedList([[item({ sessionId: "s1", activity: "working" })]]);
    renderPanel(listSessions, 1_000);
    await waitFor(() => expect(listSessions).toHaveBeenCalledTimes(1));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_100);
    });
    // 首次加载 1 次 + 三个周期
    expect(listSessions.mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  it("★ 列表全空闲时**仍然**轮询(只是放慢) —— 否则永远发现不了别的会话变忙", async () => {
    const listSessions = sequencedList([[item({ sessionId: "s1" })]]);
    renderPanel(listSessions, 1_000); // 空闲周期 = 1000 × IDLE_POLL_FACTOR(3) = 3000ms
    await waitFor(() => expect(listSessions).toHaveBeenCalledTimes(1));

    // 一个"忙碌周期"(1s)内不应触发 —— 空闲时确实放慢了
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_200);
    });
    expect(listSessions).toHaveBeenCalledTimes(1);

    // 但到了空闲周期就会查 —— 这正是「A 空闲时也能发现 B 变忙」的前提
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_200);
    });
    expect(listSessions.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("★ A 自己空闲、什么都不做时,也能发现别的会话开始忙(核心场景)", async () => {
    const listSessions = sequencedList([
      // 首次:只有 A,且空闲
      [item({ sessionId: "A", name: "我在看的" })],
      // 稍后服务端:B 出现并在忙(B 是后建的,故 A 的列表里本来没有它)
      [
        item({ sessionId: "A", name: "我在看的" }),
        item({ sessionId: "B", name: "别的会话", activity: "working" }),
      ],
    ]);
    renderPanel(listSessions, 1_000);
    await waitFor(() => expect(listSessions).toHaveBeenCalledTimes(1));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_200); // 一个空闲周期
    });
    // 轮询确实发生了(修好「鸡生蛋」缺陷的判据)
    expect(listSessions.mock.calls.length).toBeGreaterThanOrEqual(2);
    // ★ 且后建的 B **出现在列表里并带着忙碌状态** ——
    //   只更新已显示项的状态是不够的:A 的列表里本来就没有 B。
    await waitFor(() => expect(activityOf("B")).toBe("working"));
    expect(screen.getByText("别的会话")).toBeInTheDocument();
  });

  it("activityPollMs=0 → 关闭轮询(Req 8.9)", async () => {
    const listSessions = sequencedList([[item({ sessionId: "s1", activity: "working" })]]);
    renderPanel(listSessions, 0);
    await waitFor(() => expect(listSessions).toHaveBeenCalledTimes(1));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(listSessions).toHaveBeenCalledTimes(1);
  });

  it("页面不可见 → 不轮询(后台标签页不烧请求)", async () => {
    const spy = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    const listSessions = sequencedList([[item({ sessionId: "s1", activity: "working" })]]);
    renderPanel(listSessions, 1_000);
    await waitFor(() => expect(listSessions).toHaveBeenCalledTimes(1));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(listSessions).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("所有会话转为空闲后轮询放慢(而非停止)", async () => {
    const listSessions = sequencedList([
      [item({ sessionId: "s1", activity: "working" })],
      [item({ sessionId: "s1" })], // 第二次查询:已空闲
    ]);
    renderPanel(listSessions, 1_000);
    await waitFor(() => expect(activityOf("s1")).toBe("working"));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_100);
    });
    await waitFor(() => expect(activityOf("s1")).toBeNull());

    const callsAfterIdle = listSessions.mock.calls.length;
    // 空闲周期内(1s)不查
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_200);
    });
    expect(listSessions.mock.calls.length).toBe(callsAfterIdle);
    // 但满一个空闲周期(3s)后仍会查 —— 不是停,是放慢
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_200);
    });
    expect(listSessions.mock.calls.length).toBeGreaterThan(callsAfterIdle);
  });
});

describe("轮询只更新状态(Req 8.8)", () => {
  it("★ 不改变列表长度与顺序:轮询返回的少量项不会截断已加载的列表", async () => {
    const listSessions = sequencedList([
      // 首次加载:三项(模拟用户已「加载更多」后的列表)
      [
        item({ sessionId: "s1", name: "第一", activity: "working" }),
        item({ sessionId: "s2", name: "第二" }),
        item({ sessionId: "s3", name: "第三" }),
      ],
      // 轮询只返回首页一项 —— 若实现是「重拉首页」,列表会被截成 1 项
      [item({ sessionId: "s1", name: "第一", activity: "awaiting-input" })],
    ]);
    renderPanel(listSessions, 1_000);
    await waitFor(() => expect(screen.getByText("第三")).toBeInTheDocument());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_100);
    });

    // 状态更新了
    await waitFor(() => expect(activityOf("s1")).toBe("awaiting-input"));
    // 但列表长度与顺序纹丝不动
    const ids = [...document.querySelectorAll("[data-pi-session-list-item]")].map((el) =>
      el.getAttribute("data-pi-session-list-item"),
    );
    expect(ids).toEqual(["s1", "s2", "s3"]);
    expect(screen.getByText("第三")).toBeInTheDocument();
  });

  it("追加新会话时,已加载的分页内容一个不少、顺序不变", async () => {
    const listSessions = sequencedList([
      [
        item({ sessionId: "s1", name: "第一", activity: "working" }),
        item({ sessionId: "s2", name: "第二" }),
        item({ sessionId: "s3", name: "第三" }),
      ],
      // 轮询返回:一个新会话 + 首页一项(模拟服务端只回首页)
      [
        item({ sessionId: "s0", name: "新来的", activity: "working" }),
        item({ sessionId: "s1", name: "第一", activity: "working" }),
      ],
    ]);
    renderPanel(listSessions, 1_000);
    await waitFor(() => expect(screen.getByText("第三")).toBeInTheDocument());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_100);
    });

    await waitFor(() => expect(screen.getByText("新来的")).toBeInTheDocument());
    const ids = [...document.querySelectorAll("[data-pi-session-list-item]")].map((el) =>
      el.getAttribute("data-pi-session-list-item"),
    );
    // 新项置顶,既有三项一个不少且相对顺序不变
    expect(ids).toEqual(["s0", "s1", "s2", "s3"]);
  });

  it("其他会话开始忙 → 无需用户操作即可显现(本特性要解决的核心场景)", async () => {
    const listSessions = sequencedList([
      [
        item({ sessionId: "s1", name: "我在看的", activity: "working" }),
        item({ sessionId: "s2", name: "别的会话" }),
      ],
      [
        item({ sessionId: "s1", name: "我在看的", activity: "working" }),
        item({ sessionId: "s2", name: "别的会话", activity: "awaiting-input" }),
      ],
    ]);
    renderPanel(listSessions, 1_000);
    await waitFor(() => expect(activityOf("s2")).toBeNull());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_100);
    });
    // 用户什么都没做,别的会话的状态自己出现了
    await waitFor(() => expect(activityOf("s2")).toBe("awaiting-input"));
  });

  it("轮询失败不把列表推入错误态", async () => {
    let calls = 0;
    const listSessions = vi.fn(async () => {
      calls += 1;
      if (calls === 1) return resp([item({ sessionId: "s1", activity: "working" })]);
      throw new Error("network blip");
    });
    render(
      <SessionListPanel
        listSessions={listSessions}
        onResume={vi.fn()}
        currentCwd="/work"
        globalEnabled={false}
        activityPollMs={1_000}
      />,
    );
    await waitFor(() => expect(activityOf("s1")).toBe("working"));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_100);
    });
    // 列表项仍在,未显示错误态
    expect(document.querySelector('[data-pi-session-list-item="s1"]')).not.toBeNull();
    expect(activityOf("s1")).toBe("working");
  });
});
