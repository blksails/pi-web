import { describe, it, expect } from "vitest";
import { decideMode } from "../../src/agent-source/mode-decide.js";
import { applyTrust } from "../../src/agent-source/trust-apply.js";
import {
  defaultTrustPolicy,
  resolveTrustPolicy,
} from "../../src/agent-source/trust-policy.js";
import { assemble } from "../../src/agent-source/assemble-spawn.js";
import type { TrustDecision, TrustPolicyInput } from "../../src/agent-source/types.js";

describe("decideMode", () => {
  it("custom when entry present", () => {
    expect(decideMode({ kind: "entry", path: "/x/index.ts" })).toBe("custom");
  });
  it("cli when no entry", () => {
    expect(decideMode({ kind: "none" })).toBe("cli");
  });
});

describe("trustPolicy", () => {
  it("default returns ask", () => {
    expect(defaultTrustPolicy("anything")).toBe("ask");
  });
  it("resolveTrustPolicy returns default when none injected", () => {
    expect(resolveTrustPolicy({})({ dir: "/s", source: "s" })).toBe("ask");
  });
  it("resolveTrustPolicy uses injected policy", () => {
    const policy = (input: TrustPolicyInput): TrustDecision =>
      input.dir === "trusted" ? "always" : "never";
    const fn = resolveTrustPolicy({ trustPolicy: policy });
    expect(fn({ dir: "trusted", source: "s" })).toBe("always");
    expect(fn({ dir: "other", source: "s" })).toBe("never");
  });
});

describe("applyTrust — full 6-cell matrix", () => {
  it("cli + always → --approve", () => {
    expect(applyTrust("cli", "always")).toEqual({ extraArgs: ["--approve"], extraEnv: {} });
  });
  it("cli + never → --no-approve", () => {
    expect(applyTrust("cli", "never")).toEqual({ extraArgs: ["--no-approve"], extraEnv: {} });
  });
  it("cli + ask → no trust flag (headless ignore .pi/)", () => {
    const f = applyTrust("cli", "ask");
    expect(f.extraArgs).toEqual([]);
    expect(f.extraEnv).toEqual({});
  });
  it("custom + always → PI_WEB_TRUST_PROJECT=1 env", () => {
    expect(applyTrust("custom", "always")).toEqual({
      extraArgs: [],
      extraEnv: { PI_WEB_TRUST_PROJECT: "1" },
    });
  });
  it("custom + never → no release signal", () => {
    expect(applyTrust("custom", "never")).toEqual({ extraArgs: [], extraEnv: {} });
  });
  it("custom + ask → no release signal", () => {
    const f = applyTrust("custom", "ask");
    expect(f.extraArgs).toEqual([]);
    expect(f.extraEnv).toEqual({});
  });

  it("headless ask never emits any trust flag/env in either mode", () => {
    for (const mode of ["cli", "custom"] as const) {
      const f = applyTrust(mode, "ask");
      expect(f.extraArgs.some((a) => a.includes("approve") || a.includes("trust"))).toBe(false);
      expect(Object.keys(f.extraEnv)).toHaveLength(0);
    }
  });
});

