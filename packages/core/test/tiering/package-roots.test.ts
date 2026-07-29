import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  PACKAGE_ROOTS,
  assertRootsContributed,
  assertRootsResolvable,
  exportsMapOf,
  type PackageRoot,
} from "./package-roots.js";

/**
 * 单元:包根名册自身(spec: runner-package-extraction 任务 2.1)。
 *
 * ★ 为什么名册要有自己的测试:三个守卫都靠 `assertEveryRootContributed` 自证「不是空转」,
 *   而那个函数本身没人守。本文件用**构造出来的**包根驱动它,把「弄坏它必须报红」这件事
 *   从一次性的人工实验变成常驻断言 —— 人工实验只证明了那一刻,断言证明每一次。
 */

const runner = PACKAGE_ROOTS.find((r) => r.name === "runner");

/** 一个必定不存在的包根路径,用于模拟「名册路径写错」。 */
const bogusDir = path.join(path.dirname(PACKAGE_ROOTS[0]!.dir), "__no_such_package__");

describe("PACKAGE_ROOTS —— 名册内容", () => {
  it("三包全在册,且短名不重复", () => {
    expect(PACKAGE_ROOTS.map((r) => r.name)).toEqual(["core", "server", "runner"]);
  });

  it("runner 包根指向 @blksails/pi-web-runner(R5.1)", () => {
    expect(runner, "PACKAGE_ROOTS 里没有名为 runner 的包根").toBeDefined();
    expect(runner!.packageName).toBe("@blksails/pi-web-runner");
    expect(path.basename(runner!.dir)).toBe("runner");
  });

  it("每个包根都真的解析到本仓对应的包", () => {
    expect(() => assertRootsResolvable()).not.toThrow();
  });
});

describe("assertRootsResolvable —— 路径失效必须报红,不得被 pending 掩盖", () => {
  it("包根路径不存在 → 抛错并指出所查的 package.json", () => {
    const broken: PackageRoot = { ...runner!, dir: bogusDir };
    expect(() => assertRootsResolvable([broken])).toThrowError(
      /runner —— .*__no_such_package__.*package\.json 不存在/,
    );
  });

  it("包根指到了隔壁包 → 抛错(仅查目录存在拦不住这种)", () => {
    const core = PACKAGE_ROOTS.find((r) => r.name === "core")!;
    const misdirected: PackageRoot = { ...runner!, dir: core.dir };
    expect(() => assertRootsResolvable([misdirected])).toThrowError(
      /里的包名是 "@blksails\/pi-web-core",名册声明的是 "@blksails\/pi-web-runner"/,
    );
  });

  it("★ pending 豁免不是路径笔误的藏身处:路径错了照样报红", () => {
    // 这是本任务的核心自证。pending 让 runner 在三个维度上都可以扫到 0 个文件 ——
    // 而路径写错的症状**也是**扫到 0 个文件。若不加区分,把 dir 改错会一片绿。
    const broken: PackageRoot = { ...runner!, dir: bogusDir };
    expect(() =>
      assertRootsContributed([broken], new Map([["runner", 0]]), "srcFiles"),
    ).toThrowError(/无法解析到本仓的对应包/);
  });
});

describe("assertRootsContributed —— 空扫与过期豁免两个方向都要拦(R5.2, R5.3)", () => {
  const core = PACKAGE_ROOTS.find((r) => r.name === "core")!;

  /**
   * ★ pending 相关的两条判据用**构造出来的**包根驱动,不取名册里的真包根。
   *
   * spec runner-package-extraction 任务 3.3 搬完测试后,名册里已**没有**任何 pending 声明
   * (那正是本机制该有的终局)。若这两条继续拿真包根当夹具,它们会随豁免退场一起消失 ——
   * 而「pending 机制本身还好不好使」将从此无人覆盖,直到下一次拆包时才会发现它坏了。
   * 与 `module-roster.ts` 里 `stagedIn` 的处理同构:声明退场,机制留下并继续被测。
   */
  const pendingRoot: PackageRoot = { ...runner!, pendingContributions: ["testFiles"] };

  it("未声明 pending 的包根扫到 0 个 → 抛错并指出是哪个包根", () => {
    expect(() => assertRootsContributed([core], new Map([["core", 0]]), "srcFiles")).toThrowError(
      /扫到了 0 个源文件.*core/s,
    );
  });

  it("计数里压根没有该包根(而非 0)同样算空扫", () => {
    expect(() => assertRootsContributed([core], new Map(), "testFiles")).toThrowError(
      /扫到了 0 个测试文件/,
    );
  });

  it("声明了 pending 的维度扫到 0 个 → 放行", () => {
    expect(() =>
      assertRootsContributed([pendingRoot], new Map([["runner", 0]]), "testFiles"),
    ).not.toThrow();
  });

  it("★ 豁免自毁:pending 的维度一旦扫到文件就报红,并点名要删的维度键", () => {
    // 没有这条,一条过渡期豁免会永久留下 —— 于是「这个包将来真的变空」再也不会响,
    // 而那正是空扫断言存在的全部理由。
    expect(() =>
      assertRootsContributed([pendingRoot], new Map([["runner", 3]]), "testFiles"),
    ).toThrowError(/豁免过期了[\s\S]*3 个测试文件[\s\S]*pendingContributions 中的 "testFiles"/);
  });

  it("豁免按维度独立:未声明 pending 的维度仍要求非空", () => {
    const halfPending: PackageRoot = { ...runner!, pendingContributions: ["srcFiles"] };
    expect(() =>
      assertRootsContributed([halfPending], new Map([["runner", 0]]), "testFiles"),
    ).toThrowError(/扫到了 0 个测试文件/);
  });
});

describe("pending 豁免已全部退场,名册与磁盘现实一致", () => {
  it("★ 三包都不带 pending 豁免 —— 搬迁完成后豁免必须清零", () => {
    // 名册里的豁免必须是对现实的**描述**,不能是凭空的通行证。runner 的两次搬迁
    // (任务 3.1 的 `src/`、任务 3.3 的 `test/`)都已落地,三个维度的声明随之全部退场。
    for (const root of PACKAGE_ROOTS) {
      expect(root.pendingContributions, `${root.name} 不应有 pending 豁免`).toBeUndefined();
    }
  });

  it("★ 反向断言:runner 的 src/ 与 test/ 在磁盘上确实非空", () => {
    // 只删声明不搬东西,与「搬完了并删掉声明」在名册视角下长得一样 ——
    // 故必须直接看磁盘。少了这条,豁免退场就成了一件全凭自觉的事。
    for (const dim of ["src", "test"]) {
      const dir = path.join(runner!.dir, dim);
      const entries = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
      expect(
        entries,
        `packages/runner/${dim} 是空的 —— 搬迁没落地,或 pending 被过早删掉了`,
      ).not.toEqual([]);
    }
  });
});

describe("exportsMapOf —— 只收指向 src/ 的导出", () => {
  it("runner 的包根部引导脚本导出不进具名表(否则模块名会算成 \".\")", () => {
    const map = exportsMapOf(runner!);
    expect(map.has("@blksails/pi-web-runner/runner-bootstrap.mjs")).toBe(false);
    expect([...map.values()].every((rel) => !rel.startsWith("."))).toBe(true);
  });

  it("主入口仍被收录,且路径是相对 src 的", () => {
    expect(exportsMapOf(runner!).get("@blksails/pi-web-runner")).toBe("runner/index.ts");
  });
});
