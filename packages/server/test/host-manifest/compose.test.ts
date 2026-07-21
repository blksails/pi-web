import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { HOST_CAPABILITY_IDS_V1 } from "../../src/host-manifest/capability-ids.js";
import { composeCapabilities } from "../../src/host-manifest/compose.js";
import {
  CapabilityCompositionError,
  type CapabilityDecision,
  type CapabilityDescriptor,
} from "../../src/host-manifest/types.js";

/**
 * host-contract-ports 任务 5.2 —— 能力面名册与组装引擎(Req 6.1-6.7)。
 *
 * 本文件的判别力约定(tasks.md Implementation Notes「变异测试」「伪装成守卫的恒真断言」):
 *  - 名册不做「复制一份 id 再比对自己」的无判别力断言,而是以**契约文档**
 *    `docs/pi-web-host-contract-v1.md` §5.3 的冻结表格为独立对照物 —— 代码侧任何
 *    增删改名都会与文档失配而转红,且不需要在测试里再抄一份名单。
 *  - 校验顺序用例必须**同时**触发未知与缺失两种违规,否则「先未知后缺失」的断言恒真。
 */

/** 测试用的最小路由型与依赖型:证明引擎对二者均泛型化,不依赖既有 HTTP 模块。 */
interface FakeRoute {
  readonly path: string;
}
interface FakeDeps {
  readonly tag: string;
}

function descriptor(
  id: string,
  factory: (deps: FakeDeps) => readonly FakeRoute[],
): CapabilityDescriptor<FakeDeps, FakeRoute> {
  return { id, factory };
}

/** 产出单条路由的工厂,路径带来源标记以便断言「谁被采用了」。 */
function routeFactory(mark: string) {
  return vi.fn((deps: FakeDeps): readonly FakeRoute[] => [{ path: `/${mark}/${deps.tag}` }]);
}

const DEPS: FakeDeps = { tag: "t" };

function catchComposition(run: () => unknown): CapabilityCompositionError {
  let caught: unknown;
  try {
    run();
  } catch (err) {
    caught = err;
  }
  expect(caught, "expected composeCapabilities to throw").toBeDefined();
  return caught as CapabilityCompositionError;
}

