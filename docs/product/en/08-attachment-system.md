# 08 · Attachment System

The attachment system gives pi-web end-to-end file management from upload-to-persistence to tool consumption. Built on the core principle of "reference, not base64", it is implemented across four layers (L0–L3) to deliver a pluggable, enumeration-resistant, cross-process-consistent attachment store and delivery pipeline.

---

## 1. Design Principles and Three Invariants

| Invariant | Meaning |
|--------|------|
| **Single identity** | The `att_<nanoid>` public id is unique and can only be minted by `AttachmentStore.put()` on the server; the frontend cannot fabricate a legitimate id |
| **Persist before reference** | Upload-to-persistence must complete before a message references an attachment; history/context only store `att_<id>` references |
| **base64 materialized only at named exits** | Only two exits can produce base64: vision fed to the LLM (`toImageContents()`, kept as-is) and `afterToolCall` marking "needs re-inspection"; all other paths carry references only |

**Protocol constraint**: pi's `AgentTool.content` only supports `text | image base64`, with no file-reference primitive → the entire file capability lives in the pi-web layer and never enters the pi protocol.

---

## 2. Layered Architecture (L0–L3)

```
L3  context gate (wired into the runner)
     ├─ beforeToolCall ownership check (makeBeforeToolCall)
     └─ afterToolCall base64 stripping (makeAfterToolCall)

L2  resolve projection — AttachmentHandle (attachment-handle.ts)
     ├─ bytes()  stream()  localPath()  url() (no base64 form)
     └─ child-process store factory createChildAttachmentStore (child-store.ts)

L1  descriptor and public id — att_<nanoid>
     ├─ AttachmentStore facade (put/head/getReadStream/presignUrl/localPath/listBySession)
     └─ AttachmentRegistry (<id>.att.json persistence)

L0  object store — BlobStore
     ├─ LocalFsBlobBackend (persist to disk, $PI_WEB_ATTACHMENT_DIR)
     └─ S3-ready interface (planned, not yet implemented)
```

### On-disk Layout (LocalFs Backend)

```
$PI_WEB_ATTACHMENT_DIR/
├── <att_id>            # byte content (key = id, no dedup in this slice)
├── <att_id>.meta.json  # { mimeType, size }
└── <att_id>.att.json   # Attachment descriptor (includes sessionId/origin/createdAt etc.)
```

> Default directory: `~/.pi/agent/attachments` (fallback when `PI_WEB_ATTACHMENT_DIR` is unset).

---

## 3. Key Components and Source Files

| Component | Path | Responsibility |
|------|------|------|
| `BlobStore` port | `packages/server/src/attachment/blob-store.ts` | S3-style five-capability interface + `BlobNotFoundError` |
| `LocalFsBlobBackend` | `packages/server/src/attachment/local-fs-backend.ts` | Byte persist/read-stream/delete |
| `UrlSigner` | `packages/server/src/attachment/url-signer.ts` | HMAC-SHA256 sign/verify (`timingSafeEqual`) |
| `AttachmentRegistry` | `packages/server/src/attachment/attachment-registry.ts` | Descriptor metadata persistence and query |
| `AttachmentStore` facade | `packages/server/src/attachment/attachment-store.ts` | `put` mints the id internally + composes all three |
| `mintAttachmentId()` | `packages/server/src/attachment/id.ts` | `att_` + `randomBytes(16).toString("base64url")` |
| `attachmentStoreConfigFromEnv()` | `packages/server/src/attachment/config.ts` | Builds the store from env + returns `{store, dir, secret}` |
| `createAttachmentRoutes()` | `packages/server/src/http/routes/attachment-routes.ts` | Injects the upload/delivery routes |
| `uploadAttachment()` | `packages/react/src/transport/attachment-upload.ts` | Client-side multipart upload |
| `useAttachments` | `packages/react/src/hooks/use-attachments.ts` | Upload state-machine hook (uploading → ready / error) |
| `createChildAttachmentStore()` | `packages/server/src/attachment-bridge/child-store.ts` | Instantiates a store from env inside the runner subprocess (returns `undefined` when `PI_WEB_ATTACHMENT_DIR` is missing) |
| `resolveAttachment()` | `packages/server/src/attachment-bridge/resolve.ts` | L2 projection entry (`head(id)` missing → `AttachmentResolveError`) |
| `createAttachmentHandle()` | `packages/server/src/attachment-bridge/attachment-handle.ts` | Four-form handle `AttachmentHandle` (`bytes/stream/localPath/url`, no base64) |
| `makeBeforeToolCall()` | `packages/server/src/attachment-bridge/ownership-guard.ts` | Pre-tool ownership-check gate |
| `makeAfterToolCall()` | `packages/server/src/attachment-bridge/base64-gate.ts` | Post-tool base64-stripping gate |
| `putToolOutput()` | `packages/server/src/attachment-bridge/tool-output.ts` | Tool-output persistence (origin: tool-output) |
| `buildAttachmentRefs()` | `packages/server/src/attachment-bridge/reference-injection.ts` | Injects attachment text references into messages |
| `createAttachmentToolContext()` | `packages/server/src/attachment-bridge/tool-context.ts` | Builds the store-handle interface surface inside a tool's `execute` (`available/resolve/putOutput`) |
| `wireAttachmentBridge()` | `packages/server/src/runner/attachment-wiring.ts` | In the runner subprocess, wires the store + both gates into pi's `agent.beforeToolCall/afterToolCall`, and passes the ctx through to customTools via a globalThis seam |

