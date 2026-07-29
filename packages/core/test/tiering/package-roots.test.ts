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
      assertRootsContributed([runner!], new Map([["runner", 0]]), "srcFiles"),
    ).not.toThrow();
  });

  it("★ 豁免自毁:pending 的维度一旦扫到文件就报红,并点名要删的维度键", () => {
    // 没有这条,一条过渡期豁免会永久留下 —— 于是「这个包将来真的变空」再也不会响,
    // 而那正是空扫断言存在的全部理由。
    expect(() =>
      assertRootsContributed([runner!], new Map([["runner", 3]]), "srcFiles"),
    ).toThrowError(/豁免过期了[\s\S]*3 个源文件[\s\S]*pendingContributions 中的 "srcFiles"/);
  });

  it("豁免按维度独立:未声明 pending 的维度仍要求非空", () => {
    const halfPending: PackageRoot = { ...runner!, pendingContributions: ["srcFiles"] };
    expect(() =>
      assertRootsContributed([halfPending], new Map([["runner", 0]]), "testFiles"),
    ).toThrowError(/扫到了 0 个测试文件/);
  });
});

describe("runner 的 pending 声明与磁盘现实一致", () => {
  it("声明为 pending 的三个维度,此刻在磁盘上确实为空", () => {
    // 名册里的豁免必须是对现实的**描述**,不能是凭空的通行证。
    // 任务 3.1 / 3.3 把文件搬进来后,上面的「豁免自毁」断言会逼着这条声明退场。
    expect([...(runner!.pendingContributions ?? [])].sort()).toEqual([
      "srcFiles",
      "srcModules",
      "testFiles",
    ]);
    for (const sub of ["src", "test"]) {
      const dir = path.join(runner!.dir, sub);
      const entries = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
      expect(entries, `packages/runner/${sub} 已经有内容了,pending 声明该退场了`).toEqual([]);
    }
  });

  it("core 与 server 不带任何 pending 豁免", () => {
    for (const name of ["core", "server"]) {
      const root = PACKAGE_ROOTS.find((r) => r.name === name)!;
      expect(root.pendingContributions, `${name} 不应有 pending 豁免`).toBeUndefined();
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