describe("HOST_CAPABILITY_IDS_V1(v1 冻结名册)", () => {
  /** 从契约文档 §5.3 的表格中提取第一列的 id(独立于代码的对照物)。 */
  function readFrozenIdsFromContract(): readonly string[] {
    const contractPath = fileURLToPath(
      new URL("../../../../docs/pi-web-host-contract-v1.md", import.meta.url),
    );
    const doc = readFileSync(contractPath, "utf8");
    const section = doc.slice(doc.indexOf("### 5.3"));
    const table = section.slice(0, section.indexOf("\n>"));
    const ids: string[] = [];
    for (const line of table.split("\n")) {
      const id = /^\|\s*`([^`]+)`\s*\|/.exec(line)?.[1];
      if (id !== undefined) ids.push(id);
    }
    // 自检:对照物本身必须真的解析出了内容,否则下面的比对会因两边同为空而恒真。
    expect(ids.length).toBeGreaterThan(0);
    return ids;
  }

  it("与契约文档 §5.3 的冻结表格逐项一致(顺序无关的集合相等)", () => {
    const fromContract = readFrozenIdsFromContract();
    expect([...HOST_CAPABILITY_IDS_V1].sort()).toEqual([...fromContract].sort());
  });

  it("恰为 16 项且无重复", () => {
    expect(HOST_CAPABILITY_IDS_V1).toHaveLength(16);
    expect(new Set(HOST_CAPABILITY_IDS_V1).size).toBe(16);
  });

  it("每个 id 均为 `<组>.<名>` 形态(契约 §5.1 的命名约定)", () => {
    for (const id of HOST_CAPABILITY_IDS_V1) {
      expect(id, `id ${id} 不符合 <组>.<名>`).toMatch(/^[a-z][a-zA-Z]*\.[a-z][a-zA-Z]*$/);
    }
  });

  it("不含两个被判定为领域泄漏的工具模型清单端点(17 − 2 = 15 路由 + 1 非路由)", () => {
    // 负向锁:防止后人「补全」成 17 项 —— 这两项按集成设计 §5 将被删除而非表态。
    expect(HOST_CAPABILITY_IDS_V1).not.toContain("aigc.models");
    expect(HOST_CAPABILITY_IDS_V1).not.toContain("vision.models");
  });

  it("含非路由的宿主命令能力(它今天正因无表态而在云端静默缺席)", () => {
    expect(HOST_CAPABILITY_IDS_V1).toContain("host.commands");
  });
});

describe("composeCapabilities(表态组装)", () => {
  it("表态为沿用时采用默认工厂,并按描述符顺序拼接路由(Req 6.3)", () => {
    const a = routeFactory("a");
    const b = routeFactory("b");
    const routes = composeCapabilities({
      descriptors: [descriptor("x.a", a), descriptor("x.b", b)],
      decisions: { "x.a": { kind: "use" }, "x.b": { kind: "use" } },
      deps: DEPS,
    });

    expect(routes).toEqual([{ path: "/a/t" }, { path: "/b/t" }]);
    // deps 必须原样透传给工厂,而不是被引擎包装或丢弃。
    expect(a).toHaveBeenCalledWith(DEPS);
  });

  it("表态为替换时采用宿主工厂,且默认工厂完全不被调用(Req 6.4)", () => {
    const original = routeFactory("orig");
    const replacement = routeFactory("host");
    const routes = composeCapabilities({
      descriptors: [descriptor("x.a", original)],
      decisions: { "x.a": { kind: "replace", factory: replacement } },
      deps: DEPS,
    });

    expect(routes).toEqual([{ path: "/host/t" }]);
    // 只断言结果会漏过「两个都调用、取后者」的实现:默认工厂的副作用(建连、注册)仍会发生。
    expect(original).not.toHaveBeenCalled();
    expect(replacement).toHaveBeenCalledTimes(1);
  });

  it("表态为弃用时不产出任何路由,且原因经回调通知(Req 6.6)", () => {
    const declined = routeFactory("declined");
    const kept = routeFactory("kept");
    const onDecline = vi.fn();

    const routes = composeCapabilities({
      descriptors: [descriptor("x.a", declined), descriptor("x.b", kept)],
      decisions: {
        "x.a": { kind: "decline", reason: "云端由网关承担" },
        "x.b": { kind: "use" },
      },
      deps: DEPS,
      onDecline,
    });

    expect(routes).toEqual([{ path: "/kept/t" }]);
    expect(declined).not.toHaveBeenCalled();
    expect(onDecline).toHaveBeenCalledTimes(1);
    expect(onDecline).toHaveBeenCalledWith("x.a", "云端由网关承担");
  });

  it("不传弃用回调时仍正常组装(回调可选)", () => {
    const routes = composeCapabilities({
      descriptors: [descriptor("x.a", routeFactory("a"))],
      decisions: { "x.a": { kind: "decline", reason: "不需要" } },
      deps: DEPS,
    });
    expect(routes).toEqual([]);
  });

  it("存在未表态的标识时抛错并列出**是哪些**(Req 6.2)", () => {
    const unstated = routeFactory("a");
    // ★ 守卫的**真**靶子:x.b 是本例中唯一**已表态**的能力面。未表态的 x.a/x.c 任何实现
    // 都不会去调,拿它们断言「工厂未被调用」是恒真的;只有已表态者才可能被急切调用。
    const decided = routeFactory("b");
    const err = catchComposition(() =>
      composeCapabilities({
        descriptors: [
          descriptor("x.a", unstated),
          descriptor("x.b", decided),
          descriptor("x.c", routeFactory("c")),
        ],
        decisions: { "x.b": { kind: "use" } },
        deps: DEPS,
      }),
    );

    expect(err.code).toBe("missing-decision");
    // 计数不够:宿主拿着「缺 2 个」只能自己找,拿着列表才能直接补。
    expect([...err.ids].sort()).toEqual(["x.a", "x.c"]);
    expect(err.message).toContain("x.a");
    expect(err.message).toContain("x.c");
    // 校验必须在组装之前完成:**已表态的** x.b 工厂同样不得被调用,否则一个注定失败的
    // 组装会先留下建连、注册这类**不可回滚**的外部副作用。
    expect(decided).not.toHaveBeenCalled();
    expect(unstated).not.toHaveBeenCalled();
  });

  it("表态引用名册外的未知标识时抛错并列出**是哪些**(Req 6.7)", () => {
    const err = catchComposition(() =>
      composeCapabilities({
        descriptors: [descriptor("x.a", routeFactory("a"))],
        decisions: {
          "x.a": { kind: "use" },
          "x.typo": { kind: "use" },
          "x.other": { kind: "decline", reason: "r" },
        },
        deps: DEPS,
      }),
    );

    expect(err.code).toBe("unknown-id");
    expect([...err.ids].sort()).toEqual(["x.other", "x.typo"]);
    expect(err.message).toContain("x.typo");
  });

  it("同时存在未知标识与缺失表态时**只报未知**(校验顺序:先未知、后缺失)", () => {
    // 这正是宿主把 `x.a` 拼错成 `x.aa` 的形态:先报缺失会同时抱怨「缺 x.a」和「多 x.aa」,
    // 两条互相矛盾;先报未知则直指打字错误。用例必须同时触发两者,否则顺序断言恒真。
    const err = catchComposition(() =>
      composeCapabilities({
        descriptors: [descriptor("x.a", routeFactory("a"))],
        decisions: { "x.aa": { kind: "use" } },
        deps: DEPS,
      }),
    );

    expect(err.code).toBe("unknown-id");
    expect(err.ids).toEqual(["x.aa"]);
  });

  it("弃用原因为空或纯空白时抛错(Req 6.5)", () => {
    for (const reason of ["", "   ", "\n\t"]) {
      const onDecline = vi.fn();
      const err = catchComposition(() =>
        composeCapabilities({
          descriptors: [descriptor("x.a", routeFactory("a"))],
          decisions: { "x.a": { kind: "decline", reason } },
          deps: DEPS,
          onDecline,
        }),
      );

      expect(err.code, `reason ${JSON.stringify(reason)} 应被拒绝`).toBe("empty-reason");
      expect(err.ids).toEqual(["x.a"]);
      // 空原因不得先通知再抛:否则启动日志里会留下一条无内容的「有据可查的弃用」。
      expect(onDecline).not.toHaveBeenCalled();
    }
  });

  it("多个弃用原因为空时一次性列出全部(错误携带标识列表)", () => {
    const err = catchComposition(() =>
      composeCapabilities({
        descriptors: [
          descriptor("x.a", routeFactory("a")),
          descriptor("x.b", routeFactory("b")),
        ],
        decisions: {
          "x.a": { kind: "decline", reason: " " },
          "x.b": { kind: "decline", reason: "" },
        },
        deps: DEPS,
      }),
    );

    expect(err.code).toBe("empty-reason");
    expect([...err.ids].sort()).toEqual(["x.a", "x.b"]);
  });

  it("空名册与空表态组装出空路由集(不抛错)", () => {
    expect(composeCapabilities({ descriptors: [], decisions: {}, deps: DEPS })).toEqual([]);
  });
});

describe("CapabilityCompositionError", () => {
  it("按 code 判别且携带 ids(跨包 instanceof 不可靠 —— 与 WorkspaceError 同规)", () => {
    const err = new CapabilityCompositionError("missing-decision", ["a.b"], "…");
    expect(err.code).toBe("missing-decision");
    expect(err.ids).toEqual(["a.b"]);
    expect(err.name).toBe("CapabilityCompositionError");
  });

  it("表态联合类型的三种形态均可赋值(泛型化的路由型与依赖型)", () => {
    const decisions: readonly CapabilityDecision<FakeDeps, FakeRoute>[] = [
      { kind: "use" },
      { kind: "replace", factory: () => [{ path: "/x" }] },
      { kind: "decline", reason: "r" },
    ];
    expect(decisions.map((d) => d.kind)).toEqual(["use", "replace", "decline"]);
  });
});