describe("assemble — env merge & isolation", () => {
  it("custom mode spawnSpec shape: node <bootstrap> --agent <entry> --cwd <work>", () => {
    const spec = assemble(
      { mode: "custom", cwd: "/work", entryPath: "/work/index.ts" },
      { extraArgs: [], extraEnv: {} },
      { runnerEntry: "/runner-bootstrap.mjs" },
    );
    expect(spec.cmd).toBe("node");
    // The bootstrap is cwd-independent: it constructs jiti itself, so the spawn
    // no longer needs `--import jiti/register`.
    expect(spec.args).toEqual([
      "/runner-bootstrap.mjs",
      "--agent",
      "/work/index.ts",
      "--cwd",
      "/work",
    ]);
    expect(spec.cwd).toBe("/work");
  });

  it("custom mode throws when runnerEntry is not injected", () => {
    expect(() =>
      assemble(
        { mode: "custom", cwd: "/work", entryPath: "/work/index.ts" },
        { extraArgs: [], extraEnv: {} },
        {},
      ),
    ).toThrowError(/runnerEntry/);
  });

  it("cli mode throws when piCliEntry is not injected", () => {
    expect(() =>
      assemble({ mode: "cli", cwd: "/p" }, { extraArgs: [], extraEnv: {} }, {}),
    ).toThrowError(/piCliEntry/);
  });

  it("custom mode threads --agent-dir when agentDir is provided", () => {
    const spec = assemble(
      { mode: "custom", cwd: "/work", entryPath: "/work/index.ts" },
      { extraArgs: [], extraEnv: {} },
      { runnerEntry: "/runner-bootstrap.mjs", agentDir: "/iso/agentdir" },
    );
    const idx = spec.args.indexOf("--agent-dir");
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(spec.args[idx + 1]).toBe("/iso/agentdir");
    expect(spec.env["PI_CODING_AGENT_DIR"]).toBe("/iso/agentdir");
  });

  it("opts.extraArgs 追加到 custom 模式 argv 末尾(如 --no-skills/--no-extensions)", () => {
    const spec = assemble(
      { mode: "custom", cwd: "/work", entryPath: "/work/index.ts" },
      { extraArgs: [], extraEnv: {} },
      {
        runnerEntry: "/runner-bootstrap.mjs",
        extraArgs: ["--no-skills", "--no-extensions"],
      },
    );
    expect(spec.args.slice(-2)).toEqual(["--no-skills", "--no-extensions"]);
  });

  it("opts.extraArgs 追加到 cli 模式 argv 末尾", () => {
    const spec = assemble(
      { mode: "cli", cwd: "/proj" },
      { extraArgs: [], extraEnv: {} },
      { piCliEntry: "/cli.js", extraArgs: ["--no-skills", "--no-extensions"] },
    );
    expect(spec.args).toEqual([
      "/cli.js",
      "--mode",
      "rpc",
      "--no-skills",
      "--no-extensions",
    ]);
  });

  it("cli mode spawnSpec shape with pi cli + --mode rpc", () => {
    const spec = assemble(
      { mode: "cli", cwd: "/proj" },
      { extraArgs: ["--approve"], extraEnv: {} },
      { piCliEntry: "/cli.js" },
    );
    expect(spec.cmd).toBe("node");
    // pi CLI has no --cwd flag; working dir is set via spawnSpec.cwd.
    expect(spec.args).toEqual(["/cli.js", "--mode", "rpc", "--approve"]);
    expect(spec.cwd).toBe("/proj");
  });

  it("PI_CODING_AGENT_DIR comes from agentDir (not PI_AGENT_DIR)", () => {
    const spec = assemble(
      { mode: "cli", cwd: "/p" },
      { extraArgs: [], extraEnv: {} },
      { piCliEntry: "/cli.js", agentDir: "/isolated/agentdir" },
    );
    expect(spec.env["PI_CODING_AGENT_DIR"]).toBe("/isolated/agentdir");
    expect(spec.env["PI_AGENT_DIR"]).toBeUndefined();
  });

  it("extra env merged in but does not override PI_CODING_AGENT_DIR", () => {
    const spec = assemble(
      { mode: "cli", cwd: "/p" },
      { extraArgs: [], extraEnv: {} },
      {
        piCliEntry: "/cli.js",
        agentDir: "/isolated",
        env: { OPENAI_API_KEY: "sk-x", PI_CODING_AGENT_DIR: "/attacker" },
        baseEnv: { PATH: "/usr/bin" },
      },
    );
    expect(spec.env["OPENAI_API_KEY"]).toBe("sk-x");
    expect(spec.env["PATH"]).toBe("/usr/bin");
    expect(spec.env["PI_CODING_AGENT_DIR"]).toBe("/isolated");
  });

  it("trust fragment env is merged", () => {
    const spec = assemble(
      { mode: "custom", cwd: "/w", entryPath: "/w/index.ts" },
      { extraArgs: [], extraEnv: { PI_WEB_TRUST_PROJECT: "1" } },
      { runnerEntry: "/r.js" },
    );
    expect(spec.env["PI_WEB_TRUST_PROJECT"]).toBe("1");
  });
});
