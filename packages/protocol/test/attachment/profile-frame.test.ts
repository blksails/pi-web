/**
 * agent-attachment-profile · `AgentAttachmentProfileFrameSchema` 单测(任务 1.1;Req 2.3)。
 */
import { describe, expect, it } from "vitest";
import { AgentAttachmentProfileFrameSchema } from "../../src/attachment/profile-frame.js";

describe("AgentAttachmentProfileFrameSchema", () => {
  it("解析合法帧", () => {
    const parsed = AgentAttachmentProfileFrameSchema.parse({
      type: "agent_attachment_profile",
      profile: "s3-cn",
    });
    expect(parsed.profile).toBe("s3-cn");
  });

  it("拒绝空 profile 字符串", () => {
    const res = AgentAttachmentProfileFrameSchema.safeParse({
      type: "agent_attachment_profile",
      profile: "",
    });
    expect(res.success).toBe(false);
  });

  it("拒绝错误的 type 字面量", () => {
    const res = AgentAttachmentProfileFrameSchema.safeParse({
      type: "agent_routes",
      profile: "s3-cn",
    });
    expect(res.success).toBe(false);
  });

  it("拒绝缺失 profile 字段", () => {
    const res = AgentAttachmentProfileFrameSchema.safeParse({
      type: "agent_attachment_profile",
    });
    expect(res.success).toBe(false);
  });

  it("拒绝非字符串 profile", () => {
    const res = AgentAttachmentProfileFrameSchema.safeParse({
      type: "agent_attachment_profile",
      profile: 42,
    });
    expect(res.success).toBe(false);
  });

  it("拒绝整体非对象/畸形负载", () => {
    expect(AgentAttachmentProfileFrameSchema.safeParse(null).success).toBe(false);
    expect(AgentAttachmentProfileFrameSchema.safeParse("nope").success).toBe(false);
    expect(AgentAttachmentProfileFrameSchema.safeParse([]).success).toBe(false);
  });
});
