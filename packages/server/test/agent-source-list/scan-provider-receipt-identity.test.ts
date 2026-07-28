/**
 * scan-provider 身份归一(desktop-online-source-runnable 任务 2.1)。
 *
 * ## 为什么需要归一
 *
 * 线上条目 `id` = sourceId(`registry-http-provider.ts`),装完后的扫描条目 `id` = 绝对路径,
 * 而 composite 按 `id` 去重(`composite-provider.ts`)—— 两者 id 不同则去重命不中,
 * **同一个 agent 必然在列表里出现两条**(Req 3.1)。
 *
 * 归一同时覆盖 `id` 与 `source`:只归一 `id` 的话,登录态提交 `sourceId@channel`、
 * 登出后提交绝对路径,标识不稳定(违反 Req 3.2)。
 *
 * `origin` 保持 `scan` —— 改成 registry 会触碰排序语义(Req 3.3 / 8.3)。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { realpathSync } from "node:fs";
import { createScanSourceProvider } from "../../src/agent-source-list/scan-provider.js";
import type { AgentSourceRecord } from "../../src/agent-source-list/types.js";

let root: string;
const created: string[] = [];

/** 造一个可被 probeEntry 认作 cli 模式的最小 agent 目录(仅目录即可)。 */
function makeAgentDir(name: string, receipt?: unknown): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  if (receipt !== undefined) {
    writeFileSync(join(dir, ".pi-web-registry.json"), JSON.stringify(receipt));
  }
  return realpathSync(dir);
}

async function list(): Promise<readonly AgentSourceRecord[]> {
  const provider = createScanSourceProvider({ roots: [root] });
  return provider.list();
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pi-scan-receipt-"));
  created.push(root);
});

afterEach(() => {
  for (const d of created.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("scan-provider — 已装线上源认领身份", () => {
  it("含合法回执 → id/source 归一,origin 仍为 scan(Req 3.1/3.2/3.3)", async () => {
    makeAgentDir("acme__canvas", { sourceId: "acme/canvas", channel: "stable" });

    const records = await list();
    expect(records).toHaveLength(1);
    const r = records[0]!;
    expect(r.id).toBe("acme/canvas");
    expect(r.source).toBe("acme/canvas@stable");
    expect(r.origin).toBe("scan");
  });

  it("channel 非 stable 时 source 反映该 channel", async () => {
    makeAgentDir("x", { sourceId: "a/b", channel: "beta" });
    const [r] = await list();
    expect(r?.source).toBe("a/b@beta");
  });

  describe("无回执目录:行为与归一引入前逐字段等价(Req 8.1 回归护栏)", () => {
    it("id 与 source 仍为真实绝对路径", async () => {
      const dir = makeAgentDir("plain-agent");
      const [r] = await list();
      expect(r?.id).toBe(dir);
      expect(r?.source).toBe(dir);
      expect(r?.origin).toBe("scan");
    });

    it("回执损坏 → 视为无回执(降级,不抛)", async () => {
      const dir = join(root, "broken");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, ".pi-web-registry.json"), "{ not json");
      const real = realpathSync(dir);

      const [r] = await list();
      expect(r?.id).toBe(real);
      expect(r?.source).toBe(real);
    });

    it("回执缺 sourceId → 视为无回执", async () => {
      const dir = makeAgentDir("nosid", { channel: "stable" });
      const [r] = await list();
      expect(r?.id).toBe(dir);
      expect(r?.source).toBe(dir);
    });
  });

  it("混合目录:各按自身回执状态归一,互不影响", async () => {
    makeAgentDir("installed", { sourceId: "acme/canvas", channel: "stable" });
    const plain = makeAgentDir("plain");

    const records = await list();
    expect(records).toHaveLength(2);
    const byId = new Map(records.map((r) => [r.id, r]));
    expect(byId.get("acme/canvas")?.source).toBe("acme/canvas@stable");
    expect(byId.get(plain)?.source).toBe(plain);
  });
});
