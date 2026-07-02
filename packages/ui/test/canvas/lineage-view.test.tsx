import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import type { GalleryAsset } from "@blksails/pi-web-tool-kit/aigc-canvas-schema";
import { LineageView, buildLineageTree } from "../../src/canvas/lineage-view.js";

function asset(id: string, over: Partial<GalleryAsset> = {}): GalleryAsset {
  return {
    attachmentId: id,
    displayUrl: `/att/${id}`,
    mimeType: "image/png",
    name: `${id}.png`,
    createdAt: "2026-07-02T10:00:00.000Z",
    origin: "tool-output",
    ...over,
  };
}

describe("buildLineageTree", () => {
  it("按 derivedFrom 建父子树,缺父者为根", () => {
    const roots = buildLineageTree([
      asset("root"),
      asset("child", { derivedFrom: "root" }),
      asset("grand", { derivedFrom: "child" }),
      asset("orphan", { derivedFrom: "missing" }),
    ]);
    expect(roots.map((r) => r.asset.attachmentId).sort()).toEqual(["orphan", "root"]);
    const rootNode = roots.find((r) => r.asset.attachmentId === "root")!;
    expect(rootNode.children[0]?.asset.attachmentId).toBe("child");
    expect(rootNode.children[0]?.children[0]?.asset.attachmentId).toBe("grand");
  });
});

describe("LineageView", () => {
  it("渲染血缘树 + 复用参数回调", () => {
    cleanup();
    const onReuse = vi.fn();
    render(
      <LineageView
        assets={[asset("root"), asset("c", { derivedFrom: "root", genParams: { prompt: "p" } })]}
        onReuseParams={onReuse}
      />,
    );
    expect(document.querySelectorAll("[data-lineage-node]").length).toBe(2);
    fireEvent.click(document.querySelector('[data-lineage-reuse][data-att-id="c"]')!);
    expect(onReuse).toHaveBeenCalledWith(expect.objectContaining({ attachmentId: "c" }));
  });

  it("选两图出 A-B 对比", () => {
    cleanup();
    render(
      <LineageView
        assets={[asset("a"), asset("b")]}
        compareIds={["a", "b"]}
      />,
    );
    expect(document.querySelector("[data-lineage-compare]")).not.toBeNull();
    expect(document.querySelectorAll("[data-compare-img]").length).toBe(2);
  });

  it("工作图链渲染", () => {
    cleanup();
    render(<LineageView assets={[asset("a"), asset("b")]} chain={["a", "b"]} />);
    expect(document.querySelectorAll("[data-chain-step]").length).toBe(2);
  });
});
