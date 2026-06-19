import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { FsProjectTrustStore, getAgentDir } from "../../src/trust/trust-store.js";

/**
 * trust-store 与 pi CLI 的磁盘格式互通(任务 #18)。
 * 关键不变量:文件 = `<agentDir>/trust.json`,`{ [realpath(resolve(dir))]: true|false|null }`,
 * key 排序 + 2 空格 + 末尾换行;get 沿目录树向上找最近祖先。
 */
describe("FsProjectTrustStore (pi-format interop)", () => {
  let agentDir: string;
  let root: string;

  beforeEach(() => {
    agentDir = mkdtempSync(join(tmpdir(), "pi-web-ts-agent-"));
    root = mkdtempSync(join(tmpdir(), "pi-web-ts-proj-"));
  });
  afterEach(() => {
    rmSync(agentDir, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  });

  /** 实存目录的规范 key(与 store 内部一致)。 */
  const keyOf = (dir: string): string => realpathSync(resolve(dir));

  it("写出字节与 pi 格式一致(排序 key + 2 空格 + 末尾换行)", () => {
    const a = join(root, "a");
    const b = join(root, "b");
    mkdirSync(a);
    mkdirSync(b);
    const store = new FsProjectTrustStore(agentDir);
    store.set(b, true); // 先写 b
    store.set(a, false); // 再写 a → 文件中应排序 a 在前

    const raw = readFileSync(join(agentDir, "trust.json"), "utf-8");
    expect(raw.endsWith("\n")).toBe(true);
    const expected =
      `${JSON.stringify({ [keyOf(a)]: false, [keyOf(b)]: true }, null, 2)}\n`;
    // keyOf(a) < keyOf(b) 字典序(同一 root 下 a<b)
    expect(raw).toBe(expected);
  });

  it("读 pi CLI 写的 trust.json(手工构造)", () => {
    const proj = join(root, "proj");
    mkdirSync(proj);
    // 模拟 pi CLI 写入
    writeFileSync(
      join(agentDir, "trust.json"),
      `${JSON.stringify({ [keyOf(proj)]: true }, null, 2)}\n`,
      "utf-8",
    );
    const store = new FsProjectTrustStore(agentDir);
    expect(store.get(proj)).toBe(true);
  });

  it("分层:祖先 true 覆盖子目录;无关目录为 null", () => {
    const parent = join(root, "parent");
    const child = join(parent, "sub", "deep");
    mkdirSync(child, { recursive: true });
    const store = new FsProjectTrustStore(agentDir);
    store.set(parent, true);
    expect(store.get(child)).toBe(true); // 沿树向上命中 parent
    const other = join(root, "other");
    mkdirSync(other);
    expect(store.get(other)).toBe(null);
  });

  it("set false 显式拒绝;set null 删除该条目", () => {
    const proj = join(root, "p");
    mkdirSync(proj);
    const store = new FsProjectTrustStore(agentDir);
    store.set(proj, false);
    expect(store.get(proj)).toBe(false);
    store.set(proj, null);
    expect(store.get(proj)).toBe(null);
    // 文件中该 key 已删除
    const data = JSON.parse(readFileSync(join(agentDir, "trust.json"), "utf-8"));
    expect(keyOf(proj) in data).toBe(false);
  });

  it("缺失文件 → get 返回 null(不抛)", () => {
    const store = new FsProjectTrustStore(agentDir);
    expect(store.get(join(root, "nope"))).toBe(null);
  });

  it("非法值 → 读时抛(与 pi 校验一致)", () => {
    writeFileSync(join(agentDir, "trust.json"), `{"/x":"yes"}`, "utf-8");
    const store = new FsProjectTrustStore(agentDir);
    expect(() => store.get("/x")).toThrow(/must be true, false, or null/);
  });
});

describe("getAgentDir", () => {
  const ORIG = process.env.PI_CODING_AGENT_DIR;
  beforeEach(() => {
    delete process.env.PI_CODING_AGENT_DIR;
  });
  afterEach(() => {
    if (ORIG === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = ORIG;
  });

  it("尊重 PI_CODING_AGENT_DIR(展开 ~)", () => {
    process.env.PI_CODING_AGENT_DIR = "/custom/agent";
    expect(getAgentDir()).toBe("/custom/agent");
  });

  it("缺省 → ~/.pi/agent", () => {
    const dir = getAgentDir();
    expect(dir.endsWith(join(".pi", "agent"))).toBe(true);
  });
});
