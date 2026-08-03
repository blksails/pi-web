/**
 * attachment-profile-wiring · `emitAttachmentProfile` 单测(agent-attachment-profile spec,
 * 任务 3.2;Req 2.3/5.1)。
 *
 * 覆盖:发帧形状(声明存在 + 未关断);关断 → 零帧;未声明 → 零帧。
 */
import { describe, expect, it } from "vitest";
import {
  ATTACHMENT_PROFILE_DISABLED_ENV,
  emitAttachmentProfile,
  isAttachmentProfileDisabled,
} from "../../src/runner/attachment-profile-wiring.js";

describe("emitAttachmentProfile — 发帧形状(Req 2.3)", () => {
  it("声明存在 + 未关断 → 发一条 agent_attachment_profile 帧", () => {
    const lines: string[] = [];
    emitAttachmentProfile({ attachmentProfile: "s3-cn" }, false, (line) => lines.push(line));
    expect(lines).toHaveLength(1);
    const frame = JSON.parse(lines[0]!.trimEnd());
    expect(frame).toEqual({ type: "agent_attachment_profile", profile: "s3-cn" });
    expect(lines[0]!.endsWith("\n")).toBe(true);
  });
});

describe("emitAttachmentProfile — 关断零帧(Req 5.1)", () => {
  it("disabled=true → 即便声明存在也不发帧", () => {
    const lines: string[] = [];
    emitAttachmentProfile({ attachmentProfile: "s3-cn" }, true, (line) => lines.push(line));
    expect(lines).toHaveLength(0);
  });
});

describe("emitAttachmentProfile — 未声明零帧(Req 1.2)", () => {
  it("attachmentProfile 缺省 → 不发帧", () => {
    const lines: string[] = [];
    emitAttachmentProfile({}, false, (line) => lines.push(line));
    expect(lines).toHaveLength(0);
  });
});

describe("isAttachmentProfileDisabled(Req 5.1/5.2)", () => {
  it("env 值为 \"1\" → true", () => {
    expect(isAttachmentProfileDisabled({ [ATTACHMENT_PROFILE_DISABLED_ENV]: "1" })).toBe(true);
  });
  it("未设置/其他值 → false", () => {
    expect(isAttachmentProfileDisabled({})).toBe(false);
    expect(isAttachmentProfileDisabled({ [ATTACHMENT_PROFILE_DISABLED_ENV]: "true" })).toBe(false);
    expect(isAttachmentProfileDisabled({ [ATTACHMENT_PROFILE_DISABLED_ENV]: "0" })).toBe(false);
  });
});
