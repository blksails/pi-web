/**
 * system-resource-args 单测 —— `loadSystemResources` 开关 → 注入 agent 的 argv。
 * 默认载入(空数组);仅显式 false 才 `--no-skills --no-extensions`;项目覆盖全局。
 */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { systemResourceArgs } from "@/lib/app/system-resource-args";

const OFF = ["--no-skills", "--no-extensions"];

let agentDir: string;
let cwd: string;

async function writeSettings(dir: string, obj: unknown): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "settings.json"), JSON.stringify(obj), "utf8");
}

beforeEach(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "piweb-sysres-"));
  agentDir = path.join(root, "agent");
  cwd = path.join(root, "work");
  await fs.mkdir(agentDir, { recursive: true });
  await fs.mkdir(cwd, { recursive: true });
});

afterEach(async () => {
  await fs.rm(path.dirname(agentDir), { recursive: true, force: true });
});

describe("systemResourceArgs", () => {
  it("两处 settings 都缺省 → 默认载入([])", async () => {
    expect(await systemResourceArgs(agentDir, cwd)).toEqual([]);
  });

  it("全局 false → 注入 --no-skills/--no-extensions", async () => {
    await writeSettings(agentDir, { loadSystemResources: false });
    expect(await systemResourceArgs(agentDir, cwd)).toEqual(OFF);
  });

  it("全局 true(显式)→ 载入([])", async () => {
    await writeSettings(agentDir, { loadSystemResources: true });
    expect(await systemResourceArgs(agentDir, cwd)).toEqual([]);
  });

  it("项目 false 覆盖全局缺省 → 关闭", async () => {
    await writeSettings(path.join(cwd, ".pi"), { loadSystemResources: false });
    expect(await systemResourceArgs(agentDir, cwd)).toEqual(OFF);
  });

  it("项目 true 覆盖全局 false → 载入([])", async () => {
    await writeSettings(agentDir, { loadSystemResources: false });
    await writeSettings(path.join(cwd, ".pi"), { loadSystemResources: true });
    expect(await systemResourceArgs(agentDir, cwd)).toEqual([]);
  });

  it("项目缺省该键 → 回退全局 false", async () => {
    await writeSettings(agentDir, { loadSystemResources: false });
    await writeSettings(path.join(cwd, ".pi"), { other: 1 });
    expect(await systemResourceArgs(agentDir, cwd)).toEqual(OFF);
  });

  it("settings.json 损坏 → 按默认载入处理(不抛)", async () => {
    await fs.mkdir(agentDir, { recursive: true });
    await fs.writeFile(path.join(agentDir, "settings.json"), "{ not json", "utf8");
    expect(await systemResourceArgs(agentDir, cwd)).toEqual([]);
  });
});
