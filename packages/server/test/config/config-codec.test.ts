/**
 * 单元:ConfigCodec — 读写 ~/.pi/agent/*.json + 未知字段保留 + 文件权限。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigCodec } from "../../src/config/config-codec.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = join(tmpdir(), `config-codec-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(tmpDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("ConfigCodec", () => {
  it("returns empty object when file does not exist", async () => {
    const codec = new ConfigCodec(tmpDir);
    const result = await codec.load("auth");
    expect(result).toEqual({});
  });

  it("roundtrip: save then load returns same data", async () => {
    const codec = new ConfigCodec(tmpDir);
    const data = { anthropic: { apiKey: "sk-abc123", baseURL: "https://api.anthropic.com" } };
    await codec.save("auth", data);
    const loaded = await codec.load("auth");
    expect(loaded).toEqual(data);
  });

  it("roundtrip: settings domain save then load", async () => {
    const codec = new ConfigCodec(tmpDir);
    const data = { defaultProvider: "anthropic", theme: "dark" };
    await codec.save("settings", data);
    const loaded = await codec.load("settings");
    expect(loaded).toEqual(data);
  });

  it("preserves unknown fields on merge: existing unknown fields survive partial save", async () => {
    const codec = new ConfigCodec(tmpDir);

    // Pre-populate with known + unknown fields.
    const initial = {
      anthropic: { apiKey: "sk-init" },
      unknownProvider: { apiKey: "sk-unknown", customField: "preserved" },
    };
    await codec.save("auth", initial);

    // Save partial update (only anthropic).
    await codec.save("auth", { anthropic: { apiKey: "sk-new" } });

    const loaded = await codec.load("auth");
    // Unknown provider must survive.
    expect(loaded["unknownProvider"]).toEqual({ apiKey: "sk-unknown", customField: "preserved" });
    // Known provider is updated.
    expect((loaded["anthropic"] as Record<string, unknown>)["apiKey"]).toBe("sk-new");
  });

  it("preserves unknown fields in nested objects", async () => {
    const codec = new ConfigCodec(tmpDir);

    const initial = {
      defaultProvider: "anthropic",
      _internalFlag: true,
      legacyField: "old-value",
    };
    await codec.save("settings", initial);

    // Partial save — only update defaultProvider.
    await codec.save("settings", { defaultProvider: "openai" });

    const loaded = await codec.load("settings");
    expect(loaded["_internalFlag"]).toBe(true);
    expect(loaded["legacyField"]).toBe("old-value");
    expect(loaded["defaultProvider"]).toBe("openai");
  });

  it("written file has mode 0600", async () => {
    const codec = new ConfigCodec(tmpDir);
    await codec.save("settings", { theme: "light" });

    const stat = await fs.stat(join(tmpDir, "settings.json"));
    // On Linux/macOS, mode bits include type; mask with 0o777 for permissions only.
    const perm = stat.mode & 0o777;
    expect(perm).toBe(0o600);
  });

  it("creates directory if it does not exist", async () => {
    const nestedDir = join(tmpDir, "nested", "dir");
    const codec = new ConfigCodec(nestedDir);
    await codec.save("settings", { theme: "dark" });

    const stat = await fs.stat(join(nestedDir, "settings.json"));
    expect(stat.isFile()).toBe(true);
  });

  it("multiple saves accumulate correctly", async () => {
    const codec = new ConfigCodec(tmpDir);
    await codec.save("settings", { defaultProvider: "anthropic", theme: "light" });
    await codec.save("settings", { theme: "dark" });

    const loaded = await codec.load("settings");
    expect(loaded["defaultProvider"]).toBe("anthropic");
    expect(loaded["theme"]).toBe("dark");
  });
});
