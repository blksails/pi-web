/**
 * HttpRegistryAdapter(cli-package-commands 任务 7.2)—— `RegistryPort` 的生产实现。
 *
 * 经 `@pi-clouds/registry-client` 的 `RegistryHttpClient`(构建期 inline 进 cli-commands.mjs,
 * 运行时零依赖)。职责:
 *  - 持有 registry 地址 + 发布/消费 token(**不外泄给上层**;端口方法本身不带 token)。
 *  - 把 registry-client 的错误(`RegistryError` code + 网络异常)归一到本仓 `RegistryError` 联合。
 *  - **可变 ref 前置拒绝**:`registerVersion` 在 origin 引用可变时本地即失败(Req 7.8),
 *    不把判定推给服务端。
 *
 * registry-client 的具体类型不外泄:本文件是唯一 import 它的地方,上层只见 `RegistryPort`。
 */
import {
  RegistryError as ClientRegistryError,
  RegistryHttpClient,
  type Origin,
} from "@pi-clouds/registry-client";
import type {
  RegistryError,
  RegistryOrigin,
  RegistryPort,
  ResolvedRegistryEntry,
  Result,
  SignedManifest,
} from "./registry-port.js";

export interface HttpRegistryAdapterOptions {
  readonly baseUrl: string;
  /** 发布面 token(register/setChannel/uploadBundle);消费面若不同可另给 `consumeToken`。 */
  readonly publishToken?: string;
  /** 消费面 token(resolve);缺省复用 `publishToken`。 */
  readonly consumeToken?: string;
  /** 注入 fetch(测试用);缺省全局 fetch。 */
  readonly fetch?: typeof fetch;
}

const ok = <T>(value: T): Result<T, RegistryError> => ({ ok: true, value });
const err = (error: RegistryError): Result<never, RegistryError> => ({ ok: false, error });

/** 精确 semver(拒绝 range / latest / *)—— npm origin 不可变性前置判定。 */
function isExactSemver(v: string): boolean {
  return /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(v);
}

/** git ref 是否不可变(40-hex commit sha 或 `v` 开头 tag);分支名/HEAD 视为可变。 */
function isImmutableGitRef(ref: string): boolean {
  if (/^[0-9a-f]{40}$/i.test(ref)) return true;
  if (ref === "HEAD" || ref === "main" || ref === "master") return false;
  // 约定:tag 形如 v1.2.3;其余(分支名)当可变。与 pi-clouds git-origin-fetcher 判定同构。
  return /^v?\d+\.\d+\.\d+/.test(ref);
}

/** 检查 origin 不可变;可变返回该 ref 字符串(供 MUTABLE_REF 错误),不可变返回 undefined。 */
function mutableRefOf(origin: RegistryOrigin): string | undefined {
  if (origin.type === "git") return isImmutableGitRef(origin.ref) ? undefined : origin.ref;
  if (origin.type === "npm") return isExactSemver(origin.version) ? undefined : origin.version;
  return undefined; // oss bundle 恒不可变(内容寻址)
}

export class HttpRegistryAdapter implements RegistryPort {
  private readonly client: RegistryHttpClient;
  private readonly baseUrl: string;
  private readonly publishToken?: string;
  private readonly consumeToken?: string;

  constructor(opts: HttpRegistryAdapterOptions) {
    this.baseUrl = opts.baseUrl;
    this.publishToken = opts.publishToken;
    this.consumeToken = opts.consumeToken ?? opts.publishToken;
    this.client = new RegistryHttpClient({
      baseUrl: opts.baseUrl,
      ...(opts.fetch ? { fetch: opts.fetch as never } : {}),
    });
  }

  async resolve(
    sourceId: string,
    opts?: { channel?: string; version?: string },
  ): Promise<Result<ResolvedRegistryEntry, RegistryError>> {
    return this.guard(async () => {
      const r = await this.client.resolve(this.consumeToken, {
        sourceId,
        ...(opts?.channel !== undefined ? { channel: opts.channel } : {}),
        ...(opts?.version !== undefined ? { version: opts.version } : {}),
      });
      return ok<ResolvedRegistryEntry>({
        sourceId: r.sourceId,
        version: r.version,
        origin: r.origin as RegistryOrigin,
        manifest: r.manifest,
        ...(r.yanked ? { yanked: true } : {}),
      });
    }, sourceId);
  }

  async uploadBundle(sourceId: string, bytes: Uint8Array): Promise<Result<{ bundle: string }, RegistryError>> {
    return this.guard(async () => {
      const r = await this.client.uploadBundle(this.publishToken, sourceId, bytes);
      return ok({ bundle: r.bundle });
    }, sourceId);
  }

  async registerVersion(
    sourceId: string,
    origin: RegistryOrigin,
    manifest: SignedManifest,
  ): Promise<Result<void, RegistryError>> {
    // Req 7.8:可变 ref **前置拒绝**,不把判定推给服务端。
    const mutable = mutableRefOf(origin);
    if (mutable !== undefined) return err({ code: "MUTABLE_REF", ref: mutable });
    return this.guard(async () => {
      await this.client.registerVersion(this.publishToken, {
        sourceId,
        origin: origin as Origin,
        manifest,
      });
      return ok(undefined);
    }, sourceId);
  }

  async setChannel(sourceId: string, channel: string, version: string): Promise<Result<void, RegistryError>> {
    return this.guard(async () => {
      await this.client.moveChannel(this.publishToken, { sourceId, channel, version });
      return ok(undefined);
    }, sourceId);
  }

  /** 统一异常→本仓 RegistryError 归一:网络错误→UNREACHABLE(带地址);RegistryError→按 code 映射。 */
  private async guard<T>(fn: () => Promise<Result<T, RegistryError>>, sourceId: string): Promise<Result<T, RegistryError>> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof ClientRegistryError) {
        // ★ RegistryHttpClient 把网络错误**重试耗尽后**包装成 `ORIGIN_FETCH`(消息 `request failed
        //   after N attempts`),原始网络异常不逃逸。据此把"网络不可达"与服务端真正的回源失败区分开。
        if (e.code === "ORIGIN_FETCH" && /request failed after \d+ attempts/.test(e.message)) {
          return err({ code: "UNREACHABLE", baseUrl: this.baseUrl, detail: e.message });
        }
        return err(this.mapClientError(e, sourceId));
      }
      // 其它(超时/未知)→ 携带 registry 地址(Req 7.2)
      return err({ code: "UNREACHABLE", baseUrl: this.baseUrl, detail: (e as Error)?.message });
    }
  }

  private mapClientError(e: ClientRegistryError, sourceId: string): RegistryError {
    switch (e.code) {
      case "NOT_FOUND":
        return { code: "SOURCE_ABSENT", sourceId };
      case "VERSION_CONFLICT":
      case "IMMUTABLE_VIOLATION": {
        const version = (e.details?.["version"] as string) ?? "";
        return { code: "VERSION_EXISTS", sourceId, version };
      }
      case "ORIGIN_REF":
        return { code: "MUTABLE_REF", ref: (e.details?.["ref"] as string) ?? e.message };
      case "FORBIDDEN":
      case "UNAUTHORIZED":
        return { code: "FORBIDDEN", detail: e.message };
      // 服务端拒绝版本的各类原因(验签/完整性/回源)
      case "SIGNATURE":
      case "INTEGRITY":
      case "ORIGIN_FETCH":
      case "VALIDATION":
      case "YANK_CONFLICT":
        return { code: "VERSION_REJECTED", reason: `${e.code}: ${e.message}` };
      default:
        return { code: "OTHER", detail: `${e.code}: ${e.message}` };
    }
  }
}
