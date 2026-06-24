import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { Notifications } from "../../src/elements/notifications.js";
import type { ExtensionNotification } from "@blksails/react";

/**
 * Notifications 通知浮层(toasts)测试(Req 1.1/1.2/1.3/1.4/1.5/1.6、8.1/8.2)。
 *
 * 无状态展示元件:接收 notifications 列表堆叠展示;按 notifyType 配色;挂载后自动消失
 * (autoDismissMs,默认 ~5000;<=0 关闭);手动关闭按钮回调 onDismiss(id);空列表返回 null。
 * a11y:error→role=alert,info/warning→role=status;关闭按钮带 aria-label。
 */

const info: ExtensionNotification = {
  id: "n-info",
  message: "信息提示",
  notifyType: "info",
};
const warning: ExtensionNotification = {
  id: "n-warn",
  message: "警告提示",
  notifyType: "warning",
};
const error: ExtensionNotification = {
  id: "n-err",
  message: "错误提示",
  notifyType: "error",
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Notifications 通知浮层", () => {
  it("空列表返回 null,不渲染容器 (Req 1.6)", () => {
    const { container } = render(
      <Notifications notifications={[]} onDismiss={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(
      container.querySelector("[data-pi-notifications]"),
    ).not.toBeInTheDocument();
  });

  it("多条通知堆叠渲染,各带正确 data-pi-notify-type (Req 1.5/1.2)", () => {
    const { container } = render(
      <Notifications
        notifications={[info, warning, error]}
        onDismiss={vi.fn()}
        autoDismissMs={0}
      />,
    );
    const items = container.querySelectorAll("[data-pi-notification]");
    expect(items).toHaveLength(3);

    expect(screen.getByText("信息提示")).toBeInTheDocument();
    expect(screen.getByText("警告提示")).toBeInTheDocument();
    expect(screen.getByText("错误提示")).toBeInTheDocument();

    const types = Array.from(items).map((el) =>
      el.getAttribute("data-pi-notify-type"),
    );
    expect(types).toEqual(["info", "warning", "error"]);
  });

  it("error 用 role=alert;info/warning 用 role=status (Req 8.2)", () => {
    render(
      <Notifications
        notifications={[info, warning, error]}
        onDismiss={vi.fn()}
        autoDismissMs={0}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("错误提示");
    const statuses = screen.getAllByRole("status");
    expect(statuses).toHaveLength(2);
    expect(statuses.map((el) => el.textContent)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("信息提示"),
        expect.stringContaining("警告提示"),
      ]),
    );
  });

  it("点击关闭按钮调 onDismiss(对应 id) (Req 1.4)", async () => {
    const onDismiss = vi.fn();
    const user = userEvent.setup();
    render(
      <Notifications
        notifications={[info, error]}
        onDismiss={onDismiss}
        autoDismissMs={0}
      />,
    );
    const buttons = screen.getAllByRole("button", { name: "关闭通知" });
    expect(buttons).toHaveLength(2);
    await user.click(buttons[1]!);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledWith("n-err");
  });

  it("自动消失:到 autoDismissMs 调 onDismiss(id) (Req 1.3)", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(
      <Notifications
        notifications={[info]}
        onDismiss={onDismiss}
        autoDismissMs={5000}
      />,
    );
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledWith("n-info");
  });

  it("autoDismissMs <= 0 时不自动消失 (Req 1.3 关闭)", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(
      <Notifications
        notifications={[info]}
        onDismiss={onDismiss}
        autoDismissMs={0}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(60000);
    });
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
