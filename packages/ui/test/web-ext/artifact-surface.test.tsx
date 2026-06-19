import { describe, it, expect, vi } from "vitest";
import { render, act } from "@testing-library/react";
import { ArtifactSurface } from "../../src/web-ext/artifact-surface.js";

/** 在 act() 内派发,确保 message → setState 同步 flush(否则断言读到旧值,非确定性)。 */
function postFromFrame(frame: Window | null, data: unknown): void {
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { data, source: frame }));
  });
}

describe("ArtifactSurface", () => {
  it("渲染 sandbox iframe(allow-scripts,无 allow-same-origin)", () => {
    const { container } = render(<ArtifactSurface srcDoc="<p>hi</p>" />);
    const iframe = container.querySelector("iframe[data-pi-artifact]") as HTMLIFrameElement;
    expect(iframe).not.toBeNull();
    expect(iframe.getAttribute("sandbox")).toBe("allow-scripts");
    expect(iframe.getAttribute("sandbox")).not.toContain("allow-same-origin");
  });

  it("来自本 iframe 的 resize 消息调整高度", () => {
    const { container } = render(<ArtifactSurface srcDoc="<p>hi</p>" initialHeight={100} />);
    const iframe = container.querySelector("iframe") as HTMLIFrameElement;
    postFromFrame(iframe.contentWindow, { kind: "resize", height: 321 });
    expect(iframe.style.height).toBe("321px");
  });

  it("非法消息被丢弃(高度不变)", () => {
    const { container } = render(<ArtifactSurface srcDoc="<p>hi</p>" initialHeight={100} />);
    const iframe = container.querySelector("iframe") as HTMLIFrameElement;
    postFromFrame(iframe.contentWindow, { kind: "bogus" });
    postFromFrame(iframe.contentWindow, { kind: "resize", height: -5 });
    expect(iframe.style.height).toBe("100px");
  });

  it("来源非本 iframe 的消息被忽略", () => {
    const { container } = render(<ArtifactSurface srcDoc="<p>hi</p>" initialHeight={100} />);
    const iframe = container.querySelector("iframe") as HTMLIFrameElement;
    // source = window(非 iframe.contentWindow)→ 忽略
    postFromFrame(window, { kind: "resize", height: 999 });
    expect(iframe.style.height).toBe("100px");
  });

  it("rpc 消息经注入 client 中转回 agent", () => {
    const request = vi.fn(async () => ({ correlationId: "x", ok: true }));
    const { container } = render(
      <ArtifactSurface srcDoc="<p>hi</p>" rpc={{ request }} />,
    );
    const iframe = container.querySelector("iframe") as HTMLIFrameElement;
    postFromFrame(iframe.contentWindow, {
      kind: "rpc",
      request: { correlationId: "x", point: "custom", action: "execute", payload: { a: 1 }, protocolVersion: "0.1.0" },
    });
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({ point: "custom", action: "execute" }),
    );
  });
});
