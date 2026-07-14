/**
 * agent-attachment-catalog spec,任务 3.1:PiSession 目录面与事件转发(Req 1.4, 2.4, 4.2)。
 *
 * 覆盖:
 * - 声明帧缓存:`attachmentCatalogAvailable`(无声明恒 false;合法声明帧就绪门前即缓存;
 *   畸形帧丢弃不缓存)。
 * - `requestCatalog`:list/materialize 两态发请求帧→按 id 配对结果帧 resolve;超时
 *   reject `AttachmentCatalogTimeoutError`;未知/迟到 id 安全丢弃;并发独立配对;
 *   会话已停/收尾时 reject。
 * - 事件帧转发:合法 `piweb_attachment_event` → SSE `control:"attachment"`,尾沿节流
 *   ≤1 帧/秒;畸形事件帧 warn+丢弃,不转发不失败会话。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { PiSession } from "../../src/session/pi-session.js";
import { AttachmentCatalogTimeoutError } from "../../src/session/session.errors.js";
import { MockChannel } from "./mock-channel.js";
import { makeResolved } from "./fixtures.js";

function newSession(ch: MockChannel, opts?: { readinessHandshake?: boolean }): PiSession {
  return new PiSession({
    id: "s1",
    resolved: makeResolved(),
    channel: ch,
    idleMs: 0,
    ...(opts ?? {}),
  });
}

/** 取出最近一条 piweb_attachment_catalog_request 请求行(解析后)。 */
function lastCatalogRequest(ch: MockChannel): { id: string; [k: string]: unknown } {
  const line = [...ch.sent]
    .reverse()
    .find((l) => l.includes("piweb_attachment_catalog_request"));
  expect(line).toBeDefined();
  return JSON.parse(line as string) as { id: string; [k: string]: unknown };
}

const ATTACHMENT_FIXTURE = {
  id: "att_abc123",
  name: "report.pdf",
  mimeType: "application/pdf",
  size: 10,
  origin: "tool-output" as const,
  sessionId: "s1",
  createdAt: new Date().toISOString(),
};

afterEach(() => {
  vi.useRealTimers();
});

describe("PiSession.attachmentCatalogAvailable(声明帧缓存,Req 1.4)", () => {
  it("默认无声明 → false", () => {
    const s = newSession(new MockChannel());
    expect(s.attachmentCatalogAvailable).toBe(false);
  });

  it("装配期 agent_attachment_catalog 帧 → 就绪门前(lifecycle=initializing)即缓存", () => {
    const ch = new MockChannel();
    const s = newSession(ch, { readinessHandshake: true });
    expect(s.lifecycle).toBe("initializing");
    ch.emitLine(JSON.stringify({ type: "agent_attachment_catalog", available: true }));
    expect(s.lifecycle).toBe("initializing");
    expect(s.attachmentCatalogAvailable).toBe(true);
  });

  it("畸形声明帧(available:false)→ 丢弃,不缓存", () => {
    const ch = new MockChannel();
    const s = newSession(ch);
    ch.emitLine(JSON.stringify({ type: "agent_attachment_catalog", available: false }));
    expect(s.attachmentCatalogAvailable).toBe(false);
  });
});