> The type contracts `AttachmentToolContext` / `AttachmentToolHandle` are exposed to tool authors by `@blksails/pi-web-agent-kit` (types only, no value import); the constructor `createAttachmentToolContext()` (value) stays in `@blksails/pi-web-server`.

---

## 4. HTTP Endpoints

### 4.1 Upload (write path)

```
POST /sessions/:id/attachments
Content-Type: multipart/form-data

field: file   (File/Blob)
```

- `:id` session gating: the Router automatically performs existence (404) / unauthorized-access (403) / unauthenticated (401) checks.
- Missing or empty file field → `400 NO_FILE`; exceeding 25 MiB (default cap) → `413 PAYLOAD_TOO_LARGE`.

**Success response (200):**

```json
{
  "attachment": {
    "id": "att_aBcDeFgH...",
    "name": "photo.jpg",
    "mimeType": "image/jpeg",
    "size": 204800,
    "origin": "upload",
    "sessionId": "sess_...",
    "createdAt": "2026-06-24T10:00:00.000Z"
  },
  "displayUrl": "/attachments/att_aBcDeFgH.../raw?exp=1750000000&sig=..."
}
```

### 4.2 Delivery (read path)

```
GET /attachments/:attachmentId/raw?exp=<timestamp>&sig=<hmac>
```

- Not bound to a session; self-contained authentication via HMAC signature (enumeration-resistant).
- Verify the signature first; missing/invalid/expired signature → `401 INVALID_SIGNATURE` (does not reveal whether the id exists).
- Existence is only checked once the signature is valid; not found → `404 ATTACHMENT_NOT_FOUND`.
- Success response: byte stream + `Content-Type=attachment mime` + `Cache-Control: private, max-age=300`.

> **Security**: the route parameter is named `:attachmentId` rather than `:id`, to prevent the Router from treating the attachment id as a sessionId and triggering session gating (see `attachment-routes.ts:144`).

---

## 5. Environment Variables

| Variable | Default | Description |
|------|--------|------|
| `PI_WEB_ATTACHMENT_DIR` | `~/.pi/agent/attachments` | Local backend on-disk root directory (the main process passes it down to the subprocess via spawn env) |
| `PI_WEB_ATTACHMENT_SECRET` | — (when unset, a pure single-process setup can fall back to random) | HMAC signing secret (must match between main/child processes, otherwise signed URLs produced by the child get 401 in the main process) |
| `PI_WEB_ATTACHMENT_URL_BASE` | `""` | Base path prefix for delivery URLs (pass `"/api"` when the pi-handler is mounted under `/api`; not part of the HMAC signing input) |
| `PI_WEB_ATTACHMENT_URL_TTL_MS` | `315360000000` (10 years) | Default expiry window (ms) for signed delivery URLs. A long window keeps history-replay images reachable for the long term; `sig` must still be valid, so enumeration resistance is unchanged |

