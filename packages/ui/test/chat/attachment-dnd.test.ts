import { describe, it, expect } from "vitest";
import {
  ATTACHMENT_ID_MIME,
  hasAttachmentRef,
  attachmentRefsFromDataTransfer,
} from "../../src/chat/attachment-dnd.js";

/** 最小 DataTransfer 桩(jsdom 无构造器;只实现受口用到的 types/getData)。 */
function dt(data: Record<string, string>): DataTransfer {
  return {
    types: Object.keys(data),
    getData: (mime: string) => data[mime] ?? "",
  } as unknown as DataTransfer;
}

describe("attachment-dnd(composer 拖放受口契约)", () => {
  it("mime 字面钉死(业务侧发端一致,勿改)", () => {
    expect(ATTACHMENT_ID_MIME).toBe("text/att-id");
  });

  it("无 att-id mime → null(文件拖放放行既有路径)", () => {
    expect(hasAttachmentRef(dt({ Files: "" }))).toBe(false);
    expect(attachmentRefsFromDataTransfer(dt({ Files: "" }))).toBeNull();
    expect(attachmentRefsFromDataTransfer(null)).toBeNull();
  });

  it("单 id:并读 uri-list(首行)与 plain 作展示 URL/名", () => {
    expect(
      attachmentRefsFromDataTransfer(
        dt({
          [ATTACHMENT_ID_MIME]: "att_abc",
          "text/uri-list": "/attachments/att_abc/raw?exp=1&sig=x\r\nignored",
          "text/plain": "图A",
        }),
      ),
    ).toEqual([
      {
        attachmentId: "att_abc",
        name: "图A",
        displayUrl: "/attachments/att_abc/raw?exp=1&sig=x",
      },
    ]);
  });

  it("多 id(空白/逗号切分):仅 id,不挂共享 URL/名", () => {
    expect(
      attachmentRefsFromDataTransfer(
        dt({
          [ATTACHMENT_ID_MIME]: "att_a att_b,att_c",
          "text/uri-list": "/x",
        }),
      ),
    ).toEqual([
      { attachmentId: "att_a" },
      { attachmentId: "att_b" },
      { attachmentId: "att_c" },
    ]);
  });
});
