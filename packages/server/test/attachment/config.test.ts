/**
 * attachment-store · 存储配置工厂 `attachmentStoreConfigFromEnv` 单元测试
 * (task 2.5;Req 1.8, 4.6, 7.2)。
 *
 * 断言:
 * - 给定 `PI_WEB_ATTACHMENT_DIR` + `PI_WEB_ATTACHMENT_SECRET` 时,构造出**指向该目录**、
 *   **使用该 secret** 的可用 store:`put`→`getReadStream` 往返;`localPath(id)` = `<dir>/<id>`(Req 7.2/1.8);
 * - 缺省 `PI_WEB_ATTACHMENT_DIR` 时回落到约定默认目录(单一来源约定,Req 7.2);
 * - 同一 `PI_WEB_ATTACHMENT_SECRET` 下构造的两个 store 实例,一个签发的 URL 能被另一个校验通过
 *   (模拟主/子进程一致),secret 不一致则校验失败(Req 4.6)。
 *
 * 对 `process.env` 的任何修改在 afterEach 还原,避免污染其它测试。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import {
  attachmentStoreConfigFromEnv,
  ATTACHMENT_DIR_ENV,
  ATTACHMENT_SECRET_ENV,
} from "../../src/attachment/config.js";

const SECRET = "stable-secret-for-config-test";

let root: string;
let savedDir: string | undefined;
let savedSecret: string | undefined;

async function readAll(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function basePut() {
  return {
    bytes: new Uint8Array([10, 20, 30]),
    name: "x.bin",
    mimeType: "application/octet-stream",
    size: 3,
    sessionId: "sess-cfg",
    origin: "upload" as const,
  };
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "attcfg-"));
  savedDir = process.env[ATTACHMENT_DIR_ENV];
  savedSecret = process.env[ATTACHMENT_SECRET_ENV];
});

afterEach(async () => {
  // 还原 env,避免污染其它测试。
  if (savedDir === undefined) delete process.env[ATTACHMENT_DIR_ENV];
  else process.env[ATTACHMENT_DIR_ENV] = savedDir;
  if (savedSecret === undefined) delete process.env[ATTACHMENT_SECRET_ENV];
  else process.env[ATTACHMENT_SECRET_ENV] = savedSecret;
  await rm(root, { recursive: true, force: true });
});

describe("attachmentStoreConfigFromEnv — 环境变量名约定", () => {
  it("暴露稳定的目录/secret 环境变量名约定", () => {
    expect(ATTACHMENT_DIR_ENV).toBe("PI_WEB_ATTACHMENT_DIR");
    expect(ATTACHMENT_SECRET_ENV).toBe("PI_WEB_ATTACHMENT_SECRET");
  });
});

describe("attachmentStoreConfigFromEnv — 给定 DIR + SECRET", () => {
  it("构造指向该目录、用该 secret 的可用 store(put/取回往返;localPath=<dir>/<id>)", async () => {
    const { store, dir, secret } = attachmentStoreConfigFromEnv({
      [ATTACHMENT_DIR_ENV]: root,
      [ATTACHMENT_SECRET_ENV]: SECRET,
    });

    expect(dir).toBe(root);
    expect(secret).toBe(SECRET);

    const att = await store.put(basePut());
    // 指向该目录:落盘绝对路径 = <root>/<id>
    await expect(store.localPath(att.id)).resolves.toBe(join(root, att.id));
    await expect(stat(join(root, att.id))).resolves.toBeDefined();

    // 往返取回字节
    const { stream, meta } = await store.getReadStream(att.id);
    expect(meta.size).toBe(3);
    expect([...(await readAll(stream))]).toEqual([10, 20, 30]);

    // 用该 secret:签发的 URL 自洽校验
    const url = await store.presignUrl(att.id);
    const params = new URL(url, "http://x").searchParams;
    const exp = Number(params.get("exp"));
    const sig = params.get("sig")!;
    expect(store.verifyUrl(att.id, exp, sig)).toBe(true);
  });
});

describe("attachmentStoreConfigFromEnv — 缺省 DIR 回落默认目录(Req 7.2)", () => {
  it("未提供 PI_WEB_ATTACHMENT_DIR 时回落到约定默认目录", () => {
    const { dir } = attachmentStoreConfigFromEnv({
      [ATTACHMENT_SECRET_ENV]: SECRET,
      // 不提供 DIR
    });
    // 约定默认目录:类比会话工作目录(~/.pi/agent/...),稳定且非空、绝对、归于 home 下。
    expect(dir).toBeTruthy();
    expect(dir.startsWith(homedir())).toBe(true);
    expect(dir).toContain("attachment");
  });

  it("默认目录在不同调用间稳定一致(单一来源约定)", () => {
    const a = attachmentStoreConfigFromEnv({ [ATTACHMENT_SECRET_ENV]: SECRET });
    const b = attachmentStoreConfigFromEnv({ [ATTACHMENT_SECRET_ENV]: SECRET });
    expect(a.dir).toBe(b.dir);
  });
});

describe("attachmentStoreConfigFromEnv — 稳定 secret 主/子进程一致(Req 4.6)", () => {
  it("同一 PI_WEB_ATTACHMENT_SECRET 下两个 store 实例签名互验通过", async () => {
    const env = { [ATTACHMENT_DIR_ENV]: root, [ATTACHMENT_SECRET_ENV]: SECRET };
    const a = attachmentStoreConfigFromEnv(env);
    const b = attachmentStoreConfigFromEnv(env);

    const att = await a.store.put(basePut());
    // a 签发的 URL → b(模拟另一进程,同一 secret)校验通过
    const url = await a.store.presignUrl(att.id);
    const params = new URL(url, "http://x").searchParams;
    const exp = Number(params.get("exp"));
    const sig = params.get("sig")!;
    expect(b.store.verifyUrl(att.id, exp, sig)).toBe(true);
  });

  it("不同 secret 的 store 互验失败", async () => {
    const a = attachmentStoreConfigFromEnv({
      [ATTACHMENT_DIR_ENV]: root,
      [ATTACHMENT_SECRET_ENV]: SECRET,
    });
    const b = attachmentStoreConfigFromEnv({
      [ATTACHMENT_DIR_ENV]: root,
      [ATTACHMENT_SECRET_ENV]: "a-different-secret",
    });
    const att = await a.store.put(basePut());
    const url = await a.store.presignUrl(att.id);
    const params = new URL(url, "http://x").searchParams;
    const exp = Number(params.get("exp"));
    const sig = params.get("sig")!;
    expect(b.store.verifyUrl(att.id, exp, sig)).toBe(false);
  });

  it("默认读取 process.env(不显式传 env)", async () => {
    process.env[ATTACHMENT_DIR_ENV] = root;
    process.env[ATTACHMENT_SECRET_ENV] = SECRET;
    const { store, dir, secret } = attachmentStoreConfigFromEnv();
    expect(dir).toBe(root);
    expect(secret).toBe(SECRET);
    const att = await store.put(basePut());
    await expect(store.localPath(att.id)).resolves.toBe(join(root, att.id));
  });
});