> **Cross-process consistency**: the main process passes down both `PI_WEB_ATTACHMENT_DIR` + `PI_WEB_ATTACHMENT_SECRET` via spawn env; the runner subprocess instantiates the same backend with `createChildAttachmentStore(process.env)` and never calls back into the main process.

---

## 6. Two Consumption Paths

### 6.1 Path A: base64 fed to the LLM (vision)

Applies to images. `useAttachments`' `toImageContents()` keeps this path, maintaining the status quo, and does not persist through the attachment system.

### 6.2 Path B: file handed to a server-side tool

Applies to scenarios such as image editing/generation that need to operate on files inside the runner subprocess.

1. The user uploads an image → `POST /sessions/:id/attachments` persists it and yields `att_<id>`.
2. The user sends a message → the main process `injectAttachmentRefs()` injects a text marker:
   ```
   [attachment id=att_aBcDeFgH... type=image/jpeg name=photo.jpg]
   ```
3. The model copies the id from the marker and explicitly passes `{ attachmentId: "att_aBcDeFgH..." }` when calling the tool.
4. `beforeToolCall` ownership check (`ownership-guard.ts`): **parameter-name agnostic** — it recursively scans all tool parameters for values shaped like `att_<id>`, running `store.head(id)` on each to verify `sessionId === current session`; any missing/unauthorized/store-unavailable case → `{ block: true, reason }` (fail-closed, the tool never enters `execute`).
5. Inside the tool's `execute`, use `ctx.resolve(attachmentId)` to obtain an `AttachmentHandle`:
   ```ts
   const handle = await ctx.resolve(params.attachmentId);
   const localPath = await handle.localPath(); // LocalFs returns the on-disk path directly, zero-copy
   const url      = await handle.url();        // HMAC-signed delivery URL
   const bytes    = await handle.bytes();      // whole byte blob (small files)
   ```
6. Once processing is done → `ctx.putOutput({ bytes, name, mimeType })` persists it (`origin: "tool-output"`) and yields `att_out`.
7. `afterToolCall` strips inline base64 from the tool result, replacing it with the text reference `[attachment id=att_out ...]`.
8. Cross-turn loopback B: `att_out` shares the same space as the upload id, so the next turn can re-inject the reference for a tool to consume.

---

## 7. Frontend Integration

### 7.1 useAttachments hook

```ts
import { useAttachments } from "@blksails/pi-web-react";

const { items, add, remove, clear, toImageContents, referenceIds } =
  useAttachments({
    supported: true,
    baseUrl: "/api",
    sessionId: currentSessionId,
  });

// Add files (image/* only): returns { rejected } listing the rejected filenames
await add(fileList);

// items[n].status: "uploading" | "ready" | "error"
// items[n].attachmentId: "att_..." (present only when status=ready, minted by the server)
// items[n].displayUrl: "/attachments/.../raw?exp=..." (present only when status=ready)
// items[n].dataUrl: "data:image/..."  (for local preview, present both before/after upload)

// On submit, toImageContents() takes the vision base64 path (status quo)
// referenceIds() returns the list of persisted attachmentIds (for text-reference injection)
```

### 7.2 Calling Upload Manually

```ts
import { uploadAttachment } from "@blksails/pi-web-react";

const { attachment, displayUrl } = await uploadAttachment(
  "/api",
  sessionId,
  file,
);
// attachment.id === "att_..." (minted by the server, trusted)
```

---

## 8. Tool Developer Integration (agent-kit)

