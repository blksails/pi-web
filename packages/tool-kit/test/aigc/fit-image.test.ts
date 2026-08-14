import { describe, it, expect } from "vitest";
import { fitImageBytesToTarget } from "../../src/aigc/fit-image.js";

describe("fitImageBytesToTarget", () => {
  it("576x1024 cover 到 1080x1920", async () => {
    let sharp: typeof import("sharp")["default"];
    try {
      sharp = (await import("sharp")).default;
    } catch {
      return;
    }
    const src = await sharp({
      create: { width: 576, height: 1024, channels: 3, background: "red" },
    })
      .png()
      .toBuffer();
    const out = await fitImageBytesToTarget(new Uint8Array(src), { w: 1080, h: 1920 });
    expect(out).toBeDefined();
    const meta = await sharp(out!.bytes).metadata();
    expect(meta.width).toBe(1080);
    expect(meta.height).toBe(1920);
    expect(out!.mimeType).toBe("image/jpeg");
  });
});
