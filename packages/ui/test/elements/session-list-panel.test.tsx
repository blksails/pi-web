import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type {
  ListSessionsRequest,
  ListSessionsResponse,
  SessionListItem,
} from "@blksails/pi-web-protocol";
import { SessionListPanel } from "../../src/elements/session-list-panel.js";

/**
 * SessionListPanel × refreshSignal(会话历史实时刷新)。
 *
 * 背景:面板自身只在 scope/数据源变化时加载,感知不到「加载之后」的服务端变更——
 * 新会话镜像落库、auto_title 自动标题持久化都发生在一轮 `agent_end` 时。宿主在每轮结束
 * (PiChat onTurnEnd)bump `refreshSignal` → 面板重拉当前 scope 首页,使列表及时反映:
 *   1) 刚建的新会话出现(此前因 header 异步落盘竞态而看不到);
 *   2) auto_title 落库后的最新标题(此前列表停留在旧名/sessionId)。
 */

function item(over: Partial<SessionListItem> & { sessionId: string }): SessionListItem {
  return {
    cwd: "/work",
    createdAt: "2026-06-30T00:00:00.000Z",
    ...over,
  };
}

function resp(sessions: SessionListItem[]): ListSessionsResponse {
  return { sessions, scope: "cwd", globalEnabled: false };
}

describe("SessionListPanel × refreshSignal", () => {
  it("用例A:首屏加载调用一次数据源并渲染会话项", async () => {
    const listSessions = vi.fn(async () => resp([item({ sessionId: "a", name: "会话A" })]));
    render(
      <SessionListPanel
        currentCwd="/work"
        globalEnabled={false}
        listSessions={listSessions}
        onResume={() => {}}
        refreshSignal={0}
      />,
    );
    await waitFor(() => expect(screen.getByText("会话A")).toBeInTheDocument());
    expect(listSessions).toHaveBeenCalledTimes(1);
  });

  it("用例B:refreshSignal 变化 → 重拉当前 scope 首页,反映新会话与更新后的标题", async () => {
    // 首次:仅会话 A,且尚未命名(显示 sessionId);第二次:A 拿到 auto_title 名 + 新会话 B 出现。
    const listSessions = vi
      .fn<(req: ListSessionsRequest) => Promise<ListSessionsResponse>>()
      .mockResolvedValueOnce(resp([item({ sessionId: "sess-a" })]))
      .mockResolvedValueOnce(
        resp([
          item({ sessionId: "sess-b", name: "新会话标题" }),
          item({ sessionId: "sess-a", name: "自动生成的标题" }),
        ]),
      );

    const { rerender } = render(
      <SessionListPanel
        currentCwd="/work"
        globalEnabled={false}
        listSessions={listSessions}
        onResume={() => {}}
        refreshSignal={0}
      />,
    );
    // 首屏:A 未命名 → 主标题回退为 sessionId。
    await waitFor(() => expect(screen.getByText("sess-a")).toBeInTheDocument());
    expect(listSessions).toHaveBeenCalledTimes(1);

    // 宿主 bump refreshSignal(模拟一轮 agent 结束后 onTurnEnd)。
    rerender(
      <SessionListPanel
        currentCwd="/work"
        globalEnabled={false}
        listSessions={listSessions}
        onResume={() => {}}
        refreshSignal={1}
      />,
    );

    // 重拉后:A 显示 auto_title 标题(问题2 修复)+ 新会话 B 出现(问题1 修复)。
    await waitFor(() => expect(screen.getByText("自动生成的标题")).toBeInTheDocument());
    expect(screen.getByText("新会话标题")).toBeInTheDocument();
    // 旧的回退 sessionId 文本不再作为主标题展示。
    expect(screen.queryByText("sess-a")).not.toBeInTheDocument();
    expect(listSessions).toHaveBeenCalledTimes(2);
  });

  it("用例C:refreshSignal 不变的重渲染不重复拉取(避免无谓请求/抖动)", async () => {
    const listSessions = vi.fn(async () => resp([item({ sessionId: "a", name: "会话A" })]));
    const props = {
      currentCwd: "/work",
      globalEnabled: false,
      listSessions,
      onResume: () => {},
      refreshSignal: 7,
    } as const;
    const { rerender } = render(<SessionListPanel {...props} />);
    await waitFor(() => expect(screen.getByText("会话A")).toBeInTheDocument());
    expect(listSessions).toHaveBeenCalledTimes(1);

    // 同 refreshSignal 重渲染:effect 依赖未变 → 不应再次拉取。
    rerender(<SessionListPanel {...props} />);
    await Promise.resolve();
    expect(listSessions).toHaveBeenCalledTimes(1);
  });
});

describe("SessionListPanel × pendingSession(新建会话乐观占位)", () => {
  it("占位行在空列表上也立即渲染(不落库前即可见,不闪空态)", async () => {
    const listSessions = vi.fn(async () => resp([])); // 服务端尚无该会话
    render(
      <SessionListPanel
        currentSessionId="new-1"
        currentCwd="/work"
        globalEnabled={false}
        listSessions={listSessions}
        onResume={() => {}}
        refreshSignal={0}
        pendingSession={{ sessionId: "new-1" }}
      />,
    );
    await waitFor(() =>
      expect(
        document.querySelector('[data-pi-session-list-pending=""]'),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText("新会话")).toBeInTheDocument();
    // 不应出现空态。
    expect(
      document.querySelector("[data-pi-session-list-empty]"),
    ).not.toBeInTheDocument();
  });

  it("真实数据已含该 id → 占位去重让位,不重复渲染", async () => {
    const listSessions = vi.fn(async () =>
      resp([item({ sessionId: "new-1", name: "首条消息标题" })]),
    );
    render(
      <SessionListPanel
        currentSessionId="new-1"
        currentCwd="/work"
        globalEnabled={false}
        listSessions={listSessions}
        onResume={() => {}}
        refreshSignal={0}
        pendingSession={{ sessionId: "new-1" }}
      />,
    );
    await waitFor(() => expect(screen.getByText("首条消息标题")).toBeInTheDocument());
    // 占位不再出现(已被真实项去重让位)。
    expect(
      document.querySelector('[data-pi-session-list-pending=""]'),
    ).not.toBeInTheDocument();
    // 该 id 的列表项唯一。
    expect(
      document.querySelectorAll('[data-pi-session-list-item="new-1"]'),
    ).toHaveLength(1);
  });

  it("占位可带自定义标题", async () => {
    const listSessions = vi.fn(async () => resp([]));
    render(
      <SessionListPanel
        currentSessionId="new-2"
        currentCwd="/work"
        globalEnabled={false}
        listSessions={listSessions}
        onResume={() => {}}
        refreshSignal={0}
        pendingSession={{ sessionId: "new-2", title: "自定义占位标题" }}
      />,
    );
    await waitFor(() =>
      expect(screen.getByText("自定义占位标题")).toBeInTheDocument(),
    );
  });
});
