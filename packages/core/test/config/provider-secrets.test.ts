/**
 * 单元:provider-secrets — providers 域(`objectList`)的凭据掩码 + 三态合并
 * (spec: multi-gateway-providers,任务 5.2;Req 7.3, 7.4)。
 */
import { describe, it, expect } from "vitest";
import { maskProviderSecrets, mergeProviderSecrets } from "../../src/config/provider-secrets.js";
import { maskSecrets } from "../../src/config/secret-merge.js";
import { secretKeep, secretClear, secretSet, isSecretMask } from "@blksails/pi-web-protocol";
import type { FormSchema } from "@blksails/pi-web-protocol";

// ─── 已知盲点(通用实现):证明必要性 ─────────────────────────────────────────────
//
// 通用 `maskSecrets`(secret-merge.ts)只识别扁平 object 与单一 record 域两种形态,
// 对 `objectList` 字段不下钻,于是 providers 域这种"顶层是数组"的形状会被原样透传 ——
// 列表内的 apiKey 明文直接回传浏览器。此用例锁定该行为,防止未来有人以"简化,直接复用
// 通用实现"为由删掉本模块、悄悄重新引入泄露。
const PROVIDERS_FORM_SCHEMA_SHAPE: FormSchema = {
  domain: "providers",
  fields: [
    {
      key: "providers",
      kind: "objectList",
      label: "Providers",
      required: false,
      itemFields: [
        { key: "id", kind: "string", label: "ID", required: true },
        { key: "apiKey", kind: "secret", label: "API Key", required: false },
      ],
    },
  ],
};

describe("known blind spot — generic maskSecrets does not traverse objectList", () => {
  it("leaks apiKey plaintext for entries inside providers[] (documents why this module exists)", () => {
    const raw = {
      providers: [{ id: "my-provider", apiKey: "sk-plaintext-secret" }],
    };
    const masked = maskSecrets("providers", raw, PROVIDERS_FORM_SCHEMA_SHAPE);
    // ★ This assertion captures the actual (undesired) generic behavior: the secret
    // survives verbatim. It documents the failure mode maskProviderSecrets must fix.
    const providers = masked["providers"] as ReadonlyArray<Record<string, unknown>>;
    expect(providers[0]?.["apiKey"]).toBe("sk-plaintext-secret");
  });
});

// ─── 读路径:maskProviderSecrets ────────────────────────────────────────────────

describe("maskProviderSecrets", () => {
  it("replaces apiKey inside a list entry with a mask placeholder (no plaintext)", () => {
    const raw = {
      providers: [{ id: "my-provider", displayName: "My Provider", apiKey: "sk-secret-abcd" }],
    };
    const masked = maskProviderSecrets(raw) as Record<string, unknown>;
    const providers = masked["providers"] as ReadonlyArray<Record<string, unknown>>;
    const apiKeyMask = providers[0]?.["apiKey"];

    expect(typeof apiKeyMask).not.toBe("string");
    expect(isSecretMask(apiKeyMask)).toBe(true);
    const mask = apiKeyMask as { __secret: true; set: boolean; hint?: string };
    expect(mask.set).toBe(true);
    expect(mask.hint).toBe("abcd");
    // Non-secret fields pass through untouched.
    expect(providers[0]?.["displayName"]).toBe("My Provider");
    expect(providers[0]?.["id"]).toBe("my-provider");
  });

  it("output contains NO plaintext secret strings across multiple entries", () => {
    const raw = {
      providers: [
        { id: "p1", apiKey: "sk-FIRST-SECRET" },
        { id: "p2", apiKey: "sk-SECOND-SECRET" },
      ],
    };
    const masked = maskProviderSecrets(raw);
    const json = JSON.stringify(masked);
    expect(json).not.toContain("sk-FIRST-SECRET");
    expect(json).not.toContain("sk-SECOND-SECRET");
  });

  it("mask has set:false when apiKey is empty/missing", () => {
    const raw = { providers: [{ id: "p1", apiKey: "" }, { id: "p2" }] };
    const masked = maskProviderSecrets(raw) as Record<string, unknown>;
    const providers = masked["providers"] as ReadonlyArray<Record<string, unknown>>;
    expect((providers[0]?.["apiKey"] as { set: boolean }).set).toBe(false);
    expect((providers[1]?.["apiKey"] as { set: boolean }).set).toBe(false);
  });

  it("passes through non-providers shapes unchanged", () => {
    const raw = { unrelated: "value" };
    expect(maskProviderSecrets(raw)).toEqual(raw);
    expect(maskProviderSecrets(null)).toBeNull();
    expect(maskProviderSecrets("not-an-object")).toBe("not-an-object");
  });

  it("preserves non-secret sibling fields like models list", () => {
    const raw = {
      providers: [
        {
          id: "p1",
          apiKey: "sk-secret",
          input: ["text", "image"],
          models: [{ id: "model-a", name: "Model A" }],
        },
      ],
    };
    const masked = maskProviderSecrets(raw) as Record<string, unknown>;
    const providers = masked["providers"] as ReadonlyArray<Record<string, unknown>>;
    expect(providers[0]?.["input"]).toEqual(["text", "image"]);
    expect(providers[0]?.["models"]).toEqual([{ id: "model-a", name: "Model A" }]);
  });
});

