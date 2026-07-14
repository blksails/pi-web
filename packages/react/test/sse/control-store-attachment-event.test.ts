/**
 * agent-attachment-catalog — ControlStore 消费 control:"attachment"(任务 5.1;Req 4.2/4.3)。
 *
 * 非粘性事件:仅派发给已注册监听,不入 ControlSnapshot(与 ui-rpc 下行响应同构)。
 */
import { describe, it, expect } from "vitest";
import { ControlStore } from "../../src/sse/control-store.js";
import type { AttachmentControlPayload, ControlPayload } from "@blksails/pi-web-protocol";

const ATTACHMENT_FIXTURE = {
  id: "att_abc123",
  name: "report.pdf",
  mimeType: "application/pdf",
  size: 10,
  origin: "tool-output" as const,
  sessionId: "s-1",
  createdAt: new Date().toISOString(),
};

function attachmentFrame(id: string): ControlPayload {
  return { control: "attachment", event: "added", attachment: { ...ATTACHMENT_FIXTURE, id } };
}

describe("ControlStore — control:attachment", () => {
  it("派发给已注册监听", () => {
    const store = new ControlStore();
    const received: AttachmentControlPayload[] = [];
    store.onAttachmentEvent((p) => received.push(p));
    store.applyControlFrame(attachmentFrame("att_1"));
    expect(received).toHaveLength(1);
    expect(received[0]?.attachment.id).toBe("att_1");
  });

  it("多监听均收到同一事件", () => {
    const store = new ControlStore();
    const a: AttachmentControlPayload[] = [];
    const b: AttachmentControlPayload[] = [];
    store.onAttachmentEvent((p) => a.push(p));
    store.onAttachmentEvent((p) => b.push(p));
    store.applyControlFrame(attachmentFrame("att_1"));
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });

  it("取消订阅后不再收到事件", () => {
    const store = new ControlStore();
    const received: AttachmentControlPayload[] = [];
    const unsubscribe = store.onAttachmentEvent((p) => received.push(p));
    unsubscribe();
    store.applyControlFrame(attachmentFrame("att_1"));
    expect(received).toHaveLength(0);
  });

  it("不入 ControlSnapshot(非粘性,快照引用不变)", () => {
    const store = new ControlStore();
    const before = store.getSnapshot();
    store.applyControlFrame(attachmentFrame("att_1"));
    expect(store.getSnapshot()).toBe(before);
  });
});
