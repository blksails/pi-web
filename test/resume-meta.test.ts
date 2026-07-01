/**
 * resume-meta 单测 —— 冷恢复标题回填(方案A):`makeResumeMetaLoader` 除 cwd/model 外,
 * 还带回会话显示名(最新 session_info 名,经 fs 后端 displayName 派生;无则回退 header.name)。
 * 每个用例用独立临时 sessions 根(fs 后端),互不干扰。
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FsSessionEntryStore } from "@blksails/pi-web-server";
import { makeResumeMetaLoader } from "@/lib/app/resume-meta";

let root: string | undefined;
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});

const CWD = "/proj";
const header = (id: string) => ({
  type: "session" as const,
  id,
  version: 1 as const,
  cwd: CWD,
  timestamp: "2026-06-01T00:00:00.000Z",
});
const sessionInfo = (id: string, parentId: string | null, name: string) =>
  ({
    type: "session_info",
    id,
    parentId,
    timestamp: "2026-06-01T00:00:02.000Z",
    name,
  }) as never;

describe("makeResumeMetaLoader — name backfill (方案A)", () => {
  it("returns the latest session_info name as ResumeMeta.name", async () => {
    root = await mkdtemp(join(tmpdir(), "pi-resume-meta-"));
    const store = new FsSessionEntryStore(root);
    await store.create(header("s1"));
    await store.append("s1", sessionInfo("i1", null, "第一个标题"));
    await store.append("s1", sessionInfo("i2", "i1", "最新标题"));

    const load = makeResumeMetaLoader({ kind: "fs", root });
    const meta = await load("s1");
    expect(meta).toBeDefined();
    expect(meta?.cwd).toBe(CWD);
    expect(meta?.name).toBe("最新标题");
  });

  it("omits name when there is no session_info and header has none", async () => {
    root = await mkdtemp(join(tmpdir(), "pi-resume-meta-"));
    const store = new FsSessionEntryStore(root);
    await store.create(header("s2"));

    const load = makeResumeMetaLoader({ kind: "fs", root });
    const meta = await load("s2");
    expect(meta).toBeDefined();
    expect(meta?.name).toBeUndefined();
  });

  it("returns undefined for a non-existent session", async () => {
    root = await mkdtemp(join(tmpdir(), "pi-resume-meta-"));
    const load = makeResumeMetaLoader({ kind: "fs", root });
    expect(await load("missing")).toBeUndefined();
  });
});
