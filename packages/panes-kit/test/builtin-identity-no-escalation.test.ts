// @vitest-environment node
//
// 刻意用 node 而非 jsdom:本文件一处 DOM 都不碰(第③条断言落在**定义层** —— capabilities 是
// 逐 pane 的对象,隔离性在那里就已成立,不必渲染 iframe 去证),而 jsdom 下 `import.meta.url`
// 不是 file: scheme,源码级断言里的 fileURLToPath 会直接抛。
/**
 * 内置身份不提权(spec host-builtin-panes 任务 6.3;Req 4.1/4.2/4.3/4.4)。
 *
 * 守的性质:**`host:` 是命名空间,不是特权位。**
 *
 * 风险场景不抽象 —— 将来要给内置 pane 加一个便利能力,最省事的写法就是在授权判定里加一句
 * `if (paneId.startsWith(HOST_PANE_ID_PREFIX)) return`。那一刻,任何能让宿主装载一个带前缀
 * pane 的路径都变成提权路径,而 pane 是 `sandbox="allow-scripts"` 的 opaque origin,隔离
 * 边界的意义随之消失。
 *
 * ★ 本文件刻意**用带保留前缀的夹具 pane,不引真实内置清单**。依赖方向是
 * `panes-kit → ui → app`,引 `lib/app/builtin-panes/` 就是反向依赖,会把 app 层拖进内核包的
 * 测试图。而要证的性质是「前缀不产生特权」—— 一个凭空造的 `host:fixture` 完全够,真实清单
 * 反而混入了无关变量(它自己的 capabilities 恰好全空,那是另一回事)。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  authorizePaneRequest,
  definePanes,
  HOST_PANE_ID_PREFIX,
  PaneHostError,
  PaneGuestRequestSchema,
  type PaneCapabilities,
  type PaneGuestRequest,
} from "../src/index.js";

const DOC = { kind: "inline", srcDoc: "<!doctype html><p>p</p>" } as const;

/**
 * 两个**除标识外逐字相同**的夹具:一个占保留前缀,一个不占。
 *
 * capabilities 全空(零授权)—— 这是「不提权」最尖锐的形态:如果前缀有任何特权效果,
 * 零授权的带前缀 pane 就会在某个操作上被放行,而它的无前缀孪生兄弟被拒。
 */
const fixtures = definePanes({
  id: "escalation-probe",
  panes: [
    { id: `${HOST_PANE_ID_PREFIX}fixture`, title: "带保留前缀", document: DOC, capabilities: {} },
    { id: "plain-fixture", title: "不带前缀", document: DOC, capabilities: {} },
  ],
});

const prefixed = fixtures.panes[0]!;
const plain = fixtures.panes[1]!;

/** 受管操作全集 —— 覆盖 authorizePaneRequest 的每一条分支。 */
const MANAGED_REQUESTS: ReadonlyArray<{ readonly label: string; readonly request: PaneGuestRequest }> = [
  {
    label: "route.query",
    request: { type: "pane:request", requestId: "r1", operation: "route.query", route: "files" },
  },
  {
    label: "route.mutate",
    request: { type: "pane:request", requestId: "r2", operation: "route.mutate", route: "files", body: { a: 1 } },
  },
  {
    label: "surface.run",
    request: { type: "pane:request", requestId: "r3", operation: "surface.run", domain: "canvas", action: "sync" },
  },
  {
    label: "event.publish",
    request: { type: "pane:request", requestId: "r4", operation: "event.publish", topic: "t", payload: 1 },
  },
  {
    label: "attachment.put",
    request: {
      type: "pane:request",
      requestId: "r5",
      operation: "attachment.put",
      name: "a.txt",
      mimeType: "text/plain",
      bytes: new ArrayBuffer(4),
    },
  },
  {
    label: "conversation.submit",
    request: { type: "pane:request", requestId: "r6", operation: "conversation.submit", text: "hi" },
  },
];

/** 跑一次授权,把拒绝载荷取回(未拒则返回 null —— 那本身就是断言失败信号)。 */
function denialOf(capabilities: PaneCapabilities, request: PaneGuestRequest): unknown {
  try {
    authorizePaneRequest(capabilities, request);
    return null;
  } catch (error) {
    return error instanceof PaneHostError ? error.toJSON() : { unexpected: String(error) };
  }
}

describe("① 零授权的带前缀 pane 与无前缀 pane 拒绝载荷逐字一致(Req 4.1/4.4)", () => {
  it.each(MANAGED_REQUESTS)("$label 两者拒绝载荷逐字一致", ({ request }) => {
    const a = denialOf(prefixed.capabilities, request);
    const b = denialOf(plain.capabilities, request);
    // 先证明这确实是「被拒」的场景 —— 若两者都放行,下面的 toEqual(null, null) 会静默通过,
    // 那正是假绿(零授权却全放行是比不一致更严重的缺陷)。
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    // ★ 判别力所在:有人给保留前缀加了特权分支,两者就会分叉,这里报红。
    expect(a).toEqual(b);
  });

  it("★ 拒绝码统一为 CAPABILITY_DENIED,不因前缀而异", () => {
    for (const { request } of MANAGED_REQUESTS) {
      expect((denialOf(prefixed.capabilities, request) as { code: string }).code).toBe("CAPABILITY_DENIED");
    }
  });

  it("★ 授予同一能力后两者同样被放行(不是「都拒」这种平凡一致)", () => {
    // 只证「都拒一致」的话,一个恒抛异常的实现也能通过。这里补正向:同样授权 ⇒ 同样放行。
    const granted: PaneCapabilities = {
      ...prefixed.capabilities,
      surfaceCommands: [{ domain: "canvas", actions: ["sync"] }],
    };
    const request = MANAGED_REQUESTS.find((r) => r.label === "surface.run")!.request;
    expect(denialOf(granted, request)).toBeNull();
    expect(denialOf({ ...plain.capabilities, surfaceCommands: [{ domain: "canvas", actions: ["sync"] }] }, request)).toBeNull();
  });
});

