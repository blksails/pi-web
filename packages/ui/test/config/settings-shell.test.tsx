import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import {
  createSettingsRegistry,
  zodValidator,
  type SettingsPanelDescriptor,
} from "@pi-web/react";
import {
  settingsFormSchema,
  settingsConfigSchema,
  authFormSchema,
} from "@pi-web/protocol";
import { SettingsShell } from "../../src/config/settings-shell.js";

function makePanel(
  over: Partial<SettingsPanelDescriptor> = {},
): SettingsPanelDescriptor {
  return {
    id: "settings",
    title: "通用",
    order: 2,
    formSchema: settingsFormSchema,
    validate: zodValidator(settingsConfigSchema),
    load: async () => ({ theme: "dark" }),
    save: async () => undefined,
    ...over,
  };
}

describe("SettingsShell", () => {
  it("按注册表渲染导航并加载首面板值", async () => {
    const r = createSettingsRegistry();
    r.registerPanel(
      makePanel({
        id: "auth",
        title: "凭证",
        order: 1,
        formSchema: authFormSchema,
        load: async () => ({}),
      }),
    );
    r.registerPanel(makePanel());
    render(<SettingsShell registry={r} />);
    // 导航两项(用 nav 按钮角色精确定位,避免与面板标题文本冲突)
    expect(screen.getByRole("button", { name: "凭证" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "通用" })).toBeInTheDocument();
    // 首面板(auth, order=1)加载完成
    await waitFor(() =>
      expect(screen.queryByText("加载中…")).not.toBeInTheDocument(),
    );
  });

  it("保存触发 panel.save", async () => {
    const user = userEvent.setup();
    const save = vi.fn(async () => undefined);
    const r = createSettingsRegistry();
    r.registerPanel(makePanel({ save }));
    render(<SettingsShell registry={r} />);
    await waitFor(() =>
      expect(screen.queryByText("加载中…")).not.toBeInTheDocument(),
    );
    // 改值使 dirty
    const input = screen.getByLabelText("默认 Provider");
    await user.type(input, "anthropic");
    await user.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(save).toHaveBeenCalled());
  });
});
