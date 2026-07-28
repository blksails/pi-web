/**
 * 图像工具 payload 体积兜底 单元测试(spec `upload-image-compression`,任务 4.2)。
 *
 * 背景:超大 payload 会让上游**根本不返回**(2026-07-28 实测,766KB PNG 挂 23 分钟)。
 * 放宽传输层超时救不了 —— 只会把「5 分钟明确失败」变成「无限期挂起」。故在派发前拦下。
 *
 * ★对用户上传图与工具**生成**图一视同仁(Req 7.4):二者在检查点都已是 data URI,
 * 无从区分来源 —— 这正是本兜底能覆盖前端压缩盲区(canvas 二创)的原因。
 */
import { describe, it, expect } from "vitest";
import { checkPayloadLimit } from "../../src/aigc/run-image-tool.js";

const LIMIT = 1_500_000;

/** 造一个解码后约为 `bytes` 字节的 data URI。base64 每 4 字符 → 3 字节。 */
function dataUriOfBytes(bytes: number, mime = "image/png"): string {
  const b64len = Math.ceil(bytes / 3) * 4;
  return `data:${mime};base64,${"A".repeat(b64len)}`;
}

describe("checkPayloadLimit —— 超限拦截(Req 7.1/7.2)", () => {
  it("单张超上限 → 返回错误文案", () => {
    const err = checkPayloadLimit({ image: dataUriOfBytes(LIMIT + 100_000) }, ["image"]);
    expect(err).toBeDefined();
  });

  it("★错误文案须同时含实际体积与上限,用户才能判断下一步", () => {
    // 体积以 MiB 呈现:4_200_000 B ÷ 1024² ≈ 4.0MB;上限 1_500_000 B ≈ 1.4MB
    const err = checkPayloadLimit({ image: dataUriOfBytes(4_200_000) }, ["image"])!;
    expect(err).toContain("4.0MB"); // 实际体积
    expect(err).toContain("1.4MB"); // 上限
    expect(err).toMatch(/压缩|更小/); // 给出可执行的下一步
  });

  it("恰好等于上限 → 放行(边界不误伤)", () => {
    expect(checkPayloadLimit({ image: dataUriOfBytes(LIMIT) }, ["image"])).toBeUndefined();
  });

  it("未超限 → undefined,不拦截", () => {
    expect(checkPayloadLimit({ image: dataUriOfBytes(174 * 1024) }, ["image"])).toBeUndefined();
  });
});

describe("checkPayloadLimit —— 多字段合计(Req 7.1)", () => {
  it("主图 + 参考图数组合计参与计算", () => {
    const merged = {
      image: dataUriOfBytes(600_000),
      reference_images: [dataUriOfBytes(600_000), dataUriOfBytes(600_000)],
    };
    // 单看任一字段都不超限,合计 1.8MB 才超 —— 必须合计才拦得住多图场景
    expect(checkPayloadLimit({ image: merged.image }, ["image"])).toBeUndefined();
    expect(checkPayloadLimit(merged, ["image", "reference_images"])).toBeDefined();
  });

  it("mask 等其余媒体字段同样计入", () => {
    const merged = {
      image: dataUriOfBytes(800_000),
      mask: dataUriOfBytes(800_000),
    };
    expect(checkPayloadLimit(merged, ["image", "mask"])).toBeDefined();
  });

  it("未列入 mediaFields 的字段不计入", () => {
    const merged = { image: dataUriOfBytes(100), other: dataUriOfBytes(9_000_000) };
    expect(checkPayloadLimit(merged, ["image"])).toBeUndefined();
  });
});

describe("checkPayloadLimit —— 输入形态健壮性", () => {
  it("非 data URI(如 https 直链)按 0 计,不误判", () => {
    expect(checkPayloadLimit({ image: "https://example.com/a.png" }, ["image"])).toBeUndefined();
  });

  it("缺字段 / 非字符串 → 不抛错", () => {
    expect(checkPayloadLimit({}, ["image", "mask"])).toBeUndefined();
    expect(checkPayloadLimit({ image: 42, mask: null }, ["image", "mask"])).toBeUndefined();
  });

  it("数组内混入非字符串 → 跳过该元素", () => {
    const merged = { reference_images: [dataUriOfBytes(100), 7, null] };
    expect(checkPayloadLimit(merged, ["reference_images"])).toBeUndefined();
  });

  it("base64 padding 参与还原,体积估算不虚高", () => {
    // "AAAA" → 3 字节;"AAA=" → 2 字节;"AA==" → 1 字节
    const one = checkPayloadLimit({ image: "data:image/png;base64,AA==" }, ["image"]);
    expect(one).toBeUndefined();
  });

  it("生成图来源(同为 data URI)同样受检(Req 7.4)", () => {
    // 工具产出图经 resolveInputToDataUri 后与上传图形态一致,此处无从区分 —— 正是设计意图
    const generated = dataUriOfBytes(2_000_000, "image/jpeg");
    expect(checkPayloadLimit({ image: generated }, ["image"])).toBeDefined();
  });
});
