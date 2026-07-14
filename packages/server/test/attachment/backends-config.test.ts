/**
 * attachment · backends-config 拓扑解析单测(attachment-backend-pluggable spec,任务 5.1;
 * Req 2.1-2.4)。
 *
 * 覆盖:未设置返回 undefined;合法拓扑解析;七类非法输入逐一断言错误信息含错误项
 * (JSON 不可解析/schema 不符/后端集合为空/重名/write 失配/registry.backend 失配/未知 kind)。
 */
import { describe, expect, it } from "vitest";
import {
  AttachmentBackendsConfigError,
  parseBackendsEnv,
} from "../../src/attachment/backends-config.js";

describe("parseBackendsEnv — 未设置 / 空串(Req 1.1 零行为变化)", () => {
  it("undefined → 返回 undefined", () => {
    expect(parseBackendsEnv(undefined)).toBeUndefined();
  });
  it("空串 → 返回 undefined", () => {
    expect(parseBackendsEnv("")).toBeUndefined();
    expect(parseBackendsEnv("   ")).toBeUndefined();
  });
});

describe("parseBackendsEnv — 合法拓扑解析(Req 2.1)", () => {
  it("解析双 local-fs 后端拓扑", () => {
    const raw = JSON.stringify({
      backends: [
        { kind: "local-fs", name: "local", dir: "~/.pi/agent/attachments" },
        { kind: "local-fs", name: "cold" },
      ],
      write: "local",
      registry: { kind: "local-fs" },
    });
    const topology = parseBackendsEnv(raw);
    expect(topology?.backends).toHaveLength(2);
    expect(topology?.write).toBe("local");
    expect(topology?.registry).toEqual({ kind: "local-fs" });
  });

  it("解析含 s3 后端的拓扑(凭据经 *Env 间接引用)", () => {
    const raw = JSON.stringify({
      backends: [
        { kind: "local-fs", name: "local" },
        {
          kind: "s3",
          name: "s3-cn",
          bucket: "pi-attach",
          region: "cn-northwest-1",
          endpoint: "https://s3.example.com",
          accessKeyEnv: "PI_S3_AK",
          secretKeyEnv: "PI_S3_SK",
        },
      ],
      write: "s3-cn",
      registry: { kind: "s3", backend: "s3-cn" },
    });
    const topology = parseBackendsEnv(raw);
    expect(topology?.backends[1]).toMatchObject({ kind: "s3", accessKeyEnv: "PI_S3_AK" });
    expect(topology?.registry).toEqual({ kind: "s3", backend: "s3-cn" });
  });

  it("registry 缺省 = local-fs", () => {
    const raw = JSON.stringify({
      backends: [{ kind: "local-fs", name: "local" }],
      write: "local",
    });
    expect(parseBackendsEnv(raw)?.registry).toBeUndefined();
  });
});

describe("parseBackendsEnv — 七类非法输入(Req 2.2,均抛 AttachmentBackendsConfigError 且 message 指出错误项)", () => {
  it("1) JSON 不可解析", () => {
    expect(() => parseBackendsEnv("{not json")).toThrow(AttachmentBackendsConfigError);
    expect(() => parseBackendsEnv("{not json")).toThrow(/not valid JSON/);
  });

  it("2) schema 不符(缺少必需字段 write)", () => {
    const raw = JSON.stringify({ backends: [{ kind: "local-fs", name: "local" }] });
    expect(() => parseBackendsEnv(raw)).toThrow(AttachmentBackendsConfigError);
    expect(() => parseBackendsEnv(raw)).toThrow(/write/);
  });

  it("3) 后端集合为空", () => {
    const raw = JSON.stringify({ backends: [], write: "local" });
    expect(() => parseBackendsEnv(raw)).toThrow(/non-empty/);
  });

  it("4) 后端重名", () => {
    const raw = JSON.stringify({
      backends: [
        { kind: "local-fs", name: "dup" },
        { kind: "local-fs", name: "dup" },
      ],
      write: "dup",
    });
    expect(() => parseBackendsEnv(raw)).toThrow(/duplicate name "dup"/);
  });

  it("5) write 未在声明集合中(写目标失配)", () => {
    const raw = JSON.stringify({
      backends: [{ kind: "local-fs", name: "local" }],
      write: "ghost",
    });
    expect(() => parseBackendsEnv(raw)).toThrow(/write "ghost" is not among/);
  });

  it("6) registry.backend 未在声明集合中(registry 引用失配)", () => {
    const raw = JSON.stringify({
      backends: [{ kind: "local-fs", name: "local" }],
      write: "local",
      registry: { kind: "s3", backend: "ghost-s3" },
    });
    expect(() => parseBackendsEnv(raw)).toThrow(/registry\.backend "ghost-s3" is not among/);
  });

  it("7) 未知 kind", () => {
    const raw = JSON.stringify({
      backends: [{ kind: "azure-blob", name: "az" }],
      write: "az",
    });
    expect(() => parseBackendsEnv(raw)).toThrow(AttachmentBackendsConfigError);
    expect(() => parseBackendsEnv(raw)).toThrow(/does not match the expected schema/);
  });
});

describe("parseBackendsEnv — name 字符集与 s3 必需字段校验(附加,归入 schema 不符类)", () => {
  it("非法 name(含大写/以连字符开头)→ 抛错", () => {
    const raw = JSON.stringify({
      backends: [{ kind: "local-fs", name: "Bad_Name" }],
      write: "Bad_Name",
    });
    expect(() => parseBackendsEnv(raw)).toThrow(AttachmentBackendsConfigError);
  });

  it("s3 后端缺 accessKeyEnv/secretKeyEnv → 抛错", () => {
    const raw = JSON.stringify({
      backends: [{ kind: "s3", name: "s3a", bucket: "b" }],
      write: "s3a",
    });
    expect(() => parseBackendsEnv(raw)).toThrow(AttachmentBackendsConfigError);
  });
});

describe("parseBackendsEnv — cloud-http 拓扑(sandbox-attachment-store spec Wave A'3)", () => {
  it("解析含 cloud-http 后端 + registry 的拓扑", () => {
    const raw = JSON.stringify({
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
    const topology = parseBackendsEnv(raw);
    expect(topology?.backends[0]).toMatchObject({ kind: "cloud-http", tokenEnv: "PI_WEB_ATTACHMENT_TOKEN" });
    expect(topology?.registry).toEqual({ kind: "cloud-http", backend: "cloud" });
  });

  it("cloud-http registry.backend 未在声明集合中 → 抛错", () => {
    const raw = JSON.stringify({
      backends: [
        { kind: "cloud-http", name: "cloud", endpoint: "https://cloud.internal/x", tokenEnv: "TOK" },
      ],
      write: "cloud",
      registry: { kind: "cloud-http", backend: "ghost" },
    });
    expect(() => parseBackendsEnv(raw)).toThrow(AttachmentBackendsConfigError);
  });

  it("cloud-http 后端 endpoint 非法 URL → 抛错(schema 不符)", () => {
    const raw = JSON.stringify({
      backends: [{ kind: "cloud-http", name: "cloud", endpoint: "not-a-url", tokenEnv: "TOK" }],
      write: "cloud",
    });
    expect(() => parseBackendsEnv(raw)).toThrow(AttachmentBackendsConfigError);
  });
});
