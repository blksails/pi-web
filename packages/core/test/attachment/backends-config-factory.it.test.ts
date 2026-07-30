/**
 * attachment · backends-config 构建工厂单测(attachment-backend-pluggable spec,任务 5.2;
 * Req 2.1/6.1)。
 *
 * 覆盖:buildBackends 按 kind 实例化(local-fs/s3);local-fs 缺省回落共享 dir;s3 凭据缺失抛错
 * (Req 2.4);buildRegistry 支持 local-fs/s3(绑定既有具名 s3 后端配置)、registry.backend 非 s3
 * 抛错;computePassthroughEnv 产出拓扑原文 + 全部被引用凭据变量,且不整包透传 env。
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildBackends,
  buildRegistry,
  computePassthroughEnv,
  parseBackendsEnv,
  AttachmentBackendsConfigError,
  type BuildDeps,
} from "../../src/attachment/backends-config.js";
import { LocalFsBlobBackend } from "../../src/attachment/local-fs-backend.js";
import { S3BlobBackend } from "../../src/attachment/s3/s3-blob-backend.js";
import { LocalFsAttachmentRegistry } from "../../src/attachment/attachment-registry.js";
import { S3AttachmentRegistry } from "../../src/attachment/s3/s3-registry.js";
import { HttpBlobStore } from "../../src/attachment/http/http-blob-store.js";
import { HttpAttachmentRegistry } from "../../src/attachment/http/http-attachment-registry.js";
import { createUrlSigner } from "../../src/attachment/url-signer.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "attbackends-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function deps(env: NodeJS.ProcessEnv = {}): BuildDeps {
  return { signer: createUrlSigner("s3cr3t"), urlBasePath: "/api", dir, env };
}

describe("buildBackends(Req 2.1)", () => {
  it("local-fs 声明 → LocalFsBlobBackend 实例;未指定 dir 回落共享 dir", () => {
    const topology = parseBackendsEnv(
      JSON.stringify({ backends: [{ kind: "local-fs", name: "local" }], write: "local" }),
    )!;
    const backends = buildBackends(topology, deps());
    expect(backends).toHaveLength(1);
    expect(backends[0]!.name).toBe("local");
    expect(backends[0]!.store).toBeInstanceOf(LocalFsBlobBackend);
  });

  it("s3 声明 → S3BlobBackend 实例,凭据从 env 解引用", () => {
    const topology = parseBackendsEnv(
      JSON.stringify({
        backends: [
          {
            kind: "s3",
            name: "s3-cn",
            bucket: "b",
            accessKeyEnv: "AK",
            secretKeyEnv: "SK",
          },
        ],
        write: "s3-cn",
      }),
    )!;
    const backends = buildBackends(topology, deps({ AK: "ak-value", SK: "sk-value" }));
    expect(backends[0]!.store).toBeInstanceOf(S3BlobBackend);
  });

  it("s3 声明凭据变量在 env 中缺失 → 抛 AttachmentBackendsConfigError 指出变量名(Req 2.4)", () => {
    const topology = parseBackendsEnv(
      JSON.stringify({
        backends: [
          { kind: "s3", name: "s3-cn", bucket: "b", accessKeyEnv: "MISSING_AK", secretKeyEnv: "SK" },
        ],
        write: "s3-cn",
      }),
    )!;
    expect(() => buildBackends(topology, deps({ SK: "sk-value" }))).toThrow(
      AttachmentBackendsConfigError,
    );
    expect(() => buildBackends(topology, deps({ SK: "sk-value" }))).toThrow(/MISSING_AK/);
  });

  it("cloud-http 声明 → HttpBlobStore 实例,token 从声明的 tokenEnv 变量名解引用", () => {
    const topology = parseBackendsEnv(
      JSON.stringify({
        backends: [
          {
            kind: "cloud-http",
            name: "cloud",
            endpoint: "https://cloud.internal/internal/attachments/blob",
            tokenEnv: "PI_WEB_ATTACHMENT_TOKEN",
          },
        ],
        write: "cloud",
      }),
    )!;
    const backends = buildBackends(topology, deps({ PI_WEB_ATTACHMENT_TOKEN: "tok-value" }));
    expect(backends[0]!.store).toBeInstanceOf(HttpBlobStore);
  });

  it("cloud-http 声明凭据变量在 env 中缺失 → 抛 AttachmentBackendsConfigError 指出变量名(Req 2.4)", () => {
    const topology = parseBackendsEnv(
      JSON.stringify({
        backends: [
          { kind: "cloud-http", name: "cloud", endpoint: "https://cloud.internal/x", tokenEnv: "MISSING_TOK" },
        ],
        write: "cloud",
      }),
    )!;
    expect(() => buildBackends(topology, deps())).toThrow(AttachmentBackendsConfigError);
    expect(() => buildBackends(topology, deps())).toThrow(/MISSING_TOK/);
  });

  it("多后端混合(local-fs + s3)按声明顺序全部构建", () => {
    const topology = parseBackendsEnv(
      JSON.stringify({
        backends: [
          { kind: "local-fs", name: "local" },
          { kind: "s3", name: "cold", bucket: "b", accessKeyEnv: "AK", secretKeyEnv: "SK" },
        ],
        write: "local",
      }),
    )!;
    const backends = buildBackends(topology, deps({ AK: "a", SK: "s" }));
    expect(backends.map((b) => b.name)).toEqual(["local", "cold"]);
    expect(backends[0]!.store).toBeInstanceOf(LocalFsBlobBackend);
    expect(backends[1]!.store).toBeInstanceOf(S3BlobBackend);
  });
});

describe("buildRegistry(Req 2.1)", () => {
  it("registry 缺省(未声明)→ LocalFsAttachmentRegistry", () => {
    const topology = parseBackendsEnv(
      JSON.stringify({ backends: [{ kind: "local-fs", name: "local" }], write: "local" }),
    )!;
    expect(buildRegistry(topology, deps())).toBeInstanceOf(LocalFsAttachmentRegistry);
  });

  it("registry.kind = local-fs → LocalFsAttachmentRegistry", () => {
    const topology = parseBackendsEnv(
      JSON.stringify({
        backends: [{ kind: "local-fs", name: "local" }],
        write: "local",
        registry: { kind: "local-fs" },
      }),
    )!;
    expect(buildRegistry(topology, deps())).toBeInstanceOf(LocalFsAttachmentRegistry);
  });

  it("registry.kind = s3 → 绑定既有具名 s3 后端配置构造 S3AttachmentRegistry", () => {
    const topology = parseBackendsEnv(
      JSON.stringify({
        backends: [
          { kind: "s3", name: "s3-cn", bucket: "b", accessKeyEnv: "AK", secretKeyEnv: "SK" },
        ],
        write: "s3-cn",
        registry: { kind: "s3", backend: "s3-cn" },
      }),
    )!;
    const registry = buildRegistry(topology, deps({ AK: "a", SK: "s" }));
    expect(registry).toBeInstanceOf(S3AttachmentRegistry);
  });

  it("registry.backend 指向的名字不是 s3 kind(是 local-fs)→ 抛错", () => {
    const topology = parseBackendsEnv(
      JSON.stringify({
        backends: [{ kind: "local-fs", name: "local" }],
        write: "local",
        registry: { kind: "s3", backend: "local" },
      }),
    )!;
    expect(() => buildRegistry(topology, deps())).toThrow(AttachmentBackendsConfigError);
  });

  it("registry.kind = cloud-http → 绑定既有具名 cloud-http 后端配置构造 HttpAttachmentRegistry", () => {
    const topology = parseBackendsEnv(
      JSON.stringify({
        backends: [
          {
            kind: "cloud-http",
            name: "cloud",
            endpoint: "https://cloud.internal/internal/attachments/blob",
            tokenEnv: "TOK",
          },
        ],
        write: "cloud",
        registry: { kind: "cloud-http", backend: "cloud" },
      }),
    )!;
    const registry = buildRegistry(topology, deps({ TOK: "tok-value" }));
    expect(registry).toBeInstanceOf(HttpAttachmentRegistry);
  });

  it("registry.backend 指向的名字不是 cloud-http kind(是 local-fs)→ 抛错", () => {
    const topology = parseBackendsEnv(
      JSON.stringify({
        backends: [{ kind: "local-fs", name: "local" }],
        write: "local",
        registry: { kind: "cloud-http", backend: "local" },
      }),
    )!;
    expect(() => buildRegistry(topology, deps())).toThrow(AttachmentBackendsConfigError);
  });
});

describe("computePassthroughEnv(Req 6.1)", () => {
  it("产出拓扑原文 + 全部被引用凭据变量,不整包透传 env", () => {
    const raw = JSON.stringify({
      backends: [
        { kind: "local-fs", name: "local" },
        { kind: "s3", name: "cold", bucket: "b", accessKeyEnv: "AK", secretKeyEnv: "SK" },
      ],
      write: "local",
    });
    const topology = parseBackendsEnv(raw)!;
    const env: NodeJS.ProcessEnv = {
      PI_WEB_ATTACHMENT_BACKENDS: raw,
      AK: "ak-value",
      SK: "sk-value",
      UNRELATED_SECRET: "should-not-leak",
    };
    const passthrough = computePassthroughEnv(topology, env);
    expect(passthrough).toEqual({
      PI_WEB_ATTACHMENT_BACKENDS: raw,
      AK: "ak-value",
      SK: "sk-value",
    });
    expect(passthrough).not.toHaveProperty("UNRELATED_SECRET");
  });

  it("cloud-http 后端的 tokenEnv 一并透传(供子进程重建同构拓扑)", () => {
    const raw = JSON.stringify({
      backends: [
        { kind: "local-fs", name: "local" },
        {
          kind: "cloud-http",
          name: "cloud",
          endpoint: "https://cloud.internal/x",
          tokenEnv: "PI_WEB_ATTACHMENT_TOKEN",
        },
      ],
      write: "local",
    });
    const topology = parseBackendsEnv(raw)!;
    const env: NodeJS.ProcessEnv = {
      PI_WEB_ATTACHMENT_BACKENDS: raw,
      PI_WEB_ATTACHMENT_TOKEN: "tok-value",
      UNRELATED_SECRET: "should-not-leak",
    };
    const passthrough = computePassthroughEnv(topology, env);
    expect(passthrough).toEqual({
      PI_WEB_ATTACHMENT_BACKENDS: raw,
      PI_WEB_ATTACHMENT_TOKEN: "tok-value",
    });
    expect(passthrough).not.toHaveProperty("UNRELATED_SECRET");
  });

  it("含 sessionTokenEnv 时一并透传", () => {
    const raw = JSON.stringify({
      backends: [
        {
          kind: "s3",
          name: "cold",
          bucket: "b",
          accessKeyEnv: "AK",
          secretKeyEnv: "SK",
          sessionTokenEnv: "ST",
        },
      ],
      write: "cold",
    });
    const topology = parseBackendsEnv(raw)!;
    const env: NodeJS.ProcessEnv = {
      PI_WEB_ATTACHMENT_BACKENDS: raw,
      AK: "a",
      SK: "s",
      ST: "t",
    };
    expect(computePassthroughEnv(topology, env)).toEqual({
      PI_WEB_ATTACHMENT_BACKENDS: raw,
      AK: "a",
      SK: "s",
      ST: "t",
    });
  });
});
