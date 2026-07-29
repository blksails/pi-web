/**
 * 单元:secret-merge — GET 路径掩码 + PUT 路径仅写合并。
 *
 * PUT secret 字段使用 @blksails/pi-web-protocol 的 SecretWrite 三态:
 *   keep  → { __secret:true, action:"keep" }
 *   clear → { __secret:true, action:"clear" }
 *   set   → { __secret:true, action:"set", value:"..." }
 * SecretMask 回传(旧式)也视为 keep。
 * 字段缺失/undefined 也视为 keep。
 */
import { describe, it, expect } from "vitest";
import { maskSecrets, mergeSecrets, isSecretMask } from "../../src/config/secret-merge.js";
import { secretKeep, secretClear, secretSet } from "@blksails/pi-web-protocol";

// ─── GET path: maskSecrets ────────────────────────────────────────────────────

describe("maskSecrets — auth domain", () => {
  it("replaces apiKey with mask placeholder (no plaintext)", () => {
    const raw = {
      anthropic: { apiKey: "sk-ant-secretkey", baseURL: "https://api.anthropic.com" },
    };
    const masked = maskSecrets("auth", raw);
    const provider = masked["anthropic"] as Record<string, unknown>;
    const apiKeyMask = provider["apiKey"];

    // Must NOT be a plain string.
    expect(typeof apiKeyMask).not.toBe("string");
    // Must be a secret mask object.
    expect(isSecretMask(apiKeyMask)).toBe(true);
    const mask = apiKeyMask as { __secret: true; set: boolean; hint?: string };
    expect(mask.__secret).toBe(true);
    expect(mask.set).toBe(true);
    // hint is last 4 chars of "sk-ant-secretkey" → "tkey".
    expect(mask.hint).toBe("tkey");
    // baseURL is non-secret, passes through.
    expect(provider["baseURL"]).toBe("https://api.anthropic.com");
  });

  it("mask has set:false when apiKey is empty/missing", () => {
    const raw = { openai: { apiKey: "" } };
    const masked = maskSecrets("auth", raw);
    const provider = masked["openai"] as Record<string, unknown>;
    const mask = provider["apiKey"] as { __secret: true; set: boolean };
    expect(mask.set).toBe(false);
  });

  it("output contains NO plaintext secret strings", () => {
    const raw = {
      anthropic: { apiKey: "sk-VERY-SECRET" },
      openai: { apiKey: "sk-ALSO-SECRET" },
    };
    const masked = maskSecrets("auth", raw);
    const json = JSON.stringify(masked);
    expect(json).not.toContain("sk-VERY-SECRET");
    expect(json).not.toContain("sk-ALSO-SECRET");
  });

  it("preserves multiple providers with masking", () => {
    const raw = {
      anthropic: { apiKey: "sk-anthropic-1234" },
      openai: { apiKey: "sk-openai-5678" },
    };
    const masked = maskSecrets("auth", raw);
    expect(isSecretMask((masked["anthropic"] as Record<string, unknown>)["apiKey"])).toBe(true);
    expect(isSecretMask((masked["openai"] as Record<string, unknown>)["apiKey"])).toBe(true);
  });
});

describe("maskSecrets — settings domain", () => {
  it("passes through non-secret fields (no apiKey in settings)", () => {
    const raw = { defaultProvider: "anthropic", theme: "dark" };
    const masked = maskSecrets("settings", raw);
    expect(masked["defaultProvider"]).toBe("anthropic");
    expect(masked["theme"]).toBe("dark");
  });
});

// ─── PUT path: mergeSecrets ───────────────────────────────────────────────────

