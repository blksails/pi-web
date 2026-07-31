import { describe, expect, it } from "vitest";
import {
  CANVAS_OPEN_ATTACHMENTS_EVENT,
  canvasPaneModule,
  parseCanvasOpenAttachmentsEvent,
} from "../src/pane.js";

describe("canvas pane direct embed", () => {
  it("由基座提供 Guest 入口和完整能力声明", () => {
    expect(canvasPaneModule.entry).toBeInstanceOf(URL);
    expect(canvasPaneModule.entry.pathname).toMatch(/\/src\/pane-guest\.tsx$/);
    expect(canvasPaneModule.canvasStyles).toBe(true);
    expect(canvasPaneModule.capabilities.events?.subscribe).toContain(
      CANVAS_OPEN_ATTACHMENTS_EVENT,
    );
  });

  it("只接收有界附件引用", () => {
    expect(parseCanvasOpenAttachmentsEvent({ attachmentIds: ["att_1"] })).toEqual({
      attachmentIds: ["att_1"],
    });
    expect(parseCanvasOpenAttachmentsEvent({ attachmentIds: [] })).toBeUndefined();
    expect(parseCanvasOpenAttachmentsEvent({ attachmentIds: [1] })).toBeUndefined();
  });
});
