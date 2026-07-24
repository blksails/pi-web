/**
 * 单元:ConfigCodec 的错误分区(host-contract v1 M2,spec: host-contract-config-on-workspace)。
 *
 * 用受控 stub 命名空间精确验证 `load` 按 `err.code` 分区(契约 §3.6):
 *  - `corrupt` → 降级为 `{}`;
 *  - `io`(及任何非 corrupt)→ **rethrow**。
 *
 * 与 config-codec.test.ts(真实 fs,端到端)互补:此处不写真实文件、直接注入错误,以**稳定**
 * 杀死「把 io 也降级为 {}」这个变异体——真实 fs 难跨平台稳定制造 IO 错误。stub 抛的是**普通
 * 对象**(非 WorkspaceIoError 实例),同时证明分区按 `code` 而非 `instanceof`(契约 §3.6)。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { readJson, writeJson } = vi.hoisted(() => ({
  readJson: vi.fn(),
  writeJson: vi.fn(),
}));

vi.mock("../../src/workspace/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/workspace/index.js")>();
  return {
    ...actual,
    createLocalWorkspaceNamespace: () => ({
      readJson,
      writeJson,
      list: vi.fn(),
      delete: vi.fn(),
      exists: vi.fn(),
    }),
  };
});

import { ConfigCodec } from "../../src/config/config-codec.js";

beforeEach(() => {
  readJson.mockReset();
  writeJson.mockReset();
});

describe("ConfigCodec 错误分区(按 code)", () => {
  it("corrupt → load 降级为 {}", async () => {
    readJson.mockRejectedValueOnce({ code: "corrupt" });
    const codec = new ConfigCodec("/unused");
    await expect(codec.load("auth")).resolves.toEqual({});
  });

  it("io → load rethrow(不降级)", async () => {
    const ioErr = { code: "io", message: "permission denied" };
    readJson.mockRejectedValueOnce(ioErr);
    const codec = new ConfigCodec("/unused");
    // 变异判据:把 catch 分支改为无条件 `return {}` → 此处转红。
    await expect(codec.load("auth")).rejects.toBe(ioErr);
  });

  it("未知 code(既非 corrupt 亦非 io)→ rethrow", async () => {
    const weird = { code: "something-else" };
    readJson.mockRejectedValueOnce(weird);
    const codec = new ConfigCodec("/unused");
    await expect(codec.load("auth")).rejects.toBe(weird);
  });

  it("按 code 判别而非 instanceof:普通对象 { code: 'corrupt' } 也被降级", async () => {
    // stub 抛的不是 WorkspaceCorruptError 实例,仅带 code;仍降级 → 证明按 code 判别。
    // 变异判据:把 load 改用 `err instanceof WorkspaceCorruptError` → 此处转红。
    readJson.mockRejectedValueOnce({ code: "corrupt", name: "NotAWorkspaceError" });
    const codec = new ConfigCodec("/unused");
    await expect(codec.load("auth")).resolves.toEqual({});
  });
});