// ─── 写路径:mergeProviderSecrets(三态) ─────────────────────────────────────────

describe("mergeProviderSecrets — three-state merge", () => {
  const disk = {
    providers: [
      { id: "p1", displayName: "P1", apiKey: "sk-disk-p1" },
      { id: "p2", displayName: "P2", apiKey: "sk-disk-p2" },
    ],
  };

  it("keep (SecretWrite) → preserves disk value, matched by id", () => {
    const incoming = {
      providers: [{ id: "p1", displayName: "P1 renamed", apiKey: secretKeep }],
    };
    const merged = mergeProviderSecrets(incoming, disk) as Record<string, unknown>;
    const providers = merged["providers"] as ReadonlyArray<Record<string, unknown>>;
    expect(providers[0]?.["apiKey"]).toBe("sk-disk-p1");
    // Non-secret fields still take the incoming (edited) value.
    expect(providers[0]?.["displayName"]).toBe("P1 renamed");
  });

  it("echoed-back SecretMask (untouched form field) → also treated as keep, not stored as literal mask", () => {
    const incoming = {
      providers: [{ id: "p1", apiKey: { __secret: true, set: true, hint: "-p1" } }],
    };
    const merged = mergeProviderSecrets(incoming, disk) as Record<string, unknown>;
    const providers = merged["providers"] as ReadonlyArray<Record<string, unknown>>;
    expect(providers[0]?.["apiKey"]).toBe("sk-disk-p1");
  });

  it("missing apiKey field (undefined) → also treated as keep", () => {
    const incoming = { providers: [{ id: "p1", displayName: "P1" }] };
    const merged = mergeProviderSecrets(incoming, disk) as Record<string, unknown>;
    const providers = merged["providers"] as ReadonlyArray<Record<string, unknown>>;
    expect(providers[0]?.["apiKey"]).toBe("sk-disk-p1");
  });

  it("clear (SecretWrite) → removes the key entirely", () => {
    const incoming = { providers: [{ id: "p1", apiKey: secretClear }] };
    const merged = mergeProviderSecrets(incoming, disk) as Record<string, unknown>;
    const providers = merged["providers"] as ReadonlyArray<Record<string, unknown>>;
    expect(Object.prototype.hasOwnProperty.call(providers[0], "apiKey")).toBe(false);
  });

  it("set (SecretWrite) → overwrites disk value with new plaintext", () => {
    const incoming = { providers: [{ id: "p1", apiKey: secretSet("sk-new-value") }] };
    const merged = mergeProviderSecrets(incoming, disk) as Record<string, unknown>;
    const providers = merged["providers"] as ReadonlyArray<Record<string, unknown>>;
    expect(providers[0]?.["apiKey"]).toBe("sk-new-value");
  });

  it("keep on a brand-new entry (no disk match) → drops the key rather than fabricating a value", () => {
    const incoming = { providers: [{ id: "new-provider", apiKey: secretKeep }] };
    const merged = mergeProviderSecrets(incoming, disk) as Record<string, unknown>;
    const providers = merged["providers"] as ReadonlyArray<Record<string, unknown>>;
    expect(Object.prototype.hasOwnProperty.call(providers[0], "apiKey")).toBe(false);
  });

  it("plain string value (legacy compat) → overwrites disk value", () => {
    const incoming = { providers: [{ id: "p1", apiKey: "sk-plain-string" }] };
    const merged = mergeProviderSecrets(incoming, disk) as Record<string, unknown>;
    const providers = merged["providers"] as ReadonlyArray<Record<string, unknown>>;
    expect(providers[0]?.["apiKey"]).toBe("sk-plain-string");
  });

  it("each entry resolved independently by id, unrelated entries untouched", () => {
    const incoming = {
      providers: [
        { id: "p1", apiKey: secretSet("sk-p1-new") },
        { id: "p2", apiKey: secretKeep },
      ],
    };
    const merged = mergeProviderSecrets(incoming, disk) as Record<string, unknown>;
    const providers = merged["providers"] as ReadonlyArray<Record<string, unknown>>;
    expect(providers[0]?.["apiKey"]).toBe("sk-p1-new");
    expect(providers[1]?.["apiKey"]).toBe("sk-disk-p2");
  });

  it("passes through non-providers shapes unchanged", () => {
    const incoming = { unrelated: "value" };
    expect(mergeProviderSecrets(incoming, disk)).toEqual(incoming);
    expect(mergeProviderSecrets(null, disk)).toBeNull();
  });
});
