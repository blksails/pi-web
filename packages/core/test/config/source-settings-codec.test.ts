/**
 * 单元:SourceSettingsCodec — per-source 双作用域读写(spec: source-settings-and-slots,
 * 任务 2.1;Req 2.1-2.5)。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FormSchema } from "@blksails/pi-web-protocol";
import { SourceSettingsCodec } from "../../src/config/source-settings-codec.js";
import { maskSecrets, mergeSecrets } from "../../src/config/secret-merge.js";
import { sourceKey } from "../../src/source-key.js";

let agentDir: string;
let projectDir: string;

const SK = sourceKey("registry://example/crm-agent");

beforeEach(async () => {
  const nonce = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  agentDir = join(tmpdir(), `source-settings-codec-agent-${nonce}`);
  projectDir = join(tmpdir(), `source-settings-codec-project-${nonce}`);
  await fs.mkdir(agentDir, { recursive: true });
  await fs.mkdir(projectDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(agentDir, { recursive: true, force: true });
  await fs.rm(projectDir, { recursive: true, force: true });
});

describe("SourceSettingsCodec", () => {
  describe("scope: source", () => {
    it("returns empty object when file does not exist (Req 2.4)", async () => {
      const codec = new SourceSettingsCodec(agentDir);
      const result = await codec.load("source", SK);
      expect(result).toEqual({});
    });

    it("roundtrip: save then load returns same data, at <agentDir>/sources/<sourceKey>/settings.json (Req 2.1)", async () => {
      const codec = new SourceSettingsCodec(agentDir);
      const data = { apiBase: "https://crm.example.com", label: "CRM" };
      await codec.save("source", SK, data);

      const loaded = await codec.load("source", SK);
      expect(loaded).toEqual(data);

      const onDisk = JSON.parse(
        await fs.readFile(join(agentDir, "sources", SK, "settings.json"), "utf8"),
      );
      expect(onDisk).toEqual(data);
    });

    it("directory has mode 0700 and file has mode 0600 (Req 2.1)", async () => {
      const codec = new SourceSettingsCodec(agentDir);
      await codec.save("source", SK, { label: "CRM" });

      const dirStat = await fs.stat(join(agentDir, "sources", SK));
      expect(dirStat.mode & 0o777).toBe(0o700);

      const fileStat = await fs.stat(join(agentDir, "sources", SK, "settings.json"));
      expect(fileStat.mode & 0o777).toBe(0o600);
    });

    it("is per-source: two different sourceKeys never share a file", async () => {
      const codec = new SourceSettingsCodec(agentDir);
      const otherKey = sourceKey("registry://example/other-agent");

      await codec.save("source", SK, { label: "CRM" });
      await codec.save("source", otherKey, { label: "Other" });

      expect(await codec.load("source", SK)).toEqual({ label: "CRM" });
      expect(await codec.load("source", otherKey)).toEqual({ label: "Other" });
    });

    it("partial save deep-merges onto existing disk content (matches config-codec range)", async () => {
      const codec = new SourceSettingsCodec(agentDir);
      await codec.save("source", SK, { apiBase: "https://a", label: "CRM" });
      await codec.save("source", SK, { label: "CRM v2" });

      const loaded = await codec.load("source", SK);
      expect(loaded).toEqual({ apiBase: "https://a", label: "CRM v2" });
    });

    it("损坏 JSON → load 返回 {}(不抛;M4 迁移守卫,Req 4.3)", async () => {
      const codec = new SourceSettingsCodec(agentDir);
      const dir = join(agentDir, "sources", SK);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(join(dir, "settings.json"), "{ not valid json", "utf8");
      // 变异判据:删掉 load 的 corrupt catch(裸 return readJson)→ 抛 WorkspaceCorruptError,此处转红。
      await expect(codec.load("source", SK)).resolves.toEqual({});
    });
  });

  describe("scope: project", () => {
    it("returns empty object when file does not exist (Req 2.4)", async () => {
      const codec = new SourceSettingsCodec(agentDir);
      const result = await codec.load("project", SK, projectDir);
      expect(result).toEqual({});
    });

    it("roundtrip: save then load returns same data, at <cwd>/.pi/source-settings/<sourceKey>.json, independent of .pi/settings.json (Req 2.2)", async () => {
      const codec = new SourceSettingsCodec(agentDir);
      const data = { branch: "main" };
      await codec.save("project", SK, data, { cwd: projectDir });

      const loaded = await codec.load("project", SK, projectDir);
      expect(loaded).toEqual(data);

      const onDisk = JSON.parse(
        await fs.readFile(join(projectDir, ".pi", "source-settings", `${SK}.json`), "utf8"),
      );
      expect(onDisk).toEqual(data);

      // Must not touch/create the shared .pi/settings.json file.
      await expect(fs.access(join(projectDir, ".pi", "settings.json"))).rejects.toThrow();
    });

    it("directory has mode 0700 and file has mode 0600 (Req 2.2)", async () => {
      const codec = new SourceSettingsCodec(agentDir);
      await codec.save("project", SK, { branch: "main" }, { cwd: projectDir });

      const dirStat = await fs.stat(join(projectDir, ".pi", "source-settings"));
      expect(dirStat.mode & 0o777).toBe(0o700);

      const fileStat = await fs.stat(join(projectDir, ".pi", "source-settings", `${SK}.json`));
      expect(fileStat.mode & 0o777).toBe(0o600);
    });

    it("is per-cwd: same sourceKey under different cwds does not collide", async () => {
      const otherProjectDir = join(tmpdir(), `source-settings-codec-project2-${Date.now()}`);
      await fs.mkdir(otherProjectDir, { recursive: true });
      try {
        const codec = new SourceSettingsCodec(agentDir);
        await codec.save("project", SK, { branch: "main" }, { cwd: projectDir });
        await codec.save("project", SK, { branch: "dev" }, { cwd: otherProjectDir });

        expect(await codec.load("project", SK, projectDir)).toEqual({ branch: "main" });
        expect(await codec.load("project", SK, otherProjectDir)).toEqual({ branch: "dev" });
      } finally {
        await fs.rm(otherProjectDir, { recursive: true, force: true });
      }
    });

    it("损坏 JSON → load 返回 {}(不抛;M4 迁移守卫,Req 4.3)", async () => {
      const codec = new SourceSettingsCodec(agentDir);
      const dir = join(projectDir, ".pi", "source-settings");
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(join(dir, `${SK}.json`), "%%corrupt%%", "utf8");
      // 变异判据:同上,project 作用域路径。
      await expect(codec.load("project", SK, projectDir)).resolves.toEqual({});
    });

    it("throws when scope:\"project\" is used without a cwd", async () => {
      const codec = new SourceSettingsCodec(agentDir);
      await expect(codec.load("project", SK)).rejects.toThrow(TypeError);
      await expect(codec.save("project", SK, {})).rejects.toThrow(TypeError);
    });

    it("scope:\"source\" and scope:\"project\" for the same sourceKey never collide", async () => {
      const codec = new SourceSettingsCodec(agentDir);
      await codec.save("source", SK, { label: "source-scope" });
      await codec.save("project", SK, { label: "project-scope" }, { cwd: projectDir });

      expect(await codec.load("source", SK)).toEqual({ label: "source-scope" });
      expect(await codec.load("project", SK, projectDir)).toEqual({ label: "project-scope" });
    });
  });

  describe("sourceKey shape guard (Req 2.5 — never splice raw source strings into paths)", () => {
    it("rejects a sourceKey that is not the 16-hex shape produced by sourceKey()", async () => {
      const codec = new SourceSettingsCodec(agentDir);
      const malicious = "../../etc/passwd";

      await expect(codec.load("source", malicious)).rejects.toThrow(TypeError);
      await expect(codec.save("source", malicious, { x: 1 })).rejects.toThrow(TypeError);
      await expect(codec.load("project", malicious, projectDir)).rejects.toThrow(TypeError);
    });

    it("rejects an empty or non-hex sourceKey", async () => {
      const codec = new SourceSettingsCodec(agentDir);
      await expect(codec.load("source", "")).rejects.toThrow(TypeError);
      await expect(codec.load("source", "not-a-hex-key")).rejects.toThrow(TypeError);
      await expect(codec.load("source", `${SK}extra`)).rejects.toThrow(TypeError);
    });

    it("accepts exactly the shape produced by sourceKey() and never touches the filesystem outside <agentDir>/sources", async () => {
      const codec = new SourceSettingsCodec(agentDir);
      await codec.save("source", SK, { ok: true });
      const entries = await fs.readdir(join(agentDir, "sources"));
      expect(entries).toEqual([SK]);
    });
  });

  describe("secret handling (Req 2.3 — plaintext never round-trips to the browser)", () => {
    const schema: FormSchema = {
      domain: "source",
      fields: [
        { key: "apiKey", kind: "secret", label: "API Key", required: false },
        { key: "label", kind: "string", label: "Label", required: false },
      ],
    };

    it("save() persists only resolved plaintext values, never raw SecretWrite/SecretMask action shells", async () => {
      // The caller (task 2.2 route layer) is responsible for resolving a SecretWrite
      // into plaintext via mergeSecrets() *before* calling save(); the codec itself is
      // domain-agnostic and must never be handed a raw protocol action shell to persist.
      const codec = new SourceSettingsCodec(agentDir);
      const incoming = { apiKey: { __secret: true, action: "set", value: "sk-real-secret" }, label: "CRM" };

      const resolved = mergeSecrets("settings", incoming, {}, schema);
      await codec.save("source", SK, resolved);

      const onDisk = JSON.parse(
        await fs.readFile(join(agentDir, "sources", SK, "settings.json"), "utf8"),
      );
      // Plaintext lands on disk (0600-protected, same as existing auth.json precedent) —
      // but never as the __secret action shell itself.
      expect(onDisk).toEqual({ apiKey: "sk-real-secret", label: "CRM" });
      expect(onDisk.apiKey).not.toHaveProperty("__secret");
    });

    it("values read back through maskSecrets() never expose the plaintext secret to the browser", async () => {
      const codec = new SourceSettingsCodec(agentDir);
      await codec.save("source", SK, { apiKey: "sk-real-secret", label: "CRM" });

      const raw = await codec.load("source", SK);
      const masked = maskSecrets("settings", raw, schema);

      expect(masked["apiKey"]).toMatchObject({ __secret: true, set: true });
      expect(JSON.stringify(masked)).not.toContain("sk-real-secret");
      // Non-secret fields still pass through untouched.
      expect(masked["label"]).toBe("CRM");
    });

    it("a \"keep\" write leaves the on-disk secret unchanged and never receives the old plaintext from the client", async () => {
      const codec = new SourceSettingsCodec(agentDir);
      await codec.save("source", SK, { apiKey: "sk-original", label: "CRM" });

      const disk = await codec.load("source", SK);
      const resolved = mergeSecrets(
        "settings",
        { apiKey: { __secret: true, action: "keep" }, label: "CRM v2" },
        disk,
        schema,
      );
      await codec.save("source", SK, resolved, { merge: false });

      expect(await codec.load("source", SK)).toEqual({ apiKey: "sk-original", label: "CRM v2" });
    });

    it("a \"clear\" write removes the secret key from disk entirely (no plaintext, no placeholder)", async () => {
      const codec = new SourceSettingsCodec(agentDir);
      await codec.save("source", SK, { apiKey: "sk-original", label: "CRM" });

      const disk = await codec.load("source", SK);
      const resolved = mergeSecrets(
        "settings",
        { apiKey: { __secret: true, action: "clear" } },
        disk,
        schema,
      );
      await codec.save("source", SK, resolved, { merge: false });

      const loaded = await codec.load("source", SK);
      expect(loaded).not.toHaveProperty("apiKey");
    });
  });
});
