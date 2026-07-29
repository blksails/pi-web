/**
 * attachment-tool-bridge · 端到端示例 AgentTool `createEditImageTool` 集成测试
 * (task 4.2;Req 4.2, 4.3, 4.4, 4.5, 7.1, 7.2, 7.3)。
 *
 * 用临时目录经 `attachmentStoreConfigFromEnv` 构造**真实 store**(与子进程内 store 同构),落库一个
 * 上传图(`att_in`),装配示例工具(经 {@link createAttachmentToolContext} 闭包注入),跑通端到端:
 *  解析(三形态)→ 处理 → 落库(`tool-output`)→ 回引用。断言:
 *  - 三种 resolve 用法(localPath / url / bytes)均可达(Req 4.5);
 *  - 产出经 `putOutput` 落 `tool-output` 来源、铸新公开 id、可被同上下文再次 resolve(同一 id 空间,Req 7.1/7.2/7.3);
 *  - 回流以引用(`details.outputAttachmentId` / `displayUrl`)而非内联字节;
 *  - 回图时 `ImageContent.data` 为 `string`(`typeof === "string"`,非 Promise/thenable,Req 4.3);
 *  - 工具定义有必填 `description`、结果有必填 `details`(Req 4.4)。
 *
 * 工具被装配为 `customTool`:断言以 `defineAgent({ customTools: [tool] })` 形态可装配且类型兼容。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  attachmentStoreConfigFromEnv,
  ATTACHMENT_DIR_ENV,
  ATTACHMENT_SECRET_ENV,
} from "../../src/attachment/config.js";
import type { AttachmentStore } from "../../src/attachment/attachment-store.js";
import type { AgentDefinition } from "../../src/runner/agent-definition.js";
import { createAttachmentToolContext } from "../../src/attachment-bridge/index.js";
import {
  createEditImageTool,
  type EditImageToolDetails,
} from "../../src/attachment-bridge/example-tool.js";

const SECRET = "stable-secret-for-example-tool-test";
const SESSION = "sess-example";
const OTHER_SESSION = "sess-other";

// 一个非平凡的输入字节序列(非全 0x80,确保产出与输入字节不同)。
const INPUT_BYTES = new Uint8Array([0x10, 0x20, 0x30, 0x40, 0x50, 0x60]);

let root: string;
let store: AttachmentStore;

async function putUpload(sessionId = SESSION) {
  return store.put({
    bytes: INPUT_BYTES,
    name: "photo.png",
    mimeType: "image/png",
    size: INPUT_BYTES.length,
    sessionId,
    origin: "upload",
  });
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "att-example-"));
  ({ store } = attachmentStoreConfigFromEnv({
    [ATTACHMENT_DIR_ENV]: root,
    [ATTACHMENT_SECRET_ENV]: SECRET,
  }));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("createEditImageTool — 协议兼容(Req 4.2/4.4)", () => {
  it("以 attachmentId 显式参数承载输入引用,description 必填,可装配为 customTool", () => {
    const ctx = createAttachmentToolContext(store, SESSION);
    const tool = createEditImageTool(ctx);

    // description 必填(Req 4.4)。
    expect(typeof tool.description).toBe("string");
    expect(tool.description.length).toBeGreaterThan(0);

    // attachmentId 是显式参数(Req 4.2)。
    const props = (tool.parameters as { properties?: Record<string, unknown> })
      .properties;
    expect(props).toBeDefined();
    expect(props!.attachmentId).toBeDefined();

    // 可装配为 customTool(类型兼容,Req 4.5 观察完成项):slots into AgentDefinition.customTools。
    const agent: AgentDefinition = {
      systemPrompt: "example",
      customTools: [tool],
      noTools: "builtin",
    };
    expect(agent.customTools).toContain(tool);
  });
});

describe("createEditImageTool — 端到端(解析→处理→落库→回引用,Req 4.5/7.x)", () => {
  it("三种 resolve 用法可达 + 产出经 putOutput 落 tool-output 回引用 + 同一 id 空间可再 resolve", async () => {
    const input = await putUpload();
    const ctx = createAttachmentToolContext(store, SESSION);
    const tool = createEditImageTool(ctx);

    const result = await tool.execute(
      "call-1",
      { attachmentId: input.id, returnImage: false },
      undefined,
      undefined,
      undefined as never,
    );

    // details 必填且为成功结构(Req 4.4)。
    const details = result.details as EditImageToolDetails;
    expect(details).toBeDefined();
    expect(details.ok).toBe(true);
    if (!details.ok) throw new Error("expected ok details");

    // 三种 resolve 用法各自可达(Req 4.5)。
    expect(details.resolvedForms.localPath).toBe(true);
    expect(details.resolvedForms.url).toBe(true);
    expect(details.resolvedForms.bytes).toBe(true);

    // 产出经 putOutput 落库:新公开 id、来源 tool-output、当前会话属主(Req 7.1/7.2)。
    expect(details.outputAttachmentId.startsWith("att_")).toBe(true);
    expect(details.outputAttachmentId).not.toBe(input.id);
    const head = await store.head(details.outputAttachmentId);
    expect(head).toBeDefined();
    expect(head!.origin).toBe("tool-output");
    expect(head!.sessionId).toBe(SESSION);

    // 回流以引用(displayUrl)而非内联字节(Req 7.3)。
    expect(typeof details.displayUrl).toBe("string");
    expect(details.displayUrl.length).toBeGreaterThan(0);
    // 默认不回图 → content 只含 text,无 image / base64 内联。
    expect(result.content.every((c) => c.type === "text")).toBe(true);

    // 同一 id 空间:产出 id 可被同一上下文再次 resolve(闭合跨轮回环,Req 7.2)。
    const reHandle = await ctx.resolve(details.outputAttachmentId);
    const reBytes = await reHandle.bytes();
    // 产出字节是输入逐字节取反(端到端可区分,证明回流的是处理后新落库附件)。
    expect([...reBytes]).toEqual([...INPUT_BYTES].map((b) => 0xff ^ b));
  });

  it("returnImage=true → 回图 ImageContent.data 为已 await 的裸 base64 string(非 Promise,Req 4.3)", async () => {
    const input = await putUpload();
    const ctx = createAttachmentToolContext(store, SESSION);
    const tool = createEditImageTool(ctx);

    const result = await tool.execute(
      "call-2",
      { attachmentId: input.id, returnImage: true },
      undefined,
      undefined,
      undefined as never,
    );

    const image = result.content.find((c) => c.type === "image") as
      | { type: "image"; data: string; mimeType: string }
      | undefined;
    expect(image).toBeDefined();

    // data 必须是已求值字符串,而非未求值 Promise/thenable(Req 4.3)。
    expect(typeof image!.data).toBe("string");
    expect(image!.data).not.toBeInstanceOf(Promise);
    expect(
      (image!.data as unknown as { then?: unknown })?.then,
    ).toBeUndefined();
    // 裸 base64(无 data: 前缀)。
    expect(image!.data.startsWith("data:")).toBe(false);
    expect(image!.data.length).toBeGreaterThan(0);
    // 解码回字节 = 产出字节(逐字节取反)。
    const decoded = new Uint8Array(Buffer.from(image!.data, "base64"));
    expect([...decoded]).toEqual([...INPUT_BYTES].map((b) => 0xff ^ b));

    const details = result.details as EditImageToolDetails;
    if (!details.ok) throw new Error("expected ok details");
    expect(details.returnedImage).toBe(true);
  });
});

describe("createEditImageTool — 失败路径(Req 7.4/3.4)", () => {
  it("解析不存在 id → details 标失败、不回引用、不崩溃", async () => {
    const ctx = createAttachmentToolContext(store, SESSION);
    const tool = createEditImageTool(ctx);

    const result = await tool.execute(
      "call-3",
      { attachmentId: "att_does_not_exist" },
      undefined,
      undefined,
      undefined as never,
    );

    const details = result.details as EditImageToolDetails;
    expect(details.ok).toBe(false);
    if (details.ok) throw new Error("expected failure details");
    expect(typeof details.error).toBe("string");
    // 不回任何产出引用。
    const bag = details as unknown as Record<string, unknown>;
    expect(bag.outputAttachmentId).toBeUndefined();
    expect(bag.displayUrl).toBeUndefined();
    // content 无内联 image/base64。
    expect(result.content.every((c) => c.type === "text")).toBe(true);
  });

  it("能力不可用(store undefined)→ 安全早返回,不崩溃(Req 3.4)", async () => {
    const ctx = createAttachmentToolContext(undefined, SESSION);
    const tool = createEditImageTool(ctx);

    const result = await tool.execute(
      "call-4",
      { attachmentId: "att_anything" },
      undefined,
      undefined,
      undefined as never,
    );
    const details = result.details as EditImageToolDetails;
    expect(details.ok).toBe(false);
  });

  it("跨会话引用经端到端示例不属主时,resolve 仍可达但属主由前置闸门把守(本测试聚焦 tool 自身不越权落库)", async () => {
    // 注:属主校验由 beforeToolCall 闸门(task 3.1)前置;示例工具自身以当前会话 sessionId 落库产出。
    const other = await putUpload(OTHER_SESSION);
    const ctx = createAttachmentToolContext(store, SESSION);
    const tool = createEditImageTool(ctx);

    const result = await tool.execute(
      "call-5",
      { attachmentId: other.id },
      undefined,
      undefined,
      undefined as never,
    );
    const details = result.details as EditImageToolDetails;
    if (!details.ok) throw new Error("expected ok details");
    // 产出落到当前会话(SESSION),不是输入附件的属主会话 —— 属主隔离由闸门负责,工具按当前会话落库。
    const head = await store.head(details.outputAttachmentId);
    expect(head!.sessionId).toBe(SESSION);
  });
});
