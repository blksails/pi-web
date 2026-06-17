/**
 * @pi-web/ui 公开导出面存在性断言。
 *
 * 守护 task 4.2:新增 `PiChatPro` 与 `elements/*` 导出,且保留既有 `<PiChat>` 等导出不变。
 * 仅校验符号可从包根导入(运行时值 + 类型),不校验组件行为。
 */
import { describe, it, expect } from "vitest";
import * as ui from "../src/index.js";

describe("@pi-web/ui public exports", () => {
  it("新增装配组件 PiChatPro 可导入且为函数组件", () => {
    expect(typeof ui.PiChatPro).toBe("function");
  });

  it("元件层(elements/*)经包根 barrel 暴露", () => {
    expect(typeof ui.Conversation).toBe("function");
    expect(typeof ui.Message).toBe("function");
    expect(typeof ui.useAutoScroll).toBe("function");
    expect(typeof ui.SubmitButton).toBe("function");
    expect(typeof ui.PromptInput).toBe("function");
    expect(typeof ui.Attachments).toBe("function");
    expect(typeof ui.ModelSelector).toBe("function");
    expect(typeof ui.SpeechInput).toBe("function");
    expect(typeof ui.WebSearchToggle).toBe("function");
    expect(typeof ui.Sources).toBe("function");
    expect(typeof ui.Suggestions).toBe("function");
  });

  it("保留既有导出不变", () => {
    expect(typeof ui.PiChat).toBe("function");
    expect(typeof ui.PartRenderer).toBe("function");
    expect(typeof ui.PiToolPart).toBe("function");
    expect(typeof ui.PiReasoning).toBe("function");
    expect(typeof ui.PiModelSelector).toBe("function");
    expect(typeof ui.PiThinkingLevel).toBe("function");
    expect(typeof ui.PiSessionStats).toBe("function");
    expect(typeof ui.PiCommandPalette).toBe("function");
    expect(typeof ui.PiPermissionDialog).toBe("function");
    expect(typeof ui.createRendererRegistry).toBe("function");
    expect(typeof ui.cn).toBe("function");
  });
});
