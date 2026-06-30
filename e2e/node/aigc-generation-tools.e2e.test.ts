/**
 * AIGC generation tools — Node e2e test (detoolspec-unify-builtin-tools task 4.5; Req 1.x, 2.x, 5.x).
 *
 * Proves the full chain via the **extension** form (post-detoolspec):
 *   aigcExtension → pi.registerTool(image_generation/image_edit)
 *   → execute → runImageTool → mocked DashScope sync provider returns image URL
 *   → persistPicked fetches image URL → real AttachmentStore.put → att_ ref
 *   → store.head / getReadStream verify real on-disk write
 *   → store.verifyUrl passes
 *   → degradation: ctx.available=false / missing DASHSCOPE_API_KEY → ok:false, no throw
 *
 * Constraints:
 *  - No external LLM/provider credentials.
 *  - Real LocalFsBlobBackend + AttachmentStore (temp dir, afterAll cleanup).
 *  - Strict TypeScript, no `any`.
 *  - Mock fetch installed on globalThis — does NOT hit the network.
 *  - attachment ctx injected via globalThis SEAM_KEY (the real runner seam).
 *  - Model "wan2.7-image-pro" (DashScope sync) avoids polling complexity.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ── Real store imports (relative, not barrel) ────────────────────────────────
import { createUrlSigner } from "../../packages/server/src/attachment/url-signer.js";
import { LocalFsBlobBackend } from "../../packages/server/src/attachment/local-fs-backend.js";
import { AttachmentRegistry } from "../../packages/server/src/attachment/attachment-registry.js";
import { AttachmentStore } from "../../packages/server/src/attachment/attachment-store.js";

// ── tool-kit runtime imports (relative — @blksails/pi-web-tool-kit not in root node_modules) ──
import { aigcExtension, SEAM_KEY } from "../../packages/tool-kit/src/runtime.js";
import type {
  AttachmentToolContext,
  AttachmentToolHandle,
  PutOutputInput,
  ToolOutputRef,
} from "../../packages/agent-kit/src/attachment.js";
import type { Attachment } from "../../packages/protocol/src/attachment/attachment-dto.js";

// 工具定义的本地结构(避免在 root tsconfig 下 import `@earendil-works/pi-coding-agent`,
// root node_modules 不含该 peer 依赖)。
interface ToolDef {
  name: string;
  description: string;
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal: unknown,
    onUpdate: unknown,
    ctx: unknown,
  ) => Promise<{ details: unknown }>;
}

/** 用 fake pi 收集 aigcExtension 注册的工具(等价于真实会话装载)。 */
function collectAigcTools(): ToolDef[] {
  const tools: ToolDef[] = [];
  const pi = {
    registerTool: (def: ToolDef) => tools.push(def),
    registerCommand: () => {},
  };
  (aigcExtension as unknown as (pi: unknown) => void)(pi);
  return tools;
}

type AigcAsset = {
  attachmentId: string;
  displayUrl: string;
  mimeType: string;
  name: string;
};
type AigcDetails =
  | { ok: true; model?: string; assets: AigcAsset[] }
  | { ok: false; error: string };

function detailsOf(result: { details: unknown }): AigcDetails {
  return result.details as AigcDetails;
}

/** execute(toolCallId, params, signal, onUpdate, ctx);ctx={} → 无 UI,走默认 seam。 */
function runTool(tool: ToolDef, params: Record<string, unknown>): Promise<{ details: unknown }> {
  return tool.execute("tc", params, undefined, undefined, {});
}

function imageGenerationTool(): ToolDef {
  const tool = collectAigcTools().find((t) => t.name === "image_generation");
  if (!tool) throw new Error("image_generation not registered by aigcExtension");
  return tool;
}

// ── 1×1 minimal PNG constant ─────────────────────────────────────────────────
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC";

function minimalPng(): Uint8Array {
  return new Uint8Array(Buffer.from(PNG_BASE64, "base64"));
}

// ── Shared store state ────────────────────────────────────────────────────────
const SECRET = "e2e-test-secret-stable";
let tmpRoot: string;
let store: AttachmentStore;
let originalFetch: typeof fetch;

// ── AttachmentToolContext adapter (strictly typed) ─────────────────────────────
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
      return { attachmentId: att.id, displayUrl, name: att.name, mimeType: att.mimeType };
    },
  };
}

function installSeam(ctx: AttachmentToolContext): void {
  (globalThis as Record<string, unknown>)[SEAM_KEY] = ctx;
}

// ── Mock fetch factory (DashScope sync multimodal) ────────────────────────────
const SYNC_T2I_URL =
  "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation";
const MOCK_IMAGE_URL = "https://mock-image-host/generated/img-0.png";

function installMockFetch(imageBytes: Uint8Array): void {
  const mock = vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = input instanceof Request ? input.url : typeof input === "string" ? input : input.toString();
    if (url === SYNC_T2I_URL) {
      const body = JSON.stringify({
        output: { choices: [{ message: { content: [{ image: MOCK_IMAGE_URL }] } }] },
      });
      return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url === MOCK_IMAGE_URL) {
      return new Response(imageBytes.buffer as ArrayBuffer, {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    }
    throw new Error(`[mockFetch] unexpected URL: ${url}`);
  });
  globalThis.fetch = mock as unknown as typeof fetch;
}

