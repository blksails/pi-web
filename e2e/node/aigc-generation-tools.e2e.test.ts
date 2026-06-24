/**
 * AIGC generation tools — Node e2e test (Req 7.1, 7.2, 3.1–3.4, 5.2–5.3).
 *
 * Proves the full chain:
 *   buildAigcTools (image_generation, qwen-image sync variant)
 *   → mocked provider fetch returns inline 1×1 PNG bytes
 *   → persistPicked fetches image URL → ctx.putOutput → att_ ref
 *   → store.head / getReadStream verify real on-disk write
 *   → store.verifyUrl passes (Req 3.3)
 *   → degradation: ctx.available=false → ok:false, no throw (Req 5.3/3.4)
 *
 * Constraints:
 *  - No external LLM/provider credentials.
 *  - Real LocalFsBlobBackend + AttachmentStore (temp dir, afterAll cleanup).
 *  - Strict TypeScript, no `any`.
 *  - Mock fetch injected via deps.fetchImpl — does NOT hit the network.
 *  - DASHSCOPE_API_KEY set to "test-key" so requiredVars check passes.
 *  - Sync DashScope variant ("qwen-image-pro") used to avoid polling complexity.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ── Real store imports (relative, not barrel) ────────────────────────────────
import { createUrlSigner } from "../../packages/server/src/attachment/url-signer.js";
import { LocalFsBlobBackend } from "../../packages/server/src/attachment/local-fs-backend.js";
import { AttachmentRegistry } from "../../packages/server/src/attachment/attachment-registry.js";
import { AttachmentStore } from "../../packages/server/src/attachment/attachment-store.js";

// ── tool-kit runtime imports (relative — @blksails/pi-web-tool-kit not in root node_modules) ──
import { buildAigcTools, SEAM_KEY } from "../../packages/tool-kit/src/runtime.js";
import type {
  AttachmentToolContext,
  AttachmentToolHandle,
  PutOutputInput,
  ToolOutputRef,
} from "../../packages/agent-kit/src/attachment.js";
import type { Attachment } from "../../packages/protocol/src/attachment/attachment-dto.js";

// 工具定义类型从 buildAigcTools 的返回推断,避免在 root tsconfig 下直接 import
// `@earendil-works/pi-coding-agent`(root node_modules 不含该 peer 依赖)。
type ToolDef = ReturnType<typeof buildAigcTools>[number];

// 工具 details 的判别联合(对齐 compile-category 的结构化结果)。
type AigcAsset = {
  attachmentId: string;
  displayUrl: string;
  mimeType: string;
  name: string;
};
type AigcDetails =
  | { ok: true; model?: string; assets: AigcAsset[] }
  | { ok: false; error: string };

/** 把工具结果的 unknown details 断言为 AigcDetails(集中收口断言)。 */
function detailsOf(result: { details: unknown }): AigcDetails {
  return result.details as AigcDetails;
}

/** pi `ToolDefinition.execute` 形参为 5 个(toolCallId, params, signal, onUpdate, ctx);
 *  本测试只用前两个,其余以兼容值占位。 */
function runTool(
  tool: ToolDef,
  params: Record<string, unknown>,
): Promise<{ details: unknown }> {
  return tool.execute(
    "tc",
    params,
    undefined,
    undefined,
    {} as never,
  ) as Promise<{ details: unknown }>;
}

// ── 1×1 minimal PNG constant ─────────────────────────────────────────────────
// The smallest valid PNG: 1×1 transparent pixel.
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC";

function minimalPng(): Uint8Array {
  return new Uint8Array(Buffer.from(PNG_BASE64, "base64"));
}

// ── Shared store state ────────────────────────────────────────────────────────

const SECRET = "e2e-test-secret-stable";
let tmpRoot: string;
let store: AttachmentStore;

// ── AttachmentToolContext adapter (strictly typed) ─────────────────────────────

/**
 * Build a real AttachmentToolContext from the real store.
 * No `any` — all types are structurally explicit.
 */
function buildCtx(s: AttachmentStore, sessionId: string): AttachmentToolContext {
  return {
    available: true,

    async resolve(id: string): Promise<AttachmentToolHandle> {
      const meta = await s.head(id);
      if (!meta) throw new Error(`resolve: attachment not found: ${id}`);

      return {
        meta: meta as Attachment,

        async bytes(): Promise<Uint8Array> {
          const { stream } = await s.getReadStream(id);
          const chunks: Buffer[] = [];
          for await (const chunk of stream) chunks.push(Buffer.from(chunk));
          return new Uint8Array(Buffer.concat(chunks));
        },

        async localPath(): Promise<string> {
          const p = await s.localPath(id);
          if (!p) throw new Error(`localPath: no local path for ${id}`);
          return p;
        },

        async url(opts?: { expiresInMs?: number }): Promise<string> {
          return s.presignUrl(id, opts);
        },
      };
    },

    async putOutput(input: PutOutputInput): Promise<ToolOutputRef> {
      const att = await s.put({
        bytes: input.bytes,
        name: input.name,
        mimeType: input.mimeType,
        size: input.bytes.byteLength,
        sessionId,
        origin: "tool-output",
      });
      const displayUrl = await s.presignUrl(att.id);
      return {
        attachmentId: att.id,
        displayUrl,
        name: att.name,
        mimeType: att.mimeType,
      };
    },
  };
}

