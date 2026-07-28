/**
 * locate-dist — 定位/安全读取（webext-package-install 任务 2.3）。
 *
 * ★ 夹具由本文件**自建于临时目录**，不依赖 `examples/` 下任何产物。
 *
 * 此前用的是 `examples/webext-runtime-declarative-agent/.pi/web/dist`，而那个目录:
 *  - **不在 git 里**（该 example 只跟踪 index.ts 与 package.json）；
 *  - **不由 `build:webext-examples` 构建**（声明式示例无需构建）；
 *  - 只由**浏览器 e2e 的 globalSetup**（`e2e/webext-fixtures.setup.ts`）顺手写出。
 *
 * 也就是说这三条断言一直靠「本地跑过一次 e2e 留下的残留物」才绿，
 * 全新检出（CI）上必然失败。与 desktop-release 工作流那个
 * 「webext 产物没人构建」的缺陷是同一类：**单测依赖了它并不拥有的副产物**。
 *
 * 自建夹具同时让断言更强：manifest 内容就在眼前，不必去猜 e2e setup 写了什么。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  locateDist,
  readManifestJson,
  toBaseUrl,
  decodeDistDir,
  readDistFile,
} from "../lib/app/webext/locate-dist.js";

/** 纯声明式 manifest：无 entry、无签名（与运行时声明夹具同形）。 */
const MANIFEST = {
  id: "webext-runtime-declarative",
  name: "Runtime Declarative",
  version: "0.0.0",
  capabilities: ["slots"],
} as const;

let root: string;
let FIXTURE: string;

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), "pi-web-locate-dist-"));
  FIXTURE = path.join(root, "declarative-agent");
  const dist = path.join(FIXTURE, ".pi", "web", "dist");
  mkdirSync(dist, { recursive: true });
  writeFileSync(path.join(dist, "manifest.json"), JSON.stringify(MANIFEST, null, 2), "utf8");
  // 供「目录穿越被拒」用：dist 之外放一个真实存在的文件，
  // 否则那条断言可能因为「目标本就不存在」而假绿。
  writeFileSync(path.join(FIXTURE, "secret.txt"), "must-not-be-readable", "utf8");
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

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
    expect(await locateDist(path.join(root, "does-not-exist-xyz"))).toBeUndefined();
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
    // ★ 目标文件**确实存在**（beforeAll 写的 secret.txt），故这条测的是「被拒」，
    //   而不是「文件本来就没有」——后者会让断言假绿。
    expect(await readDistFile(dist, "../../../secret.txt")).toBeUndefined();
    expect(await readDistFile(dist, "../../../../../../etc/passwd")).toBeUndefined();
  });

  it("非 .pi/web/dist 目录被拒", async () => {
    expect(await readDistFile("/tmp", "manifest.json")).toBeUndefined();
  });
});
