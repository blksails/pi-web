/**
 * 主入口(`src/index.ts`)导出面守卫。
 *
 * ## 为什么需要
 *
 * 内核包的价值主张是「只要会话引擎的宿主,不必安装云沙箱 SDK 与数据库驱动」。`index.ts`
 * 的文件头把这件事讲得很清楚,还逐条标注了**刻意不导出**的三个子路径,并写着「不要顺手
 * 补全」。但那是**注释纪律** —— 一个 `export * from "./x"` 就能撤销掉整个主张,而且不会
 * 有任何东西转红。
 *
 * 本守卫把纪律变成机制:主入口的每一条 re-export 都必须在下面的名册里。**加一条导出就要
 * 改这个名册**,那一步会强迫作者面对「这条该不该进内核入口」这个问题,而不是顺手写下。
 *
 * ## 为什么不做传递依赖闭包分析
 *
 * 同目录的 `dependency-guard.test.ts` 已经记录了实测结论:barrel 把整个模块图拉进来,
 * 传递分析在 198 个候选里误报 116 个(59%)。这里沿用同一判断 —— 只看**声明**层面的
 * 事实(导出了哪些子路径),不做闭包推断。
 *
 * 本文件跑在 fast 档:只读文件,不起子进程、不写盘。
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const INDEX = path.join(HERE, "..", "..", "src", "index.ts");

/**
 * 主入口允许出现的 re-export 目标(相对说明符,原样比对)。
 *
 * ⚠ 往这里加条目**不是**例行公事。先回答两个问题:
 *  1. 它是否**值**导入了 agent 运行时 SDK / 云沙箱 SDK / 数据库驱动?是 → 不能进,
 *     给它开一个独立子路径(`exports` 已有 `./*.js` 通配)。
 *  2. 它是否只是「用起来方便」?是 → 也走子路径。主入口不是便利面,是内核契约面。
 */
const ALLOWED_EXPORTS: ReadonlySet<string> = new Set([
  "./rpc-channel/index.js",
  "./agent-source/index.js",
  "./builtin-agents/entry-path.js",
  "./session/index.js",
  "./session-store/index.js",
  "./http/index.js",
  "./attachment/index.js",
  "./attachment-bridge/index.js",
  "./completion/index.js",
  "./commands/host-command-registry.js",
  "./source-key.js",
  "./config/index.js",
  "./session-list/index.js",
  "./agent-source-list/index.js",
  "./aigc-settings/index.js",
  "./vision-settings/index.js",
  "./session-actions/index.js",
  "./sandbox/entry.js",
  "./model-catalog/index.js",
  "./host-contract-version.js",
  "./workspace/index.js",
  "./capability/index.js",
  "./parent-watchdog.js",
  "./host-manifest/index.js",
  "./config-domain/index.js",
]);

/**
 * **绝不可**出现在主入口的子路径,各有独立成因(见 `index.ts` 文件头)。
 *
 * 前两者值导入 agent 运行时 SDK —— 进主入口等于让每个 import 内核的宿主都去解析 pi SDK;
 * 第三个是一致性测试套件 —— 进主入口会随之进运行期产物。
 */
const FORBIDDEN_SUBSTRINGS: readonly string[] = [
  "config/model-options",
  "vision-settings/vision-model-options",
  "workspace/testing",
];

/** 抽出所有 `export ... from "<spec>"` 的说明符。 */
function exportSpecifiers(source: string): string[] {
  const out: string[] = [];
  const re = /export\s+(?:\*|\{[^}]*\})\s+from\s+"([^"]+)"/g;
  for (const m of source.matchAll(re)) out.push(m[1]!);
  return out;
}

describe("主入口导出面守卫", () => {
  const source = fs.readFileSync(INDEX, "utf8");
  const specs = exportSpecifiers(source);

  it("主入口确有 re-export(守卫本身没有因正则失配而空跑)", () => {
    // ★ 没有这一条,正则一旦失配,下面两个断言都会在空集合上「通过」——
    //   一个永远绿的守卫比没有守卫更糟。
    expect(specs.length).toBeGreaterThan(20);
  });

  it("★每一条 re-export 都在名册内(新增导出必须显式登记)", () => {
    const unlisted = specs.filter((s) => !ALLOWED_EXPORTS.has(s));
    expect(
      unlisted,
      `主入口新增了未登记的导出:${unlisted.join(", ")}\n` +
        "先读 test/tiering/barrel-guard.test.ts 里 ALLOWED_EXPORTS 上方的两个问题," +
        "再决定是登记它、还是给它开一个子路径。",
    ).toEqual([]);
  });

  it("★名册内的条目都还在被导出(删导出时名册不留孤儿)", () => {
    const stale = [...ALLOWED_EXPORTS].filter((a) => !specs.includes(a));
    expect(stale, `名册里有已不存在的条目:${stale.join(", ")}`).toEqual([]);
  });

  it("★三个刻意排除的子路径不得出现在主入口", () => {
    for (const forbidden of FORBIDDEN_SUBSTRINGS) {
      const hit = specs.filter((s) => s.includes(forbidden));
      expect(
        hit,
        `${forbidden} 不得经主入口导出(理由见 src/index.ts 文件头);它已有独立子路径。`,
      ).toEqual([]);
    }
  });
});