```ts
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";
import type { AttachmentToolContext } from "@blksails/pi-web-agent-kit";

// Declare parameters with pi-ai's Type.Object (defineTool expects a TypeBox schema, not a bare object)
const EditImageParameters = Type.Object({
  attachmentId: Type.String({
    description: "Input attachment public id (att_...), copied verbatim from the [attachment id=…] reference in the user message",
  }),
});

export function createMyImageTool(ctx: AttachmentToolContext) {
  return defineTool({
    name: "edit_image",
    description: "Edit and process the specified attachment image",
    parameters: EditImageParameters,
    async execute(toolCallId, params) {
      if (!ctx.available) {
        return { content: [{ type: "text", text: "Attachment capability unavailable" }], details: { ok: false } };
      }
      const handle = await ctx.resolve(params.attachmentId);
      const localPath = await handle.localPath(); // pass directly to the processing tool, zero-copy

      // ... image processing ...
      const outputBytes = new Uint8Array(/* ... */);

      const outputRef = await ctx.putOutput({
        bytes: outputBytes,
        name: "result.png",
        mimeType: "image/png",
      });

      // ToolOutputRef shape: { attachmentId, displayUrl, name, mimeType } (no .attachment)
      return {
        content: [{ type: "text", text: `Processing complete: ${outputRef.displayUrl}` }],
        details: {
          ok: true,
          outputAttachmentId: outputRef.attachmentId,
          displayUrl: outputRef.displayUrl,
        },
      };
    },
  });
}
```

- Server-side example implementation: `packages/server/src/attachment-bridge/example-tool.ts` (`createEditImageTool`, demonstrating three-form resolution + loopback).
- End-to-end runnable form: `examples/attachment-tool-agent/tools/edit-image-tool.ts` (genuinely loaded via jiti, assembled by the runner as a customTool, with browser e2e exercising the full chain).

#### Running This Example

1. Set up the attachment-store env (matching between main/child processes), and start dev with `PI_WEB_DEFAULT_SOURCE` pointing at the example agent source:
   ```bash
   export PI_WEB_ATTACHMENT_DIR="$HOME/.pi/agent/attachments"
   export PI_WEB_ATTACHMENT_SECRET="$(openssl rand -hex 32)"
   PI_WEB_DEFAULT_SOURCE=./examples/attachment-tool-agent pnpm dev
   ```
   (You may also skip `PI_WEB_DEFAULT_SOURCE` and, after startup, fill in `./examples/attachment-tool-agent` directly in the home-page agent source picker, matching `e2e/browser/attachment-tool-bridge.e2e.ts:44`.)
2. Open http://localhost:3000, upload an image (`image/*` only) in the chat box, and wait for the status to turn `ready`.
3. Send a message asking to edit that image; the model calls the `edit_image` tool based on the injected `[attachment id=… ]` marker.
4. Expected result: the tool loops back an `att_out` output, a new `displayUrl` appears in the message, and it remains visible in history after refresh.
5. If the tool reports "Attachment capability unavailable" → the subprocess env is missing `PI_WEB_ATTACHMENT_DIR` (`ctx.available === false`); if the output image gets 401 → the main/child `PI_WEB_ATTACHMENT_SECRET` do not match. See [18 · Troubleshooting FAQ](./18-troubleshooting-faq.md).

> Runner assembly (`wireAttachmentBridge`, `packages/server/src/runner/attachment-wiring.ts`) passes the closure-bound `AttachmentToolContext` (child-process store + current sessionId) to tools running in the subprocess via the conventional globalThis seam `__piWebAttachmentToolContext__` — the example tool retrieves its context this way, and when it is missing, falls back to `available:false` for safe degradation.

---

## 9. Trigger Completion Framework / `@`-mention Attachments

Once attachments are persisted, users also need a lightweight way to **reference** them in the input box — without re-uploading or hand-copying `att_<id>` each time. pi-web provides a general-purpose **trigger completion framework** for this (spec `completion-provider-framework`), with attachment references (spec `attachment-mention-completion`) being the first built-in provider on top of it, coexisting with the built-in `@file` file reference under the same `@` trigger.

### 9.1 What the Framework Is

The completion framework abstracts "type a trigger → fetch candidates → select and insert a token → resolve to context text at submit time" into a set of pluggable **CompletionProvider**s. One provider corresponds to one trigger semantic; multi-trigger capability is achieved by registering multiple providers, not by a single provider declaring an array.

