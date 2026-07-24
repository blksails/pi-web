import { describe, expect, it } from "vitest";
import * as main from "../src/index.js";
import * as versionModule from "../src/host-contract-version.js";
import * as workspaceModule from "../src/workspace/index.js";
import * as capabilityModule from "../src/capability/index.js";
import * as hostManifestModule from "../src/host-manifest/index.js";
import * as configDomainModule from "../src/config-domain/index.js";
import type {
  CapabilityDecision,
  CapabilityDescriptor,
  CapabilityProvider,
  CapabilitySnapshot,
  ConfigDomainDescriptor,
  Workspace,
} from "../src/index.js";

/**
 * host-contract-ports 任务 6.2 —— 包主入口导出五个契约模块(Req 9.1、10.1、10.4)。
 *
 * ⚠ 与 6.1 同构的盲区,但这次更隐蔽:`tsc` 对「主入口少了一条 `export *`」**零杀伤**
 * ——没有任何既有代码引用这些新符号,少导出一整个模块也编译得过、既有 242 个用例也照样全绿。
 * 故本文件是唯一盯着「跨包消费面」的守卫,判据仍分两层:
 *
 *  1. **运行期:逐模块的「无漏项」对照**。断言不写死符号清单,而是**从模块出口自身派生**
 *     ——遍历模块 barrel 的每个运行期导出,要求主入口有同名项**且是同一个对象**
 *     (`main[k] === mod[k]`)。这样做有两个硬理由:
 *       · 少一条 `export *` → 该模块全部符号缺失,整条转红;
 *       · 将来模块出口**新增**符号时,守卫自动跟着覆盖,不需要有人记得回来改清单
 *         (硬编码清单会随时间静默退化成只覆盖当年那几个符号)。
 *     同一性(`toBe`)而非仅存在性:名字对上但指向另一个实现(重名遮蔽)同样是缺陷。
 *  2. **类型层:顶部那条 `import type { … } from "../src/index.js"`**。类型不进运行期名集,
 *     第 1 层对它完全沉默;而 TS 对导入不存在的具名导出直接报 TS2305/TS2724,**与是否被使用
 *     无关**。四个端口模块各取代表类型,任一模块的类型面没接通即转红。
 *     (`host-contract-version.ts` 没有类型专属导出,其覆盖全在第 1 层。)
 *
 * ★ **`capability/index.ts` 的运行期导出数为 0**(它只交付类型契约,本期无实现),故第 1 层
 * 对它**结构上不可能有杀伤力**——遍历空集的「无漏项」是恒真的。这不是可以含糊过去的细节:
 * 若把它照常放进第 1 层的表里,那一行会是一条**看起来在守、实际恒绿**的断言。因此它被
 * 移出该表,覆盖**全部**落在第 2 层的 `CapabilityProvider` / `CapabilitySnapshot` 上;
 * 同时下面单列一条断言钉住「运行期导出数为 0」这个前提——将来它一旦长出运行期导出(例如
 * 后续阶段的 `EnvCapabilityProvider`),该断言即转红,**强制**把它加回第 1 层的表,而不是
 * 让新符号悄悄躺在守卫之外。
 *
 * ★ 下面那条元组是**锚**,不是守卫本身:它把这些 `import type` 消费掉,使编辑器手动触发的
 * "Organize Imports" 不会把真守卫(那条 import)当未使用摘掉。本仓无 eslint / biome / oxlint /
 * prettier,不存在自动摘除的行为体;但 `noUnusedLocals` 未开,**一旦被摘,失效是静默的**。
 */
type _MainEntryTypeSurface = [
  CapabilityDecision<unknown, unknown>,
  CapabilityDescriptor<unknown, unknown>,
  CapabilityProvider,
  CapabilitySnapshot,
  ConfigDomainDescriptor,
  Workspace,
];

/**
 * 有运行期导出、可被第 1 层覆盖的契约模块。
 *
 * ⚠ `capability/index.ts` **刻意不在此表**,理由见文件头注释(纯类型模块,放进来即恒真)。
 */
const CONTRACT_MODULES: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
  ["host-contract-version.ts", versionModule],
  ["workspace/index.ts", workspaceModule],
  ["host-manifest/index.ts", hostManifestModule],
  ["config-domain/index.ts", configDomainModule],
];

describe("包主入口 · 五个契约模块的重导出", () => {
  it.each(CONTRACT_MODULES)("%s 的运行期导出在主入口无漏项且同一", (_name, mod) => {
    const own = Object.keys(mod).sort();
    // 前置:模块本身得有运行期导出,否则「无漏项」会退化成对空集的恒真断言。
    expect(own.length).toBeGreaterThan(0);

    const missing = own.filter((k) => !(k in main));
    expect(missing).toEqual([]);
    for (const key of own) {
      expect((main as Record<string, unknown>)[key]).toBe(mod[key]);
    }
  });

  it("capability/index.ts 仍是纯类型模块 —— 一旦长出运行期导出,须补进第 1 层的表", () => {
    expect(Object.keys(capabilityModule)).toEqual([]);
  });

  it("版本常量可从主入口按值读取(Req 9.1:版本标识可被程序读取)", () => {
    expect(main.HOST_CONTRACT_VERSION).toBe(versionModule.HOST_CONTRACT_VERSION);
    expect(() => main.assertHostContractVersion(main.HOST_CONTRACT_VERSION)).not.toThrow();
    expect(() => main.assertHostContractVersion(main.HOST_CONTRACT_VERSION + 1)).toThrow(
      main.HostContractVersionError,
    );
  });
});
