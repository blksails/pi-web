/**
 * Node-level e2e — AskUserQuestion 富卡片的帧级闭环(离线 stub,无 LLM 成本)。
 *
 * spec: ask-user-question-card,任务 4.2;Req 5.1 / 5.3 / 6.3。
 *
 * 经真实 HTTP handler(REST + SSE)驱动 stub agent:prompt 含 `ext-askq` sentinel 时,
 * stub 用 **protocol 共享 codec** 把富问题组编码进 `extension_ui_request(select)` 的 title;
 * 前端(此处由测试代劳)以 `encodeAskAnswers` 编出的富答案 POST `/ui-response`,stub 解码后
 * echo 出结构化答案并 finish。
 *
 * 证明「发起富问题组 → 富作答回传 → 续跑得结构化结果」闭环 —— 这是 UI 单测
 * (`packages/ui/test/elements/ask-user-question-card.test.tsx`)之上的**帧级**佐证:
 * 单测只证组件会渲染,本用例证协议编解码在真实传输链路上往返无损。
 *
 * **零协议改动佐证**(Req 6.3):富卡片完全承载在既有 `select` 方法的 title/options 里,
 * 故 `protocolVersion` 仍是 0.1.0 —— 本用例显式断言之。
 */
import { afterAll, describe, expect, it } from "vitest";
import path from "node:path";

process.env.PI_WEB_STUB_AGENT = "1";
process.env.PI_WEB_STUB_AGENT_PATH = path.join(
  process.cwd(),
  "lib",
  "app",
  "stub-agent-process.mjs",
);

const route = await import("@/lib/app/api-route");
const { shutdownHandler } = await import("@/lib/app/pi-handler");
const {
  ASK_TITLE_SENTINEL,
  ASK_ANSWER_SENTINEL,
  encodeAskAnswers,
  isAskTitle,
  decodeAskTitle,
  protocolVersion,
} = await import("@blksails/pi-web-protocol");

afterAll(async () => {
  await shutdownHandler();
});

function reqOf(pathname: string, init?: RequestInit): Request {
  return new Request(`http://localhost${pathname}`, init);
}

async function createSession(source: string): Promise<string> {
  const res = await route.POST(
    reqOf("/api/sessions", { method: "POST", body: JSON.stringify({ source }) }),
  );
  expect([200, 201]).toContain(res.status);
  const body = (await res.json()) as { sessionId: string };
  return body.sessionId;
}

function readUntil(
  res: Response,
  predicate: (text: string) => boolean,
  maxMs: number,
): { text: () => string; done: Promise<void>; cancel: () => Promise<void> } {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let acc = "";
  const deadline = Date.now() + maxMs;
  const done = (async () => {
    while (Date.now() < deadline) {
      const { done: d, value } = await reader.read();
      if (value !== undefined) acc += decoder.decode(value, { stream: true });
      if (d) break;
      if (predicate(acc)) break;
    }
  })();
  return { text: () => acc, done, cancel: () => reader.cancel() };
}

async function postJson(pathname: string, body: unknown): Promise<Response> {
  const res = await route.POST(reqOf(pathname, { method: "POST", body: JSON.stringify(body) }));
  expect(res.status).toBeGreaterThanOrEqual(200);
  expect(res.status).toBeLessThan(300);
  return res;
}

describe("AskUserQuestion 富卡片帧级闭环(离线 stub)", () => {
  it("富问题组经 select 帧下发(title 含哨兵),富答案回传后 stub echo 出结构化结果并 finish", async () => {
    const id = await createSession("./examples/ask-user-question-agent");

    // Phase 1:带 ext-askq sentinel 的 prompt → stub 发富问题组并暂停。
    const s1 = await route.GET(reqOf(`/api/sessions/${id}/stream`, { method: "GET" }));
    expect(s1.headers.get("content-type")).toContain("text/event-stream");
    const p1 = readUntil(s1, (t) => t.includes('"askq-1"'), 15000);
    const promptRes = await route.POST(
      reqOf(`/api/sessions/${id}/messages`, {
        method: "POST",
        body: JSON.stringify({ message: "how to release? (ext-askq)" }),
      }),
    );
    expect(promptRes.status).toBe(200);
    await p1.done;
    const t1 = p1.text();
    await p1.cancel();

    // 帧确实是 extension-ui 的 select 请求。
    expect(t1).toContain("extension-ui");
    expect(t1).toContain('"askq-1"');
    // ★ 富卡片的判据:title 携带编码哨兵(前端据此升级为富卡片渲染,否则回退纯文本 select)。
    // 变异判据:若 stub 改回发纯文本 title,此断言转红。
    expect(t1).toContain(ASK_TITLE_SENTINEL);

    // 从帧里取出真实 title 并用协议判定函数确认(不靠字符串猜测)。
    const titleMatch = /"title":"((?:[^"\\]|\\.)*)"/.exec(t1);
    expect(titleMatch).not.toBeNull();
    const rawTitle = JSON.parse(`"${titleMatch![1]}"`) as string;
    expect(isAskTitle(rawTitle)).toBe(true);

    // 更强的往返校验:解码回富问题组,确认 stub 的确定性夹具无损穿过传输层。
    const decodedGroup = decodeAskTitle(rawTitle);
    expect(decodedGroup).toBeDefined();
    expect(decodedGroup!.questions[0]?.header).toBe("Release path");
    expect(decodedGroup!.questions[0]?.options.map((o) => o.label)).toEqual(["Canary", "Direct"]);

    // Phase 2:回传**富答案**(经共享 codec 编码)→ stub 解码后 echo 结构化结果并结束。
    const s2 = await route.GET(reqOf(`/api/sessions/${id}/stream`, { method: "GET" }));
    const p2 = readUntil(s2, (t) => t.includes('"finish"'), 15000);
    const richValue = encodeAskAnswers({
      answers: [
        {
          header: "Release path",
          question: "How should the release proceed?",
          selected: ["Canary"],
          other: "with extra checks",
        },
      ],
    });
    expect(richValue.startsWith(ASK_ANSWER_SENTINEL)).toBe(true);
    await postJson(`/api/sessions/${id}/ui-response`, {
      type: "extension_ui_response",
      id: "askq-1",
      value: richValue,
    });
    await p2.done;
    const t2 = p2.text();
    await p2.cancel();

    // stub 解码成功 → echo 出结构化答案(header + 选项 + other),而非降级的 raw value。
    // 变异判据:若答案未经哨兵编码,stub 会走 degraded 分支,以下断言转红。
    expect(t2).toContain("AskUserQuestion answer");
    expect(t2).toContain("Release path");
    expect(t2).toContain("Canary");
    expect(t2).toContain("with extra checks");
    expect(t2).not.toContain("degraded");
    expect(t2).toContain('"finish"');
  }, 45000);

  it("零协议改动佐证:富卡片承载于既有 select 方法,protocolVersion 仍为 0.1.0(Req 6.3)", () => {
    expect(protocolVersion).toBe("0.1.0");
  });
});
