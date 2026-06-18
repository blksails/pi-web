import type { Meta, StoryObj } from "@storybook/react-vite";
import { PiInteraction } from "../src/elements/pi-interaction.js";
import {
  mockExtensionUI,
  selectRequest,
  confirmRequest,
  inputRequest,
  editorRequest,
} from "./_mocks.js";

/**
 * 内联扩展交互:四类(select / confirm / input / editor)+ 回传(ui-components 7.1)。
 * 以 `extensionUI.current` 注入挂起请求,内联卡片即时呈现。
 * (原 dialog/PiPermissionDialog 已重命名为 elements/PiInteraction。)
 */
const meta: Meta<typeof PiInteraction> = {
  title: "Interaction/PiInteraction",
  component: PiInteraction,
};
export default meta;

type Story = StoryObj<typeof PiInteraction>;

export const Select: Story = {
  args: { extensionUI: mockExtensionUI({ current: selectRequest() }) },
};

export const Confirm: Story = {
  args: { extensionUI: mockExtensionUI({ current: confirmRequest() }) },
};

export const Input: Story = {
  args: { extensionUI: mockExtensionUI({ current: inputRequest() }) },
};

export const Editor: Story = {
  args: { extensionUI: mockExtensionUI({ current: editorRequest() }) },
};
