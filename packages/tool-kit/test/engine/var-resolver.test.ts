import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  resolveVars,
  resolveVarsOptional,
  checkRequiredVars,
} from "../../src/engine/var-resolver.js";

describe("resolveVars", () => {
  beforeEach(() => {
    process.env["TEST_VAR_A"] = "hello";
    process.env["TEST_VAR_B"] = "world";
  });
  afterEach(() => {
    delete process.env["TEST_VAR_A"];
    delete process.env["TEST_VAR_B"];
    delete process.env["TEST_VAR_MISSING"];
  });

  it("replaces a single var", () => {
    expect(resolveVars("value=${TEST_VAR_A}")).toBe("value=hello");
  });

  it("replaces multiple vars", () => {
    expect(resolveVars("${TEST_VAR_A} ${TEST_VAR_B}")).toBe("hello world");
  });

  it("reads each unique var only once (dedup)", () => {
    // Two occurrences of the same var — should still resolve fine.
    expect(resolveVars("${TEST_VAR_A}-${TEST_VAR_A}")).toBe("hello-hello");
  });

  it("${VAR:-default}: env 缺失时回落默认值(default 可含 :// 与 /)", () => {
    delete process.env["TEST_BASE"];
    expect(
      resolveVars("${TEST_BASE:-https://default.example.com/api/v1}/x"),
    ).toBe("https://default.example.com/api/v1/x");
  });

  it("${VAR:-default}: env 有值时用 env 值(忽略默认)", () => {
    process.env["TEST_BASE"] = "https://custom.example.com/v2";
    expect(resolveVars("${TEST_BASE:-https://default.example.com}/x")).toBe(
      "https://custom.example.com/v2/x",
    );
    delete process.env["TEST_BASE"];
  });

  it("${VAR}(无默认值)缺失仍抛错", () => {
    delete process.env["TEST_VAR_MISSING"];
    expect(() => resolveVars("${TEST_VAR_MISSING}")).toThrow(/Missing env/);
  });

  it("returns the template unchanged when no placeholders", () => {
    expect(resolveVars("no-placeholders")).toBe("no-placeholders");
  });

  it("throws when a required variable is missing", () => {
    expect(() => resolveVars("${TEST_VAR_MISSING}")).toThrow("TEST_VAR_MISSING");
  });

  it("includes all missing var names in the error message", () => {
    delete process.env["TEST_VAR_A"];
    // Both A and MISSING are absent.
    expect(() => resolveVars("${TEST_VAR_A} and ${TEST_VAR_MISSING}")).toThrow(/TEST_VAR_A/);
  });
});

describe("resolveVarsOptional", () => {
  beforeEach(() => {
    process.env["TEST_VAR_A"] = "hello";
  });
  afterEach(() => {
    delete process.env["TEST_VAR_A"];
    delete process.env["TEST_VAR_MISSING"];
  });

  it("resolves when all vars present", () => {
    expect(resolveVarsOptional("${TEST_VAR_A}")).toBe("hello");
  });

  it("returns undefined when any var is missing", () => {
    expect(resolveVarsOptional("${TEST_VAR_MISSING}")).toBeUndefined();
  });

  it("returns undefined when template is undefined", () => {
    expect(resolveVarsOptional(undefined)).toBeUndefined();
  });

  it("returns template unchanged when no placeholders", () => {
    expect(resolveVarsOptional("no-vars")).toBe("no-vars");
  });
});

describe("checkRequiredVars", () => {
  beforeEach(() => {
    process.env["TEST_VAR_A"] = "hello";
    process.env["TEST_VAR_B"] = "world";
  });
  afterEach(() => {
    delete process.env["TEST_VAR_A"];
    delete process.env["TEST_VAR_B"];
    delete process.env["TEST_VAR_MISSING"];
  });

  it("returns ok:true when all vars present", () => {
    expect(checkRequiredVars(["TEST_VAR_A", "TEST_VAR_B"])).toEqual({ ok: true });
  });

  it("returns ok:true for empty list", () => {
    expect(checkRequiredVars([])).toEqual({ ok: true });
  });

  it("returns ok:true for undefined list", () => {
    expect(checkRequiredVars(undefined)).toEqual({ ok: true });
  });

  it("returns ok:false with missing names when a var is absent", () => {
    const result = checkRequiredVars(["TEST_VAR_A", "TEST_VAR_MISSING"]);
    expect(result).toEqual({ ok: false, missing: ["TEST_VAR_MISSING"] });
  });

  it("lists all missing vars", () => {
    delete process.env["TEST_VAR_A"];
    const result = checkRequiredVars(["TEST_VAR_A", "TEST_VAR_MISSING"]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.missing).toContain("TEST_VAR_A");
      expect(result.missing).toContain("TEST_VAR_MISSING");
    }
  });
});
