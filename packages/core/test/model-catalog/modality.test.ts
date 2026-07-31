/**
 * modality 单元测试:输入/输出类型取值域的缺省补齐、provider→模型继承覆盖、
 * 四种取值的筛选谓词(multi-gateway-providers task 1.2)。
 */
import { describe, expect, it } from "vitest";
import {
  normalizeModalities,
  inheritModalities,
  matchesFilter,
  type Modality,
} from "../../src/model-catalog/modality.js";

describe("normalizeModalities", () => {
  it("未声明输出时按对话缺省补齐为 text", () => {
    const result = normalizeModalities({ input: ["text"] });
    expect(result.output).toEqual(["text"]);
  });

  it("声明了输出时保留原声明,不被缺省覆盖", () => {
    const result = normalizeModalities({ input: ["text"], output: ["image"] });
    expect(result.output).toEqual(["image"]);
  });

  it("未声明输入时输入为空数组(不套用对话缺省)", () => {
    const result = normalizeModalities({ output: ["image"] });
    expect(result.input).toEqual([]);
  });

  it("剔除非法/未识别取值,不牵连其余合法取值", () => {
    const result = normalizeModalities({
      input: ["text", "smell" as unknown as string],
      output: ["image", "" as unknown as string],
    });
    expect(result.input).toEqual(["text"]);
    expect(result.output).toEqual(["image"]);
  });
});

describe("inheritModalities", () => {
  it("provider 层声明一次,由模型继承", () => {
    const provider = { input: ["text"] as readonly Modality[], output: ["image"] as readonly Modality[] };
    const result = inheritModalities(provider, {});
    expect(result).toEqual({ input: ["text"], output: ["image"] });
  });

  it("模型自身声明覆盖 provider 的继承值", () => {
    const provider = { input: ["text"] as readonly Modality[], output: ["image"] as readonly Modality[] };
    const result = inheritModalities(provider, { output: ["video"] });
    expect(result).toEqual({ input: ["text"], output: ["video"] });
  });

  it("provider 与模型均未声明时落到空数组", () => {
    const result = inheritModalities({}, {});
    expect(result).toEqual({ input: [], output: [] });
  });
});

describe("matchesFilter", () => {
  const chat = { input: ["text"] as readonly Modality[], output: ["text"] as readonly Modality[] };
  const image = { input: ["text"] as readonly Modality[], output: ["image"] as readonly Modality[] };
  const vision = { input: ["text", "image"] as readonly Modality[], output: ["text"] as readonly Modality[] };
  const speech = { input: ["text"] as readonly Modality[], output: ["audio"] as readonly Modality[] };
  const videoGen = { input: ["text"] as readonly Modality[], output: ["video"] as readonly Modality[] };

  it("按输出为 image 筛选命中生图模型", () => {
    expect(matchesFilter(image, { output: "image" })).toBe(true);
    expect(matchesFilter(chat, { output: "image" })).toBe(false);
  });

  it("按输入为 image 筛选命中可读图模型", () => {
    expect(matchesFilter(vision, { input: "image" })).toBe(true);
    expect(matchesFilter(chat, { input: "image" })).toBe(false);
  });

  it("按输出为 audio 筛选命中配音模型", () => {
    expect(matchesFilter(speech, { output: "audio" })).toBe(true);
    expect(matchesFilter(chat, { output: "audio" })).toBe(false);
  });

  it("按输出为 video 筛选命中视频模型", () => {
    expect(matchesFilter(videoGen, { output: "video" })).toBe(true);
    expect(matchesFilter(chat, { output: "video" })).toBe(false);
  });

  it("同时指定输入与输出时须两者组合匹配", () => {
    expect(matchesFilter(vision, { input: "image", output: "text" })).toBe(true);
    expect(matchesFilter(vision, { input: "image", output: "image" })).toBe(false);
  });

  it("未指定任何方向时匹配一切", () => {
    expect(matchesFilter(chat, {})).toBe(true);
  });
});
