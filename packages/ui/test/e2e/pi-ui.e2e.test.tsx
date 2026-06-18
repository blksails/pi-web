import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { UIMessageChunk } from "ai";
import { PiChat } from "../../src/chat/pi-chat.js";
import { mockSession, mockControls, MockTransport } from "../fixtures/mock-session.js";

/**
 * e2e(组件级):agent 经 data-pi-ui 声明 server-driven UI,<PiChat> 零配置渲染。
 *   - <PiChat> 挂载即自动注册 data-pi-ui 渲染器(无需宿主手动接线)。
 *   - 经 MockTransport 推送 builtin(metric)与 sandbox(box/heading/table)规格 → 端到端渲染。
 *   - 安全:危险 href 的 sandbox link 被拒(safeParse 失败)→ 回退,不产出可点击 javascript: 链接。
 */
describe("server-driven UI e2e (<PiChat> + data-pi-ui)", () => {
  it("builtin + sandbox 渲染,且危险 href 降级", async () => {
    const user = userEvent.setup();
    const script: UIMessageChunk[] = [
      { type: "start", messageId: "a1" },
      {
        type: "data-pi-ui",
        data: {
          kind: "builtin",
          component: "metric",
          props: { label: "今日活跃", value: "1,284", delta: "+12%", tone: "success" },
        },
      },
      {
        type: "data-pi-ui",
        data: {
          kind: "sandbox",
          title: "部署报告",
          root: {
            el: "box",
            direction: "col",
            children: [
              { el: "heading", level: 2, text: "部署成功" },
              { el: "table", columns: ["服务", "状态"], rows: [["api", "OK"]] },
            ],
          },
        },
      },
      {
        type: "data-pi-ui",
        data: {
          kind: "sandbox",
          root: { el: "link", text: "danger-link", href: "javascript:alert(1)" },
        },
      },
      { type: "finish" },
    ] as UIMessageChunk[];

    const transport = new MockTransport(script);
    const session = mockSession({
      transport: transport as unknown as ReturnType<typeof mockSession>["transport"],
    });

    render(<PiChat session={session} controls={mockControls()} />);

    // 提交一条消息,驱动 transport 脚本流。
    await user.type(screen.getByRole("textbox", { name: /消息输入|message/i }), "go");
    await user.click(screen.getByRole("button", { name: /发送/ }));

    // builtin metric 卡渲染。
    await waitFor(() => expect(screen.getByText("今日活跃")).toBeInTheDocument());
    expect(screen.getByText("1,284")).toBeInTheDocument();
    expect(
      document.querySelector("[data-pi-ui-builtin='metric']"),
    ).not.toBeNull();

    // sandbox 节点树渲染(标题 + 表格)。
    expect(screen.getByText("部署报告")).toBeInTheDocument();
    expect(screen.getByText("部署成功")).toBeInTheDocument();
    expect(screen.getByText("api")).toBeInTheDocument();
    expect(document.querySelector("[data-pi-ui-sandbox] table")).not.toBeNull();

    // 安全:危险 href 不产出可点击 javascript: 链接,且呈现回退占位。
    expect(document.querySelector('a[href^="javascript"]')).toBeNull();
    expect(screen.queryByText("danger-link")).toBeNull();
    expect(document.querySelector("[data-pi-ui-fallback]")).not.toBeNull();
  });
});
