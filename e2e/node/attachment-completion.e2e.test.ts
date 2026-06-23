/**
 * Node e2e(attachment-mention-completion · task 3.2)—— 经真实 createPiWebHandler
 * (走 Next route)端到端验证「附件 mention 补全」全链路,不开浏览器。
 *
 * 链路:上传附件(POST /sessions/:id/attachments,落主进程附件单例)→ 经
 * `attachmentStore.listBySession` 被 attachment provider 列举为 `@` 候选(8.1/8.2)
 * → 提交一条仅含 `@attachment:<id>` token 的消息(不带 attachmentIds,避免
 * injectAttachmentRefs 干扰)→ resolveCompletions 把 token 改写为规范引用标记,
 * stub agent 把改写后的 prompt 文本作为 user message 持久化 → 经
 * GET /sessions/:id/messages 读回断言改写结果(8.3)→ 同查询下 file provider 既有
 * 行为不退化(8.4)。
 *
 * 会话 cwd = agent 源目录。用临时夹具目录作为 dir 源(stub agent 仅替换通道,cwd
 * 仍按源解析),夹具内预置文件供 file provider 列举,验证 `@file:` 不退化。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import path from "node:path";

process.env.PI_WEB_STUB_AGENT = "1";
process.env.PI_WEB_STUB_AGENT_PATH = path.join(
  process.cwd(),
  "lib",
  "app",
  "stub-agent-process.mjs",
);

const route = await import("@/app/api/sessions/[[...path]]/route");
const { shutdownHandler } = await import("@/lib/app/pi-handler");

let fixture: string;

beforeAll(async () => {
  fixture = await fs.mkdtemp(path.join(os.tmpdir(), "att-cpl-e2e-cwd-"));
  // 夹具内预置文件:供 file provider 列举,断言 @file: 不退化(8.4)。
  await fs.mkdir(path.join(fixture, "src"));
  await fs.writeFile(path.join(fixture, "src", "app.ts"), "x");
  await fs.writeFile(path.join(fixture, "README.md"), "x");
});

afterAll(async () => {
  await shutdownHandler();
  await fs.rm(fixture, { recursive: true, force: true });
});

function reqOf(pathname: string, init?: RequestInit): Request {
  return new Request(`http://localhost${pathname}`, init);
}

async function createSession(source: string): Promise<string> {
  const res = await route.POST(
    reqOf("/api/sessions", {
      method: "POST",
      body: JSON.stringify({ source }),
    }),
  );
  expect([200, 201]).toContain(res.status);
  const body = (await res.json()) as { sessionId: string };
  return body.sessionId;
}

interface UploadedAttachment {
  readonly id: string;
  readonly name: string;
  readonly mimeType: string;
  readonly sessionId: string;
}

/**
 * 上传一个附件到会话(multipart/form-data, 字段名 `file`),返回落库描述符。
 * 内容字节对断言无关(测试只用 id/mime/name),故用字符串 BlobPart,既满足上传端点
 * 「非空文件」校验,又彻底绕开 Uint8Array→BlobPart 的 SharedArrayBuffer typing 噪声。
 */
