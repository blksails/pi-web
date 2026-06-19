import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import * as React from "react";
import { resolveComponent } from "../../src/customization/component-overrides.js";
import { layoutClassNames } from "../../src/customization/layout.js";
import { IconsProvider, useIcon } from "../../src/customization/icons.js";
import { ThemeProvider } from "../../src/theme/theme-provider.js";

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove("dark");
});

const Default = (): React.JSX.Element => <span data-testid="default" />;
const Override = (): React.JSX.Element => <span data-testid="override" />;

describe("resolveComponent (Req 5.5/9.2/9.3)", () => {
  it("缺省回退默认实现", () => {
    expect(resolveComponent(undefined, Default)).toBe(Default);
  });
  it("覆盖组件优先", () => {
    expect(resolveComponent(Override, Default)).toBe(Override);
  });
  it("null 表示移除(Req 5.4)", () => {
    expect(resolveComponent(null, Default)).toBeNull();
  });
});

describe("layoutClassNames (Req 7.1/7.3/7.4)", () => {
  it("缺省等价 centered", () => {
    expect(layoutClassNames(undefined)).toEqual(layoutClassNames("centered"));
    expect(layoutClassNames("centered").content).toContain("max-w-3xl");
    expect(layoutClassNames("centered").hasAside).toBe(false);
  });
  it("wide 更宽", () => {
    expect(layoutClassNames("wide").content).toContain("max-w-5xl");
  });
  it("full 满宽且无让位区", () => {
    expect(layoutClassNames("full").hasAside).toBe(false);
  });
  it("split 划出让位区", () => {
    expect(layoutClassNames("split").hasAside).toBe(true);
  });
});

function IconProbe(): React.JSX.Element {
  const Icon = useIcon("send", () => <span data-testid="fallback" />);
  return <Icon />;
}

describe("useIcon / IconsProvider (Req 8.1/8.2)", () => {
  it("无主题回退 fallback", () => {
    render(
      <IconsProvider>
        <IconProbe />
      </IconsProvider>,
    );
    expect(screen.getByTestId("fallback")).toBeInTheDocument();
  });
  it("命中主题用主题图标", () => {
    render(
      <IconsProvider icons={{ send: () => <span data-testid="brand" /> }}>
        <IconProbe />
      </IconsProvider>,
    );
    expect(screen.getByTestId("brand")).toBeInTheDocument();
  });
});

function mockMatchMedia(matches: boolean): { set: (m: boolean) => void } {
  const listeners = new Set<() => void>();
  const mql = {
    matches,
    media: "(prefers-color-scheme: dark)",
    addEventListener: (_: string, cb: () => void) => listeners.add(cb),
    removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
  };
  window.matchMedia = vi.fn().mockReturnValue(mql) as unknown as typeof window.matchMedia;
  return {
    set: (m: boolean) => {
      mql.matches = m;
      listeners.forEach((cb) => cb());
    },
  };
}

describe("ThemeProvider (Req 2.1/2.2/2.3)", () => {
  it("dark 应用暗色类,light 移除", () => {
    const { rerender } = render(<ThemeProvider mode="dark">x</ThemeProvider>);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    rerender(<ThemeProvider mode="light">x</ThemeProvider>);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
  it("system 跟随系统偏好且运行时更新", () => {
    const mm = mockMatchMedia(true);
    render(<ThemeProvider mode="system">x</ThemeProvider>);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    act(() => mm.set(false));
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});
