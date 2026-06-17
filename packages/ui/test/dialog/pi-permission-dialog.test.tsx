import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { PiPermissionDialog } from "../../src/dialog/pi-permission-dialog.js";
import {
  mockExtensionUI,
  selectRequest,
  confirmRequest,
  inputRequest,
  editorRequest,
} from "../fixtures/mock-session.js";

describe("PiPermissionDialog", () => {
  it("无 current 时返回 null(不渲染)", () => {
    render(<PiPermissionDialog extensionUI={mockExtensionUI()} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("select 类型渲染可选项并提交 value", async () => {
    const user = userEvent.setup();
    const ext = mockExtensionUI({ current: selectRequest() });
    render(<PiPermissionDialog extensionUI={ext} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.click(screen.getByLabelText("beta"));
    await user.click(screen.getByText("Submit"));
    expect(ext.respond).toHaveBeenCalledWith("req-select", {
      type: "extension_ui_response",
      id: "req-select",
      value: "beta",
    });
  });

  it("confirm 类型呈现确认/取消并回传 confirmed", async () => {
    const user = userEvent.setup();
    const ext = mockExtensionUI({ current: confirmRequest() });
    render(<PiPermissionDialog extensionUI={ext} />);
    expect(screen.getByText("Proceed with action?")).toBeInTheDocument();
    await user.click(screen.getByText("Confirm"));
    expect(ext.respond).toHaveBeenCalledWith("req-confirm", {
      type: "extension_ui_response",
      id: "req-confirm",
      confirmed: true,
    });
  });

  it("input 类型呈现文本输入并回传 value", async () => {
    const user = userEvent.setup();
    const ext = mockExtensionUI({ current: inputRequest() });
    render(<PiPermissionDialog extensionUI={ext} />);
    const input = screen.getByRole("textbox");
    await user.type(input, "Ada");
    await user.click(screen.getByText("Submit"));
    expect(ext.respond).toHaveBeenCalledWith("req-input", {
      type: "extension_ui_response",
      id: "req-input",
      value: "Ada",
    });
  });

  it("editor 类型呈现多行编辑(prefill)并回传 value", async () => {
    const user = userEvent.setup();
    const ext = mockExtensionUI({ current: editorRequest() });
    render(<PiPermissionDialog extensionUI={ext} />);
    const editor = screen.getByRole("textbox");
    expect(editor).toHaveValue("initial");
    await user.clear(editor);
    await user.type(editor, "edited");
    await user.click(screen.getByText("Submit"));
    expect(ext.respond).toHaveBeenCalledWith("req-editor", {
      type: "extension_ui_response",
      id: "req-editor",
      value: "edited",
    });
  });

  it("回传失败保留弹窗并显示错误,允许重试", async () => {
    const user = userEvent.setup();
    const respond = vi
      .fn<(id: string, r: unknown) => Promise<void>>()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(undefined);
    const ext = mockExtensionUI({ current: inputRequest(), respond });
    render(<PiPermissionDialog extensionUI={ext} />);
    await user.type(screen.getByRole("textbox"), "x");
    await user.click(screen.getByText("Submit"));
    expect(await screen.findByRole("alert")).toHaveTextContent("network down");
    // 弹窗仍在,可重试
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.click(screen.getByText("Submit"));
    expect(respond).toHaveBeenCalledTimes(2);
  });

  it("Esc 关闭触发取消回传(aria 对话框语义)", async () => {
    const user = userEvent.setup();
    const ext = mockExtensionUI({ current: inputRequest() });
    render(<PiPermissionDialog extensionUI={ext} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(ext.respond).toHaveBeenCalledWith("req-input", {
        type: "extension_ui_response",
        id: "req-input",
        cancelled: true,
      }),
    );
  });
});
