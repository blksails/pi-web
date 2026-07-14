/**
 * vision 测试夹具 — 伪造 attachment 上下文、模型注册表与 ExtensionContext。
 *
 * 全部为结构同形的最小实现:tool-kit 刻意不依赖 pi 内层包的具体类,测试亦然。
 */
import { vi } from "vitest";
import type { Attachment } from "@blksails/pi-web-protocol";
import type { AttachmentToolContext } from "@blksails/pi-web-agent-kit";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { ExtensionContext, ModelRegistry } from "@earendil-works/pi-coding-agent";

/** 造一个 Attachment 描述符。 */
export function att(
  id: string,
  mimeType: string,
  createdAt: string,
  name = `${id}.bin`,
): Attachment {
  return {
    id,
    name,
    mimeType,
    size: 3,
    origin: "upload",
    sessionId: "s1",
    createdAt,
  };
}

/** 造一个 vision 模型(input 含 image)或纯文本模型。 */
export function model(
  provider: string,
  id: string,
  input: ("text" | "image")[] = ["text", "image"],
  name = id,
): Model<Api> {
  return {
    id,
    name,
    api: "openai-completions",
    provider,
    baseUrl: "https://example.test/v1",
    reasoning: false,
    input,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1000,
    maxTokens: 100,
  } as Model<Api>;
}

export interface FakeAttOpts {
  readonly available?: boolean;
  /** id → 字节 + mimeType;缺失则 resolve 抛错。 */
  readonly blobs?: Record<string, { bytes: Uint8Array; mimeType: string }>;
  readonly list?: Attachment[];
  /** listBySession 抛错。 */
  readonly listThrows?: boolean;
}

/** 伪造 AttachmentToolContext。 */
export function fakeAttCtx(opts: FakeAttOpts = {}): AttachmentToolContext {
  const { available = true, blobs = {}, list = [], listThrows = false } = opts;
  return {
    available,
    async resolve(id: string) {
      const hit = blobs[id];
      if (hit === undefined) throw new Error(`no such attachment: ${id}`);
      return {
        meta: att(id, hit.mimeType, "2026-01-01T00:00:00.000Z"),
        async bytes() {
          return hit.bytes;
        },
        async localPath() {
          return `/tmp/${id}`;
        },
        async url() {
          return `https://example.test/${id}`;
        },
      };
    },
    async putOutput() {
      throw new Error("putOutput must not be called by vision");
    },
    async listBySession() {
      if (listThrows) throw new Error("list failed");
      return list;
    },
    async getMeta() {
      return undefined;
    },
    async setMeta() {
      /* no-op */
    },
  } as unknown as AttachmentToolContext;
}

export interface FakeRegistryOpts {
  /** 凭据可用的模型(getAvailable 返回)。 */
  readonly available: Model<Api>[];
  /** 全部模型(getAll 返回);缺省等于 available。 */
  readonly all?: Model<Api>[];
  /** getApiKeyAndHeaders 的应答。 */
  readonly auth?:
    | { ok: true; apiKey?: string; headers?: Record<string, string>; env?: Record<string, string> }
    | { ok: false; error: string };
}

/** 伪造 ModelRegistry。 */
export function fakeRegistry(opts: FakeRegistryOpts): ModelRegistry {
  const auth = opts.auth ?? { ok: true as const, apiKey: "sk-test", headers: { "X-T": "1" } };
  return {
    getAvailable: vi.fn(() => opts.available),
    getAll: vi.fn(() => opts.all ?? opts.available),
    find: vi.fn(),
    getApiKeyAndHeaders: vi.fn(async () => auth),
  } as unknown as ModelRegistry;
}

export interface FakeCtxOpts {
  readonly hasUI?: boolean;
  readonly registry: ModelRegistry;
  /** ui.select 的返回值(undefined = 用户取消)。 */
  readonly selectReturns?: string | undefined;
  readonly selectThrows?: boolean;
  readonly signal?: AbortSignal;
}

export interface FakeCtx {
  readonly ctx: ExtensionContext;
  readonly select: ReturnType<typeof vi.fn>;
  readonly notify: ReturnType<typeof vi.fn>;
}

/** 伪造 ExtensionContext(含 ui.select / ui.notify 探针)。 */
export function fakeCtx(opts: FakeCtxOpts): FakeCtx {
  const select = vi.fn(async () => {
    if (opts.selectThrows === true) throw new Error("select blew up");
    return opts.selectReturns;
  });
  const notify = vi.fn();
  const ctx = {
    hasUI: opts.hasUI ?? false,
    ui: { select, notify },
    modelRegistry: opts.registry,
    model: undefined,
    signal: opts.signal,
  } as unknown as ExtensionContext;
  return { ctx, select, notify };
}

/** 造一个已 abort 的 signal。 */
export function abortedSignal(): AbortSignal {
  const c = new AbortController();
  c.abort();
  return c.signal;
}