| Concept | Location | Responsibility |
|------|------|------|
| `CompletionProvider` contract | `packages/server/src/completion/types.ts:36` | `id` / single-character `trigger` / `kind` / `priority` / `extract` (token extraction rule) + `complete()` + optional `resolve()` |
| `CompletionRegistry` | `packages/server/src/completion/registry.ts:86` | Registration (validate single-character trigger, warn on same-id override), union of active triggers, concurrent `complete` dispatch by normalized trigger (per-provider timeout degradation), merge and dedup, reverse-lookup of provider by `kind` for `resolve` |
| `resolveCompletions()` | `packages/server/src/completion/resolve.ts:13` | At submit time, scans tokens in the message, dispatches `resolve` by `kind`, replaces tokens with context text; no provider / no resolve / throws / returns `null` → keeps the original token, never blocks sending |
| Wire-protocol DTO | `packages/protocol/src/transport/completion-dto.ts` | `CompletionItem` / `CompletionResponse` / `CompletionTriggersResponse` (the function-bearing provider contract is a server-side internal type and does not enter the protocol layer) |

Providers are registered during `createHandler` assembly (`packages/server/src/http/create-handler.ts:79`): the built-in `createFileProvider()` is always registered, `createAttachmentProvider(lister)` is registered additionally once the attachment store is ready, and the host can append custom providers via `opts.completionProviders`.

### 9.2 HTTP Endpoints

Completion goes through two session-scoped read-only endpoints (`packages/server/src/http/routes/completion-routes.ts`), both reusing session gating via `requireSession` (not-found/unauthorized → 404, mirroring the query routes):

```
GET /sessions/:id/completion/triggers          → { triggers: [{ trigger, extract }] }
GET /sessions/:id/completion?trigger=@&q=<query>  → { items, groups }
```

- `/triggers` returns the union of triggers + extraction rules from all registered providers; the frontend uses this to decide which characters should trigger the completion popover.
- `/completion` dispatches to the matching provider(s) by normalized trigger, fetches candidates concurrently, then merges, dedups, and caps the result (default limit 30, per-provider timeout 800 ms degradation), returning the candidates + a per-`kind` group summary.
- `CompletionCtx` (`sessionId` / `cwd` / `userId`) is assembled and injected by the server from the session + authentication; the **provider must not take it from the frontend** — this is the root of session isolation.

### 9.3 Built-in file provider and the realpath Security Gate

`createFileProvider()` (`packages/server/src/completion/providers/file-provider.ts`) lets users reference workspace files under the current session's `cwd` with `@`:

- `complete`: traverses `ctx.cwd` (respecting `.gitignore`, skipping heavy directories like `.git`/`node_modules`/`dist`, with a traversal cap + TTL cache, not following symlinks), fuzzy-scores and ranks by query, caps the result, and produces `@file:<relative-path>` candidates.
- `resolve` (at submit time): normalizes `@file:<rel>` into the LLM-friendly `@<rel>` (v1 does not read file contents). The key security gate — via `fs.realpath` it resolves the target to its real path and asserts it falls within the realpath prefix of `cwd`; `../` out-of-bounds, symlink escape, or non-existent target → returns `null`, the framework keeps the original text, preventing any path outside `cwd` from being injected into the context (`file-provider.ts:257`).

### 9.4 Full `@`-mention Attachment Chain (complete → candidate → resolve)

`createAttachmentProvider(store)` (`packages/server/src/completion/providers/attachment-provider.ts`, id `"attachment"`, trigger `@`, kind `attachment`) wires persisted attachments to the same `@` trigger:

