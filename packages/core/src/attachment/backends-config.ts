/**
 * attachment · 拓扑配置 `PI_WEB_ATTACHMENT_BACKENDS`(`attachment-backend-pluggable` spec,
 * 任务 5.1;Req 2.1-2.4)。
 *
 * 单一 env 承载完整多后端拓扑(判别联合 + zod schema,与既有 `session-store` 同族);未设置该
 * env 时 {@link parseBackendsEnv} 返回 `undefined`(存量单机部署零行为变化,Req 1.1)。
 *
 * 装配期 fail fast(design.md §backends-config):JSON 不可解析、schema 不符、后端集合为空、
 * 重名、`write`/`registry.backend` 引用失配、未知 `kind` → {@link AttachmentBackendsConfigError}
 * (类型化,message 指出具体错误项),绝不以部分拓扑静默启动(Req 2.2)。
 *
 * 凭据仅以 `*Env` 间接引用宿主环境变量名表达(拓扑体本身不含明文凭据,Req 2.3);解引用为空
 * 变量名的校验发生在装配期的构建工厂(`buildBackends`,任务 5.2),因为只有工厂才持有
 * `env: NodeJS.ProcessEnv`(本模块的 {@link parseBackendsEnv} 签名不接收 env,契约以
 * design.md 为准)。
 */
import { z } from "zod";
import type { BlobStore } from "./blob-store.js";
import { LocalFsBlobBackend } from "./local-fs-backend.js";
import {
  LocalFsAttachmentRegistry,
  type AttachmentRegistryPort,
} from "./attachment-registry.js";
import type { UrlSigner } from "./url-signer.js";
import { S3BlobBackend, type S3BlobBackendConfig } from "./s3/s3-blob-backend.js";
import { S3AttachmentRegistry } from "./s3/s3-registry.js";
import { HttpBlobStore } from "./http/http-blob-store.js";
import { HttpAttachmentRegistry } from "./http/http-attachment-registry.js";
import type { NamedBackend } from "./union-blob-store.js";

/** 拓扑 env 变量名(`PI_WEB_ATTACHMENT_BACKENDS`)。 */
export const ATTACHMENT_BACKENDS_ENV = "PI_WEB_ATTACHMENT_BACKENDS";

/**
 * agent 具名附件 profile 运维关断 env(`agent-attachment-profile` spec;`"1"` 关断,默认开启,
 * 与 `PI_WEB_AGENT_ROUTES_DISABLED` 同风格)。
 *
 * 定义于此(而非 `runner/attachment-profile-wiring.ts`)是因为该常量须同时被子进程侧
 * (runner 白名单校验/帧发射)与主进程侧(`pi-session` 帧消费防御核对、`lib/app` spawn env
 * 下发清单)消费——`runner/` 模块刻意不从 `@blksails/pi-web-server` 主入口 re-export
 * (见 `packages/server/src/index.ts` 顶部注释:避免把整套 pi SDK 打进路由 bundle),
 * 而 `attachment/` 模块经主入口 `export * from "./attachment/index.js"` 全量导出,是两侧
 * 都能触达的单一来源。
 */
export const ATTACHMENT_PROFILE_DISABLED_ENV =
  "PI_WEB_AGENT_ATTACHMENT_PROFILE_DISABLED";

/** 装配期读取一次:关断生效返回 `true`(`env` 默认 `process.env`,便于测试注入)。 */
export function isAttachmentProfileDisabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env[ATTACHMENT_PROFILE_DISABLED_ENV] === "1";
}

/** 具名后端 name 的合法字符集:小写字母数字与连字符,首字符不可为连字符。 */
const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const NAME_SCHEMA = z.string().regex(NAME_PATTERN, "backend name must match ^[a-z0-9][a-z0-9-]*$");

const LocalFsBackendDeclSchema = z.object({
  kind: z.literal("local-fs"),
  name: NAME_SCHEMA,
  dir: z.string().optional(),
});

