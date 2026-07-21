import { describe, expect, it } from "vitest";
import {
  runWorkspaceConformance,
  type ConformanceFactory,
  type SuiteRunner,
} from "../../src/workspace/testing/index.js";
import {
  createFlatMemoryWorkspace,
  createLaxMemoryWorkspace,
  createLocaleSortedMemoryWorkspace,
  createMemoryWorkspace,
  createReadLimitedMemoryWorkspace,
  createTornMemoryWorkspace,
  type MemoryWorkspaceHandle,
  type MemoryWorkspaceOptions,
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

/** 把某个夹具构造器包成套件工厂(所有变体共用同一套接线,差异只在夹具本身)。 */
const factoryOf =
  (make: (o: MemoryWorkspaceOptions) => MemoryWorkspaceHandle): ConformanceFactory =>
  async (opts) => {
    const h = make({ maxValueBytes: opts?.maxValueBytes });
    return {
      workspace: h.workspace,
      corrupt: h.corrupt,
      reopen: h.reopen,
      cleanup: async () => undefined,
    };
  };

const compliantFactory = factoryOf(createMemoryWorkspace);
const laxFactory = factoryOf(createLaxMemoryWorkspace);

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
    const results = await collectSuite(factoryOf(createTornMemoryWorkspace));
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
    const results = await collectSuite(factoryOf(createReadLimitedMemoryWorkspace));
    const third = results.filter((r) => r.title.includes("上限调小后"));
    expect(third.length, "上限第③例必须存在").toBe(1);
    expect(
      third[0]?.error,
      "读路径校验上限的实现必须被第③例抓出,否则该例形同虚设",
    ).toBeDefined();
  });

  it("★ 扁平 KV(不校验值/分组同址)被同址用例组抓出 —— 证明该组不是恒真", async () => {
    // 任务 4.4 / 契约勘误⑧。这条是同址用例组存在的**理由**:层级载体上「写不进去」是
    // errno 顺带给的,而扁平 KV 上两个键天然并存 —— 若不主动校验,同一份配置搬到另一端
    // 就会炸。故必须证明该组真能抓到一个不校验的扁平实现,否则它就是恒真断言。
    const results = await collectSuite(factoryOf(createFlatMemoryWorkspace));
    const group = results.filter((r) => r.title.includes("值与分组不可同址"));
    expect(group.length, "同址用例组必须存在且为三例").toBe(3);

    // ① / ② 两个写入方向必须都被抓出(只抓一个方向说明另一个方向没人看着)。
    const forward = group.find((r) => r.title.includes("①"));
    const backward = group.find((r) => r.title.includes("②"));
    expect(forward?.error, "正向(前缀已是值键)必须被抓出").toBeDefined();
    expect(backward?.error, "反向(键是既有值键的前缀)必须被抓出").toBeDefined();
  });

  it("★ 区域相关排序的实现被码元序用例抓出 —— 证明改键组后该断言仍有判别力", async () => {
    // 勘误⑦ 的修复把排序用例的键组从含大小写碰撞改成了无碰撞的 `1`/`B`/`_u`/`a`。
    // 换键组之后它是否还能区分「码元序」与 `localeCompare`?——用一个 localeCompare
    // 实现实测,而不是靠推理。
    const results = await collectSuite(factoryOf(createLocaleSortedMemoryWorkspace));
    const ordering = results.filter((r) => r.title.includes("码元序"));
    expect(ordering.length, "码元序用例必须存在(双根各一)").toBe(2);
    for (const r of ordering) {
      expect(r.error, `${r.title}: 区域相关排序必须被抓出`).toBeDefined();
    }
    // 且失败只落在排序用例上,不是整体崩掉后的连带现象。
    const others = results.filter(
      (r) => r.error !== undefined && !r.title.includes("码元序"),
    );
    expect(others.map((r) => r.title), "排序违规不应波及其它用例").toEqual([]);
  });

  it("★ 谎称『载体大小写不敏感』的实现被抓出 —— 声明不是把红改绿的开关", async () => {
    // 勘误⑦ 给了实现一个声明限制的入口(`caseSensitiveKeys: false`)。若声明等于跳过,
    // 任何实现都能靠声明让大小写用例消失。故声明后用例改为断言「两键确实互为别名」,
    // 此处用一个**大小写敏感**的夹具谎报不敏感,证明谎报会红。
    const liar: ConformanceFactory = async (opts) => ({
      ...(await compliantFactory(opts)),
      caseSensitiveKeys: false,
    });
    const results = await collectSuite(liar);
    const cs = results.filter((r) => r.title.includes("键大小写敏感"));
    expect(cs.length, "大小写用例必须存在(双根各一)").toBe(2);
    for (const r of cs) {
      expect(r.error, `${r.title}: 谎报载体不敏感必须被抓出`).toBeDefined();
    }
  });

  it("套件用例构成与其声明的用例组逐组一致(任务 4.4 观察态)", async () => {
    // 用途:防止某个用例组在重构中**整组消失**而无人察觉 —— 那种情况下所有仍在的用例
    // 依旧全绿,套件看起来健康,实际少验了一整个契约维度。逐组计数是唯一能抓到它的判据。
    const results = await collectSuite(compliantFactory);
    const countIn = (group: string) =>
      results.filter((r) => r.title.includes(`› ${group}`)).length;

    // 键空间:双根 × (14 条非法键 + 1 条合法键 + 1 条大小写)
    expect(countIn("键空间规则"), "键空间组").toBe(2 * 16);
    // 同址:三例(两个写入方向 + 读分组前缀),不分根
    expect(countIn("值与分组不可同址"), "同址组(勘误⑧)").toBe(3);
    // 读写语义:双根 × 11 条
    expect(countIn("读写语义"), "读写语义组").toBe(2 * 11);
    expect(countIn("双根隔离"), "双根隔离组").toBe(3);
    expect(countIn("单键值上限"), "上限三例").toBe(3);
    expect(countIn("并发原子可见性"), "并发组").toBe(2);
    // 分组之和 = 总数 ⇒ 没有游离在任何声明组之外的用例。
    expect(results.length, "总用例数").toBe(2 * 16 + 3 + 2 * 11 + 3 + 3 + 2);
  });

  it("双根都被覆盖 —— user 与 project 各自有用例", async () => {
    const results = await collectSuite(compliantFactory);
    expect(results.some((r) => r.title.includes("[user]"))).toBe(true);
    expect(results.some((r) => r.title.includes("[project]"))).toBe(true);
  });
});
