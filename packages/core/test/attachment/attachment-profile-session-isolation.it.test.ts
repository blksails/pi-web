/**
 * attachment · agent-attachment-profile 会话隔离与生命周期集成测试(任务 6.2;Req 3.3/4.1/4.2)。
 *
 * 覆盖:
 * - 一个「profile 会话」store(writeProfile="secondary")与一个「未声明会话」store
 *   (writeProfile 缺省)并存,各自新写入分别落 secondary / 拓扑默认(primary),互不影响(Req 3.3);
 * - profile 会话落库的对象,经**新建**门面实例(同 env、不同实例,模拟服务重启)按描述符
 *   读回(head)与签发(presignUrl→verifyUrl)均正常,证明描述符权威链与会话/进程存活状态无关
 *   (Req 4.1/4.2;进程级重启等价性已由上游 attachment-backend-pluggable spec 的 e2e 证明,
 *   本测试验证 profile 落库对象走的是同一条描述符权威链,不是 profile 专属旁路)。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { attachmentStoreConfigFromEnv } from "../../src/attachment/config.js";
import { ATTACHMENT_BACKENDS_ENV } from "../../src/attachment/backends-config.js";

const SECRET = "profile-isolation-secret";

let dirPrimary: string;
let dirSecondary: string;

beforeEach(async () => {
  dirPrimary = await mkdtemp(join(tmpdir(), "attiso-primary-"));
  dirSecondary = await mkdtemp(join(tmpdir(), "attiso-secondary-"));
});
afterEach(async () => {
  await rm(dirPrimary, { recursive: true, force: true });
  await rm(dirSecondary, { recursive: true, force: true });
});

function envFor(): NodeJS.ProcessEnv {
  return {
    PI_WEB_ATTACHMENT_DIR: dirPrimary,
    PI_WEB_ATTACHMENT_SECRET: SECRET,
    [ATTACHMENT_BACKENDS_ENV]: JSON.stringify({
      backends: [
        { kind: "local-fs", name: "primary", dir: dirPrimary },
        { kind: "local-fs", name: "secondary", dir: dirSecondary },
      ],
      write: "primary",
    }),
  };
}

function putInput(sessionId: string, bytes: Uint8Array = new Uint8Array([1, 2, 3, 4])) {
  return {
    bytes,
    name: "x.bin",
    mimeType: "application/octet-stream",
    size: bytes.byteLength,
    sessionId,
    origin: "upload" as const,
  };
}

describe("会话隔离:profile 会话与未声明会话并存各落其目标(Req 3.3)", () => {
  it("同一门面实例内,profile 会话(per-call writeBackend=secondary)落 secondary;未声明会话落拓扑默认 primary,二者共存互不干扰", async () => {
    // 主进程侧是单例门面(跨会话共享),profile 覆盖是 per-call 的(design.md 双轨:
    // 子进程走 writeProfile 静态绑定,主进程走 opts.writeBackend 逐调用覆盖)——
    // 用同一个 store 实例模拟两个会话在主进程侧并发写入的真实拓扑。
    const { store } = attachmentStoreConfigFromEnv(envFor());

    const profileAtt = await store.put({
      ...putInput("sess-profile"),
      writeBackend: "secondary",
    });
    const defaultAtt = await store.put(putInput("sess-default"));

    expect(profileAtt.backend).toBe("secondary");
    expect(defaultAtt.backend).toBe("primary");

    // 会话属主隔离(既有语义不变):按 sessionId 各自只看到自己的对象,与落库后端无关。
    const profileSessionList = await store.listBySession("sess-profile");
    const defaultSessionList = await store.listBySession("sess-default");
    expect(profileSessionList.map((a) => a.id)).toEqual([profileAtt.id]);
    expect(defaultSessionList.map((a) => a.id)).toEqual([defaultAtt.id]);

    // 各自按 id 读回时后端固化不串:profile 会话对象在 secondary,默认会话对象在 primary。
    expect((await store.head(profileAtt.id))?.backend).toBe("secondary");
    expect((await store.head(defaultAtt.id))?.backend).toBe("primary");
  });
});

describe("生命周期:profile 落库对象经新建门面实例(模拟重启)按描述符读回与签发(Req 4.1/4.2)", () => {
  it("新建的 store 实例(同 env、不同实例)head/getReadStream/presignUrl→verifyUrl 均正常", async () => {
    const env = envFor();
    const { store: profileStore } = attachmentStoreConfigFromEnv(env, {
      writeProfile: "secondary",
    });
    const att = await profileStore.put(putInput("sess-profile", new Uint8Array([9, 8, 7])));
    expect(att.backend).toBe("secondary");

    // 新建门面实例(模拟服务重启:同 env,但是全新 union/registry/signer 实例)。
    const { store: restarted } = attachmentStoreConfigFromEnv(env);

    const head = await restarted.head(att.id);
    expect(head?.backend).toBe("secondary");
    expect(head?.sessionId).toBe("sess-profile");

    const { stream, meta } = await restarted.getReadStream(att.id);
    expect(meta.size).toBe(3);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    expect([...Buffer.concat(chunks)]).toEqual([9, 8, 7]);

    const url = await restarted.presignUrl(att.id);
    const params = new URL(url, "http://x").searchParams;
    expect(
      restarted.verifyUrl(att.id, Number(params.get("exp")), params.get("sig")!),
    ).toBe(true);
  });
});
