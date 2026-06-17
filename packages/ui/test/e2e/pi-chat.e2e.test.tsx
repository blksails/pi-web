import { describe, it, expect, vi } from "vitest";
import * as React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { PiChatBasic } from "../../src/chat/pi-chat-basic.js";
import type { UseExtensionUIResult } from "@pi-web/react";
import {
  mockSession,
  mockControls,
  mockExtensionUI,
  selectRequest,
  MockTransport,
} from "../fixtures/mock-session.js";
import { streamWithToolAndReasoning } from "../fixtures/ui-message-fixtures.js";

/**
 * e2e(组件级):mock 会话/mock transport 驱动 <PiChatBasic>(最小组件),断言跨组件完整交互。
 *   (a) 流式文本逐步出现
 *   (b) 工具卡 start→end 呈现
 *   (c) 思考块可展开
 *   (d) 权限弹窗出现→作答→经 respond 回传并关闭
 */
describe("PiChatBasic e2e (mock 会话)", () => {
  it("流式文本 + 工具卡 + 思考块 + 权限弹窗完整交互", async () => {
    const user = userEvent.setup();

    // (a)-(c) — 流式文本 / 工具 / 思考
    const transport = new MockTransport(streamWithToolAndReasoning());
    const session = mockSession({
      transport: transport as unknown as ReturnType<
        typeof mockSession
      >["transport"],
    });

    // (d) — 受控扩展 UI:respond 后清空 current 模拟出队关闭
    function Wrapper(): React.JSX.Element {
      const [current, setCurrent] = React.useState<
        UseExtensionUIResult["current"]
      >(undefined);
      const respond = vi.fn(async () => {
        setCurrent(undefined);
      });
      const ext = mockExtensionUI({ current, respond });
      return (
        <div>
          <button
            type="button"
            onClick={() => setCurrent(selectRequest())}
            data-testid="trigger-ext"
          >
            trigger
          </button>
          <PiChatBasic
            session={session}
            controls={mockControls()}
            extensionUI={ext}
            showControls={false}
          />
        </div>
      );
    }

    render(<Wrapper />);

    // 提交一条消息,驱动 transport 脚本流
    await user.type(screen.getByLabelText("Message"), "go");
    await user.click(screen.getByRole("button", { name: /send/i }));

    // (a) 流式文本逐步出现
    await waitFor(() =>
      expect(screen.getByText(/Hello world/)).toBeInTheDocument(),
    );

    // (b) 工具卡呈现(end 态)
    await waitFor(() =>
      expect(document.querySelector("[data-pi-tool]")).not.toBeNull(),
    );
    const toolCard = document.querySelector("[data-pi-tool]");
    expect(toolCard).toHaveAttribute("data-pi-tool-phase", "end");

    // (c) 思考块可展开
    const reasoningToggle = screen.getByRole("button", { name: /reasoning/i });
    expect(reasoningToggle).toHaveAttribute("aria-expanded", "false");
    await user.click(reasoningToggle);
    expect(reasoningToggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/Let me think/)).toBeInTheDocument();

    // (d) 权限弹窗出现→作答→回传并关闭
    await user.click(screen.getByTestId("trigger-ext"));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    await user.click(screen.getByLabelText("alpha"));
    await user.click(screen.getByText("Submit"));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });
});
