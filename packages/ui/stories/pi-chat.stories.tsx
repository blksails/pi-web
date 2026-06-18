import type { Meta, StoryObj } from "@storybook/react-vite";
import { within, userEvent, waitFor, expect } from "storybook/test";
import { PiChat } from "../src/chat/pi-chat.js";
import {
  mockSession,
  mockControls,
  mockExtensionUI,
  confirmRequest,
} from "./_mocks.js";

/**
 * `<PiChat>` 富装配组件 — mock 会话/控制/扩展 UI 驱动(ui-components 10.1)。
 *
 * - Default:展示装配壳(消息区 + 控制 + 输入)。
 * - StreamingConversation:play 自动提交一次 prompt,经 mock transport 推送脚本化 chunk,
 *   呈现流式文本 / 工具卡 / 思考块。
 * - WithPermissionDialog:注入挂起扩展 UI 请求,内嵌权限弹窗即时呈现。
 */
const meta: Meta<typeof PiChat> = {
  title: "Chat/PiChat",
  component: PiChat,
  parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<typeof PiChat>;

export const Default: Story = {
  render: () => (
    <div className="h-[600px]">
      <PiChat
        session={mockSession()}
        controls={mockControls()}
        extensionUI={mockExtensionUI()}
      />
    </div>
  ),
};

export const StreamingConversation: Story = {
  render: () => (
    <div className="h-[600px]">
      <PiChat
        session={mockSession()}
        controls={mockControls()}
        extensionUI={mockExtensionUI()}
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const textbox = canvas.getByRole("textbox");
    await userEvent.type(textbox, "搜索 pi{Enter}");
    // 流式文本逐步出现 + 工具卡呈现。
    await waitFor(() => {
      expect(canvas.getByText(/Hello world/)).toBeInTheDocument();
    });
  },
};

export const WithPermissionDialog: Story = {
  render: () => (
    <div className="h-[600px]">
      <PiChat
        session={mockSession()}
        controls={mockControls()}
        extensionUI={mockExtensionUI({ current: confirmRequest() })}
      />
    </div>
  ),
};
