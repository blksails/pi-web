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

  it("同 group 的面板合并为一个菜单项 + Tab 切换", async () => {
    const user = userEvent.setup();
    const globalLoad = vi.fn(async () => ({ theme: "dark" }));
    const projectLoad = vi.fn(async () => ({ theme: "light" }));
    const r = createSettingsRegistry();
    r.registerPanel(
      makePanel({
        id: "sandbox",
        title: "沙箱",
        group: "sandbox",
        groupTitle: "沙箱",
        groupOrder: 3,
        tabLabel: "全局",
        tabOrder: 1,
        load: globalLoad,
      }),
    );
    r.registerPanel(
      makePanel({
        id: "sandbox-project",
        title: "沙箱",
        group: "sandbox",
        groupTitle: "沙箱",
        groupOrder: 3,
        tabLabel: "项目",
        tabOrder: 2,
        load: projectLoad,
      }),
    );
    render(<SettingsShell registry={r} />);

    // 左侧仅一个「沙箱」菜单项(不是两个),Tab 才是「全局/项目」。
    expect(screen.getByRole("button", { name: "沙箱" })).toBeInTheDocument();
    const globalTab = screen.getByRole("tab", { name: "全局" });
    const projectTab = screen.getByRole("tab", { name: "项目" });
    expect(globalTab).toHaveAttribute("aria-selected", "true");
    expect(projectTab).toHaveAttribute("aria-selected", "false");

    // 默认加载全局面板。
    await waitFor(() => expect(globalLoad).toHaveBeenCalled());

    // 切到「项目」Tab → 加载项目面板。
    await user.click(projectTab);
    expect(projectTab).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(projectLoad).toHaveBeenCalled());
  });
});
