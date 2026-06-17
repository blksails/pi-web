/**
 * 单元:信任决策落地矩阵(cli/custom × always/never/ask,Req 6.1–6.6/10.1)。
 */
import { describe, expect, it } from "vitest";
import { landTrust } from "../../src/extensions/install/trust-landing.js";
import type { TrustDecision } from "../../src/extensions/ext.types.js";

const policyReturning =
  (d: TrustDecision) =>
  (_src: string): TrustDecision =>
    d;

describe("landTrust — cli mode", () => {
  it("always → --approve", () => {
    const f = landTrust("src", "cli", policyReturning("always"));
    expect(f.extraArgs).toEqual(["--approve"]);
    expect(f.extraEnv).toEqual({});
  });

  it("never → --no-approve (no .pi/ release signal)", () => {
    const f = landTrust("src", "cli", policyReturning("never"));
    expect(f.extraArgs).toEqual(["--no-approve"]);
    expect(f.extraEnv).toEqual({});
  });

  it("ask → empty fragment (headless ignores .pi/)", () => {
    const f = landTrust("src", "cli", policyReturning("ask"));
    expect(f.extraArgs).toEqual([]);
    expect(f.extraEnv).toEqual({});
  });
});

describe("landTrust — custom mode", () => {
  it("always → PI_WEB_TRUST_PROJECT=1 runner signal", () => {
    const f = landTrust("src", "custom", policyReturning("always"));
    expect(f.extraEnv["PI_WEB_TRUST_PROJECT"]).toBe("1");
    expect(f.extraArgs).toEqual([]);
  });

  it("never → no release signal", () => {
    const f = landTrust("src", "custom", policyReturning("never"));
    expect(f.extraEnv).toEqual({});
    expect(f.extraArgs).toEqual([]);
  });

  it("ask → no release signal", () => {
    const f = landTrust("src", "custom", policyReturning("ask"));
    expect(f.extraEnv).toEqual({});
    expect(f.extraArgs).toEqual([]);
  });
});

describe("landTrust — defaults & invariants", () => {
  it("defaults to ask (no release signal) when no policy injected", () => {
    expect(landTrust("src", "cli").extraArgs).toEqual([]);
    expect(landTrust("src", "custom").extraEnv).toEqual({});
  });

  it("never emits any context/global-extension suppression signal", () => {
    // 任何取值的片段只可能是 --approve / --no-approve / PI_WEB_TRUST_PROJECT;
    // 不含任何抑制 AGENTS.md/CLAUDE.md/全局扩展的标志。
    for (const d of ["always", "never", "ask"] as const) {
      for (const mode of ["cli", "custom"] as const) {
        const f = landTrust("src", mode, policyReturning(d));
        const blob = JSON.stringify(f);
        expect(blob).not.toMatch(/no-context|disable-global|no-extensions|ignore-agents/i);
      }
    }
  });
});
