import { describe, expect, it } from "vitest";
import * as barrel from "../../src/workspace/index.js";
import { createLocalWorkspace, createLocalWorkspaceNamespace } from "../../src/workspace/local-workspace.js";
import { assertWorkspaceKey, validateWorkspaceKey } from "../../src/workspace/key.js";
import {
  DEFAULT_WORKSPACE_MAX_VALUE_BYTES,
  WORKSPACE_MAX_VALUE_BYTES_ENV,
  WorkspaceConfigError,
  resolveWorkspaceValueLimit,
} from "../../src/workspace/limit-config.js";
import { deepMergeJson } from "../../src/workspace/merge.js";
import {
  WorkspaceCorruptError,
  WorkspaceError,
  WorkspaceIoError,
  WorkspaceKeyError,
  WorkspaceLimitError,
} from "../../src/workspace/types.js";
import type {
  JsonObject,
  LocalWorkspaceNamespaceOptions,
  LocalWorkspaceOptions,
  Workspace,
  WorkspaceErrorCode,
  WorkspaceKey,
  WorkspaceNamespace,
  WorkspaceWriteOptions,
} from "../../src/workspace/index.js";

/**
 * host-contract-ports 任务 6.1 —— 宿主状态存储模块出口(Req 10.1)。
 *
 * ⚠ 本仓既有的 workspace 用例**一律按具体文件路径 import**(`../../src/workspace/key.js`
 * 之类),故它们对 barrel 零覆盖:barrel 少导出一半符号,那些用例照样全绿,`tsc` 也照样零
 * 错误(没人引用缺失的那半)。本文件是唯一盯着出口面本身的守卫,判据分两层:
 *
 *  1. **运行期名集全等**(下面第一条用例)。不是「包含」而是**全等**,故两个方向都有牙:
 *     少导出一个值 → 缺项转红;多导出一个(把 `resolveWorkspaceKeyPath` 这类载体内部件、
 *     或 `testing/` 下的套件符号漏进生产出口)→ 多项转红。
 *  2. **类型导出面**由本文件顶部的 `import type { ... } from ".../index.js"` 承担:类型
 *     不进运行期名集,名集断言对它完全沉默;少一条类型重导出即 `TS2305`,由 `pnpm typecheck`
 *     捕获(`tsconfig.json` 的 include 覆盖整个 `test/` 目录)。两层缺一都会留下盲区。
 */

/** 出口的**运行期**公开面(值:类、函数、常量)。少一个多一个都应转红。 */
const EXPECTED_VALUE_EXPORTS: readonly string[] = [
  "DEFAULT_WORKSPACE_MAX_VALUE_BYTES",
  "WORKSPACE_MAX_VALUE_BYTES_ENV",
  "WorkspaceConfigError",
  "WorkspaceCorruptError",
  "WorkspaceError",
  "WorkspaceIoError",
  "WorkspaceKeyError",
  "WorkspaceLimitError",
  "assertWorkspaceKey",
  "createLocalWorkspace",
  "createLocalWorkspaceNamespace",
  "deepMergeJson",
  "resolveWorkspaceValueLimit",
  "validateWorkspaceKey",
];

/**
 * 出口的**类型**公开面。
 *
 * ★ **真正的守卫是本文件顶部那条 `import type { … } from "../../src/workspace/index.js"`**,
 * 不是下面这条元组。TS 对具名类型导入是**急性解析**的:导入一个不存在的具名导出即
 * `TS2305`/`TS2724`,**与该类型是否被使用无关**(8 个类型逐个删除实测 8/8 全红)。
 *
 * 下面的元组对 `tsc` 的**边际贡献恰好为 0**——双向实测:只删元组、出口保持完整 → `tsc` rc=0;
 * 删元组 + 删一个类型导出 → 仍红,且报错位置在上面的 import 行。
 *
 * **那为什么还留着它?** 因为它把那 8 个 `import type` **消费掉**了,于是「摘掉守卫」这个
 * 动作本身会转红。**元组是「防止守卫被摘除」的锚,不是守卫本身。**
 *
 * 风险的准确形态(别写宽了):**本仓没有任何会自动摘除未使用 import 的行为体**——无 eslint /
 * biome / oxlint / prettier,无配置文件,`packages/server` 的 scripts 只有 `test` 与
 * `typecheck`。风险来自**编辑器手动触发**的 "Organize Imports"(VS Code / JetBrains,由 TS
 * language service 提供)。真正要命的不是「谁会摘」,而是**摘掉之后没有任何东西会报警**:
 * `noUnusedLocals` 未开、运行期名集断言对类型完全沉默、`tsc` 照样 rc=0 —— 类型层守卫会
 * **静默**消失。
 *
 * ⚠ 初稿此处曾写「任一条类型重导出缺失,**本别名**即无法解析,类型检查转红」——**是错的**,
 * 它把守卫记在了元组名下。要动这段代码的人请先读这里:**可以重排元组,但删掉或改动上面那条
 * `import type` 就等于拆掉整个类型层守卫。**
 */
type _BarrelTypeSurface = [
  JsonObject,
  LocalWorkspaceNamespaceOptions,
  LocalWorkspaceOptions,
  Workspace,
  WorkspaceErrorCode,
  WorkspaceKey,
  WorkspaceNamespace,
  WorkspaceWriteOptions,
];

describe("workspace 模块出口", () => {
  it("运行期名集与公开面全等(少导出与多导出都转红)", () => {
    expect(Object.keys(barrel).sort()).toEqual([...EXPECTED_VALUE_EXPORTS].sort());
  });

  it("重导出的是同一模块实例,不是出口层的再包装", () => {
    expect(barrel.validateWorkspaceKey).toBe(validateWorkspaceKey);
    expect(barrel.assertWorkspaceKey).toBe(assertWorkspaceKey);
    expect(barrel.deepMergeJson).toBe(deepMergeJson);
    expect(barrel.resolveWorkspaceValueLimit).toBe(resolveWorkspaceValueLimit);
    expect(barrel.createLocalWorkspace).toBe(createLocalWorkspace);
    expect(barrel.createLocalWorkspaceNamespace).toBe(createLocalWorkspaceNamespace);
    expect(barrel.WORKSPACE_MAX_VALUE_BYTES_ENV).toBe(WORKSPACE_MAX_VALUE_BYTES_ENV);
    expect(barrel.DEFAULT_WORKSPACE_MAX_VALUE_BYTES).toBe(DEFAULT_WORKSPACE_MAX_VALUE_BYTES);
    expect(barrel.WorkspaceError).toBe(WorkspaceError);
    expect(barrel.WorkspaceKeyError).toBe(WorkspaceKeyError);
    expect(barrel.WorkspaceLimitError).toBe(WorkspaceLimitError);
    expect(barrel.WorkspaceCorruptError).toBe(WorkspaceCorruptError);
    expect(barrel.WorkspaceIoError).toBe(WorkspaceIoError);
    expect(barrel.WorkspaceConfigError).toBe(WorkspaceConfigError);
  });

  it("跨 barrel 的错误判别仍按 code(勘误①)且四类可从出口构造", () => {
    const codes = [
      new barrel.WorkspaceKeyError("a/../b", "relative segment").code,
      new barrel.WorkspaceLimitError("big.json", 2048, 1024).code,
      new barrel.WorkspaceCorruptError("broken.json").code,
      new barrel.WorkspaceIoError("x.json").code,
    ];
    expect(codes).toEqual(["key", "limit", "corrupt", "io"]);
  });
});
