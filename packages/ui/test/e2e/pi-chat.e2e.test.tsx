import { describe, it, expect, vi } from "vitest";
import * as React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { PiChatBasic } from "../../src/chat/pi-chat-basic.js";
import type { UseExtensionUIResult } from "@blksails/pi-web-react";
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
    // i18n 后输入框 aria-label / 发送按钮文案随 locale 变化,改用语言无关的 data-* 选择器。
    await user.type(
      document.querySelector("[data-pi-input-textarea]") as HTMLElement,
      "go",
    );
    await user.click(document.querySelector("[data-pi-send]") as HTMLElement);

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

    // (d) 交互内联卡出现→作答→经 respond 回传,active 卡转为只读留痕
    await user.click(screen.getByTestId("trigger-ext"));
    const active = await waitFor(() => {
      const el = document.querySelector("[data-pi-interaction-active]");
      expect(el).not.toBeNull();
      return el!;
    });
    // 非模态:不弹 dialog。
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(active.getAttribute("data-pi-interaction-method")).toBe("select");
    await user.click(screen.getByLabelText("alpha"));
    await user.click(document.querySelector("[data-pi-interaction-submit]")!);
    // 应答后:active 卡消失(出队),留痕「已选择：alpha」可见。
    await waitFor(() =>
      expect(
        document.querySelector("[data-pi-interaction-active]"),
      ).toBeNull(),
    );
    expect(screen.getByText("已选择：alpha")).toBeInTheDocument();
  });
});
