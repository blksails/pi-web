/**
 * 单元:vision 图像来源解析(Req 1.1–1.5)。
 *
 * 核心回归锁:产出必须是**裸 base64**(无 `data:` 前缀)——`ImageContent.data` 的形状要求。
 */
import { describe, expect, it } from "vitest";
import {
  pickLatestImage,
  resolveImageSource,
} from "../../src/vision/resolve-image.js";
import type { ResolvedImage, VisionFail } from "../../src/vision/types.js";
import { att, fakeAttCtx } from "./fixtures.js";

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e]);
const PNG_B64 = Buffer.from(PNG_BYTES).toString("base64");

function asOk(v: ResolvedImage | VisionFail): ResolvedImage {
  if ("ok" in v && v.ok === false) throw new Error(`expected ok, got ${v.reason}`);
  return v as ResolvedImage;
}
function asFail(v: ResolvedImage | VisionFail): VisionFail {
  if (!("ok" in v)) throw new Error("expected fail, got image");
  return v as VisionFail;
}

describe("resolveImageSource — 指定附件引用", () => {
  it("取回裸 base64,且不含 data: 前缀(1.1)", async () => {
    const ctx = fakeAttCtx({
      blobs: { att_a: { bytes: PNG_BYTES, mimeType: "image/png" } },
    });
    const got = asOk(await resolveImageSource("att_a", ctx));

    expect(got.base64).toBe(PNG_B64);
    expect(got.base64.startsWith("data:")).toBe(false);
    expect(got.mimeType).toBe("image/png");
    expect(got.attachmentId).toBe("att_a");
  });

  it("引用无法解析 → attachment_not_found,不抛出(1.3)", async () => {
    const ctx = fakeAttCtx({ blobs: {} });
    const got = asFail(await resolveImageSource("att_missing", ctx));
    expect(got.reason).toBe("attachment_not_found");
  });

  it("附件非图像 → not_an_image(1.4)", async () => {
    const ctx = fakeAttCtx({
      blobs: { att_t: { bytes: PNG_BYTES, mimeType: "text/plain" } },
    });
    const got = asFail(await resolveImageSource("att_t", ctx));
    expect(got.reason).toBe("not_an_image");
    expect(got.detail).toContain("text/plain");
  });
});

describe("resolveImageSource — 缺省取最近一张图", () => {
  it("多图按 createdAt 降序取最新,并跳过非图像附件(1.2)", async () => {
    const ctx = fakeAttCtx({
      list: [
        att("att_old", "image/png", "2026-01-01T00:00:00.000Z"),
        att("att_doc", "application/pdf", "2026-09-09T00:00:00.000Z"), // 更新但非图像
        att("att_new", "image/jpeg", "2026-03-03T00:00:00.000Z"),
      ],
      blobs: {
        att_old: { bytes: PNG_BYTES, mimeType: "image/png" },
        att_new: { bytes: PNG_BYTES, mimeType: "image/jpeg" },
      },
    });
    const got = asOk(await resolveImageSource(undefined, ctx));
    expect(got.attachmentId).toBe("att_new");
    expect(got.base64.startsWith("data:")).toBe(false);
  });

  it("会话内无任何图像 → no_image(1.5)", async () => {
    const ctx = fakeAttCtx({
      list: [att("att_doc", "application/pdf", "2026-01-01T00:00:00.000Z")],
    });
    const got = asFail(await resolveImageSource(undefined, ctx));
    expect(got.reason).toBe("no_image");
  });

  it("listBySession 抛错 → no_image,异常不外泄", async () => {
    const ctx = fakeAttCtx({ listThrows: true });
    const got = asFail(await resolveImageSource(undefined, ctx));
    expect(got.reason).toBe("no_image");
  });
});

describe("pickLatestImage", () => {
  it("无图像返回 undefined", () => {
    expect(pickLatestImage([att("a", "text/plain", "2026-01-01T00:00:00.000Z")])).toBeUndefined();
  });

  it("空数组返回 undefined", () => {
    expect(pickLatestImage([])).toBeUndefined();
  });

  it("跨时区偏移表示下按真实时刻比较,而非字典序", () => {
    // 09:00+08:00 === 01:00Z,早于 02:00Z。纯字典序会误判 "2026-…T09:00…" 更大。
    const offset = att("att_offset", "image/png", "2026-01-01T09:00:00.000+08:00");
    const utc = att("att_utc", "image/png", "2026-01-01T02:00:00.000Z");
    expect(pickLatestImage([offset, utc])?.id).toBe("att_utc");
    expect(pickLatestImage([utc, offset])?.id).toBe("att_utc");
  });

  it("非法 createdAt 时退化为字典序,不崩溃", () => {
    const bad = att("att_bad", "image/png", "not-a-date");
    const good = att("att_good", "image/png", "2026-01-01T00:00:00.000Z");
    expect(pickLatestImage([bad, good])?.id).toBe("att_bad"); // "not-a-date" > "2026-…"
  });
});
