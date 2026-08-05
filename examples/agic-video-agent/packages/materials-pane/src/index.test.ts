import { describe, expect, it } from "vitest";
import {
  MATERIALS_OPEN_EVENT,
  materialsPanePackage,
  parseMaterialsOpenEvent,
} from "./index.js";

describe("materials pane package", () => {
  it("聚合的 route 与 Pane 授权同源", () => {
    const declared = materialsPanePackage.routes.map(({ name }) => name);
    const granted = materialsPanePackage.pane.capabilities.routes?.map(({ name }) => name);
    expect(granted).toEqual(declared);
    expect(declared).toEqual([
      "assets-list",
      "materials-library",
      "material-status",
    ]);
  });

  it("编辑事件仅接受有界 attachmentId 引用", () => {
    expect(MATERIALS_OPEN_EVENT).toBe("pi.canvas.open-attachments");
    expect(parseMaterialsOpenEvent({ attachmentIds: ["att_1"] })).toEqual({
      attachmentIds: ["att_1"],
    });
    expect(parseMaterialsOpenEvent({ attachmentIds: [] })).toBeUndefined();
    expect(parseMaterialsOpenEvent({ attachmentIds: [1] })).toBeUndefined();
  });
});