// ── Setup / Teardown ──────────────────────────────────────────────────────────
beforeAll(async () => {
  process.env["DASHSCOPE_API_KEY"] = "test-key";
  originalFetch = globalThis.fetch;
  tmpRoot = await mkdtemp(join(tmpdir(), "aigc-e2e-"));
  const signer = createUrlSigner(SECRET);
  const backend = new LocalFsBlobBackend(tmpRoot, signer);
  const registry = new AttachmentRegistry(tmpRoot);
  store = new AttachmentStore({ blob: backend, registry, signer, backend });
});

afterAll(async () => {
  delete process.env["DASHSCOPE_API_KEY"];
  globalThis.fetch = originalFetch;
  await rm(tmpRoot, { recursive: true, force: true });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete (globalThis as Record<string, unknown>)[SEAM_KEY];
  vi.restoreAllMocks();
});

const GEN_PARAMS = { prompt: "a test image", model: "wan2.7-image-pro" } as const;

// ── Tests ─────────────────────────────────────────────────────────────────────
describe("aigc-generation-tools node e2e (extension form)", () => {
  describe("image_generation — DashScope sync — happy path (Req 1.2, 1.4)", () => {
    it("execute returns ok=true, assets non-empty, attachmentId starts with att_", async () => {
      installSeam(buildCtx(store, "sess-e2e-1"));
      installMockFetch(minimalPng());
      const result = await runTool(imageGenerationTool(), { ...GEN_PARAMS });
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
      installSeam(buildCtx(store, "sess-e2e-2"));
      installMockFetch(minimalPng());
      const result = await runTool(imageGenerationTool(), { ...GEN_PARAMS });
      const details = detailsOf(result);
      if (!details.ok) throw new Error("details.ok must be true");
      const head = await store.head(details.assets[0]!.attachmentId);
      expect(head).toBeDefined();
      expect(head!.origin).toBe("tool-output");
      expect(head!.mimeType).toMatch(/^image\//);
      expect(head!.sessionId).toBe("sess-e2e-2");
    });

    it("store.getReadStream bytes === injected PNG bytes (proves real disk write + read)", async () => {
      const pngBytes = minimalPng();
      installSeam(buildCtx(store, "sess-e2e-3"));
      installMockFetch(pngBytes);
      const result = await runTool(imageGenerationTool(), { ...GEN_PARAMS });
      const details = detailsOf(result);
      if (!details.ok) throw new Error("details.ok must be true");
      const { stream } = await store.getReadStream(details.assets[0]!.attachmentId);
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk));
      const readBytes = new Uint8Array(Buffer.concat(chunks));
      expect(readBytes.length).toBe(pngBytes.length);
      expect([...readBytes]).toEqual([...pngBytes]);
    });

    it("store.verifyUrl passes for the produced displayUrl", async () => {
      installSeam(buildCtx(store, "sess-e2e-4"));
      installMockFetch(minimalPng());
      const result = await runTool(imageGenerationTool(), { ...GEN_PARAMS });
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

  describe("globalThis seam injection (Req 5.x / design seam)", () => {
    it("ctx injected via globalThis seam is read by execute (no deps)", async () => {
      installSeam(buildCtx(store, "sess-e2e-seam"));
      installMockFetch(minimalPng());
      const result = await runTool(imageGenerationTool(), { ...GEN_PARAMS });
      const details = detailsOf(result);
      expect(details.ok).toBe(true);
      if (!details.ok) throw new Error("details.ok must be true (seam path)");
      expect(details.assets[0]!.attachmentId).toMatch(/^att_/);
    });
  });

  describe("degradation path (Req 5.4 / 5.5)", () => {
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
      installSeam(unavailableCtx);
      installMockFetch(minimalPng());
      const result = await runTool(imageGenerationTool(), { ...GEN_PARAMS });
      const details = detailsOf(result);
      expect(details.ok).toBe(false);
      if (details.ok) throw new Error("expected ok=false for unavailable ctx");
      expect(details.error).toBeTruthy();
    });

    it("missing DASHSCOPE_API_KEY → execute returns ok=false without throwing", async () => {
      const savedKey = process.env["DASHSCOPE_API_KEY"];
      delete process.env["DASHSCOPE_API_KEY"];
      try {
        installSeam(buildCtx(store, "sess-e2e-nokey"));
        installMockFetch(minimalPng());
        const result = await runTool(imageGenerationTool(), { ...GEN_PARAMS });
        const details = detailsOf(result);
        expect(details.ok).toBe(false);
        if (details.ok) throw new Error("expected ok=false for missing API key");
        expect(details.error).toMatch(/DASHSCOPE_API_KEY/);
      } finally {
        if (savedKey !== undefined) process.env["DASHSCOPE_API_KEY"] = savedKey;
      }
    });
  });

  describe("aigcExtension toolset structure (Req 2.1, 2.5)", () => {
    it("registers both image_generation and image_edit tools", () => {
      const names = collectAigcTools().map((t) => t.name);
      expect(names).toContain("image_generation");
      expect(names).toContain("image_edit");
    });

    it("each registered tool has name, description, and execute function", () => {
      for (const tool of collectAigcTools()) {
        expect(typeof tool.name).toBe("string");
        expect(tool.name.length).toBeGreaterThan(0);
        expect(typeof tool.execute).toBe("function");
      }
    });
  });
});
