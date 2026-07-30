/**
 * attachment · config 工厂拓扑分支接线测试(attachment-backend-pluggable spec,任务 6.1;
 * Req 1.1/1.2/2.1)。
 *
 * 覆盖:
 * - 未设 `PI_WEB_ATTACHMENT_BACKENDS` → 原单后端路径,产物(目录/签名/描述符形状)与现状逐项一致,
 *   `passthroughEnv` 为空对象(Req 1.1/1.2);
 * - 设了拓扑 env → union + registry 组装,读路由权威接 registry 的 `backend` 字段,首个本地后端
 *   作 `localPath` 委托,返回值扩 `passthroughEnv`(Req 2.1)。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  attachmentStoreConfigFromEnv,
  ATTACHMENT_DIR_ENV,
  ATTACHMENT_SECRET_ENV,
} from "../../src/attachment/config.js";
import { ATTACHMENT_BACKENDS_ENV } from "../../src/attachment/backends-config.js";

const SECRET = "topology-test-secret";

let dirA: string;
let dirB: string;

beforeEach(async () => {
  dirA = await mkdtemp(join(tmpdir(), "atttopo-a-"));
  dirB = await mkdtemp(join(tmpdir(), "atttopo-b-"));
});
afterEach(async () => {
  await rm(dirA, { recursive: true, force: true });
  await rm(dirB, { recursive: true, force: true });
});

function basePut(overrides: Record<string, unknown> = {}) {
  return {
    bytes: new Uint8Array([1, 2, 3]),
    name: "x.bin",
    mimeType: "application/octet-stream",
    size: 3,
    sessionId: "sess-topo",
    origin: "upload" as const,
    ...overrides,
  };
}

describe("config 工厂 — 未设拓扑 env(Req 1.1/1.2 回归)", () => {
  it("原单后端路径:描述符不含 backend 字段,passthroughEnv 为空对象", async () => {
    const { store, passthroughEnv } = attachmentStoreConfigFromEnv({
      [ATTACHMENT_DIR_ENV]: dirA,
      [ATTACHMENT_SECRET_ENV]: SECRET,
    });
    expect(passthroughEnv).toEqual({});
    const att = await store.put(basePut());
    expect(att).not.toHaveProperty("backend");
    await expect(store.localPath(att.id)).resolves.toBe(join(dirA, att.id));
  });
});

describe("config 工厂 — 设拓扑 env(Req 2.1;union + registry 组装)", () => {
  it("双 local-fs 拓扑:描述符固化 backend,读路由接 registry,localPath 委托首个本地后端", async () => {
    const topology = JSON.stringify({
      backends: [
        { kind: "local-fs", name: "primary", dir: dirA },
        { kind: "local-fs", name: "secondary", dir: dirB },
      ],
      write: "primary",
    });
    const { store, passthroughEnv } = attachmentStoreConfigFromEnv({
      [ATTACHMENT_DIR_ENV]: dirA,
      [ATTACHMENT_SECRET_ENV]: SECRET,
      [ATTACHMENT_BACKENDS_ENV]: topology,
    });

    expect(passthroughEnv).toEqual({ [ATTACHMENT_BACKENDS_ENV]: topology });

    const att = await store.put(basePut());
    expect(att.backend).toBe("primary");
    // 字节确实落在 primary 声明的目录(首个本地后端)。
    await expect(stat(join(dirA, att.id))).resolves.toBeDefined();
    await expect(stat(join(dirB, att.id))).rejects.toMatchObject({ code: "ENOENT" });

    // localPath 委托首个本地后端(design.md:union 本身不实现 diskPath)。
    await expect(store.localPath(att.id)).resolves.toBe(join(dirA, att.id));

    // 读路径接 registry 的 backend 字段权威路由(head 复算证明经 primary 目录读到)。
    const { stream } = await store.getReadStream(att.id);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    expect([...Buffer.concat(chunks)]).toEqual([1, 2, 3]);
  });

  it("write 指向非首个后端时,localPath 仍委托首个本地后端,但字节落在 write 指定后端", async () => {
    const topology = JSON.stringify({
      backends: [
        { kind: "local-fs", name: "primary", dir: dirA },
        { kind: "local-fs", name: "secondary", dir: dirB },
      ],
      write: "secondary",
    });
    const { store } = attachmentStoreConfigFromEnv({
      [ATTACHMENT_DIR_ENV]: dirA,
      [ATTACHMENT_SECRET_ENV]: SECRET,
      [ATTACHMENT_BACKENDS_ENV]: topology,
    });
    const att = await store.put(basePut());
    expect(att.backend).toBe("secondary");
    await expect(stat(join(dirB, att.id))).resolves.toBeDefined();
    // localPath 契约(design.md):首个参与组合的本地后端承接 diskPath 委托,
    // 与该附件实际落库的后端无关(仅 union 内部读路由感知 backend 字段)。
    await expect(store.localPath(att.id)).resolves.toBe(join(dirA, att.id));
  });
});
