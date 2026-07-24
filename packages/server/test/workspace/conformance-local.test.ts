import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createLocalWorkspace } from "../../src/workspace/local-workspace.js";
import {
  runWorkspaceConformance,
  type ConformanceFactory,
  type ConformanceTarget,
  type ConformanceTargetOptions,
} from "../../src/workspace/testing/index.js";

/**
 * host-contract-ports 任务 4.4 —— 以**参照实现** `LocalWorkspace` 驱动完整一致性套件
 * (Req 8.5:「对内建的本地实现执行该套件 → 全部用例通过」)。
 *
 * 这是本 spec 的收口:套件(任务 3.x)照契约写、`LocalWorkspace`(任务 4.x)照契约实现,
 * 二者此前从未对接。契约冲突必须暴露在这里,而不是等到 pi-clouds 联调。
 *
 * ⚠ 工厂每次调用产出**独立临时根**(契约 §3.8):用例间不串数据。上限一律经工厂参数
 * 指定,**绝不改写 `process.env`**(Req 8.6)。`env: {}` 使被测实例与宿主进程环境完全
 * 解耦——否则本机若设了 `PI_WEB_WORKSPACE_MAX_VALUE_BYTES`,套件会随环境飘。
 */

/**
 * 探测临时根所在载体是否**大小写敏感**(契约 §3.2 第 4 条 / 勘误⑦)。
 *
 * 必须**运行时**探测而非写死:同一份 `LocalWorkspace` 代码在 Linux ext4 上大小写敏感、
 * 在 macOS APFS(默认)与 Windows NTFS(默认)上不敏感。写死任一值都会让套件在半数
 * 开发机上红,而那不是实现的缺陷。
 */
async function probeCaseSensitiveKeys(base: string): Promise<boolean> {
  const probe = join(base, "case-probe");
  await fs.writeFile(probe, "");
  try {
    await fs.stat(join(base, "CASE-PROBE"));
    return false; // 另一种大小写也能 stat 到 ⇒ 物理同一个文件 ⇒ 载体不敏感
  } catch {
    return true;
  } finally {
    await fs.rm(probe, { force: true });
  }
}

interface LocalTargetHandle {
  readonly target: ConformanceTarget;
  /** 本目标独占的临时根(两根之父),仅供工厂自身的义务用例断言。 */
  readonly base: string;
}

async function createLocalTargetHandle(
  opts?: ConformanceTargetOptions,
): Promise<LocalTargetHandle> {
  const base = await fs.mkdtemp(join(tmpdir(), "pi-web-ws-conformance-"));
  const roots = { user: join(base, "user"), project: join(base, "project") } as const;
  const caseSensitiveKeys = await probeCaseSensitiveKeys(base);

  const open = (o?: ConformanceTargetOptions) =>
    createLocalWorkspace({
      userRoot: roots.user,
      projectRoot: roots.project,
      maxValueBytes: o?.maxValueBytes,
      env: {},
      cwd: base,
    });

  return {
    base,
    target: {
      workspace: open(opts),
      caseSensitiveKeys,
      async corrupt(namespace, key) {
        // 端口之下的破坏:直接把落盘文件写成非法 JSON(经 API 构造不出来)。
        const path = join(roots[namespace], ...key.split("/"));
        await fs.mkdir(join(path, ".."), { recursive: true });
        await fs.writeFile(path, "{ not json at all", "utf8");
      },
      async reopen(next) {
        // ★ 同一对临时根 ⇒ 同一份既有数据,只换选项。
        return open(next);
      },
      async cleanup() {
        await fs.rm(base, { recursive: true, force: true });
      },
    },
  };
}

const createLocalTarget: ConformanceFactory = async (opts) =>
  (await createLocalTargetHandle(opts)).target;

runWorkspaceConformance({ describe, it }, "LocalWorkspace(参照实现)", createLocalTarget);

describe("一致性工厂本身的义务(契约 §3.8)", () => {
  it("★ 每次调用产出**独立临时根**的隔离目标 —— 用例间不串数据", async () => {
    // 若工厂复用同一个根,上面那整套用例会**互相污染**:症状是随机的、依赖执行顺序的
    // 偶发红,而不是一个能指向根因的失败。故这条义务直接断言,不靠套件间接覆盖。
    const a = await createLocalTargetHandle();
    const b = await createLocalTargetHandle();
    try {
      expect(a.base).not.toBe(b.base);
      await a.target.workspace.user.writeJson("iso.json", { from: "a" }, { merge: false });
      expect(await b.target.workspace.user.readJson("iso.json")).toEqual({});
      expect(await b.target.workspace.user.exists("iso.json")).toBe(false);
      // project 根同样不串。
      await b.target.workspace.project.writeJson(
        "iso.json",
        { from: "b" },
        { merge: false },
      );
      expect(await a.target.workspace.project.readJson("iso.json")).toEqual({});
    } finally {
      await a.target.cleanup();
      await b.target.cleanup();
    }
  });

  it("★ `reopen` 换选项后仍看到**同一份数据** —— 否则上限第③例会退化成弱断言", async () => {
    // 契约 §3.8 对 `reopen` 的必填理由:工厂产出隔离实例,「同一份数据、不同配置」只能
    // 由它表达。若这里错写成「再 mkdtemp 一个新根」,上限第③例会变成两个互不相干的
    // 弱断言而依旧全绿 —— 那正是 3.3 复核驳回过的形态。
    const { target } = await createLocalTargetHandle({ maxValueBytes: 64 * 1024 });
    try {
      await target.workspace.user.writeJson("kept.json", { v: 1 }, { merge: false });
      const again = await target.reopen({ maxValueBytes: 1024 });
      expect(await again.user.readJson("kept.json")).toEqual({ v: 1 });
    } finally {
      await target.cleanup();
    }
  });

  it("`cleanup` 之后临时根不复存在 —— 反复取实例不堆积垃圾", async () => {
    const { target, base } = await createLocalTargetHandle();
    await target.workspace.user.writeJson("x.json", { a: 1 });
    await target.cleanup();
    await expect(fs.stat(base)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("工厂接受上限参数,且该上限确实生效(Req 8.6:不改写进程环境)", async () => {
    const { target } = await createLocalTargetHandle({ maxValueBytes: 256 });
    try {
      await expect(
        target.workspace.user.writeJson("big.json", { blob: "x".repeat(512) }),
      ).rejects.toMatchObject({ code: "limit" });
      // 同一实例上小值照常写入 —— 证明拒绝来自上限而非别的故障。
      await target.workspace.user.writeJson("small.json", { ok: true });
      expect(await target.workspace.user.readJson("small.json")).toEqual({ ok: true });
    } finally {
      await target.cleanup();
    }
  });
});