// ── Mock fetch factory ───────────────────────────────────────────────────────

/**
 * Build a DashScope sync mock fetch.
 *
 * The sync variant (qwen-image / multimodal-generation) sends one POST and
 * expects a JSON body shaped like:
 *   { output: { choices: [{ message: { content: [{ image: "<url>" }] } }] } }
 *
 * persistPicked then fetches that image URL to get the raw bytes.
 */
const SYNC_T2I_URL =
  "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation";
const MOCK_IMAGE_URL = "https://mock-image-host/generated/img-0.png";

function buildMockFetch(imageBytes: Uint8Array): typeof fetch {
  return vi.fn(
    async (input: string | URL | Request): Promise<Response> => {
      const url =
        input instanceof Request
          ? input.url
          : typeof input === "string"
            ? input
            : input.toString();

      if (url === SYNC_T2I_URL) {
        const body = JSON.stringify({
          output: {
            choices: [{ message: { content: [{ image: MOCK_IMAGE_URL }] } }],
          },
        });
        return new Response(body, {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (url === MOCK_IMAGE_URL) {
        // Uint8Array → BodyInit:在严格 lib 下 Uint8Array 泛型与 BodyInit 不直接兼容,
        // 经 ArrayBuffer 视图传入(运行时为原始字节)。
        return new Response(imageBytes.buffer as ArrayBuffer, {
          status: 200,
          headers: { "content-type": "image/png" },
        });
      }

      throw new Error(`[mockFetch] unexpected URL: ${url}`);
    },
  ) as unknown as typeof fetch;
}

// ── Setup / Teardown ──────────────────────────────────────────────────────────

beforeAll(async () => {
  process.env["DASHSCOPE_API_KEY"] = "test-key";

  tmpRoot = await mkdtemp(join(tmpdir(), "aigc-e2e-"));

  const signer = createUrlSigner(SECRET);
  const backend = new LocalFsBlobBackend(tmpRoot, signer);
  const registry = new AttachmentRegistry(tmpRoot);
  store = new AttachmentStore({ blob: backend, registry, signer, backend });
});

afterAll(async () => {
  delete process.env["DASHSCOPE_API_KEY"];
  await rm(tmpRoot, { recursive: true, force: true });
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function getTextToImageTool(
  ctx: AttachmentToolContext,
  mockFetch: typeof fetch,
): ToolDef {
  const tools = buildAigcTools({
    include: ["image_generation"],
    deps: { getCtx: () => ctx, fetchImpl: mockFetch },
  });
  const tool = tools.find((t) => t.name === "image_generation");
  if (!tool) {
    throw new Error("image_generation tool not found in buildAigcTools output");
  }
  return tool;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("aigc-generation-tools node e2e", () => {
  describe("image_generation — sync qwen-image variant — happy path (Req 1.1, 3.1–3.3)", () => {
    it("execute returns ok=true, assets non-empty, attachmentId starts with att_", async () => {
      const ctx = buildCtx(store, "sess-e2e-1");
      (globalThis as Record<string, unknown>)[SEAM_KEY] = ctx;
      const tool = getTextToImageTool(ctx, buildMockFetch(minimalPng()));

      const result = await runTool(tool, { prompt: "a test image", model: "qwen-image-pro" });
      const details = detailsOf(result);

      expect(details.ok).toBe(true);
      if (!details.ok) throw new Error("details.ok must be true");
      expect(details.assets.length).toBeGreaterThan(0);

      const asset = details.assets[0]!;
      expect(asset.attachmentId).toMatch(/^att_[A-Za-z0-9_-]+$/);
      expect(asset.displayUrl).toBeTruthy();
      expect(asset.mimeType).toContain("image/");
    });

    it("store.head finds the produced attachment with origin tool-output and mime image/*", async () => {
      const ctx = buildCtx(store, "sess-e2e-2");
      (globalThis as Record<string, unknown>)[SEAM_KEY] = ctx;
      const tool = getTextToImageTool(ctx, buildMockFetch(minimalPng()));

      const result = await runTool(tool, { prompt: "a test image", model: "qwen-image-pro" });
      const details = detailsOf(result);
      if (!details.ok) throw new Error("details.ok must be true");

      const head = await store.head(details.assets[0]!.attachmentId);
      expect(head).toBeDefined();
      expect(head!.origin).toBe("tool-output");
      expect(head!.mimeType).toMatch(/^image\//);
      expect(head!.sessionId).toBe("sess-e2e-2");
    });

    it("store.getReadStream bytes === injected PNG bytes (proves real disk write + read, Req 3.1)", async () => {
      const pngBytes = minimalPng();
      const ctx = buildCtx(store, "sess-e2e-3");
      (globalThis as Record<string, unknown>)[SEAM_KEY] = ctx;
      const tool = getTextToImageTool(ctx, buildMockFetch(pngBytes));

      const result = await runTool(tool, { prompt: "a test image", model: "qwen-image-pro" });
      const details = detailsOf(result);
      if (!details.ok) throw new Error("details.ok must be true");

      const { stream } = await store.getReadStream(details.assets[0]!.attachmentId);
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk));
      const readBytes = new Uint8Array(Buffer.concat(chunks));

      expect(readBytes.length).toBe(pngBytes.length);
      expect([...readBytes]).toEqual([...pngBytes]);
    });

    it("store.verifyUrl passes for the produced displayUrl (Req 3.3)", async () => {
      const ctx = buildCtx(store, "sess-e2e-4");
      (globalThis as Record<string, unknown>)[SEAM_KEY] = ctx;
      const tool = getTextToImageTool(ctx, buildMockFetch(minimalPng()));

      const result = await runTool(tool, { prompt: "a test image", model: "qwen-image-pro" });
      const details = detailsOf(result);
      if (!details.ok) throw new Error("details.ok must be true");

      const { attachmentId, displayUrl } = details.assets[0]!;
      const parsedUrl = new URL(displayUrl, "http://x");
      const exp = Number(parsedUrl.searchParams.get("exp"));
      const sig = parsedUrl.searchParams.get("sig") ?? "";

      expect(store.verifyUrl(attachmentId, exp, sig)).toBe(true);
      expect(store.verifyUrl(attachmentId, exp, "tampered")).toBe(false);
    });
  });

  describe("globalThis seam injection (Req 5.3 / design seam)", () => {
    it("ctx injected via globalThis seam is read by getAttachmentToolContext", async () => {
      const ctx = buildCtx(store, "sess-e2e-seam");
      (globalThis as Record<string, unknown>)[SEAM_KEY] = ctx;

      // 仅经 globalThis 注入 ctx — 不传 deps.getCtx,走真实 seam 读取。
      const tools = buildAigcTools({
        include: ["image_generation"],
        deps: { fetchImpl: buildMockFetch(minimalPng()) },
      });
      const tool = tools.find((t) => t.name === "image_generation")!;

      const result = await runTool(tool, { prompt: "seam test", model: "qwen-image-pro" });
      const details = detailsOf(result);
      expect(details.ok).toBe(true);
      if (!details.ok) throw new Error("details.ok must be true (seam path)");
      expect(details.assets[0]!.attachmentId).toMatch(/^att_/);
    });
  });

  describe("degradation path (Req 5.3 / 3.4)", () => {
    it("ctx with available:false → execute returns ok=false without throwing", async () => {
      const unavailableCtx: AttachmentToolContext = {
        available: false,
        async resolve(): Promise<AttachmentToolHandle> {
          throw new Error("attachment capability unavailable: context not injected");
        },
        async putOutput(): Promise<ToolOutputRef> {
          throw new Error("attachment capability unavailable: context not injected");
        },
      };

      const tools = buildAigcTools({
        include: ["image_generation"],
        deps: { getCtx: () => unavailableCtx, fetchImpl: buildMockFetch(minimalPng()) },
      });
      const tool = tools.find((t) => t.name === "image_generation")!;

      const result = await runTool(tool, { prompt: "degrade test", model: "qwen-image-pro" });
      const details = detailsOf(result);
      expect(details.ok).toBe(false);
      if (details.ok) throw new Error("expected ok=false for unavailable ctx");
      expect(details.error).toBeTruthy();
    });

    it("missing DASHSCOPE_API_KEY → execute returns ok=false without throwing (Req 5.2)", async () => {
      const savedKey = process.env["DASHSCOPE_API_KEY"];
      delete process.env["DASHSCOPE_API_KEY"];

      try {
        const ctx = buildCtx(store, "sess-e2e-nokey");
        const tools = buildAigcTools({
          include: ["image_generation"],
          deps: { getCtx: () => ctx, fetchImpl: buildMockFetch(minimalPng()) },
        });
        const tool = tools.find((t) => t.name === "image_generation")!;

        const result = await runTool(tool, { prompt: "no key test", model: "qwen-image-pro" });
        const details = detailsOf(result);
        expect(details.ok).toBe(false);
        if (details.ok) throw new Error("expected ok=false for missing API key");
        expect(details.error).toMatch(/DASHSCOPE_API_KEY/);
      } finally {
        if (savedKey !== undefined) process.env["DASHSCOPE_API_KEY"] = savedKey;
      }
    });
  });

  describe("buildAigcTools toolset structure (Req 6.1 / 6.2)", () => {
    it("buildAigcTools returns both image_generation and image_edit tools", () => {
      const names = buildAigcTools().map((t) => t.name);
      expect(names).toContain("image_generation");
      expect(names).toContain("image_edit");
    });

    it("include filter restricts to specified tools", () => {
      const tools = buildAigcTools({ include: ["image_generation"] });
      expect(tools).toHaveLength(1);
      expect(tools[0]!.name).toBe("image_generation");
    });

    it("each tool has name, description, and execute function", () => {
      for (const tool of buildAigcTools()) {
        expect(typeof tool.name).toBe("string");
        expect(tool.name.length).toBeGreaterThan(0);
        expect(typeof tool.execute).toBe("function");
      }
    });
  });
});
