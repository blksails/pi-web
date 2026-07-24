import { describe, it } from "vitest";
import { runWorkspaceConformance } from "../../src/workspace/testing/index.js";
import { createMemoryWorkspace } from "./fixtures/memory-workspace.js";

/**
 * host-contract-ports 任务 3.1 —— 以**真实调用形态**驱动一致性套件(Req 8.1/8.2)。
 *
 * 这同时是两端接入套件的范例:传入自己的 `describe`/`it`,提供一个每次产出隔离实例的工厂。
 * 套件本身不 import vitest —— 这里传的是 vitest 的,pi-clouds 传它自己的。
 */
runWorkspaceConformance({ describe, it }, "MemoryWorkspace(夹具)", async (opts) => {
  const handle = createMemoryWorkspace({ maxValueBytes: opts?.maxValueBytes });
  return {
    workspace: handle.workspace,
    corrupt: handle.corrupt,
    reopen: handle.reopen,
    // 内存实现无需清理;每次调用已是全新 Map,天然隔离。
    cleanup: async () => undefined,
  };
});