describe("② 保留前缀不出现在任何授权判定条件中(Req 4.2)", () => {
  it("★ 授权函数签名里没有 pane 标识通道(结构性,不靠行为推断)", () => {
    // authorizePaneRequest(capabilities, request) —— 两个形参。加第三个 paneId 参数是
    // 引入前缀特权最直接的路径,这条把它钉住。
    expect(authorizePaneRequest.length).toBe(2);
  });

  it("★ 请求消息的任何变体都不含 pane 标识字段(guest 无从自报身份影响授权)", () => {
    // 即使不改签名,也可以把 paneId 塞进请求体里分支 —— 那样 guest 还能自报,更糟。
    for (const { request } of MANAGED_REQUESTS) {
      const parsed = PaneGuestRequestSchema.parse(request) as Record<string, unknown>;
      // zod 剥掉未知键;若有人给 schema 加了 paneId,这里就会出现该键。
      const idish = Object.keys(parsed).filter((k) => /paneid|pane_id/i.test(k));
      expect(idish).toEqual([]);
    }
  });

  it("★ 授权模块源码不引用保留前缀(有特权分支必然要引用它)", () => {
    // 源码级断言:前两条管住了「通过参数/消息拿 paneId」,但闭包捕获、模块级变量等路径它们
    // 抓不到。而任何按前缀分支的实现都必须引用这个前缀 —— 无论从哪拿到 paneId。
    const src = readFileSync(
      fileURLToPath(new URL("../src/authorization.ts", import.meta.url)),
      "utf8",
    );
    expect(src).not.toContain(HOST_PANE_ID_PREFIX);
    expect(src).not.toContain("HOST_PANE_ID_PREFIX");
    // 前缀常量住在 merge.ts;授权模块不该依赖它。
    expect(src).not.toMatch(/from\s+"\.\/merge\.js"/);
  });

  it("前缀常量本身仍是可用的(上一条不是因为常量被删而空过)", () => {
    // 判别力兜底:若 HOST_PANE_ID_PREFIX 变成空字符串,上面的 not.toContain 会恒真。
    expect(HOST_PANE_ID_PREFIX.length).toBeGreaterThan(0);
    expect(prefixed.id.startsWith(HOST_PANE_ID_PREFIX)).toBe(true);
    expect(plain.id.startsWith(HOST_PANE_ID_PREFIX)).toBe(false);
  });
});

describe("③ 两个 pane 同时在世时互不可见对方运行环境(Req 4.3)", () => {
  it("★ 定义解析不让带前缀 pane 看见同伴的能力(每个 pane 只持有自己的 grants)", () => {
    // capabilities 是**逐 pane** 的对象,不存在共享/继承通道。给无前缀 pane 授权,
    // 带前缀的那个不得因此获得任何东西 —— 反之亦然。
    const withGrants = definePanes({
      id: "isolation-probe",
      panes: [
        { id: `${HOST_PANE_ID_PREFIX}a`, title: "A", document: DOC, capabilities: {} },
        {
          id: "b",
          title: "B",
          document: DOC,
          capabilities: {
            routes: [{ name: "secret", methods: ["GET"] }],
            attachments: "read-write",
            conversation: "submit",
          },
        },
      ],
    });
    const a = withGrants.panes[0]!;
    const request: PaneGuestRequest = {
      type: "pane:request",
      requestId: "x",
      operation: "route.query",
      route: "secret",
    };
    // A 不得蹭到 B 的 route 授权。
    expect(denialOf(a.capabilities, request)).not.toBeNull();
    expect(a.capabilities.routes).toEqual([]);
    expect(a.capabilities.attachments).toBe("none");
    expect(a.capabilities.conversation).toBe("none");
    // 对照:B 自己是被放行的(否则上面那条可能只是「谁都拒」)。
    expect(denialOf(withGrants.panes[1]!.capabilities, request)).toBeNull();
  });

  it("★ 各 pane 的文档相互独立,带前缀者不获得更宽的隔离豁免", () => {
    // 两个夹具的 document 是各自的 inline srcDoc —— 没有「内置 pane 走 same-origin」这种
    // 分支。文档形态相同是「同构隔离」在定义层的体现(iframe sandbox 属性由 PanesHost 统一
    // 施加,已在 panes-host 的用例里断言)。
    expect(prefixed.document.kind).toBe("inline");
    expect(plain.document.kind).toBe(prefixed.document.kind);
  });
});
