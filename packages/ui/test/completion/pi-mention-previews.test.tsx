/**
 * PiMentionPreviews 单测(attachment-mention-preview)。
 *
 * 覆盖:token 扫描/去重、缩略图渲染(有/无 previewUrl)、名字回退 id、移除回调、
 * removeAttachmentMention 从值删 token。
 */
import * as React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import {
  PiMentionPreviews,
  scanAttachmentMentions,
  removeAttachmentMention,
  type MentionPreview,
} from "../../src/completion/pi-mention-previews.js";

afterEach(cleanup);

describe("scanAttachmentMentions", () => {
  it("扫描 @attachment:<id> token,去重保序;无 token → 空", () => {
    expect(scanAttachmentMentions("hi")).toEqual([]);
    expect(
      scanAttachmentMentions("@attachment:att_a foo @attachment:att_b @attachment:att_a"),
    ).toEqual(["att_a", "att_b"]);
  });
});

describe("removeAttachmentMention", () => {
  it("删去指定 token 连带其后一个空白", () => {
    expect(removeAttachmentMention("x @attachment:att_a y", "att_a")).toBe("x y");
    expect(removeAttachmentMention("@attachment:att_z", "att_z")).toBe("");
  });
});

function previewsOf(entries: Record<string, MentionPreview>): ReadonlyMap<string, MentionPreview> {
  return new Map(Object.entries(entries));
}

describe("PiMentionPreviews", () => {
  it("无 token → 不渲染(null)", () => {
    const { container } = render(
      <PiMentionPreviews value="hello" previews={new Map()} />,
    );
    expect(container.querySelector("[data-pi-mention-previews]")).toBeNull();
  });

  it("有预览 → 缩略图 + 名字;无 previewUrl → 无图、名字回退 id", () => {
    const { container } = render(
      <PiMentionPreviews
        value="@attachment:att_img @attachment:att_x"
        previews={previewsOf({
          att_img: { name: "cat.png", previewUrl: "/api/attachments/att_img/raw?sig=1" },
        })}
      />,
    );
    const imgChip = container.querySelector('[data-pi-mention-preview="att_img"]');
    expect(imgChip?.textContent).toContain("cat.png");
    expect(
      imgChip?.querySelector("img[data-pi-mention-preview-img]")?.getAttribute("src"),
    ).toBe("/api/attachments/att_img/raw?sig=1");
    // 未捕获预览的 token:无图,名字回退 id
    const xChip = container.querySelector('[data-pi-mention-preview="att_x"]');
    expect(xChip?.querySelector("img")).toBeNull();
    expect(xChip?.textContent).toContain("att_x");
  });

  it("视频/音频引用 → 缩略图或图标,hover 出现可播放预览", () => {
    const { container } = render(
      <PiMentionPreviews
        value="@attachment:att_video @attachment:att_audio"
        previews={previewsOf({
          att_video: {
            name: "clip.mp4",
            mediaType: "video/mp4",
            previewUrl: "/api/attachments/att_video/raw",
          },
          att_audio: {
            name: "voice.mp3",
            mediaType: "audio/mpeg",
            previewUrl: "/api/attachments/att_audio/raw",
          },
        })}
      />,
    );
    const videoThumb = container.querySelector(
      '[data-pi-mention-preview="att_video"] [data-pi-mention-preview-thumb]',
    );
    expect(videoThumb?.querySelector("video")).not.toBeNull();
    fireEvent.mouseEnter(videoThumb!);
    expect(
      container.querySelector("[data-pi-mention-preview-popup] video[controls]"),
    ).not.toBeNull();
    fireEvent.mouseLeave(videoThumb!);

    const audioThumb = container.querySelector(
      '[data-pi-mention-preview="att_audio"] [data-pi-mention-preview-thumb]',
    );
    fireEvent.mouseEnter(audioThumb!);
    expect(
      container.querySelector("[data-pi-mention-preview-popup] audio[controls]"),
    ).not.toBeNull();
  });

  it("点移除按钮 → onRemove(id)", () => {
    const onRemove = vi.fn();
    const { container } = render(
      <PiMentionPreviews
        value="@attachment:att_a"
        previews={previewsOf({ att_a: { name: "a.png" } })}
        onRemove={onRemove}
      />,
    );
    const btn = container.querySelector('[data-pi-mention-preview="att_a"] button');
    fireEvent.click(btn!);
    expect(onRemove).toHaveBeenCalledWith("att_a");
  });
});
