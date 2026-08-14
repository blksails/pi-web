import { describe, it, expect } from "vitest";
import {
  DASHSCOPE_SIZE_OPTIONS,
  DEFAULT_SIZE_OPTIONS,
  SIZE_OPTIONS,
} from "../../src/aigc/size-options.js";

/** pi-labs `src/agents/aigc/shared/options.ts` 的像素档(分隔符归一为 x)。 */
const PI_LABS_SIZES = [
  "1024x1024",
  "1280x720",
  "720x1280",
  "1328x1328",
  "832x1216",
  "800x800",
  "1080x1920",
];

describe("SIZE_OPTIONS", () => {
  it("含 pi-labs 全部出图尺寸", () => {
    for (const size of PI_LABS_SIZES) {
      expect(SIZE_OPTIONS).toContain(size);
    }
  });

  it("dashscope 族覆盖 pi-labs 全量;gpt 族保留 1:1/3:2/2:3", () => {
    expect([...DASHSCOPE_SIZE_OPTIONS]).toEqual(PI_LABS_SIZES);
    expect([...DEFAULT_SIZE_OPTIONS]).toEqual(["1024x1024", "1536x1024", "1024x1536"]);
    expect(SIZE_OPTIONS).toContain("auto");
    expect(SIZE_OPTIONS).toContain("custom");
  });
});
