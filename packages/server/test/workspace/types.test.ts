import { describe, expect, it } from "vitest";
import { HOST_CONTRACT_VERSION } from "../../src/host-contract-version.js";
import {
  WorkspaceCorruptError,
  WorkspaceError,
  WorkspaceIoError,
  WorkspaceKeyError,
  WorkspaceLimitError,
  type Workspace,
  type WorkspaceErrorCode,
} from "../../src/workspace/types.js";

/**
 * host-contract-ports 任务 1.3 —— 类型契约与错误分类(Req 2.1/2.2/3.4/4.1/9.1)。
 *
 * 本文件只验错误分类的可判别性与上下文携带;读写语义由一致性套件对具体实现验收。
 */

const ALL_CODES: readonly WorkspaceErrorCode[] = ["key", "limit", "corrupt", "io"];

describe("Workspace 错误分类", () => {
  it("四类错误各自携带稳定判别码,两两不同", () => {
    const errs = [
      new WorkspaceKeyError("a/../b", "relative segment"),
      new WorkspaceLimitError("big.json", 2048, 1024),
      new WorkspaceCorruptError("broken.json"),
      new WorkspaceIoError("x.json"),
    ];
    const codes = errs.map((e) => e.code);
    expect(codes).toEqual(["key", "limit", "corrupt", "io"]);
    expect(new Set(codes).size).toBe(4);
    // 判别码集合恰为契约所定义的四项,不多不少。
    expect([...new Set(codes)].sort()).toEqual([...ALL_CODES].sort());
  });

  it("均继承共同基类,使调用方可先收窄再按 code 分派", () => {
    for (const e of [
      new WorkspaceKeyError("k", "r"),
      new WorkspaceLimitError("k", 1, 0),
      new WorkspaceCorruptError("k"),
      new WorkspaceIoError("k"),
    ]) {
      expect(e).toBeInstanceOf(WorkspaceError);
      expect(e).toBeInstanceOf(Error);
    }
  });

  it("★ 判别不依赖 instanceof —— 仅凭 code 即可分派", () => {
    // 跨包/跨仓时同名类可能来自不同模块实例,instanceof 会假阴性。
    // 此处以「结构等价的异类对象」模拟跨边界错误:只要带 code 就能被正确分派。
    const foreign = { code: "limit" as const, message: "from another realm" };
    const classify = (e: { code: WorkspaceErrorCode }): string => e.code;
    expect(classify(foreign)).toBe("limit");
    expect(classify(new WorkspaceLimitError("k", 2, 1))).toBe("limit");
  });

  it("每类错误都写了 name,且携带定位所需的上下文字段", () => {
    const key = new WorkspaceKeyError("/abs", "absolute path");
    expect(key.name).toBe("WorkspaceKeyError");
    expect(key.key).toBe("/abs");
    expect(key.reason).toBe("absolute path");
    // message 须含原键,便于日志中直接定位(键本身不是凭据,可入日志)。
    expect(key.message).toContain("/abs");

    const limit = new WorkspaceLimitError("big.json", 2048, 1024);
    expect(limit.name).toBe("WorkspaceLimitError");
    expect(limit.size).toBe(2048);
    expect(limit.limit).toBe(1024);
    expect(limit.message).toContain("2048");
    expect(limit.message).toContain("1024");

    const cause = new Error("EACCES");
    const io = new WorkspaceIoError("x.json", cause);
    expect(io.name).toBe("WorkspaceIoError");
    expect(io.cause).toBe(cause);

    const corrupt = new WorkspaceCorruptError("broken.json", cause);
    expect(corrupt.name).toBe("WorkspaceCorruptError");
    expect(corrupt.key).toBe("broken.json");
    expect(corrupt.cause).toBe(cause);
  });
});

describe("Workspace 端口形状", () => {
  it("双根命名空间与版本字段可被结构化实现(类型层契约)", () => {
    // 编译期即校验:实现必须提供两个根与正确版本。此处以最小桩证明形状可满足。
    const ns = {
      readJson: async () => ({}),
      writeJson: async () => undefined,
      list: async () => [],
      delete: async () => undefined,
      exists: async () => false,
    };
    const ws: Workspace = {
      contractVersion: HOST_CONTRACT_VERSION,
      user: ns,
      project: ns,
    };
    expect(ws.contractVersion).toBe(HOST_CONTRACT_VERSION);
    expect(ws.user).not.toBeUndefined();
    expect(ws.project).not.toBeUndefined();
  });
});
