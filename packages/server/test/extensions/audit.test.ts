/**
 * 单元:审计记录构造 + 脱敏(Req 8.1–8.4/9.3/10.1)。
 */
import { describe, expect, it } from "vitest";
import {
  actorOf,
  buildAuditRecord,
  redactReason,
} from "../../src/extensions/security/audit.js";
import type { AuthContext } from "../../src/http/index.js";

const anon: AuthContext = { anonymous: true };
const user: AuthContext = { anonymous: false, userId: "root" };
const fixedNow = (): Date => new Date("2026-06-17T00:00:00.000Z");

describe("actorOf", () => {
  it("maps anonymous → 'anonymous' and user → userId", () => {
    expect(actorOf(anon)).toBe("anonymous");
    expect(actorOf(user)).toBe("root");
  });
});

describe("buildAuditRecord — three outcomes", () => {
  it("builds a complete success record", () => {
    const r = buildAuditRecord({
      auth: user,
      action: "install",
      source: "npm:@pi-web/sample@1.0.0",
      outcome: "success",
      now: fixedNow,
    });
    expect(r).toEqual({
      actor: "root",
      at: "2026-06-17T00:00:00.000Z",
      action: "install",
      source: "npm:@pi-web/sample@1.0.0",
      outcome: "success",
    });
  });

  it("builds a failure record with a reason", () => {
    const r = buildAuditRecord({
      auth: user,
      action: "install",
      source: "npm:@pi-web/sample@1.0.0",
      outcome: "failure",
      reason: "pi install exited with code 1",
      now: fixedNow,
    });
    expect(r.outcome).toBe("failure");
    expect(r.reason).toBe("pi install exited with code 1");
  });

  it("builds a rejected record (anonymous actor)", () => {
    const r = buildAuditRecord({
      auth: anon,
      action: "install",
      source: "https://evil.com/x@v1.0.0",
      outcome: "rejected",
      reason: "git host not in allowlist",
      now: fixedNow,
    });
    expect(r.actor).toBe("anonymous");
    expect(r.outcome).toBe("rejected");
  });
});

describe("redaction — no env secrets / credentials", () => {
  it("redacts inline git URL credentials", () => {
    expect(redactReason("clone failed for https://user:ghp_secret@github.com/x")).not.toMatch(
      /ghp_secret|user:/,
    );
  });

  it("redacts key=value style secrets", () => {
    expect(redactReason("failed with API_KEY=sk-12345 token=abcdef")).not.toMatch(
      /sk-12345|abcdef/,
    );
  });

  it("audit record reason is redacted at construction time", () => {
    const r = buildAuditRecord({
      auth: user,
      action: "install",
      source: "git:github.com/x/y@v1",
      outcome: "failure",
      reason: "auth to https://bob:topsecret@github.com failed",
      now: fixedNow,
    });
    expect(JSON.stringify(r)).not.toMatch(/topsecret|bob:/);
  });
});
