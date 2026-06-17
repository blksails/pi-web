import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { PendingAttachment } from "@pi-web/react";
import { Attachments } from "../../src/elements/attachments.js";

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
