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

  // ── host-contract v1 M2:三处「收紧」的行为零变化守卫 ──
  // spec: host-contract-config-on-workspace。ConfigCodec 改建到 LocalWorkspace 之上后,
  // Workspace 对损坏 JSON 抛 corrupt、写入设上限、原子写;下列用例锁死 config 域的既有
  // 可观测行为不因这些收紧而改变。io 分区(必须 rethrow)见 config-codec.error-partition.test.ts。

  it("收紧①:磁盘为非法 JSON → load 返回 {}(静默降级,不抛)", async () => {
    await fs.writeFile(join(tmpDir, "auth.json"), "{ not valid json", "utf8");
    const codec = new ConfigCodec(tmpDir);
    // 变异判据:删掉 load 的 `code === "corrupt"` 降级分支 → 此处转红(readJson 抛 corrupt)。
    await expect(codec.load("auth")).resolves.toEqual({});
  });

  it("收紧①:磁盘为合法但非对象(数组 / 标量)→ load 返回 {}", async () => {
    await fs.writeFile(join(tmpDir, "settings.json"), JSON.stringify([1, 2, 3]), "utf8");
    const codec = new ConfigCodec(tmpDir);
    await expect(codec.load("settings")).resolves.toEqual({});

    await fs.writeFile(join(tmpDir, "sandbox.json"), JSON.stringify("scalar"), "utf8");
    await expect(codec.load("sandbox")).resolves.toEqual({});
  });

  it("收紧① + merge:损坏磁盘时 save(默认 merge)以 {} 为基底、不抛", async () => {
    await fs.writeFile(join(tmpDir, "auth.json"), "%%corrupt%%", "utf8");
    const codec = new ConfigCodec(tmpDir);
    // 变异判据:若底层改用 writeJson({merge:true})(对损坏磁盘二次 read 抛 corrupt)→ save
    // 抛错,此处转红。当前实现在本层以 load(→{}) 为合并基底,底层恒 merge:false。
    await expect(
      codec.save("auth", { anthropic: { apiKey: "sk-new" } }),
    ).resolves.toBeUndefined();
    const loaded = await codec.load("auth");
    expect(loaded).toEqual({ anthropic: { apiKey: "sk-new" } });
  });

  it("落盘字节守卫:save 写出 JSON.stringify(x, null, 2) 且无尾换行", async () => {
    const codec = new ConfigCodec(tmpDir);
    const data = { defaultProvider: "anthropic", nested: { a: 1 } };
    await codec.save("settings", data);
    const raw = await fs.readFile(join(tmpDir, "settings.json"), "utf8");
    // 变异判据:落盘格式漂移(缩进变化 / 追加尾换行)→ 转红。逐字节复刻既有 ConfigCodec。
    expect(raw).toBe(JSON.stringify(data, null, 2));
    expect(raw.endsWith("\n")).toBe(false);
  });
});
