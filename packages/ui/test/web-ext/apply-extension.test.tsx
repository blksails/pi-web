import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import * as React from "react";
import {
  SlotHost,
  applyExtensionRenderers,
  resolveSlot,
} from "../../src/web-ext/apply-extension.js";
import { createRendererRegistry } from "../../src/registry/renderer-registry.js";
import type { WebExtension, ConversationAccess } from "@blksails/pi-web-kit";

function Dummy(): null {
  return null;
}

describe("SlotHost", () => {
  it("渲染扩展声明的插槽内容(ReactNode)到指定位置", () => {
    const ext: WebExtension = {
      manifestId: "acme",
      slots: { panelRight: <div data-testid="ext-panel">PANEL</div> },
    };
    render(<SlotHost ext={ext} slot="panelRight" fallback={<span>def</span>} />);
    expect(screen.getByTestId("ext-panel")).toHaveTextContent("PANEL");
  });

  it("组件型贡献获得 extId", () => {
    const Panel = ({ extId }: { extId: string }): React.JSX.Element => (
      <div data-testid="p">{extId}</div>
    );
    const ext: WebExtension = { manifestId: "acme", slots: { headerCenter: Panel } };
    render(<SlotHost ext={ext} slot="headerCenter" />);
    expect(screen.getByTestId("p")).toHaveTextContent("acme");
  });

  it("syncSignal 经 SlotHost 透传给组件型 slot 贡献(Canvas 轮末 re-sync 接线)", () => {
    const Panel = ({ syncSignal }: { syncSignal?: unknown }): React.JSX.Element => (
      <div data-testid="sig">{String(syncSignal)}</div>
    );
    // slot 组件按生产范式以 `as never` 挂载(对齐 web.config.tsx 的 `CanvasPanel as never`):
    // 注入 props(surface/upload/syncSignal…)由组件自声明,不进最小 SlotRenderProps 契约。
    const ext: WebExtension = { manifestId: "acme", slots: { panelRight: Panel as never } };
    const { rerender } = render(
      <SlotHost ext={ext} slot="panelRight" syncSignal={0} />,
    );
    expect(screen.getByTestId("sig")).toHaveTextContent("0");
    // 宿主轮末 bump → slot 组件收到新值(据此触发 run("sync"))。
    rerender(<SlotHost ext={ext} slot="panelRight" syncSignal={1} />);
    expect(screen.getByTestId("sig")).toHaveTextContent("1");
  });

  it("conversation 能力对象经 SlotHost 透传给组件型 slot 贡献(§4.2 能力对象注入)", () => {
    const Panel = ({
      conversation,
    }: {
      conversation?: ConversationAccess;
    }): React.JSX.Element => (
      <button
        data-testid="conv"
        onClick={() => conversation?.submitUserMessage("hi")}
      >
        {conversation !== undefined ? "on" : "off"}
      </button>
    );
    const submit = vi.fn();
    const conversation: ConversationAccess = { submitUserMessage: submit };
    const ext: WebExtension = {
      manifestId: "acme",
      slots: { panelRight: Panel as never },
    };
    render(<SlotHost ext={ext} slot="panelRight" conversation={conversation} />);
    const btn = screen.getByTestId("conv");
    // 能力对象到达 slot props(非 undefined),且是宿主注入的同一对象(调用命中 spy)。
    expect(btn).toHaveTextContent("on");
    fireEvent.click(btn);
    expect(submit).toHaveBeenCalledWith("hi");
  });

  it("未声明插槽时回退默认", () => {
    const ext: WebExtension = { manifestId: "acme", slots: {} };
    render(<SlotHost ext={ext} slot="footer" fallback={<span data-testid="def">DEF</span>} />);
    expect(screen.getByTestId("def")).toBeInTheDocument();
  });

  it("扩展插槽抛错被 error boundary 隔离 → 渲染 fallback 且上报", () => {
    const Boom = (): React.JSX.Element => {
      throw new Error("boom");
    };
    const onError = vi.fn();
    const ext: WebExtension = { manifestId: "acme", slots: { footer: Boom } };
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(
      <SlotHost ext={ext} slot="footer" fallback={<span data-testid="fb">FB</span>} onError={onError} />,
    );
    expect(screen.getByTestId("fb")).toBeInTheDocument();
    expect(onError).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("applyExtensionRenderers", () => {
  it("把渲染器注册到 extId 命名空间,clear 卸载", () => {
    const reg = createRendererRegistry();
    const ext: WebExtension = {
      manifestId: "acme",
      renderers: { dataParts: { "data-card": Dummy }, tools: { search: Dummy } },
    };
    const dispose = applyExtensionRenderers(reg, ext);
    expect(reg.resolveDataPartRenderer("data-card")).toBe(Dummy);
    expect(reg.resolveToolRenderer("search")).toBe(Dummy);
    dispose();
    expect(reg.resolveDataPartRenderer("data-card")).toBeUndefined();
  });

  it("resolveSlot 取贡献", () => {
    const ext: WebExtension = { manifestId: "x", slots: { footer: <i>f</i> } };
    expect(resolveSlot(ext, "footer")).toBeDefined();
    expect(resolveSlot(ext, "header" as never)).toBeUndefined();
    expect(resolveSlot(undefined, "footer")).toBeUndefined();
  });
});
