import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import {
  ConversationImageGallery,
  type ConversationImageGalleryProps,
} from "../../src/elements/conversation-image-gallery.js";

const ASSETS: ConversationImageGalleryProps["assets"] = [
  {
    id: "a1",
    url: "https://assets.test/attachments/att_1/raw",
    filename: "one.png",
    mediaType: "image/png",
    attachmentId: "att_1",
  },
  {
    id: "a2",
    url: "https://assets.test/attachments/att_2/raw",
    filename: "two.png",
    mediaType: "image/png",
    attachmentId: "att_2",
  },
];

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ConversationImageGallery", () => {
  it("以适中 contain 容器与毛玻璃 pill 展示，动作去重并发布 Canvas 事件", async () => {
    const user = userEvent.setup();
    const publish = vi.fn();
    const run = vi.fn(({ asset, publishPaneEvent }) => {
      publishPaneEvent("pi.canvas.open-attachments", {
        attachmentIds: [asset.attachmentId],
      });
    });
    render(
      <ConversationImageGallery
        assets={[ASSETS[0]!]}
        actions={[
          { id: "canvas:open", label: "在画布中打开", icon: "palette", run },
          { id: "canvas:open", label: "重复动作", icon: "palette", run },
        ]}
        publishPaneEvent={publish}
      />,
    );
    const image = screen.getByRole("img", { name: "one.png" });
    expect(image).toHaveStyle({ maxHeight: "min(56dvh, 520px)" });
    expect(image).toHaveClass("object-contain");
    expect(document.querySelectorAll("[data-image-action='canvas:open']")).toHaveLength(1);
    expect(document.querySelector("[data-pi-conversation-image-pill]"))
      .toHaveClass("backdrop-blur-md");

    await user.click(screen.getByRole("button", { name: "在画布中打开" }));
    expect(run).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith("pi.canvas.open-attachments", {
      attachmentIds: ["att_1"],
    });
  });

  it("单次点击按顺序就地下载全部图片", async () => {
    const user = userEvent.setup();
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      calls.push(url);
      return new Response(new Blob(["image"]), { status: 200 });
    }));
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn((blob: Blob) => `blob:${blob.size}:${calls.length}`),
      revokeObjectURL: vi.fn(),
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(<ConversationImageGallery assets={ASSETS} />);

    await user.click(screen.getByRole("button", { name: "下载全部" }));
    await waitFor(() => expect(click).toHaveBeenCalledTimes(2));
    expect(calls).toEqual(ASSETS.map((asset) => asset.url));
  });

  it("动作失败留在当前页面并显示错误", async () => {
    const user = userEvent.setup();
    render(
      <ConversationImageGallery
        assets={[ASSETS[0]!]}
        actions={[{
          id: "broken",
          label: "失败动作",
          icon: "sparkles",
          run: () => Promise.reject(new Error("画布不可用")),
        }]}
      />,
    );
    await user.click(screen.getByRole("button", { name: "失败动作" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("画布不可用");
  });
});