const S3BackendDeclSchema = z.object({
  kind: z.literal("s3"),
  name: NAME_SCHEMA,
  bucket: z.string().min(1),
  region: z.string().optional(),
  endpoint: z.string().optional(),
  prefix: z.string().optional(),
  forcePathStyle: z.boolean().optional(),
  /** 凭据经变量名间接引用(Req 2.3):字段值是宿主 env 变量的**名字**,不是明文凭据。 */
  accessKeyEnv: z.string().min(1),
  secretKeyEnv: z.string().min(1),
  sessionTokenEnv: z.string().optional(),
});

/**
 * `cloud-http` 后端声明(`sandbox-attachment-store` spec Wave A'1，design §7.1)：远端字节后端，
 * 字节经 HTTP 代理到 pi-clouds `cloud` 内部路由。凭据(scoped attachment token)经 `tokenEnv`
 * 间接引用(Req 2.3 同构)：拓扑体本身只放 endpoint + 变量名，token 明文单独经该 env 变量下发。
 */
const CloudHttpBackendDeclSchema = z.object({
  kind: z.literal("cloud-http"),
  name: NAME_SCHEMA,
  endpoint: z.string().url(),
  /** scoped attachment token 所在的宿主 env 变量名(不是明文凭据)。 */
  tokenEnv: z.string().min(1),
});

const BackendDeclSchema = z.discriminatedUnion("kind", [
  LocalFsBackendDeclSchema,
  S3BackendDeclSchema,
  CloudHttpBackendDeclSchema,
]);

export type LocalFsBackendDecl = z.infer<typeof LocalFsBackendDeclSchema>;
export type S3BackendDecl = z.infer<typeof S3BackendDeclSchema>;
export type CloudHttpBackendDecl = z.infer<typeof CloudHttpBackendDeclSchema>;
export type BackendDecl = z.infer<typeof BackendDeclSchema>;

const RegistryDeclSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("local-fs") }),
  z.object({ kind: z.literal("s3"), backend: z.string().min(1) }),
  z.object({ kind: z.literal("cloud-http"), backend: z.string().min(1) }),
]);
export type RegistryDecl = z.infer<typeof RegistryDeclSchema>;

const BackendsTopologySchema = z.object({
  backends: z.array(BackendDeclSchema).min(1, "backends must be non-empty"),
  write: z.string().min(1),
  registry: RegistryDeclSchema.optional(),
});
export type BackendsTopology = z.infer<typeof BackendsTopologySchema>;

/**
 * 拓扑装配期配置错误(类型化,可 `instanceof` 识别;message 指出具体错误项/变量名,Req 2.2/2.4)。
 */
export class AttachmentBackendsConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttachmentBackendsConfigError";
  }
}

/**
 * 解析 `PI_WEB_ATTACHMENT_BACKENDS` env 原文为拓扑对象。
 *
 * - `raw` 未设置/空串 → 返回 `undefined`(未配置 = 存量单机路径,Req 1.1);
 * - JSON 不可解析 / schema 不符(含未知 `kind`)/ 后端集合为空 / 重名 / `write` 未在声明集合中 /
 *   `registry.backend`(当 `registry.kind==="s3"`)未在声明集合中 → 抛
 *   {@link AttachmentBackendsConfigError},message 指出具体错误项(Req 2.2)。
 */
