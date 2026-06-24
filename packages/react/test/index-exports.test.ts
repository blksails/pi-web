/**
 * @blksails/pi-web-react 公开导出面存在性断言。
 *
 * 守护 task 4.2:四个新数据 hooks(useModels/useAttachments/useBranches/useSuggestions)
 * 经包根导出,且保留既有 hooks/transport 导出不变。
 */
import { describe, it, expect } from "vitest";
import * as react from "../src/index.js";

describe("@blksails/pi-web-react public exports", () => {
  it("四个新数据 hooks 可从包根导入", () => {
    expect(typeof react.useModels).toBe("function");
    expect(typeof react.useAttachments).toBe("function");
    expect(typeof react.useBranches).toBe("function");
    expect(typeof react.useSuggestions).toBe("function");
  });

  it("保留既有 hooks/transport 导出不变", () => {
    expect(typeof react.usePiSession).toBe("function");
    expect(typeof react.usePiControls).toBe("function");
    expect(typeof react.useExtensionUI).toBe("function");
    expect(typeof react.PiTransport).toBe("function");
    expect(typeof react.createPiClient).toBe("function");
    expect(typeof react.PiProvider).toBe("function");
  });
});
