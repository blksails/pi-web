// @vitest-environment node
/**
 * 共享状态的授权判定(spec panes-only-right-panel 任务 1.1;Req 2.5/2.6/2.7/2.8)。
 *
 * 三条性质:
 *  ① **读写分离** —— 读授权不蕴含写授权。写改的是 agent 也在读的同一份状态,是显著更强的
 *     权力,不该被「订阅这个键」顺带捎上。
 *  ② **越权拒绝不泄露键的存在性** —— 「未授权」与「键不存在」必须返回**逐字相同**的载荷。
 *     否则调用方可以拿拒绝消息当探针,枚举出会话里有哪些键。
 *  ③ **复用既有超限语义**,不另立一套错误码。
 */
import { describe, expect, it } from "vitest";
import {
  authorizePaneRequest,
  definePanes,
  PaneHostError,
  DEFAULT_PANE_REQUEST_BYTES,
  type PaneCapabilities,
  type PaneGuestRequest,
} from "../src/index.js";

const DOC = { kind: "inline", srcDoc: "<!doctype html><p>p</p>" } as const;

/** 读 `counter` 但**不能写**它;写 `draft` 但**不能读**它 —— 交叉授权最能暴露「一张表管两件事」。 */
const crossGranted = definePanes({
  id: "state-auth-probe",
  panes: [
    {
      id: "p",
      title: "P",
      document: DOC,
      capabilities: { state: { read: ["counter"], write: ["draft"] } },
    },
    // 零授权对照。
    { id: "q", title: "Q", document: DOC, capabilities: {} },
  ],
}).panes;

const granted = crossGranted[0]!.capabilities;
const zero = crossGranted[1]!.capabilities;

function setReq(key: string, value: unknown = 1): PaneGuestRequest {
  return { type: "pane:request", requestId: "r", operation: "state.set", key, value };
}
function delReq(key: string): PaneGuestRequest {
  return { type: "pane:request", requestId: "r", operation: "state.delete", key };
}

function denialOf(caps: PaneCapabilities, request: PaneGuestRequest): unknown {
  try {
    authorizePaneRequest(caps, request);
    return null;
  } catch (error) {
    return error instanceof PaneHostError ? error.toJSON() : { unexpected: String(error) };
  }
}

describe("① 读写分离(Req 2.5)", () => {
  it("★ 有读授权的键不因此获得写授权", () => {
    // counter 在 read 表里、不在 write 表里 —— 若实现用一张表管两件事,这条会绿得莫名其妙。
    expect(denialOf(granted, setReq("counter"))).not.toBeNull();
    expect(denialOf(granted, delReq("counter"))).not.toBeNull();
  });

  it("有写授权的键可以写(证明上一条不是「什么都拒」)", () => {
    expect(denialOf(granted, setReq("draft"))).toBeNull();
    expect(denialOf(granted, delReq("draft"))).toBeNull();
  });

  it("写授权不蕴含读授权(方向对称)", () => {
    // draft 可写但不在 read 表里。读不走上行请求(由宿主按 read 表推送),
    // 故此处断言的是**授权数据本身**没有把 write 并进 read。
    expect(granted.state.read).not.toContain("draft");
    expect(granted.state.write).not.toContain("counter");
  });

  it("零授权 pane 的读写表均为空,任何键都写不了", () => {
    expect(zero.state.read).toEqual([]);
    expect(zero.state.write).toEqual([]);
    expect(denialOf(zero, setReq("draft"))).not.toBeNull();
  });
});

describe("★ ② 越权拒绝不泄露键的存在性(Req 2.6)", () => {
  it("★ 「未授权的已知键」与「完全不存在的键」拒绝载荷逐字一致", () => {
    // counter 是这个 pane 知道的键(它有读授权);zzz-nonexistent 则是随口编的。
    // 两者都不在 write 表里 ⇒ 拒绝载荷必须一模一样,否则消息本身就是存在性探针。
    const knownButUnwritable = denialOf(granted, setReq("counter"));
    const totallyUnknown = denialOf(granted, setReq("zzz-nonexistent"));
    expect(knownButUnwritable).not.toBeNull();
    expect(knownButUnwritable).toEqual(totallyUnknown);
  });

  it("★ 拒绝消息不含任何键名(带上键名就等于回显了探针输入)", () => {
    const payload = denialOf(granted, setReq("counter")) as { message: string };
    expect(payload.message).not.toContain("counter");
    const other = denialOf(granted, setReq("secret-key-name")) as { message: string };
    expect(other.message).not.toContain("secret-key-name");
    // 两条消息因此必然相同 —— 这是上一条的机制性原因。
    expect(payload.message).toBe(other.message);
  });

  it("删除与设置的拒绝载荷同样一致(别只堵一半)", () => {
    expect(denialOf(granted, delReq("counter"))).toEqual(denialOf(granted, delReq("nope")));
  });
});

describe("③ 复用既有错误语义(Req 2.7/2.8)", () => {
  it("拒绝码是既有的能力被拒码,不新增码", () => {
    expect((denialOf(granted, setReq("counter")) as { code: string }).code).toBe("CAPABILITY_DENIED");
  });

  it("★ 超限走既有的载荷过大码,且**先过授权门**", () => {
    const huge = "x".repeat(DEFAULT_PANE_REQUEST_BYTES + 1024);
    // 已授权的键 + 超大载荷 → 载荷过大。
    expect((denialOf(granted, setReq("draft", huge)) as { code: string }).code).toBe("PAYLOAD_TOO_LARGE");
    // ★ 未授权的键 + 超大载荷 → 仍是能力被拒。顺序反了的话,越权者能靠错误码差异
    // 得知「这个键存在且我只是载荷太大」。
    expect((denialOf(granted, setReq("counter", huge)) as { code: string }).code).toBe("CAPABILITY_DENIED");
  });

  it("删除操作不做载荷校验(它没有载荷)", () => {
    expect(denialOf(granted, delReq("draft"))).toBeNull();
  });
});

describe("授权只源于已装载定义(Req 2.7)", () => {
  it("★ pane 自报的标识不产生任何共享状态权限", () => {
    // 请求消息里没有任何 pane 标识字段 —— 授权只看传入的 capabilities。
    // 这条与既有的「内置身份不提权」同源:授权判定拿不到 pane 标识。
    const parsed = setReq("draft") as Record<string, unknown>;
    expect(Object.keys(parsed).filter((k) => /paneid|pane_id/i.test(k))).toEqual([]);
    expect(authorizePaneRequest.length).toBe(2);
  });
});