export function parseBackendsEnv(raw: string | undefined): BackendsTopology | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    throw new AttachmentBackendsConfigError(
      `PI_WEB_ATTACHMENT_BACKENDS is not valid JSON: ${(err as Error).message}`,
    );
  }

  const result = BackendsTopologySchema.safeParse(json);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
      .join("; ");
    throw new AttachmentBackendsConfigError(
      `PI_WEB_ATTACHMENT_BACKENDS does not match the expected schema: ${issues}`,
    );
  }
  const topology = result.data;

  const names = topology.backends.map((b) => b.name);
  const nameSet = new Set(names);
  if (nameSet.size !== names.length) {
    const seen = new Set<string>();
    const dup = names.find((n) => (seen.has(n) ? true : (seen.add(n), false)));
    throw new AttachmentBackendsConfigError(
      `PI_WEB_ATTACHMENT_BACKENDS.backends has a duplicate name "${dup}"`,
    );
  }

  if (!nameSet.has(topology.write)) {
    throw new AttachmentBackendsConfigError(
      `PI_WEB_ATTACHMENT_BACKENDS.write "${topology.write}" is not among the declared backend names`,
    );
  }

  if (
    (topology.registry?.kind === "s3" || topology.registry?.kind === "cloud-http") &&
    !nameSet.has(topology.registry.backend)
  ) {
    throw new AttachmentBackendsConfigError(
      `PI_WEB_ATTACHMENT_BACKENDS.registry.backend "${topology.registry.backend}" is not among the declared backend names`,
    );
  }

  return topology;
}

/**
 * 构建/凭据解引用依赖(`attachment-backend-pluggable` spec,任务 5.2;Req 2.1/6.1)。
 *
 * 与主进程 config 工厂({@link ./config.js})的解析结果同构:`dir`/`signer`/`urlBasePath` 供
 * local-fs 后端与 registry 构造使用,`env` 供 s3 后端凭据解引用(Req 2.4)。
 */
export interface BuildDeps {
  readonly signer: UrlSigner;
  readonly urlBasePath: string;
  /** local-fs 后端/registry 缺省落盘目录(未在拓扑中显式指定 `dir` 时使用)。 */
  readonly dir: string;
  readonly env: NodeJS.ProcessEnv;
}

/**
 * 解引用凭据 env 变量;缺失(未设或空)→ 抛 {@link AttachmentBackendsConfigError},message 指出
 * 具体变量名(Req 2.4)。
 */
function resolveCredentialEnv(env: NodeJS.ProcessEnv, varName: string, context: string): string {
  const value = env[varName];
  if (value === undefined || value.length === 0) {
    throw new AttachmentBackendsConfigError(
      `PI_WEB_ATTACHMENT_BACKENDS references missing credential env var "${varName}" (${context})`,
    );
  }
  return value;
}

/** 把 {@link S3BackendDecl} + env 解引用为可直接构造 {@link S3Client} 的配置。 */
function resolveS3ClientConfig(decl: S3BackendDecl, env: NodeJS.ProcessEnv): S3BlobBackendConfig {
  return {
    bucket: decl.bucket,
    region: decl.region ?? "us-east-1",
    endpoint: decl.endpoint,
    forcePathStyle: decl.forcePathStyle,
    prefix: decl.prefix,
    accessKeyId: resolveCredentialEnv(env, decl.accessKeyEnv, `backend "${decl.name}".accessKeyEnv`),
    secretAccessKey: resolveCredentialEnv(
      env,
      decl.secretKeyEnv,
      `backend "${decl.name}".secretKeyEnv`,
    ),
    sessionToken:
      decl.sessionTokenEnv !== undefined
        ? resolveCredentialEnv(env, decl.sessionTokenEnv, `backend "${decl.name}".sessionTokenEnv`)
        : undefined,
  };
}

function buildSingleBackend(decl: BackendDecl, deps: BuildDeps): BlobStore {
  if (decl.kind === "local-fs") {
    const dir = decl.dir !== undefined && decl.dir.length > 0 ? decl.dir : deps.dir;
    return new LocalFsBlobBackend(dir, deps.signer, deps.urlBasePath);
  }
  if (decl.kind === "cloud-http") {
    const token = resolveCredentialEnv(deps.env, decl.tokenEnv, `backend "${decl.name}".tokenEnv`);
    return new HttpBlobStore({ endpoint: decl.endpoint, token });
  }
  return new S3BlobBackend(resolveS3ClientConfig(decl, deps.env));
}

