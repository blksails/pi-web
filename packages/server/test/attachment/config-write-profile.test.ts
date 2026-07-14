/**
 * attachment · config 工厂 `writeProfile` 静态写路由覆盖测试(agent-attachment-profile spec,
 * 任务 2.3;Req 3.2/1.2)。
 *
 * 覆盖:覆盖生效(writeProfile 优先于拓扑默认 write)/失配(未声明名字装配期抛
 * AttachmentBackendsConfigError)/不传(= 现状,既有 config-topology 测试零改动)三态。
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
import {
  ATTACHMENT_BACKENDS_ENV,
  AttachmentBackendsConfigError,
} from "../../src/attachment/backends-config.js";

const SECRET = "write-profile-test-secret";

let dirA: string;
let dirB: string;

beforeEach(async () => {
  dirA = await mkdtemp(join(tmpdir(), "attwp-a-"));
  dirB = await mkdtemp(join(tmpdir(), "attwp-b-"));
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
    sessionId: "sess-wp",
    origin: "upload" as const,
    ...overrides,
  };
}

function topologyEnv(): Record<string, string> {
  const topology = JSON.stringify({
    backends: [
      { kind: "local-fs", name: "primary", dir: dirA },
      { kind: "local-fs", name: "secondary", dir: dirB },
    ],
    write: "primary",
  });
  return {
    [ATTACHMENT_DIR_ENV]: dirA,
    [ATTACHMENT_SECRET_ENV]: SECRET,
    [ATTACHMENT_BACKENDS_ENV]: topology,
  };
}

describe("attachmentStoreConfigFromEnv writeProfile — 覆盖生效(Req 3.2)", () => {
  it("writeProfile 优先于拓扑声明的默认 write", async () => {
    const { store } = attachmentStoreConfigFromEnv(topologyEnv(), {
      writeProfile: "secondary",
    });
    const att = await store.put(basePut());
    expect(att.backend).toBe("secondary");
    await expect(stat(join(dirB, att.id))).resolves.toBeDefined();
    await expect(stat(join(dirA, att.id))).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("attachmentStoreConfigFromEnv writeProfile — 失配(Req 3.2)", () => {
  it("writeProfile 指向未声明的后端名 → 装配期抛 AttachmentBackendsConfigError", () => {
    expect(() =>
      attachmentStoreConfigFromEnv(topologyEnv(), { writeProfile: "ghost-profile" }),
    ).toThrow(AttachmentBackendsConfigError);
    expect(() =>
      attachmentStoreConfigFromEnv(topologyEnv(), { writeProfile: "ghost-profile" }),
    ).toThrow(/ghost-profile/);
  });
});

describe("attachmentStoreConfigFromEnv writeProfile — 不传(= 现状,Req 1.2)", () => {
  it("不传 writeProfile → 走拓扑声明的默认 write(既有行为零改动)", async () => {
    const { store } = attachmentStoreConfigFromEnv(topologyEnv());
    const att = await store.put(basePut());
    expect(att.backend).toBe("primary");
  });
});
