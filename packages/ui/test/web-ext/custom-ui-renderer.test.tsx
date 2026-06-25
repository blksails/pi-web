import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import * as React from "react";
import {
  CustomUiRenderer,
  CustomUiDataPart,
  registerCustomUi,
  getCustomUi,
} from "../../src/web-ext/custom-ui-renderer.js";

describe("custom-ui-renderer", () => {
  it("注册后 getCustomUi 命中", () => {
    const Comp = (): React.JSX.Element => <div>x</div>;
    registerCustomUi("test-comp", Comp);
    expect(getCustomUi("test-comp")).toBe(Comp);
  });

  it("命中注册名 → 渲染组件 + 透传 props", () => {
    registerCustomUi("greeter", ({ props }) => (
      <div data-testid="greeter">{(props as { name: string }).name}</div>
    ));
    const { getByTestId, container } = render(
      <CustomUiRenderer payload={{ component: "greeter", props: { name: "pi" } }} />,
    );
    expect(getByTestId("greeter").textContent).toBe("pi");
    expect(container.querySelector("[data-pi-custom-ui]")).not.toBeNull();
  });

  it("未注册名 → 降级占位(不崩)", () => {
    const { container } = render(
      <CustomUiRenderer payload={{ component: "nope-xyz" }} />,
    );
    expect(container.querySelector("[data-pi-custom-ui-fallback]")).not.toBeNull();
  });

  it("CustomUiDataPart:解析 part.data 并渲染;非法 data → null", () => {
    registerCustomUi("dp", () => <div data-testid="dp">ok</div>);
    const { getByTestId } = render(
      <CustomUiDataPart part={{ data: { component: "dp" } }} />,
    );
    expect(getByTestId("dp")).toBeTruthy();

    const { container } = render(<CustomUiDataPart part={{ data: { bad: 1 } }} />);
    expect(container.querySelector("[data-pi-custom-ui]")).toBeNull();
    expect(container.querySelector("[data-pi-custom-ui-fallback]")).toBeNull();
  });
});
