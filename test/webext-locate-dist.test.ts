/**
 * locate-dist — 定位/安全读取（webext-package-install 任务 2.3）。
 */
import { describe, it, expect } from "vitest";
import path from "node:path";
import {
  locateDist,
  readManifestJson,
  toBaseUrl,
  decodeDistDir,
  readDistFile,
} from "../lib/app/webext/locate-dist.js";

const FIXTURE = "./examples/webext-runtime-declarative-agent";

describe("locateDist / readManifestJson", () => {
  it("定位本地源 .pi/web/dist 并读出声明式 manifest", async () => {
    const dist = await locateDist(FIXTURE);
    expect(dist).toBeDefined();
    expect(dist?.endsWith(path.join(".pi", "web", "dist"))).toBe(true);
    const m = (await readManifestJson(dist as string)) as { id?: string; entry?: string };
    expect(m.id).toBe("webext-runtime-declarative");
    expect(m.entry).toBeUndefined(); // 纯声明
  });

  it("不存在的源 → undefined", async () => {
    expect(await locateDist("./examples/does-not-exist-xyz")).toBeUndefined();
  });
});

describe("toBaseUrl / decodeDistDir", () => {
  it("往返一致", () => {
    const dir = "/abs/pkg/.pi/web/dist";
    const url = toBaseUrl(dir);
    expect(url.startsWith("/api/webext/dist/")).toBe(true);
    const seg = url.slice("/api/webext/dist/".length, -1);
    expect(decodeDistDir(seg)).toBe(dir);
  });
});

describe("readDistFile — 安全", () => {
  it("读 dist 内文件成功，带正确 content-type", async () => {
    const dist = (await locateDist(FIXTURE)) as string;
    const f = await readDistFile(dist, "manifest.json");
    expect(f).toBeDefined();
    expect(f?.contentType).toContain("application/json");
  });

  it("目录穿越被拒（../ 越出 dist）", async () => {
    const dist = (await locateDist(FIXTURE)) as string;
    expect(await readDistFile(dist, "../../../index.ts")).toBeUndefined();
    expect(await readDistFile(dist, "../../../../../../etc/passwd")).toBeUndefined();
  });

  it("非 .pi/web/dist 目录被拒", async () => {
    expect(await readDistFile("/tmp", "manifest.json")).toBeUndefined();
  });
});
