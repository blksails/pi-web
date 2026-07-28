/**
 * examples/aigc-agent · 对话内媒体预览宿主(dialogLayer)的纯函数自检。
 *
 * 两处值得钉死:
 *  - `attachmentIdFromUrl` 决定 hover pill 上「编辑」按钮出不出 —— 认错了 id 就会把不是附件的图
 *    (外链 / data URI / 画布 blob)也送进对话,故只认 `/attachments/att_…` 这一形态;
 *  - `openImagePreview` 是其它组件开预览的唯一编程入口,事件名与 detail 形状即契约。
 *
 * 交互部分(点击拦截 / hover / 灯箱变换)靠宿主 DOM 属性驱动,不在此单测,由构建期
 * CSS scoping 闸与 packages/ui 的插槽用例守。
 */
import { describe, expect, it } from "vitest";
import {
  MEDIA_PREVIEW_EVENT,
  attachmentIdFromUrl,
  openImagePreview,
} from "@/examples/aigc-agent/.pi/web/media-preview-host.js";

describe("attachmentIdFromUrl", () => {
  it("认相对路径、绝对 URL、带 query 与 hash 者", () => {
    expect(attachmentIdFromUrl("/api/attachments/att_abc123")).toBe("att_abc123");
    expect(attachmentIdFromUrl("https://h.example/api/attachments/att_abc123")).toBe("att_abc123");
    expect(attachmentIdFromUrl("/api/attachments/att_abc123?w=200")).toBe("att_abc123");
    expect(attachmentIdFromUrl("/api/attachments/att_abc123#x")).toBe("att_abc123");
  });

  it("base64url 随机体的 - 与 _ 不截断(见 packages/server attachments/id.ts)", () => {
    expect(attachmentIdFromUrl("/api/attachments/att_a-b_c9")).toBe("att_a-b_c9");
  });

  it("非附件图一律不认(外链 / data URI / blob / 缺前缀)", () => {
    expect(attachmentIdFromUrl("https://cdn.example/img/att_fake.png")).toBeUndefined();
    expect(attachmentIdFromUrl("data:image/png;base64,iVBORw0KGgo=")).toBeUndefined();
    expect(attachmentIdFromUrl("blob:http://localhost/9f1e")).toBeUndefined();
    expect(attachmentIdFromUrl("/api/attachments/abc123")).toBeUndefined();
  });
});

describe("openImagePreview", () => {
  it("派 aigc-media-preview 窗口事件,detail 原样搬运", () => {
    const seen: unknown[] = [];
    const on = (e: Event): void => void seen.push((e as CustomEvent).detail);
    window.addEventListener(MEDIA_PREVIEW_EVENT, on);
    try {
      openImagePreview({ gallery: [{ url: "/a.png" }, { url: "/b.png" }], index: 1 });
      openImagePreview({ url: "/solo.png" });
    } finally {
      window.removeEventListener(MEDIA_PREVIEW_EVENT, on);
    }
    expect(seen).toEqual([
      { gallery: [{ url: "/a.png" }, { url: "/b.png" }], index: 1 },
      { url: "/solo.png" },
    ]);
  });
});
