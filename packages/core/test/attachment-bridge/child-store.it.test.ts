/**
 * attachment-tool-bridge · 子进程 store 客户端工厂 `createChildAttachmentStore` 单元/集成测试
 * (task 1.1;Req 3.1, 3.2, 3.3, 3.4)。
 *
 * 断言:
 * - 给定 `PI_WEB_ATTACHMENT_DIR` + `PI_WEB_ATTACHMENT_SECRET` env → 构造**可用**的上游
 *   `AttachmentStore` 门面客户端(经门面 head/getReadStream/localPath/listBySession/put/presignUrl
 *   调用,Req 3.1/3.2);
 * - 缺失 `PI_WEB_ATTACHMENT_DIR` 目录约定 → 返回 `undefined`(能力不可用降级,不崩溃,Req 3.4);
 * - 子进程门面 `put(origin:"tool-output")` 落盘后,用**同目录另一实例**(模拟主进程,经
 *   `attachmentStoreConfigFromEnv` 同 env 构造)按 id `head`/读流得到一致内容(双进程同后端,Req 3.2/3.3/7.2);
 * - 子进程门面 `presignUrl` 产出的 `/raw` 签名 URL,在**主进程**(同 secret)`verifyUrl` 校验通过(Req 3.2)。
 *
 * 临时目录,afterEach 清理;不依赖 process.env(显式注入 env)。
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
import { createChildAttachmentStore } from "../../src/attachment-bridge/index.js";

const SECRET = "stable-secret-for-child-store-test";

let root: string;

async function readAll(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function basePut() {
  return {
    bytes: new Uint8Array([7, 8, 9, 10]),
    name: "tool-out.bin",
    mimeType: "application/octet-stream",
    size: 4,
    sessionId: "sess-child",
    origin: "tool-output" as const,
  };
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "attchild-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("createChildAttachmentStore — 给定 DIR + SECRET 构造可用门面客户端(Req 3.1/3.2)", () => {
  it("从 env 实例化上游 AttachmentStore 门面;经门面 put/head/getReadStream/localPath 往返", async () => {
    const store = createChildAttachmentStore({
      [ATTACHMENT_DIR_ENV]: root,
      [ATTACHMENT_SECRET_ENV]: SECRET,
    });
    expect(store).toBeDefined();

    const att = await store!.put(basePut());
    expect(att.origin).toBe("tool-output");
    expect(att.id.startsWith("att_")).toBe(true);

    // 门面 head 取描述符(不含字节)。
    await expect(store!.head(att.id)).resolves.toMatchObject({
      id: att.id,
      sessionId: "sess-child",
    });

    // 门面 localPath = <root>/<id>(本地后端直返落盘路径,经门面委托)。
    await expect(store!.localPath(att.id)).resolves.toBe(join(root, att.id));

    // 门面 getReadStream(meta = 上游 BlobMeta)往返一致。
    const { stream, meta } = await store!.getReadStream(att.id);
    expect(meta.size).toBe(4);
    expect([...(await readAll(stream))]).toEqual([7, 8, 9, 10]);

    // 门面 listBySession 按属主列举。
    const list = await store!.listBySession("sess-child");
    expect(list.map((a) => a.id)).toContain(att.id);
  });
});

describe("createChildAttachmentStore — 缺失目录约定降级(Req 3.4)", () => {
  it("缺失 PI_WEB_ATTACHMENT_DIR 时返回 undefined(能力不可用,不崩溃)", () => {
    const store = createChildAttachmentStore({
      [ATTACHMENT_SECRET_ENV]: SECRET,
      // 不提供 PI_WEB_ATTACHMENT_DIR
    });
    expect(store).toBeUndefined();
  });

  it("空字符串 PI_WEB_ATTACHMENT_DIR 同样视为缺失 → undefined", () => {
    const store = createChildAttachmentStore({
      [ATTACHMENT_DIR_ENV]: "",
      [ATTACHMENT_SECRET_ENV]: SECRET,
    });
    expect(store).toBeUndefined();
  });

  it("cloud-http 拓扑(sandbox-attachment-store spec Wave A'3)下发 BACKENDS → 可用 store", () => {
    const topology = JSON.stringify({
      backends: [
        {
          kind: "cloud-http",
          name: "cloud",
          endpoint: "https://cloud.internal/internal/attachments/blob",
          tokenEnv: "PI_WEB_ATTACHMENT_TOKEN",
        },
      ],
      write: "cloud",
      registry: { kind: "cloud-http", backend: "cloud" },
    });
    const store = createChildAttachmentStore({
      PI_WEB_ATTACHMENT_BACKENDS: topology,
      PI_WEB_ATTACHMENT_TOKEN: "tok-value",
      [ATTACHMENT_SECRET_ENV]: SECRET,
    });
    expect(store).toBeDefined();
  });
});

describe("createChildAttachmentStore — writeProfile 静态绑定(agent-attachment-profile spec,Req 3.2)", () => {
  it("覆盖生效:opts.writeProfile 覆盖拓扑声明的默认 write", async () => {
    const topology = JSON.stringify({
      backends: [
        { kind: "local-fs", name: "primary", dir: root },
        { kind: "local-fs", name: "secondary" },
      ],
      write: "primary",
    });
    const store = createChildAttachmentStore(
      { PI_WEB_ATTACHMENT_BACKENDS: topology, [ATTACHMENT_SECRET_ENV]: SECRET },
      { writeProfile: "secondary" },
    );
    expect(store).toBeDefined();
    const att = await store!.put(basePut());
    expect(att.backend).toBe("secondary");
  });

  it("失配:未声明的 writeProfile → 抛错(createChildAttachmentStore 透传 config 工厂的装配期错误)", () => {
    const topology = JSON.stringify({
      backends: [{ kind: "local-fs", name: "primary", dir: root }],
      write: "primary",
    });
    expect(() =>
      createChildAttachmentStore(
        { PI_WEB_ATTACHMENT_BACKENDS: topology, [ATTACHMENT_SECRET_ENV]: SECRET },
        { writeProfile: "ghost" },
      ),
    ).toThrow(/ghost/);
  });

  it("不传 opts(或未含 writeProfile)= 现状:走拓扑默认 write", async () => {
    const topology = JSON.stringify({
      backends: [{ kind: "local-fs", name: "primary", dir: root }],
      write: "primary",
    });
    const store = createChildAttachmentStore({
      PI_WEB_ATTACHMENT_BACKENDS: topology,
      [ATTACHMENT_SECRET_ENV]: SECRET,
    });
    const att = await store!.put(basePut());
    expect(att.backend).toBe("primary");
  });
});

describe("createChildAttachmentStore — DIR 或 BACKENDS 任一下发即可用(attachment-backend-pluggable spec,Req 6.2/6.3)", () => {
  it("仅下发 PI_WEB_ATTACHMENT_BACKENDS(不下发 DIR)→ 可用", async () => {
    const topology = JSON.stringify({
      backends: [{ kind: "local-fs", name: "local", dir: root }],
      write: "local",
    });
    const store = createChildAttachmentStore({
      PI_WEB_ATTACHMENT_BACKENDS: topology,
      [ATTACHMENT_SECRET_ENV]: SECRET,
    });
    expect(store).toBeDefined();
    const att = await store!.put(basePut());
    expect(att.backend).toBe("local");
  });

  it("DIR 与 BACKENDS 均未下发(空字符串同视为缺失)→ undefined", () => {
    const store = createChildAttachmentStore({
      PI_WEB_ATTACHMENT_BACKENDS: "",
      [ATTACHMENT_SECRET_ENV]: SECRET,
    });
    expect(store).toBeUndefined();
  });
});

describe("createChildAttachmentStore — 双进程同后端一致性(Req 3.2/3.3/7.2)", () => {
  it("子进程 put 落盘后,同目录另一实例(主进程)按 id 读到一致内容", async () => {
    const env = { [ATTACHMENT_DIR_ENV]: root, [ATTACHMENT_SECRET_ENV]: SECRET };

    // 子进程门面客户端落盘。
    const child = createChildAttachmentStore(env);
    expect(child).toBeDefined();
    const att = await child!.put(basePut());

    // 主进程 store(同 env、同目录),按 id 读流应得一致内容。
    const { store: main } = attachmentStoreConfigFromEnv(env);
    const head = await main.head(att.id);
    expect(head?.id).toBe(att.id);
    const { stream, meta } = await main.getReadStream(att.id);
    expect(meta.size).toBe(4);
    expect([...(await readAll(stream))]).toEqual([7, 8, 9, 10]);
  });

  it("子进程 presignUrl 产出的 /raw 签名 URL 在主进程同 secret 校验通过(Req 3.2)", async () => {
    const env = { [ATTACHMENT_DIR_ENV]: root, [ATTACHMENT_SECRET_ENV]: SECRET };

    const child = createChildAttachmentStore(env);
    const att = await child!.put(basePut());

    // 子进程签发展示 URL。
    const url = await child!.presignUrl(att.id);
    const params = new URL(url, "http://x").searchParams;
    const exp = Number(params.get("exp"));
    const sig = params.get("sig")!;

    // 主进程(同 secret)校验通过。
    const { store: main } = attachmentStoreConfigFromEnv(env);
    expect(main.verifyUrl(att.id, exp, sig)).toBe(true);
  });

  it("不同 secret 的主进程校验子进程 URL 失败(secret 不一致即拒)", async () => {
    const child = createChildAttachmentStore({
      [ATTACHMENT_DIR_ENV]: root,
      [ATTACHMENT_SECRET_ENV]: SECRET,
    });
    const att = await child!.put(basePut());
    const url = await child!.presignUrl(att.id);
    const params = new URL(url, "http://x").searchParams;
    const exp = Number(params.get("exp"));
    const sig = params.get("sig")!;

    const { store: main } = attachmentStoreConfigFromEnv({
      [ATTACHMENT_DIR_ENV]: root,
      [ATTACHMENT_SECRET_ENV]: "a-different-secret",
    });
    expect(main.verifyUrl(att.id, exp, sig)).toBe(false);
  });
});
