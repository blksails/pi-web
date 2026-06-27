/**
 * 单元:来源白名单 + 版本固定(Req 2.3/2.4/10.1)。
 */
import { describe, expect, it } from "vitest";
import {
  checkAllowlist,
  DEFAULT_ALLOWLIST,
} from "../../src/extensions/install/source-allowlist.js";
import type { AllowlistConfig } from "../../src/extensions/ext.types.js";

const cfg: AllowlistConfig = {
  npmScopes: ["@pi-web", "@earendil-works"],
  gitHosts: ["github.com"],
  allowLocal: false,
};

describe("checkAllowlist — npm", () => {
  it("accepts an allowlisted scoped npm package pinned to an exact version", () => {
    const d = checkAllowlist("npm:@pi-web/sample@1.2.3", cfg);
    expect(d.allowed).toBe(true);
    if (d.allowed) {
      expect(d.source).toEqual({
        kind: "npm",
        scope: "@pi-web",
        name: "sample",
        version: "1.2.3",
      });
      expect(d.canonical).toBe("npm:@pi-web/sample@1.2.3");
    }
  });

  it("rejects a non-allowlisted npm scope", () => {
    const d = checkAllowlist("npm:@evil/pkg@1.0.0", cfg);
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.reason).toMatch(/scope/);
  });

  it("rejects npm without a pinned version", () => {
    const d = checkAllowlist("npm:@pi-web/sample", cfg);
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.reason).toMatch(/pinned version|x\.y\.z/);
  });

  it("rejects npm with a dist-tag / range instead of exact version", () => {
    expect(checkAllowlist("npm:@pi-web/sample@latest", cfg).allowed).toBe(false);
    expect(checkAllowlist("npm:@pi-web/sample@^1.0.0", cfg).allowed).toBe(false);
  });

  it("rejects unscoped npm packages", () => {
    const d = checkAllowlist("npm:leftpad@1.0.0", cfg);
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.reason).toMatch(/unscoped/);
  });
});

describe("checkAllowlist — npm with allowAnyNpm", () => {
  const anyNpm: AllowlistConfig = { ...cfg, allowAnyNpm: true };

  it("accepts an unscoped npm package when allowAnyNpm is set (still pinned)", () => {
    const d = checkAllowlist("npm:pi-schedule-prompt@0.4.1", anyNpm);
    expect(d.allowed).toBe(true);
    if (d.allowed) {
      expect(d.source).toEqual({
        kind: "npm",
        name: "pi-schedule-prompt",
        version: "0.4.1",
      });
      expect(d.canonical).toBe("npm:pi-schedule-prompt@0.4.1");
    }
  });

  it("accepts a non-default scope when allowAnyNpm is set", () => {
    expect(checkAllowlist("npm:@acme/x@1.0.0", anyNpm).allowed).toBe(true);
  });

  it("STILL requires an exact pinned version under allowAnyNpm", () => {
    expect(checkAllowlist("npm:pi-schedule-prompt", anyNpm).allowed).toBe(false);
    expect(checkAllowlist("npm:pi-schedule-prompt@latest", anyNpm).allowed).toBe(
      false,
    );
    expect(checkAllowlist("npm:pi-schedule-prompt@^0.4.1", anyNpm).allowed).toBe(
      false,
    );
  });

  it("does not affect git/local gating (only relaxes npm scope)", () => {
    expect(checkAllowlist("https://evil.example.com/x/y@v1.0.0", anyNpm).allowed).toBe(
      false,
    );
    expect(checkAllowlist("local:/tmp/x", anyNpm).allowed).toBe(false);
  });
});

describe("checkAllowlist — git", () => {
  it("accepts an allowlisted git host with a pinned tag", () => {
    const d = checkAllowlist("git:github.com/acme/ext@v1.0.0", cfg);
    expect(d.allowed).toBe(true);
    if (d.allowed) {
      expect(d.source).toEqual({
        kind: "git",
        host: "github.com",
        repoPath: "acme/ext",
        ref: "v1.0.0",
      });
    }
  });

  it("accepts a pinned 40-hex commit on an allowlisted https URL", () => {
    const sha = "a".repeat(40);
    const d = checkAllowlist(`https://github.com/acme/ext@${sha}`, cfg);
    expect(d.allowed).toBe(true);
  });

  it("rejects an arbitrary https URL host not in the allowlist", () => {
    const d = checkAllowlist("https://evil.example.com/x/y@v1.0.0", cfg);
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.reason).toMatch(/host/);
  });

  it("rejects a git source without a pinned ref", () => {
    const d = checkAllowlist("git:github.com/acme/ext", cfg);
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.reason).toMatch(/pinned ref/);
  });

  it("rejects a mutable branch ref", () => {
    const d = checkAllowlist("git:github.com/acme/ext@main", cfg);
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.reason).toMatch(/pinned|branch/);
  });
});

describe("checkAllowlist — local + misc", () => {
  it("rejects local sources when allowLocal is false", () => {
    expect(checkAllowlist("local:/tmp/ext", cfg).allowed).toBe(false);
  });

  it("accepts local sources when allowLocal is true", () => {
    const d = checkAllowlist("local:/tmp/ext", { ...cfg, allowLocal: true });
    expect(d.allowed).toBe(true);
    if (d.allowed) expect(d.source).toEqual({ kind: "local", path: "/tmp/ext" });
  });

  it("rejects empty / unrecognized sources", () => {
    expect(checkAllowlist("", cfg).allowed).toBe(false);
    expect(checkAllowlist("   ", cfg).allowed).toBe(false);
    expect(checkAllowlist("ftp://x/y@v1.0.0", cfg).allowed).toBe(false);
    expect(checkAllowlist("just-a-name", cfg).allowed).toBe(false);
  });

  it("DEFAULT_ALLOWLIST disallows local and arbitrary hosts", () => {
    expect(DEFAULT_ALLOWLIST.allowLocal).toBe(false);
    expect(checkAllowlist("https://evil.com/a/b@v1.0.0", DEFAULT_ALLOWLIST).allowed).toBe(
      false,
    );
  });
});
