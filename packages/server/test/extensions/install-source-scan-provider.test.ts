/**
 * ScanInstallSourceProvider 单测(spec agent-plugin-commands,任务 1.2)。
 *
 * 迁移验收:标志文件判定、深度与条数上限、噪声目录跳过、realpath 越界防护四项行为必须与
 * 迁移前逐条一致 —— 这些断言就是「迁移未走样」的判据。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs, mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createScanInstallSourceProvider,
  createScanPublishSourceProvider,
} from "../../src/extensions/install-sources/scan-provider.js";

let cwd: string;

beforeEach(async () => {
  cwd = await fs.mkdtemp(join(tmpdir(), "scan-src-"));
});

afterEach(async () => {
  await fs.rm(cwd, { recursive: true, force: true });
});

async function mkdirWith(rel: string, marker?: string): Promise<string> {
  const dir = join(cwd, rel);
  await fs.mkdir(dir, { recursive: true });
  if (marker !== undefined) await fs.writeFile(join(dir, marker), "");
  return dir;
}

function paths(items: readonly { path: string }[]): string[] {
  return items.map((i) => i.path).sort();
}

describe("createScanInstallSourceProvider", () => {
  it("四种标志文件任一命中即入选,无标志的目录不入选", async () => {
    await mkdirWith("a-ts", "index.ts");
    await mkdirWith("b-js", "index.js");
    await mkdirWith("c-pkg", "package.json");
    await mkdirWith("d-pi", ".pi");
    await mkdirWith("plain", "notes.txt");
    const items = await createScanInstallSourceProvider().list({ cwd, query: "" });
    expect(paths(items)).toEqual(["./a-ts", "./b-js", "./c-pkg", "./d-pi"]);
  });

  it("insertText 为 local: 前缀的相对路径", async () => {
    await mkdirWith("agent-a", "index.ts");
    const items = await createScanInstallSourceProvider().list({ cwd, query: "" });
    expect(items[0]?.insertText).toBe("local:./agent-a");
  });

  it("跳过噪声目录与点开头目录", async () => {
    await mkdirWith("node_modules/x", "index.js");
    await mkdirWith("dist", "package.json");
    await mkdirWith(".hidden", "index.ts");
    await mkdirWith("keep", "index.ts");
    const items = await createScanInstallSourceProvider().list({ cwd, query: "" });
    expect(paths(items)).toEqual(["./keep"]);
  });

  it("超过深度上限的目录不入选", async () => {
    await mkdirWith("l1/l2/l3", "index.ts");
    // 默认深度 2:l1/l2 可达,l1/l2/l3 超限。
    await mkdirWith("l1/l2", "index.ts");
    const deep = await createScanInstallSourceProvider().list({ cwd, query: "" });
    expect(paths(deep)).toEqual(["./l1/l2"]);
    // 放宽深度后第三层可见。
    const wider = await createScanInstallSourceProvider({ maxDepth: 3 }).list({
      cwd,
      query: "",
    });
    expect(paths(wider)).toEqual(["./l1/l2", "./l1/l2/l3"]);
  });

  it("条数上限截断结果", async () => {
    await mkdirWith("s1", "index.ts");
    await mkdirWith("s2", "index.ts");
    await mkdirWith("s3", "index.ts");
    const items = await createScanInstallSourceProvider({ maxItems: 2 }).list({
      cwd,
      query: "",
    });
    expect(items).toHaveLength(2);
  });

  it("符号链接指向基准目录之外时不入选(越界防护)", async () => {
    const outside = await fs.mkdtemp(join(tmpdir(), "scan-out-"));
    await fs.writeFile(join(outside, "index.ts"), "");
    await fs.symlink(outside, join(cwd, "linked"));
    await mkdirWith("inside", "index.ts");
    const items = await createScanInstallSourceProvider().list({ cwd, query: "" });
    expect(paths(items)).toEqual(["./inside"]);
    await fs.rm(outside, { recursive: true, force: true });
  });

  it("query 按子串过滤(大小写不敏感)", async () => {
    await mkdirWith("agent-alpha", "index.ts");
    await mkdirWith("pkg-beta", "index.ts");
    const items = await createScanInstallSourceProvider().list({
      cwd,
      query: "BETA",
    });
    expect(paths(items)).toEqual(["./pkg-beta"]);
  });

  it("基准目录不存在 → 空数组,不抛", async () => {
    const items = await createScanInstallSourceProvider().list({
      cwd: join(cwd, "nope"),
      query: "",
    });
    expect(items).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// publish 候选枚举(spec publish-host-command,任务 3.1/3.4)
// ---------------------------------------------------------------------------

describe("createScanPublishSourceProvider", () => {
  it("只产出**含发布清单**的目录,且 insertText 是目录路径本身(无 local: 前缀)", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-pubscan-"));
    // a:含发布清单 → 应命中;b:只有安装判据(package.json)→ **不应**命中。
    mkdirSync(join(root, "a"), { recursive: true });
    writeFileSync(join(root, "a", "pi-web.json"), '{"kind":"agent"}');
    mkdirSync(join(root, "b"), { recursive: true });
    writeFileSync(join(root, "b", "package.json"), "{}");

    const got = await createScanPublishSourceProvider().list({ cwd: root, query: "" });

    expect(got.map((r) => r.path)).toEqual(["./a"]);
    // publish 接受目录本身;带 `local:` 前缀会让选中的候选直接解析失败。
    expect(got[0]?.insertText).toBe("./a");
    rmSync(root, { recursive: true, force: true });
  });

  it("安装 provider 对同一目录树的行为**逐条不变**(参数化不得改既有默认)", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-pubscan-"));
    mkdirSync(join(root, "a"), { recursive: true });
    writeFileSync(join(root, "a", "pi-web.json"), '{"kind":"agent"}');
    mkdirSync(join(root, "b"), { recursive: true });
    writeFileSync(join(root, "b", "package.json"), "{}");

    const got = await createScanInstallSourceProvider().list({ cwd: root, query: "" });

    // b 有 package.json → 命中;a 有 .pi? 没有,但 pi-web.json 不是安装判据 → a 不命中。
    expect(got.map((r) => r.path)).toEqual(["./b"]);
    expect(got[0]?.insertText).toBe("local:./b");
    rmSync(root, { recursive: true, force: true });
  });

  it("越界防护仍生效:指向基准外的符号链接不进候选(安全边界,不是便利检查)", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-pubscan-"));
    const outside = mkdtempSync(join(tmpdir(), "pi-pubout-"));
    writeFileSync(join(outside, "pi-web.json"), '{"kind":"agent"}');
    symlinkSync(outside, join(root, "escape"), "dir");

    const got = await createScanPublishSourceProvider().list({ cwd: root, query: "" });

    expect(got).toEqual([]);
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });
});
