import type { Meta, StoryObj } from "@storybook/react-vite";
import { PiPermissionDialog } from "../src/dialog/pi-permission-dialog.js";
import {
  mockExtensionUI,
  selectRequest,
  confirmRequest,
  inputRequest,
  editorRequest,
} from "./_mocks.js";

/**
 * 权限弹窗:扩展 UI 四类(select / confirm / input / editor)+ 回传(ui-components 7.1)。
 * 以 `extensionUI.current` 注入挂起请求,弹窗即时呈现。
 */
const meta: Meta<typeof PiPermissionDialog> = {
  title: "Dialog/PiPermissionDialog",
  component: PiPermissionDialog,
};
export default meta;

type Story = StoryObj<typeof PiPermissionDialog>;

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
