import { describe, expect, it } from "vitest";
import {
  runWorkspaceConformance,
  type ConformanceFactory,
  type SuiteRunner,
} from "../../src/workspace/testing/index.js";
import {
  createLaxMemoryWorkspace,
  createMemoryWorkspace,
  createReadLimitedMemoryWorkspace,
  createTornMemoryWorkspace,
} from "./fixtures/memory-workspace.js";

/**
 * host-contract-ports 任务 3.1 —— **套件自检**(Req 8.1/8.2)。
 *
 * 一致性套件本身也可能写错:若某个断言恒真,它对任何实现都"通过",看起来全绿实则什么
 * 都没验到。故此处用一个**违规实现**证明套件真的会失败 —— 这是套件有效性的下界。
 *
 * ★ 之所以能这样自检,正是因为套件**框架无关**:`SuiteRunner` 是个普通接口,可以传入
 * 一个收集型实现来捕获成败,而不是让 vitest 直接把失败报成整个文件红。若套件当初
 * 直接 `import { describe } from "vitest"`,这条自检根本写不出来。
 */

interface CollectedCase {
  readonly title: string;
  readonly error?: unknown;
}

/** 收集型 runner:登记用例 → 顺序执行 → 记录成败,不抛。 */
async function collectSuite(factory: ConformanceFactory): Promise<CollectedCase[]> {
  const scopes: string[] = [];
  const registered: { title: string; fn: () => void | Promise<void> }[] = [];

  const runner: SuiteRunner = {
    describe(name, fn) {
      scopes.push(name);
      fn();
      scopes.pop();
    },
    it(name, fn) {
      registered.push({ title: [...scopes, name].join(" › "), fn });
    },
  };

  runWorkspaceConformance(runner, "selftest", factory);

  const results: CollectedCase[] = [];
  for (const c of registered) {
    try {
      await c.fn();
      results.push({ title: c.title });
    } catch (error) {
      results.push({ title: c.title, error });
    }
  }
  return results;
}

const compliantFactory: ConformanceFactory = async (opts) => {
  const h = createMemoryWorkspace({ maxValueBytes: opts?.maxValueBytes });
  return {
    workspace: h.workspace,
    corrupt: h.corrupt,
    reopen: h.reopen,
    cleanup: async () => undefined,
  };
};

const laxFactory: ConformanceFactory = async (opts) => {
  const h = createLaxMemoryWorkspace({ maxValueBytes: opts?.maxValueBytes });
  return {
    workspace: h.workspace,
    corrupt: h.corrupt,
    reopen: h.reopen,
    cleanup: async () => undefined,
  };
};

describe("套件自检(Req 8.1/8.2)", () => {
  it("套件确实登记了用例,且合规实现全部通过", async () => {
    const results = await collectSuite(compliantFactory);
    expect(results.length).toBeGreaterThan(0);
    const failed = results.filter((r) => r.error !== undefined);
    expect(
      failed.map((f) => `${f.title}: ${String(f.error)}`),
      "合规实现不应有任何失败",
    ).toEqual([]);
  });

  it("★ 违规实现(不校验键)被键空间用例组抓出 —— 证明套件不是恒真", async () => {
    const results = await collectSuite(laxFactory);
    const failed = results.filter((r) => r.error !== undefined);
    expect(failed.length, "违规实现必须失败,否则套件形同虚设").toBeGreaterThan(0);
    // 失败必须落在键空间组,而不是别处偶然报错。
    for (const f of failed) {
      expect(f.title).toContain("键空间规则");
    }
  });

  it("违规实现的失败覆盖全部非法键形态,不是只抓到一两个", async () => {
    const results = await collectSuite(laxFactory);
    const keyCases = results.filter((r) => r.title.includes("拒绝非法键"));
    expect(keyCases.length).toBeGreaterThan(0);
    // 该实现对所有非法键一律放行,故每一条非法键用例都应失败。
    const passedButShouldNot = keyCases.filter((r) => r.error === undefined);
    expect(
      passedButShouldNot.map((r) => r.title),
      "不校验键的实现不应有任何非法键用例通过",
    ).toEqual([]);
  });

  it("★ 撕裂写入的实现被并发原子可见性用例抓出 —— 证明该断言不是恒真", async () => {
    // 合规实现整值替换,故并发用例必过;若不另造一个会撕裂的实现,那条断言在任何
    // 被测实现上都通不过失败 —— 等于没验。此处证明它确实能抓到部分写入。
    const tornFactory: ConformanceFactory = async (opts) => {
      const h = createTornMemoryWorkspace({ maxValueBytes: opts?.maxValueBytes });
      return {
        workspace: h.workspace,
        corrupt: h.corrupt,
        reopen: h.reopen,
        cleanup: async () => undefined,
      };
    };
    const results = await collectSuite(tornFactory);
    const concurrency = results.filter((r) => r.title.includes("并发原子可见性"));
    expect(concurrency.length, "并发用例组必须存在").toBeGreaterThan(0);
    expect(
      concurrency.some((r) => r.error !== undefined),
      "撕裂写入必须被抓出,否则并发断言形同虚设",
    ).toBe(true);
  });

  it("★ 读路径也校验上限的实现被上限第③例抓出 —— 证明该例不是恒真", async () => {
    // 复核驳回 3.3 时指出:第③例曾被写成两个互不相干的弱断言,恒真。修正后须证明它
    // 真能抓到"读路径也校验上限"这一违规 —— 那正是 Req 3.5 要防的:调小上限会使既有
    // 数据不可达,且用户无法自救(要缩小它必须先读到它)。
    const readLimitedFactory: ConformanceFactory = async (opts) => {
      const h = createReadLimitedMemoryWorkspace({ maxValueBytes: opts?.maxValueBytes });
      return {
        workspace: h.workspace,
        corrupt: h.corrupt,
        reopen: h.reopen,
        cleanup: async () => undefined,
      };
    };
    const results = await collectSuite(readLimitedFactory);
    const third = results.filter((r) => r.title.includes("上限调小后"));
    expect(third.length, "上限第③例必须存在").toBe(1);
    expect(
      third[0]?.error,
      "读路径校验上限的实现必须被第③例抓出,否则该例形同虚设",
    ).toBeDefined();
  });

  it("双根都被覆盖 —— user 与 project 各自有用例", async () => {
    const results = await collectSuite(compliantFactory);
    expect(results.some((r) => r.title.includes("[user]"))).toBe(true);
    expect(results.some((r) => r.title.includes("[project]"))).toBe(true);
  });
});