describe("PiSession.requestCatalog(同步配对,Req 2.4)", () => {
  it("list:发请求帧并按 id 配对结果帧 resolve", async () => {
    const ch = new MockChannel();
    const s = newSession(ch);
    const p = s.requestCatalog({ op: "list", query: "rep" });
    const sent = lastCatalogRequest(ch);
    expect(sent).toMatchObject({
      type: "piweb_attachment_catalog_request",
      op: "list",
      query: "rep",
    });
    ch.emitLine(
      JSON.stringify({
        type: "piweb_attachment_catalog_result",
        id: sent.id,
        ok: true,
        entries: [{ id: "entry-1", name: "Report" }],
      }),
    );
    await expect(p).resolves.toMatchObject({
      ok: true,
      entries: [{ id: "entry-1", name: "Report" }],
    });
  });

  it("materialize:发请求帧并按 id 配对结果帧 resolve", async () => {
    const ch = new MockChannel();
    const s = newSession(ch);
    const p = s.requestCatalog({ op: "materialize", entryId: "entry-1" });
    const sent = lastCatalogRequest(ch);
    expect(sent).toMatchObject({
      type: "piweb_attachment_catalog_request",
      op: "materialize",
      entryId: "entry-1",
    });
    ch.emitLine(
      JSON.stringify({
        type: "piweb_attachment_catalog_result",
        id: sent.id,
        ok: true,
        attachmentId: "att_abc123",
      }),
    );
    await expect(p).resolves.toMatchObject({ ok: true, attachmentId: "att_abc123" });
  });

  it("ok:false 以返回值表达(不 reject)", async () => {
    const ch = new MockChannel();
    const s = newSession(ch);
    const p = s.requestCatalog({ op: "materialize", entryId: "ghost" });
    const sent = lastCatalogRequest(ch);
    ch.emitLine(
      JSON.stringify({
        type: "piweb_attachment_catalog_result",
        id: sent.id,
        ok: false,
        error: { code: "ENTRY_NOT_FOUND", message: "no such entry" },
      }),
    );
    await expect(p).resolves.toMatchObject({
      ok: false,
      error: { code: "ENTRY_NOT_FOUND", message: "no such entry" },
    });
  });

  it("无结果帧时按超时 reject AttachmentCatalogTimeoutError", async () => {
    const ch = new MockChannel();
    const s = newSession(ch);
    await expect(
      s.requestCatalog({ op: "list", query: "" }, 20),
    ).rejects.toBeInstanceOf(AttachmentCatalogTimeoutError);
  });

  it("默认超时为代码内 20s(不读 env)", async () => {
    vi.useFakeTimers();
    const ch = new MockChannel();
    const s = newSession(ch);
    const p = s.requestCatalog({ op: "list", query: "" });
    const rejected = vi.fn();
    p.catch(rejected);
    await vi.advanceTimersByTimeAsync(19_999);
    expect(rejected).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(rejected).toHaveBeenCalledOnce();
    expect(rejected.mock.calls[0]?.[0]).toBeInstanceOf(AttachmentCatalogTimeoutError);
  });

  it("未知/迟到 id 与畸形结果帧安全丢弃", async () => {
    const ch = new MockChannel();
    const s = newSession(ch);
    const p = s.requestCatalog({ op: "list", query: "" });
    const sent = lastCatalogRequest(ch);
    ch.emitLine(
      JSON.stringify({ type: "piweb_attachment_catalog_result", id: "other", ok: true }),
    );
    ch.emitLine(
      JSON.stringify({ type: "piweb_attachment_catalog_result", id: sent.id }),
    ); // 畸形(缺 ok)
    ch.emitLine(
      JSON.stringify({
        type: "piweb_attachment_catalog_result",
        id: sent.id,
        ok: true,
        entries: [],
      }),
    );
    await expect(p).resolves.toMatchObject({ ok: true, entries: [] });
  });

  it("并发多请求各自独立配对不串扰(乱序回流)", async () => {
    const ch = new MockChannel();
    const s = newSession(ch);
    const p1 = s.requestCatalog({ op: "list", query: "a" });
    const id1 = lastCatalogRequest(ch).id;
    const p2 = s.requestCatalog({ op: "list", query: "b" });
    const id2 = lastCatalogRequest(ch).id;
    expect(id1).not.toBe(id2);
    ch.emitLine(
      JSON.stringify({ type: "piweb_attachment_catalog_result", id: id2, ok: true, entries: [] }),
    );
    ch.emitLine(
      JSON.stringify({ type: "piweb_attachment_catalog_result", id: id1, ok: true, entries: [] }),
    );
    await expect(p1).resolves.toMatchObject({ id: id1 });
    await expect(p2).resolves.toMatchObject({ id: id2 });
  });

  it("会话已停时 reject(不下发请求)", async () => {
    const ch = new MockChannel();
    const s = newSession(ch);
    await s.stop("idle");
    const sentBefore = ch.sent.length;
    await expect(
      s.requestCatalog({ op: "list", query: "" }),
    ).rejects.toBeInstanceOf(Error);
    expect(ch.sent.length).toBe(sentBefore);
  });

  it("会话收尾时 reject 所有在途请求(不悬挂)", async () => {
    const ch = new MockChannel();
    const s = newSession(ch);
    const p = s.requestCatalog({ op: "list", query: "" });
    const guarded = p.catch((e: unknown) => e);
    await s.stop("idle");
    await expect(guarded).resolves.toBeInstanceOf(Error);
  });
});

describe("PiSession — piweb_attachment_event → control:attachment(Req 4.2)", () => {
  it("合法事件帧 → 立即转发一次(首次无节流积压)", () => {
    const ch = new MockChannel();
    const s = newSession(ch);
    const frames: unknown[] = [];
    s.subscribe((f) => frames.push(f));
    ch.emitLine(
      JSON.stringify({
        type: "piweb_attachment_event",
        event: "added",
        attachment: ATTACHMENT_FIXTURE,
      }),
    );
    const controlFrames = frames.filter(
      (f) => (f as { kind?: string }).kind === "control",
    ) as Array<{ payload: { control: string; event: string; attachment: { id: string } } }>;
    expect(controlFrames).toHaveLength(1);
    expect(controlFrames[0]?.payload).toMatchObject({
      control: "attachment",
      event: "added",
      attachment: { id: "att_abc123" },
    });
  });

  it("畸形事件帧(attachment 描述符不合法)→ warn+丢弃,不转发不失败会话", () => {
    const ch = new MockChannel();
    const s = newSession(ch);
    const frames: unknown[] = [];
    s.subscribe((f) => frames.push(f));
    expect(() =>
      ch.emitLine(
        JSON.stringify({
          type: "piweb_attachment_event",
          event: "added",
          attachment: { id: "att_abc123" }, // 缺必填字段
        }),
      ),
    ).not.toThrow();
    expect(frames.filter((f) => (f as { kind?: string }).kind === "control")).toHaveLength(0);
    expect(s.lifecycle).not.toBe("error");
  });

  it("尾沿节流:窗口内多次事件只补发最新一条(≤1 帧/秒防风暴)", () => {
    vi.useFakeTimers();
    const ch = new MockChannel();
    const s = newSession(ch);
    const frames: Array<{ payload: { attachment: { id: string } } }> = [];
    s.subscribe((f) => {
      if ((f as { kind?: string }).kind === "control") {
        frames.push(f as { payload: { attachment: { id: string } } });
      }
    });

    const emitAdded = (id: string): void => {
      ch.emitLine(
        JSON.stringify({
          type: "piweb_attachment_event",
          event: "added",
          attachment: { ...ATTACHMENT_FIXTURE, id },
        }),
      );
    };

    emitAdded("att_1"); // 首次 → 立即转发
    expect(frames).toHaveLength(1);
    expect(frames[0]?.payload.attachment.id).toBe("att_1");

    emitAdded("att_2"); // 窗口内 → 挂起
    emitAdded("att_3"); // 窗口内再来一次 → 覆盖挂起载荷(只留最新)
    expect(frames).toHaveLength(1); // 尚未到期,未新增转发

    vi.advanceTimersByTime(1000); // 窗口到期 → 一次性补发最新挂起载荷
    expect(frames).toHaveLength(2);
    expect(frames[1]?.payload.attachment.id).toBe("att_3");
  });
});
