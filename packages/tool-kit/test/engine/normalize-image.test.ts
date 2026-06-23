/**
 * normalize-image:剥除 Apple 多图 JPEG 容器(MPF APP2 + 尾部 gain map),保留其它段。
 *
 * 背景见 src/engine/normalize-image.ts:NewAPI gpt-image 网关对 iPhone 多图 JPEG 渠道选择失败,
 * 实测剥 MPF(APP2)+ 截断主图首个 EOI 之后的尾图即可通过,且保留 EXIF(APP1)。
 */
import { describe, it, expect } from "vitest";
import { normalizeImageDataUri } from "../../src/engine/normalize-image.js";

function toJpegDataUri(bytes: number[]): string {
  return `data:image/jpeg;base64,${Buffer.from(Uint8Array.from(bytes)).toString("base64")}`;
}
function bytesOf(dataUri: string): number[] {
  const b64 = dataUri.split(",")[1] ?? "";
  return [...Buffer.from(b64, "base64")];
}

// SOI + APP1("AB") + APP2-MPF("MPF\0",0x11,0x22) + SOS + 熵数据 + EOI + 尾图(DE AD)
const SOI = [0xff, 0xd8];
const APP1 = [0xff, 0xe1, 0x00, 0x04, 0x41, 0x42]; // len=4 → 2 载荷字节
const APP2_MPF = [0xff, 0xe2, 0x00, 0x08, 0x4d, 0x50, 0x46, 0x00, 0x11, 0x22];
const APP2_ICC = [0xff, 0xe2, 0x00, 0x07, 0x49, 0x43, 0x43, 0x5f, 0x58]; // "ICC_X" 占位
const SOS_EOI = [0xff, 0xda, 0x00, 0x02, 0xaa, 0xbb, 0xff, 0xd9];
const TRAILER = [0xde, 0xad, 0xbe, 0xef];

describe("normalizeImageDataUri", () => {
  it("剥除 MPF(APP2)段并截断尾部 gain map,保留 APP1(EXIF)", () => {
    const input = toJpegDataUri([...SOI, ...APP1, ...APP2_MPF, ...SOS_EOI, ...TRAILER]);
    const out = bytesOf(normalizeImageDataUri(input));
    // 期望:SOI + APP1 + SOS..EOI(APP2-MPF 与尾图被去除)
    expect(out).toEqual([...SOI, ...APP1, ...SOS_EOI]);
    // MPF 标识不再出现
    expect(Buffer.from(Uint8Array.from(out)).includes(Buffer.from([0x4d, 0x50, 0x46, 0x00]))).toBe(false);
    // EXIF 占位载荷("AB")仍在
    expect(Buffer.from(Uint8Array.from(out)).includes(Buffer.from("AB"))).toBe(true);
  });

  it("保留非 MPF 的 APP2(如 ICC 色彩配置)", () => {
    const input = toJpegDataUri([...SOI, ...APP2_ICC, ...SOS_EOI, ...TRAILER]);
    const out = bytesOf(normalizeImageDataUri(input));
    // ICC 段保留;仅尾图被截断
    expect(out).toEqual([...SOI, ...APP2_ICC, ...SOS_EOI]);
  });

  it("无 MPF、无尾部数据的普通 JPEG 原样返回", () => {
    const input = toJpegDataUri([...SOI, ...APP1, ...SOS_EOI]);
    expect(normalizeImageDataUri(input)).toBe(input);
  });

  it("非 JPEG(PNG)data URI 原样返回", () => {
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";
    expect(normalizeImageDataUri(png)).toBe(png);
  });

  it("非 data: 输入(att_/https)原样返回", () => {
    expect(normalizeImageDataUri("att_abc")).toBe("att_abc");
    expect(normalizeImageDataUri("https://example.com/a.jpg")).toBe("https://example.com/a.jpg");
  });
});
