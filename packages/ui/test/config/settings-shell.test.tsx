import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import {
  createSettingsRegistry,
  zodValidator,
  type SettingsPanelDescriptor,
} from "@blksails/pi-web-react";
import {
  settingsFormSchema,
  settingsConfigSchema,
  authFormSchema,
  providersFormSchema,
} from "@blksails/pi-web-protocol";
import { SettingsShell } from "../../src/config/settings-shell.js";
import {
  ProviderVisibilityField,
  __setProviderVisibilityFetchImpl,
  __resetProviderVisibilityFetchImpl,
} from "../../src/config/provider-visibility-field.js";
import { registerFieldRendererByKey } from "../../src/config/field-registry.js";

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

  describe("providers 面板 — 全部 provider 清单(Req 7.1;provider-visibility-config 任务 3.1)", () => {
    afterEach(() => {
      __resetProviderVisibilityFetchImpl();
    });

    it("providers 面板经 widget 渲染清单,分别按 output=text/image 取数并合并标明来源", async () => {
      // 两批各贡献互不相交的 provider,证明是**两次**取数合并而非单次(变异判据:
      // 若改回零筛选/单次取数,`newapi`(只在 output=image 那批里)不会出现)。
      const fetchSpy = vi.fn(async (url: string) => {
        if (url.includes("output=image")) {
          return new Response(
            JSON.stringify({ models: [{ provider: "newapi", id: "img-1", source: "self" }] }),
            { status: 200 },
          );
        }
        return new Response(
          JSON.stringify({
            models: [
              { provider: "blksails-ai", id: "m1", source: "blksails-ai" },
              { provider: "my-provider", id: "m2", source: "custom" },
            ],
          }),
          { status: 200 },
        );
      });
      __setProviderVisibilityFetchImpl(fetchSpy as unknown as typeof fetch);
      registerFieldRendererByKey("providerVisibility", ProviderVisibilityField);
      const r = createSettingsRegistry();
      r.registerPanel(
        makePanel({ id: "providers", title: "Provider", formSchema: providersFormSchema }),
      );
      render(<SettingsShell registry={r} />);

      // 变异判据:若 providers 表单里的 `visibility` 字段或其 widget renderer 注册
      // 任一缺失,下面这个清单区块整体不会出现(原先守的是 settings-shell 的 panel.id
      // 特判,该特判已被正规 widget 取代 —— 意图不变:providers 面板必须显示三档清单)。
      await waitFor(() => expect(screen.getByText("blksails-ai")).toBeInTheDocument());
      expect(screen.getByText("my-provider")).toBeInTheDocument();
      expect(screen.getByText("newapi")).toBeInTheDocument();
      // 两条(blksails-ai + newapi)都归"内置注册"档。
      expect(screen.getAllByText("内置注册")).toHaveLength(2);
      expect(screen.getByText("使用者自定义")).toBeInTheDocument();
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining("output=text"),
        expect.anything(),
      );
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining("output=image"),
        expect.anything(),
      );
    });

    it("非 providers 面板不渲染该清单区块", async () => {
      const r = createSettingsRegistry();
      r.registerPanel(makePanel({ id: "settings", title: "通用" }));
      render(<SettingsShell registry={r} />);
      await waitFor(() =>
        expect(screen.queryByText("加载中…")).not.toBeInTheDocument(),
      );
      expect(screen.queryByText("全部 Provider")).not.toBeInTheDocument();
    });
  });
});