async function uploadAttachment(
  sessionId: string,
  fileName: string,
  mimeType: string,
): Promise<UploadedAttachment> {
  const form = new FormData();
  form.append("file", new File(["x"], fileName, { type: mimeType }), fileName);
  const res = await route.POST(
    reqOf(`/api/sessions/${sessionId}/attachments`, {
      method: "POST",
      body: form,
    }),
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as { attachment: UploadedAttachment };
  expect(body.attachment.id.length).toBeGreaterThan(0);
  return body.attachment;
}

interface CompletionItemShape {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
  readonly insertText: string;
}
interface CompletionResponseShape {
  readonly items: readonly CompletionItemShape[];
  readonly groups: ReadonlyArray<{ kind: string; count: number }>;
}

async function queryCompletion(
  sessionId: string,
  query: string,
): Promise<CompletionResponseShape> {
  const res = await route.GET(
    reqOf(
      `/api/sessions/${sessionId}/completion?trigger=@&q=${encodeURIComponent(query)}`,
    ),
  );
  expect(res.status).toBe(200);
  return (await res.json()) as CompletionResponseShape;
}

interface AgentMessageShape {
  readonly role: string;
  readonly content: ReadonlyArray<{ type: string; text?: string }>;
}

/** 读回会话历史的 user 文本(取第一条 user message 的 text part 拼接)。 */
async function readBackUserText(sessionId: string): Promise<string | undefined> {
  const res = await route.GET(reqOf(`/api/sessions/${sessionId}/messages`));
  expect(res.status).toBe(200);
  const body = (await res.json()) as { messages: readonly AgentMessageShape[] };
  const user = body.messages.find((m) => m.role === "user");
  if (user === undefined) return undefined;
  return user.content
    .filter((c) => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text ?? "")
    .join("");
}

describe("attachment mention completion (offline node e2e)", () => {
  it("8.1/8.2: 上传后 @ 补全含 attachment 候选与分组,insertText 形如 @attachment:<id>", async () => {
    const id = await createSession(fixture);
    const att = await uploadAttachment(id, "diagram.png", "image/png");

    const res = await queryCompletion(id, "");

    // 8.1 — items 含 kind==="attachment" 的候选。
    const attItems = res.items.filter((i) => i.kind === "attachment");
    expect(attItems.length).toBeGreaterThan(0);
    const mine = attItems.find((i) => i.id === att.id);
    expect(mine).toBeDefined();

    // 8.1 — groups 同时含 attachment 与 file(file provider 仍参与)。
    const groupKinds = res.groups.map((g) => g.kind);
    expect(groupKinds).toContain("attachment");
    expect(groupKinds).toContain("file");

    // 8.2 — attachment 候选 insertText 形如 @attachment:<真实 id>。
    expect(mine?.insertText).toBe(`@attachment:${att.id}`);
  });

  it("8.3: 提交仅含 @attachment:<id>(无 attachmentIds)的消息被改写为规范标记", async () => {
    const id = await createSession(fixture);
    const att = await uploadAttachment(id, "report.png", "image/png");

    // 经流连接驱动 stub(写入历史前需通道活跃,镜像 streaming e2e)。
    const stream = await route.GET(reqOf(`/api/sessions/${id}/stream`));
    expect(stream.headers.get("content-type")).toContain("text/event-stream");
    const reader = stream.body!.getReader();

    // 仅在文本里放 token,不传 attachmentIds → injectAttachmentRefs 为 no-op,
    // 只有 resolveCompletions 改写 token,断言干净。
    const promptRes = await route.POST(
      reqOf(`/api/sessions/${id}/messages`, {
        method: "POST",
        body: JSON.stringify({ message: `see @attachment:${att.id}` }),
      }),
    );
    expect(promptRes.status).toBe(200);

    // 轮询读回 user 文本,直到出现规范标记(写-后-读,handlePrompt 先持久化)。
    const expectedMarker = `[attachment id=${att.id} type=${att.mimeType} name=${att.name}]`;
    let userText: string | undefined;
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      userText = await readBackUserText(id);
      if (userText !== undefined && userText.includes(expectedMarker)) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    await reader.cancel();

    expect(userText).toBeDefined();
    // 改写后含规范标记,且不再含原始 token。
    expect(userText).toContain(expectedMarker);
    expect(userText).not.toContain(`@attachment:${att.id}`);
    // 标记携带真实 mime / name。
    expect(userText).toContain("type=image/png");
    expect(userText).toContain("name=report.png");
  }, 20000);

  it("8.4: file provider 既有候选与 @file: 行为不退化", async () => {
    const id = await createSession(fixture);
    // 同会话也有附件,验证两 provider 共存不互相退化。
    await uploadAttachment(id, "photo.png", "image/png");

    // triggers 含 @。
    const tRes = await route.GET(
      reqOf(`/api/sessions/${id}/completion/triggers`),
    );
    expect(tRes.status).toBe(200);
    const tBody = (await tRes.json()) as {
      triggers: Array<{ trigger: string }>;
    };
    expect(tBody.triggers.map((t) => t.trigger)).toContain("@");

    // @ 空查询能返回 cwd 文件候选(kind=file 仍在)。
    const all = await queryCompletion(id, "");
    const fileItems = all.items.filter((i) => i.kind === "file");
    expect(fileItems.length).toBeGreaterThan(0);
    const fileIds = fileItems.map((i) => i.id);
    expect(fileIds).toContain("src/app.ts");
    expect(fileIds).toContain("README.md");
    // file 候选 insertText 形如 @file:<相对路径>(未退化)。
    const readme = fileItems.find((i) => i.id === "README.md");
    expect(readme?.insertText).toBe("@file:README.md");

    // 带查询收敛仍命中文件候选(file provider 模糊匹配未退化)。
    const q = await queryCompletion(id, "app");
    const qFile = q.items.find((i) => i.kind === "file" && i.id === "src/app.ts");
    expect(qFile).toBeDefined();
  });
});
