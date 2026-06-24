import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { PendingAttachment } from "@blksails/pi-web-react";
import {
  Attachments,
  getMediaCategory,
  getAttachmentLabel,
} from "../../src/elements/attachments.js";

/**
 * Attachments 无状态展示元件测试(Req 3.1/3.3/3.4/3.5、11.4)。
 *
 * 无状态:props 接收附件项列表、supported、onAdd/onRemove 与 rejected 提示。
 * 实际图片过滤/编码在 useAttachments(task 2.2),本元件只负责 UI 与透传 files。
 */
const item = (over: Partial<PendingAttachment> = {}): PendingAttachment => ({
  id: "att-1",
  name: "pic.png",
  mimeType: "image/png",
  dataUrl: "data:image/png;base64,AAAA",
  ...over,
});

describe("Attachments 附件展示与拖拽/粘贴", () => {
  it("渲染 chip:缩略图(dataUrl)与文件名 (Req 3.1)", () => {
    render(
      <Attachments
        items={[item()]}
        supported
        onAdd={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    const img = screen.getByRole("img", { name: /pic\.png/i });
    expect(img).toHaveAttribute("src", "data:image/png;base64,AAAA");
    expect(screen.getByText("pic.png")).toBeInTheDocument();
  });

  it("点击移除按钮调 onRemove(id) (Req 3.3)", async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    render(
      <Attachments
        items={[item({ id: "att-9", name: "a.png" })]}
        supported
        onAdd={vi.fn()}
        onRemove={onRemove}
      />,
    );
    const btn = screen.getByRole("button", { name: /移除|a\.png/i });
    expect(btn).toHaveAttribute("aria-label");
    await user.click(btn);
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledWith("att-9");
  });

  it("点击选择(file input change)调 onAdd(files) (Req 3.1)", async () => {
    const onAdd = vi.fn();
    const { container } = render(
      <Attachments items={[]} supported onAdd={onAdd} onRemove={vi.fn()} />,
    );
    const input = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    expect(input).not.toBeNull();
    const file = new File(["x"], "x.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [file] } });
    expect(onAdd).toHaveBeenCalledTimes(1);
    const passed = onAdd.mock.calls[0]![0] as FileList | File[];
    expect(Array.from(passed)[0]).toBe(file);
  });

  it("拖拽 drop 文件调 onAdd(files) (Req 3.1)", () => {
    const onAdd = vi.fn();
    render(
      <Attachments items={[]} supported onAdd={onAdd} onRemove={vi.fn()} />,
    );
    const zone = screen.getByTestId("pi-attachments-dropzone");
    const file = new File(["x"], "d.png", { type: "image/png" });
    fireEvent.drop(zone, { dataTransfer: { files: [file] } });
    expect(onAdd).toHaveBeenCalledTimes(1);
    const passed = onAdd.mock.calls[0]![0] as FileList | File[];
    expect(Array.from(passed)[0]).toBe(file);
  });

  it("粘贴图片调 onAdd(files) (Req 3.1)", () => {
    const onAdd = vi.fn();
    render(
      <Attachments items={[]} supported onAdd={onAdd} onRemove={vi.fn()} />,
    );
    const zone = screen.getByTestId("pi-attachments-dropzone");
    const file = new File(["x"], "p.png", { type: "image/png" });
    fireEvent.paste(zone, { clipboardData: { files: [file] } });
    expect(onAdd).toHaveBeenCalledTimes(1);
    const passed = onAdd.mock.calls[0]![0] as FileList | File[];
    expect(Array.from(passed)[0]).toBe(file);
  });

  it("粘贴无文件时不调 onAdd(不阻断文本粘贴) (Req 3.4)", () => {
    const onAdd = vi.fn();
    render(
      <Attachments items={[]} supported onAdd={onAdd} onRemove={vi.fn()} />,
    );
    const zone = screen.getByTestId("pi-attachments-dropzone");
    fireEvent.paste(zone, { clipboardData: { files: [] } });
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("展示 rejected 非图片的'暂不支持'提示 (Req 3.4)", () => {
    render(
      <Attachments
        items={[]}
        supported
        rejected={["notes.txt"]}
        onAdd={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByText(/暂不支持该类型附件/)).toBeInTheDocument();
    expect(screen.getByText(/notes\.txt/)).toBeInTheDocument();
  });

  it("无 rejected 时不展示提示 (Req 3.4)", () => {
    render(
      <Attachments items={[]} supported onAdd={vi.fn()} onRemove={vi.fn()} />,
    );
    expect(screen.queryByText(/暂不支持该类型附件/)).not.toBeInTheDocument();
  });

  it("supported=false 时隐藏附件入口(dropzone 与 file input) (Req 3.5)", () => {
    const { container } = render(
      <Attachments
        items={[]}
        supported={false}
        onAdd={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(
      screen.queryByTestId("pi-attachments-dropzone"),
    ).not.toBeInTheDocument();
    expect(container.querySelector('input[type="file"]')).toBeNull();
  });
});

describe("Attachments 呈现增强(Req 12)", () => {
  it("getMediaCategory/getAttachmentLabel 按 mimeType 与后缀分类 (Req 12.1)", () => {
    expect(getMediaCategory(item({ mimeType: "image/png" }))).toBe("image");
    expect(getMediaCategory(item({ mimeType: "video/mp4" }))).toBe("video");
    expect(getMediaCategory(item({ mimeType: "audio/mpeg" }))).toBe("audio");
    expect(
      getMediaCategory(item({ mimeType: "", name: "report.pdf" })),
    ).toBe("file");
    // mimeType 缺失时回退到文件名后缀
    expect(getMediaCategory(item({ mimeType: "", name: "clip.webm" }))).toBe(
      "video",
    );
    expect(getAttachmentLabel(item({ mimeType: "image/png" }))).toBe("图片");
    expect(getAttachmentLabel(item({ mimeType: "video/mp4" }))).toBe("视频");
  });

  it("呈现可读类型标签 (Req 12.1)", () => {
    render(
      <Attachments items={[item()]} supported onAdd={vi.fn()} onRemove={vi.fn()} />,
    );
    expect(screen.getByText("图片")).toBeInTheDocument();
  });

  it.each([
    ["panel", "panel"],
    ["compact", "compact"],
    ["inline", "inline"],
    ["grid", "grid"],
    ["list", "list"],
  ] as const)(
    "variant=%s 渲染对应布局容器 (Req 12.3)",
    (variant, expected) => {
      const { container } = render(
        <Attachments
          items={[item()]}
          supported
          variant={variant}
          onAdd={vi.fn()}
          onRemove={vi.fn()}
        />,
      );
      expect(
        container.querySelector(
          `[data-pi-attachments-variant="${expected}"]`,
        ),
      ).not.toBeNull();
    },
  );

  it("panel/compact 向后兼容:默认 variant 仍渲染 dropzone 与缩略图 (Req 12.3)", () => {
    render(
      <Attachments items={[item()]} supported onAdd={vi.fn()} onRemove={vi.fn()} />,
    );
    expect(screen.getByTestId("pi-attachments-dropzone")).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: /pic\.png/i }),
    ).toHaveAttribute("src", "data:image/png;base64,AAAA");
  });

  it("展示变体(inline)在 supported=false 时仍展示已有附件 (Req 12.3)", () => {
    const { container } = render(
      <Attachments
        items={[item()]}
        supported={false}
        variant="inline"
        onAdd={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(
      container.querySelector('[data-pi-attachments-variant="inline"]'),
    ).not.toBeNull();
    expect(screen.getByText("pic.png")).toBeInTheDocument();
  });

  it("悬停图片缩略图出现放大预览、移开消失 (Req 12.2)", () => {
    render(
      <Attachments items={[item()]} supported onAdd={vi.fn()} onRemove={vi.fn()} />,
    );
    // 默认态无预览浮层(避免出现第二个同名 img)
    expect(screen.queryByTestId("pi-attachment-preview")).not.toBeInTheDocument();
    const thumb = screen.getByLabelText("预览 pic.png");
    fireEvent.mouseEnter(thumb);
    expect(screen.getByTestId("pi-attachment-preview")).toBeInTheDocument();
    fireEvent.mouseLeave(thumb);
    expect(screen.queryByTestId("pi-attachment-preview")).not.toBeInTheDocument();
  });

  it("键盘聚焦/失焦同样开合预览 (Req 12.2/12.6)", () => {
    render(
      <Attachments items={[item()]} supported onAdd={vi.fn()} onRemove={vi.fn()} />,
    );
    const thumb = screen.getByLabelText("预览 pic.png");
    fireEvent.focus(thumb);
    expect(screen.getByTestId("pi-attachment-preview")).toBeInTheDocument();
    fireEvent.blur(thumb);
    expect(screen.queryByTestId("pi-attachment-preview")).not.toBeInTheDocument();
  });

  it("hoverPreview=false 时不开启预览 (Req 12.2)", () => {
    render(
      <Attachments
        items={[item()]}
        supported
        hoverPreview={false}
        onAdd={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText("预览 pic.png")).not.toBeInTheDocument();
    expect(screen.queryByTestId("pi-attachment-preview")).not.toBeInTheDocument();
  });

  it("无缩略图时以占位图标降级,仍保留文件名与移除按钮 (Req 12.4)", () => {
    const onRemove = vi.fn();
    const { container } = render(
      <Attachments
        items={[item({ id: "v1", name: "clip.mp4", mimeType: "video/mp4", dataUrl: "" })]}
        supported
        onAdd={vi.fn()}
        onRemove={onRemove}
      />,
    );
    // 无真实图片(占位图标分支)
    expect(container.querySelector("img[src]")).toBeNull();
    // 占位以 role=img + 文件名 aria-label 暴露
    expect(screen.getByRole("img", { name: "clip.mp4" })).toBeInTheDocument();
    expect(screen.getByText("clip.mp4")).toBeInTheDocument();
    expect(screen.getByText("视频")).toBeInTheDocument();
    const btn = screen.getByRole("button", { name: /移除附件 clip\.mp4/ });
    fireEvent.click(btn);
    expect(onRemove).toHaveBeenCalledWith("v1");
  });

  it("不改 Req 3 边界:非图片仍走 rejected 提示且不入列 (Req 12.5)", () => {
    render(
      <Attachments
        items={[]}
        supported
        rejected={["notes.txt"]}
        onAdd={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByText(/暂不支持该类型附件/)).toBeInTheDocument();
    // 未入列:无附件 chip
    expect(
      document.querySelector("[data-pi-attachment-chip]"),
    ).toBeNull();
  });
});

describe("Attachments 展示 URL 与上传状态呈现(Req 5.2/5.4/5.5)", () => {
  it("就绪附件以网络展示 URL 为图片源(非内联 base64) (Req 5.2)", () => {
    render(
      <Attachments
        items={[
          item({
            status: "ready",
            displayUrl: "https://cdn.example/att-1.png",
            attachmentId: "att_x",
          }),
        ]}
        supported
        onAdd={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    const img = screen.getByRole("img", { name: /pic\.png/i });
    expect(img).toHaveAttribute("src", "https://cdn.example/att-1.png");
    // 断言图片源非 data: base64 内联
    expect(img.getAttribute("src")).not.toMatch(/^data:/);
  });

  it("无 displayUrl(上传中)回退本地预览 dataUrl (Req 5.2/5.4)", () => {
    render(
      <Attachments
        items={[item({ status: "uploading", displayUrl: undefined })]}
        supported
        onAdd={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    const img = screen.getByRole("img", { name: /pic\.png/i });
    expect(img).toHaveAttribute("src", "data:image/png;base64,AAAA");
  });

  it("悬停预览浮层也优先使用展示 URL (Req 5.2)", () => {
    render(
      <Attachments
        items={[
          item({
            status: "ready",
            displayUrl: "https://cdn.example/att-1.png",
            attachmentId: "att_x",
          }),
        ]}
        supported
        onAdd={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    const thumb = screen.getByLabelText("预览 pic.png");
    fireEvent.mouseEnter(thumb);
    const preview = screen.getByTestId("pi-attachment-preview");
    const previewImg = preview.querySelector("img") as HTMLImageElement;
    expect(previewImg).not.toBeNull();
    expect(previewImg.getAttribute("src")).toBe(
      "https://cdn.example/att-1.png",
    );
  });

  it("上传中呈现可感知进行态标记 (Req 5.4)", () => {
    render(
      <Attachments
        items={[item({ status: "uploading", displayUrl: undefined })]}
        supported
        onAdd={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    const status = screen.getByTestId("pi-attachment-status-uploading");
    expect(status).toBeInTheDocument();
    expect(status).toHaveAttribute("aria-label");
    // chip 暴露 data-pi-attachment-status="uploading"
    expect(
      document.querySelector('[data-pi-attachment-status="uploading"]'),
    ).not.toBeNull();
  });

  it("失败呈现错误标记 (Req 5.5)", () => {
    render(
      <Attachments
        items={[item({ status: "error", displayUrl: undefined })]}
        supported
        onAdd={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    const status = screen.getByTestId("pi-attachment-status-error");
    expect(status).toBeInTheDocument();
    expect(status).toHaveAttribute("aria-label");
    expect(
      document.querySelector('[data-pi-attachment-status="error"]'),
    ).not.toBeNull();
  });

  it("就绪态不呈现上传中/失败标记 (Req 5.4/5.5)", () => {
    render(
      <Attachments
        items={[
          item({
            status: "ready",
            displayUrl: "https://cdn.example/att-1.png",
            attachmentId: "att_x",
          }),
        ]}
        supported
        onAdd={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(
      screen.queryByTestId("pi-attachment-status-uploading"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("pi-attachment-status-error"),
    ).not.toBeInTheDocument();
  });

  it("缺省 status(向后兼容字面量)不呈现状态标记且用 dataUrl (Req 5.2)", () => {
    render(
      <Attachments items={[item()]} supported onAdd={vi.fn()} onRemove={vi.fn()} />,
    );
    expect(
      screen.queryByTestId("pi-attachment-status-uploading"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("pi-attachment-status-error"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: /pic\.png/i }),
    ).toHaveAttribute("src", "data:image/png;base64,AAAA");
  });
});
