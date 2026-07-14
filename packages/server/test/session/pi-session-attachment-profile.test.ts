/**
 * agent-attachment-profile spec,任务 4.1:PiSession `agent_attachment_profile` 帧消费与
 * 会话级投影(Req 2.1/2.3)。
 *
 * 覆盖:合法缓存(就绪门前即可读,slash_completions/agent_routes 同族时序);三类丢弃
 * (畸形帧/关断/名字未在本进程拓扑视角命中)均 warn+丢弃,不缓存、不失败会话。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PiSession } from "../../src/session/pi-session.js";
import { ATTACHMENT_BACKENDS_ENV } from "../../src/attachment/backends-config.js";
import { ATTACHMENT_PROFILE_DISABLED_ENV } from "../../src/runner/attachment-profile-wiring.js";
import { MockChannel } from "./mock-channel.js";
import { makeResolved } from "./fixtures.js";

function newSession(ch: MockChannel, opts?: { readinessHandshake?: boolean }): PiSession {
  return new PiSession({
    id: "s1",
    resolved: makeResolved(),
    channel: ch,
    idleMs: 0,
    ...(opts ?? {}),
  });
}

function topology(...names: string[]): string {
  return JSON.stringify({
    backends: names.map((name) => ({ kind: "local-fs", name })),
    write: names[0],
  });
}

const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  savedEnv[ATTACHMENT_BACKENDS_ENV] = process.env[ATTACHMENT_BACKENDS_ENV];
  savedEnv[ATTACHMENT_PROFILE_DISABLED_ENV] = process.env[ATTACHMENT_PROFILE_DISABLED_ENV];
  delete process.env[ATTACHMENT_BACKENDS_ENV];
  delete process.env[ATTACHMENT_PROFILE_DISABLED_ENV];
});

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("PiSession.getAttachmentWriteProfile — 合法缓存(Req 2.1/2.3)", () => {
  it("默认无声明 → undefined", () => {
    const s = newSession(new MockChannel());
    expect(s.getAttachmentWriteProfile()).toBeUndefined();
  });

  it("装配期 agent_attachment_profile 帧(命中本进程拓扑视角)→ 就绪门前即缓存", () => {
    process.env[ATTACHMENT_BACKENDS_ENV] = topology("local", "s3-cn");
    const ch = new MockChannel();
    const s = newSession(ch, { readinessHandshake: true });
    expect(s.lifecycle).toBe("initializing");
    ch.emitLine(
      JSON.stringify({ type: "agent_attachment_profile", profile: "s3-cn" }),
    );
    expect(s.lifecycle).toBe("initializing");
    expect(s.getAttachmentWriteProfile()).toBe("s3-cn");
  });

  it("后到声明帧覆盖前值(热重载重声明语义)", () => {
    process.env[ATTACHMENT_BACKENDS_ENV] = topology("a", "b");
    const ch = new MockChannel();
    const s = newSession(ch);
    ch.emitLine(JSON.stringify({ type: "agent_attachment_profile", profile: "a" }));
    ch.emitLine(JSON.stringify({ type: "agent_attachment_profile", profile: "b" }));
    expect(s.getAttachmentWriteProfile()).toBe("b");
  });
});

describe("PiSession.getAttachmentWriteProfile — 三类丢弃(Req 2.3/5.1)", () => {
  it("畸形帧(profile 空串/缺失)→ warn+丢弃,不缓存", () => {
    process.env[ATTACHMENT_BACKENDS_ENV] = topology("local");
    const ch = new MockChannel();
    const s = newSession(ch);
    ch.emitLine(JSON.stringify({ type: "agent_attachment_profile", profile: "" }));
    expect(s.getAttachmentWriteProfile()).toBeUndefined();
    ch.emitLine(JSON.stringify({ type: "agent_attachment_profile" }));
    expect(s.getAttachmentWriteProfile()).toBeUndefined();
  });

  it("关断生效 → 即便帧合法且命中拓扑也丢弃,不缓存", () => {
    process.env[ATTACHMENT_BACKENDS_ENV] = topology("local");
    process.env[ATTACHMENT_PROFILE_DISABLED_ENV] = "1";
    const ch = new MockChannel();
    const s = newSession(ch);
    ch.emitLine(JSON.stringify({ type: "agent_attachment_profile", profile: "local" }));
    expect(s.getAttachmentWriteProfile()).toBeUndefined();
  });

  it("名字未在本进程拓扑视角命中(含本进程未声明任何拓扑)→ warn+丢弃", () => {
    // 未设置 ATTACHMENT_BACKENDS_ENV(本进程视角 = 无拓扑)。
    const ch = new MockChannel();
    const s = newSession(ch);
    ch.emitLine(JSON.stringify({ type: "agent_attachment_profile", profile: "ghost" }));
    expect(s.getAttachmentWriteProfile()).toBeUndefined();

    process.env[ATTACHMENT_BACKENDS_ENV] = topology("local");
    ch.emitLine(JSON.stringify({ type: "agent_attachment_profile", profile: "not-declared" }));
    expect(s.getAttachmentWriteProfile()).toBeUndefined();
  });

  it("三类丢弃均不影响会话存活(未失败/未抛出)", () => {
    const ch = new MockChannel();
    const s = newSession(ch);
    expect(() =>
      ch.emitLine(JSON.stringify({ type: "agent_attachment_profile", profile: "x" })),
    ).not.toThrow();
    expect(s.lifecycle).not.toBe("error");
  });
});