describe("mergeSecrets — auth domain", () => {
  const diskValues = {
    anthropic: { apiKey: "sk-disk-key", baseURL: "https://api.anthropic.com" },
    openai: { apiKey: "sk-openai-existing" },
  };

  it("undefined/missing field → keeps disk value (empty sentinel)", () => {
    // Incoming has no apiKey field → keep disk value.
    const incoming = {
      anthropic: { baseURL: "https://new.url" },
    };
    const merged = mergeSecrets("auth", incoming, diskValues);
    const provider = merged["anthropic"] as Record<string, unknown>;
    expect(provider["apiKey"]).toBe("sk-disk-key");
    expect(provider["baseURL"]).toBe("https://new.url");
  });

  it("SecretWrite keep → keeps disk value", () => {
    const incoming = {
      anthropic: { apiKey: secretKeep },
    };
    const merged = mergeSecrets("auth", incoming, diskValues);
    const provider = merged["anthropic"] as Record<string, unknown>;
    expect(provider["apiKey"]).toBe("sk-disk-key");
  });

  it("SecretMask placeholder (old-style) → keeps disk value", () => {
    const incoming = {
      anthropic: { apiKey: { __secret: true, set: true, hint: "1234" } },
    };
    const merged = mergeSecrets("auth", incoming, diskValues);
    const provider = merged["anthropic"] as Record<string, unknown>;
    expect(provider["apiKey"]).toBe("sk-disk-key");
  });

  it("SecretWrite set → overwrites disk value", () => {
    const incoming = {
      anthropic: { apiKey: secretSet("sk-new-value") },
    };
    const merged = mergeSecrets("auth", incoming, diskValues);
    const provider = merged["anthropic"] as Record<string, unknown>;
    expect(provider["apiKey"]).toBe("sk-new-value");
  });

  it("new plaintext string value → overwrites disk value (backward compat)", () => {
    const incoming = {
      anthropic: { apiKey: "sk-new-value" },
    };
    const merged = mergeSecrets("auth", incoming, diskValues);
    const provider = merged["anthropic"] as Record<string, unknown>;
    expect(provider["apiKey"]).toBe("sk-new-value");
  });

  it("SecretWrite clear on secret subfield → removes the key", () => {
    const incoming = {
      anthropic: { apiKey: secretClear },
    };
    const merged = mergeSecrets("auth", incoming, diskValues);
    const provider = merged["anthropic"] as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(provider, "apiKey")).toBe(false);
  });

  it("null on provider → removes the provider", () => {
    const incoming: Record<string, unknown> = { openai: null };
    const merged = mergeSecrets("auth", incoming, diskValues);
    expect(Object.prototype.hasOwnProperty.call(merged, "openai")).toBe(false);
    // anthropic must survive.
    expect(merged["anthropic"]).toBeDefined();
  });

  it("unrelated providers in disk are preserved", () => {
    const incoming = { anthropic: { apiKey: secretSet("sk-new") } };
    const merged = mergeSecrets("auth", incoming, diskValues);
    expect(merged["openai"]).toEqual(diskValues["openai"]);
  });
});

describe("mergeSecrets — settings domain (no secret fields)", () => {
  const diskValues = { defaultProvider: "anthropic", theme: "light", _unknown: true };

  it("overwrites changed field", () => {
    const incoming = { theme: "dark" };
    const merged = mergeSecrets("settings", incoming, diskValues);
    expect(merged["theme"]).toBe("dark");
    expect(merged["defaultProvider"]).toBe("anthropic");
  });

  it("preserves unknown fields not in incoming", () => {
    const incoming = { theme: "dark" };
    const merged = mergeSecrets("settings", incoming, diskValues);
    expect(merged["_unknown"]).toBe(true);
  });

  it("null removes a field", () => {
    const incoming: Record<string, unknown> = { defaultProvider: null };
    const merged = mergeSecrets("settings", incoming, diskValues);
    expect(Object.prototype.hasOwnProperty.call(merged, "defaultProvider")).toBe(false);
  });
});

// ─── isSecretMask ─────────────────────────────────────────────────────────────

describe("isSecretMask", () => {
  it("returns true for valid mask", () => {
    expect(isSecretMask({ __secret: true, set: true })).toBe(true);
    expect(isSecretMask({ __secret: true, set: false, hint: "1234" })).toBe(true);
  });

  it("returns false for non-mask values", () => {
    expect(isSecretMask("sk-abc")).toBe(false);
    expect(isSecretMask(null)).toBe(false);
    expect(isSecretMask(undefined)).toBe(false);
    expect(isSecretMask({ set: true })).toBe(false);
    expect(isSecretMask({ __secret: false, set: true })).toBe(false);
  });

  it("returns false for SecretWrite objects (they have action, not set)", () => {
    expect(isSecretMask(secretKeep)).toBe(false);
    expect(isSecretMask(secretClear)).toBe(false);
    expect(isSecretMask(secretSet("x"))).toBe(false);
  });
});