/**
 * 按拓扑声明实例化全部具名字节后端(`kind` → LocalFs/S3 实例,Req 2.1)。
 *
 * s3 后端的凭据在此处从声明的 `*Env` 变量名解引用为明文(缺失即抛错,Req 2.4);
 * local-fs 后端未显式声明 `dir` 时回落 `deps.dir`。
 */
export function buildBackends(t: BackendsTopology, deps: BuildDeps): NamedBackend[] {
  return t.backends.map((decl) => ({ name: decl.name, store: buildSingleBackend(decl, deps) }));
}

/**
 * 按拓扑声明构建描述符注册表(缺省 `local-fs`;`kind==="s3"` 时绑定既有具名 s3 后端的客户端配置,
 * Req 2.1)。
 *
 * `registry.backend` 指向的名字必须是一个已声明的 **s3** 后端(`parseBackendsEnv` 已校验该名字
 * 存在于 `backends` 中,此处进一步校验其 `kind` 确为 `s3`)。
 */
export function buildRegistry(
  t: BackendsTopology,
  deps: BuildDeps,
): AttachmentRegistryPort {
  const registryDecl = t.registry ?? { kind: "local-fs" as const };
  if (registryDecl.kind === "local-fs") {
    return new LocalFsAttachmentRegistry(deps.dir);
  }
  const backendDecl = t.backends.find((b) => b.name === registryDecl.backend);
  if (registryDecl.kind === "cloud-http") {
    if (backendDecl === undefined || backendDecl.kind !== "cloud-http") {
      throw new AttachmentBackendsConfigError(
        `PI_WEB_ATTACHMENT_BACKENDS.registry.backend "${registryDecl.backend}" is not a declared cloud-http backend`,
      );
    }
    const token = resolveCredentialEnv(
      deps.env,
      backendDecl.tokenEnv,
      `backend "${backendDecl.name}".tokenEnv`,
    );
    return new HttpAttachmentRegistry({ endpoint: backendDecl.endpoint, token });
  }
  if (backendDecl === undefined || backendDecl.kind !== "s3") {
    throw new AttachmentBackendsConfigError(
      `PI_WEB_ATTACHMENT_BACKENDS.registry.backend "${registryDecl.backend}" is not a declared s3 backend`,
    );
  }
  return new S3AttachmentRegistry(resolveS3ClientConfig(backendDecl, deps.env));
}

/**
 * 计算子进程 spawn env 透传清单(`attachment-backend-pluggable` spec,任务 5.2;Req 6.1)。
 *
 * 产出拓扑 env 原文(`PI_WEB_ATTACHMENT_BACKENDS`,若已设置)+ 全部被 s3 后端声明引用的凭据变量
 * (`accessKeyEnv`/`secretKeyEnv`/`sessionTokenEnv`)当前取值,使子进程按同一 env 重建同构拓扑
 * (design.md §backends-config;不整包透传 env,只下发被引用变量)。
 */
export function computePassthroughEnv(
  t: BackendsTopology,
  env: NodeJS.ProcessEnv,
): Record<string, string> {
  const out: Record<string, string> = {};
  const raw = env[ATTACHMENT_BACKENDS_ENV];
  if (raw !== undefined) out[ATTACHMENT_BACKENDS_ENV] = raw;
  for (const decl of t.backends) {
    if (decl.kind === "s3") {
      for (const varName of [decl.accessKeyEnv, decl.secretKeyEnv, decl.sessionTokenEnv]) {
        if (varName === undefined) continue;
        const value = env[varName];
        if (value !== undefined) out[varName] = value;
      }
      continue;
    }
    if (decl.kind === "cloud-http") {
      const value = env[decl.tokenEnv];
      if (value !== undefined) out[decl.tokenEnv] = value;
    }
  }
  return out;
}