1. **complete**: the user types `@` → the framework hits the trigger → calls the provider. The provider lists **session-local** attachments only via `store.listBySession(ctx.sessionId)` (both `upload` and `tool-output` origins), fuzzy-matches by attachment-name subsequence, and each candidate carries `label` (attachment name) and `detail` (`mimeType · human-readable size`). Listing throws / empty session → returns an empty array, completion degrades but does not block the UI.
2. **candidate and token**: selecting a candidate inserts the token `@attachment:<id>` (produced by `serializeToken({ trigger: "@", kind: "attachment", id })`). It shares the `@` trigger with `@file:<rel>` — in the same popover, file and attachment candidates are grouped side by side by `kind`.
3. **resolve (at submit time)**: on send, `POST /sessions/:id/messages` first resolves tokens via `resolveCompletions` (`packages/server/src/http/routes/command-routes.ts:104`). The attachment provider's `resolve` reuses `buildAttachmentRefs([att])` — only when `head(id)` hits **and** `att.sessionId === ctx.sessionId` — to produce the canonical reference marker `[attachment id=… type=… name=…]` **identical** to the upload-injection/base64-stripping path; otherwise it returns `null` and the framework keeps the original token — preventing both cross-session references and enumerating others' attachments via completion.

### 9.5 Integration with the Attachment System

The `resolve` exit deliberately reuses §6's `buildAttachmentRefs()`: whether an attachment is introduced via "persist before reference" (the `injectAttachmentRefs` of §6.2 step 2) or via `@` completion, the text marker injected into the user message is **uniform** in shape, and the downstream `beforeToolCall` ownership check, the `ctx.resolve` handle retrieval inside the tool's `execute`, and the cross-turn loopback (§6.2 step 8) all reuse the same chain, with no separate branch needed for completion. Completion merely opens one more **user-side reference entry** for the attachment system; it introduces no new materialization and no new id source — the three invariants (§1) hold unchanged.

### 9.6 Practical Reference

For the end-to-end runnable form see `examples/attachment-tool-agent`: after uploading and persisting an image, type `@` in the input box to select the just-uploaded attachment from the popover, selecting it inserts `@attachment:<id>`, and on send it is resolved into a canonical reference marker handed to the `edit_image` tool for consumption (same agent source as §8 "Running This Example", with browser e2e covering the full chain). For the contract and endpoint behavior of the completion framework itself, see also the explanation of the trigger completion framework extension points in [09 · Extensions and Skills](./09-extensions-and-skills.md).

---

## 10. Common Questions and Constraints

| Scenario | Handling |
|------|----------|
| `PI_WEB_ATTACHMENT_SECRET` unset, with a runner subprocess present | Signed URLs produced by the subprocess get 401 in the main process (secret mismatch); it must be set explicitly |
| Subprocess env missing `PI_WEB_ATTACHMENT_DIR` | `createChildAttachmentStore()` returns `undefined`, `ctx.available === false`, the tool degrades safely |
| Upload file exceeds 25 MiB | `413 PAYLOAD_TOO_LARGE` (`DEFAULT_MAX_UPLOAD_BYTES` can override) |
| Non-image on the vision path | `useAttachments.add()` only accepts `image/*`; the rest go into `rejected` |
| Tool result contains inline base64 | `afterToolCall` (`base64-gate.ts`) strips it to a text reference by default; set `details.keepInlineImages=true` to keep it |
| Orphan-object GC / content-hash dedup | The interface leaves a seam (`key=id`, no dedup in this slice), planned (not yet implemented) |

> For more detailed error reproduction and troubleshooting steps (signed URL 401, subprocess `ctx.available === false`, upload 413, etc.) see [18 · Troubleshooting FAQ](./18-troubleshooting-faq.md).

---

## Next Steps / Related

- How AIGC image tools call the attachment system → [11 · AIGC Tools](./11-aigc-tools.md)
- Trigger completion framework / `@`-mention attachments → this doc [§9](#9-trigger-completion-framework--mention-attachments); extension points also in [09 · Extensions and Skills](./09-extensions-and-skills.md)
- Full HTTP API endpoint list (including `/attachments`) → [13 · HTTP API Reference](./13-http-api-reference.md)
- Overall system architecture and process boundaries → [03 · Architecture](./03-architecture.md)
- Environment-variable configuration for deployment → [15 · Deployment](./15-deployment.md)
- Signed URL 401, `ctx.available === false`, and other troubleshooting → [18 · Troubleshooting FAQ](./18-troubleshooting-faq.md)
