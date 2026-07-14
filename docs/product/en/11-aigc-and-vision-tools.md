# 11 · AIGC & Vision Tools

`@blksails/pi-web-tool-kit` ships two same-origin capability lines: the **AIGC image tools** (`image_generation` text-to-image, `image_edit` image editing) handle "drawing it", and the **vision tools** (`image_vision` tool, `/img_vision` command) handle "understanding it". All four are in-process pi extensions—registered through `pi.registerTool` / `pi.registerCommand` and loaded by the agent via `AgentDefinition.extensions: [aigcExtension, visionExtension]`. Produced images land in the attachment store and flow back into the conversation as `att_<id>` references; vision conclusions flow back as plain text that can be replayed and followed up on.

> **Shape note (detoolspec-unify-builtin-tools)**: the AIGC tools once used a declarative `ToolSpec` + `compileTool` + `buildAigcTools` (the `customTools` assembly path)—**that two-layer compilation architecture and the `customTools` path have both been removed from main**. Today the two tools use hand-written `Type.Object` parameters registered through `pi.registerTool`, and the runtime orchestration goes through a single `runImageTool`. If you see `customTools` / `buildAigcTools` / `compileTool` in older docs or examples, this chapter is authoritative.

---

## Tool Overview

| Name | Type | Function | Required params | Default model |
|---|---|---|---|---|
| `image_generation` | Tool | Text-to-image | `prompt` | `gpt-image-2` |
| `image_edit` | Tool | Image editing (inpaint / whole-image rewrite) | `image`, `prompt` | `gpt-image-2` |
| `image_vision` | Tool | Image understanding (answer questions about an image) | `question` | reads `PI_WEB_VISION_MODEL` |
| `/img_vision` | Command | Run recognition against the "most recent image" in the session | command argument is the question | same as above |

Registration functions and aggregation factories:

- `registerImageGeneration(pi)` at `packages/tool-kit/src/aigc/tools/image-generation.ts:178` and `registerImageEdit(pi)` at `image-edit.ts:186`, aggregated as `aigcExtension` (`packages/tool-kit/src/aigc/extension.ts:75`).
- `registerImageVision(pi, run)` at `packages/tool-kit/src/vision/tools/image-vision.ts:69` and `registerImgVisionCommand(pi, run)` at `command.ts:37`, aggregated as `visionExtension` (`packages/tool-kit/src/vision/extension.ts:71`).

---

## Integration

> Fastest path: the repo ships `examples/aigc-agent/` (its core is a single `index.ts`, with `@blksails/*` dependencies resolved through the monorepo workspace). You can run it directly to watch the generate + look-back loop (see "Complete Example" at the end).

```bash
export NEWAPI_API_KEY=sk-xxxxxxxx          # default gpt-image-2 route for generation/editing
export PI_WEB_VISION_MODEL=openai/gpt-4o   # default vision model for image_vision (provider/modelId)

# source is a positional argument, not an --agent flag; --open launches the browser automatically
pi-web ./examples/aigc-agent --open
```

The core assembly in `examples/aigc-agent/index.ts:28-68`:

```ts
import { defineAgent } from "@blksails/pi-web-agent-kit";
import { aigcSlashCompletions } from "@blksails/pi-web-tool-kit";
// note: use the /runtime sub-entry—it contains pi SDK value imports and loads only in the runner (jiti) subprocess
import { aigcExtension, visionExtension } from "@blksails/pi-web-tool-kit/runtime";

export default defineAgent({
  systemPrompt: "...",                     // teach the LLM when to call image_generation / image_edit / image_vision
  extensions: [aigcExtension, visionExtension],  // in-process ExtensionFactory (pi.registerTool)
  slashCompletions: aigcSlashCompletions,  // /img-gen, /img-edit appear in input completion (selecting only fills, never executes)
  noTools: "builtin",                      // turn off built-in tools, expose only the extension tools
  skills: ({ diagnostics }) => ({ skills: [], diagnostics }),
});
```

> **Sub-entry discipline**: `aigcExtension` / `visionExtension` must be imported from `@blksails/pi-web-tool-kit/runtime`. That entry contains pi SDK value imports and loads only inside the runner subprocess—it **must not** enter the frontend bundle. The main entry `@blksails/pi-web-tool-kit` exports only frontend-safe pure data/types (`BUILTIN_COMMANDS`, `aigcSlashCompletions`, `AIGC_MODEL_CATALOG`, etc.).

When you create a **standalone** agent package (outside this monorepo), add the dependencies to `package.json`:

```jsonc
{
  "dependencies": {
    "@blksails/pi-web-tool-kit": "workspace:*",
    "@blksails/pi-web-agent-kit": "workspace:*"
  }
}
```

The in-monorepo `examples/aigc-agent` skips this step—its `package.json` carries only pi-web display metadata (`title` / `avatar` / `description`) and declares no `@blksails/*` dependency, resolved directly by the workspace.

---

## Environment Variables

At startup the image tools check the `requiredVars` declared by each route; when a variable is missing that route returns `ok:false` and degrades instead of crashing the subprocess. The vision tool reads its default model from `PI_WEB_VISION_MODEL`.

| Variable | Purpose | When required |
|---|---|---|
| `NEWAPI_API_KEY` | NewAPI gateway (default `gpt-image-2` route) | Required when using gpt-image-2 |
| `SUFY_API_KEY` | sufy (Qiniu Cloud) gateway (`*-sufy` routes) | Required when using a `*-sufy` model |
| `OPENROUTER_API_KEY` | OpenRouter gateway (gemini/gpt-5 family image models) | Required when using an OpenRouter model |
| `OPENROUTER_PROXY` | OpenRouter request proxy (optional, `${VAR}` placeholder; direct connection if unset) | Set when access must go through a proxy |
| `DASHSCOPE_API_KEY` | The official DashScope route and the token plan route **read their key from the same variable name** | Required when using DashScope / token plan models |
| `DASHSCOPE_TOKENPLAN_BASE_URL` | token plan endpoint base (optional, defaults to `https://token-plan.cn-beijing.maas.aliyuncs.com/api/v1`) | Set to override the token plan domain |
| `PI_WEB_VISION_MODEL` | default vision model for `image_vision`, in `provider/modelId` form | Set to configure a default vision model |

> **DashScope dual-key trap**: the official `dashscope.aliyuncs.com` routes (`wan2.7-image-pro` / `qwen-image-edit-max`) and the token plan routes (`*-bailian`) both read their key from `DASHSCOPE_API_KEY`, but the two key sets are **not interchangeable**—a token plan key against the official endpoint returns 401, and vice versa. A single process can only hold one value, so it is one or the other. On a 401 or "channel does not exist", see [23 · Troubleshooting FAQ](./23-troubleshooting-faq.md#4-provider--model-issues).

---

## Tool Parameters in Detail

### image_generation

Parameters are hand-written in `PARAMETER_FIELDS` at `image-generation.ts:122`; the `model` enum is built dynamically by `optionalModelEnum(routes, DEFAULT_MODEL)` (`buildParameters`, `:159`).

```jsonc
{
  "prompt": "极光下的雪山，胶片质感",   // required; keep the user's original language, do not translate to English
  "n": 1,                                // image count 1–10, some models support only 1
  "size": "1024x1024",                   // or 1536x1024 / 1024x1536 / auto
  "negative_prompt": "模糊, 水印",       // effective for DashScope/OpenRouter
  "background": "transparent",           // gpt-image only
  "quality": "high",                     // OpenAI only
  "moderation": "low",                   // gpt-image only
  "model": "gpt-image-2"                 // omit to use DEFAULT_MODEL
}
```

### image_edit

```jsonc
{
  "image": "att_abc123",    // attachment id (att_ prefix) or https URL; required
  "prompt": "把背景换成夕阳下的海滩",  // edit instruction; required
  "mask": "att_def456",     // optional B/W mask: white areas are repainted
  "reference_images": ["att_xyz"],  // optional reference images
  "n": 1,
  "size": "1024x1024",
  "model": "gpt-image-2"
}
```

`image` / `mask` / `reference_images` are the three media fields (`IMAGE_EDIT_MEDIA_FIELDS`, `image-edit.ts:102`); before the call the orchestrator resolves them into data URIs (subject to the attachment permission check), so the LLM only needs to pass through the `att_` reference shown in the conversation verbatim. For the DashScope family the total of "main image + mask + reference images" must be ≤ 3 (`IMAGE_EDIT_MAX_IMAGES` at `providers/dashscope.ts:155`, throws on overflow).

---

## Available Model Routes

Routes are the module-level constant array `ROUTES` (`image-generation.ts:44` / same in `image-edit.ts`), exported as `IMAGE_GENERATION_ROUTES` (`:170`) / `IMAGE_EDIT_ROUTES`. The OpenRouter family is centralized in `providers/openrouter-models.ts`, reused by both tools through `openRouterImageRoutes()` / `openRouterImageEditRoutes()`.

### image_generation routes

| model id | provider | Endpoint shape |
|---|---|---|
| `gpt-image-2` (default) | NewAPI (`https://www.apiservices.top/v1`) | OpenAI `/images/generations` |
| `gpt-image-2-sufy` | sufy (`https://openai.sufy.com/v1`) | OpenAI `/images/generations` (providerModel `openai/gpt-image-2`) |
| `gemini-3.1-flash-lite-image-sufy` | sufy | OpenAI `/images` (providerModel `google/gemini-3.1-flash-lite-image`, fast & low cost) |
| `gemini-3.1-flash-image` / `gemini-3-pro-image` / `gemini-2.5-flash-image` | OpenRouter | chat/completions + `modalities:["image","text"]` |
| `gpt-5-image` / `gpt-5-image-mini` / `gpt-5.4-image-2` | OpenRouter | same as above; `gpt-5.4-image-2` is temporarily unavailable when upstream org quota misbehaves |
| `wan2.7-image-pro` | DashScope official | `multimodal-generation` (sync input/parameters) |
| `wan2.7-image-pro-bailian` | Aliyun Bailian token plan | same DashScope path, base switched to the token plan domain |

### image_edit routes

| model id | provider | Characteristics |
|---|---|---|
| `gpt-image-2` (default) / `gpt-image-2-sufy` | NewAPI / sufy | whole-image rewrite; multipart FormData |
| `gemini-3.1-flash-lite-image-sufy` | sufy | whole-image rewrite; providerModel `google/gemini-3.1-flash-lite-image` |
| `gemini-3.1-flash-image` / `gemini-3-pro-image` / `gemini-2.5-flash-image` | OpenRouter | whole-image rewrite (no mask) |
| `gpt-5-image` / `gpt-5-image-mini` / `gpt-5.4-image-2` | OpenRouter | whole-image rewrite (no mask) |
| `qwen-image-edit-max` | DashScope official | highest fidelity; supports mask-based local repaint |
| `wan2.7-image-edit-bailian` | Aliyun Bailian token plan | DashScope-native messages/content; supports image-conditioned editing |

---

## Interactive Parameter Completion

`model`, `size`, and `prompt` are critical to output quality but are not in the tool's `parameters.required`—if the LLM omits one, it is not blocked by parameter validation; instead a runtime prompt via the extension context's `ctx.ui` asks the user to fill it in.

The required options are declared as the module constant `REQUIRED_PARAMS` (`image-generation.ts:99`, `image-edit.ts:108`, same structure); the completion logic lives in `resolveRequiredParams` in `run-image-tool.ts` (`:156`), invoked by `runImageTool` before routing and the provider call:

1. A non-empty value already exists → skip directly, no prompt (the normal flow is undisturbed).
2. An interactive UI is available (`ctx.hasUI`): `via:"select"` calls `ctx.ui.select(...)`, `via:"input"` calls `ctx.ui.input(...)`; if the user cancels → `ok:false`, no provider call is made.
3. No interactive UI: use `fallback` if present (e.g. `size` falls back to `auto`); `param === "model"` falls back to `DEFAULT_MODEL`; `prompt` has no fallback → `ok:false`.

The sentinel value `"$models"` in `options` is expanded at runtime by `expandOptions` (`run-image-tool.ts:141`) into all `model` route keys of the currently active routes (disabled models are removed at the same source).

---

## Image Normalization: the iPhone Multi-Picture JPEG Problem

**Problem**: JPEGs shot by an iPhone contain an `APP2/MPF` (Multi-Picture Format) index plus an HDR gain map appended after the main image's `EOI`. Sending these to the NewAPI gateway triggers a misleading error: "no available channel exists / This token has no access to model (with an empty model name)".

**Solution**: pure-JS lossless normalization, implemented in `packages/tool-kit/src/engine/normalize-image.ts` (still under `engine/`, still reused), exporting `normalizeImageDataUri(input): string`:

- Only processes `data:image/jpeg` (other formats are returned as-is);
- Locates and skips the `APP2/MPF` segment (identified by the magic number `4d 50 46 00`, distinct from the ICC_PROFILE APP2 that must be preserved);
- Truncates at the main image's first `EOI` (`FF D9`), discarding the appended gain map;
- Zero re-encoding, zero resizing, preserving EXIF orientation and other metadata; on parse failure or when there is no MPF content, returns as-is without blocking the call.

`runImageTool`'s `resolveMediaFields` (`run-image-tool.ts:208`) resolves each `mediaFields` field (including the array type `reference_images`) through `resolveAndNormalizeImage` (`:199`): an `att_` prefix → convert to a data URI → then feed into `normalizeImageDataUri`; an https URL that is neither `att_` nor `data:` is passed through as-is. The whole chain completes before the request body is built, so tool authors do not need to handle it manually.

> Still hitting "empty model name / channel does not exist" and confirmed it is an iPhone multi-picture photo? See [23 · Troubleshooting FAQ](./23-troubleshooting-faq.md#4-provider--model-issues).

---

## Execution Flow

A successful image generation/editing call (orchestrated uniformly by `runImageTool`):

1. The LLM invokes the tool, passing `prompt` (and optional parameters); `model` is stripped out as the route key.
2. `resolveRequiredParams` checks the required options and triggers interactive completion for missing items (user cancels → `ok:false`).
3. `selectRoute` (`run-image-tool.ts:118`) routes to the corresponding `ImageRoute` by `model` (or `DEFAULT_MODEL`).
4. Checks whether that route's `requiredVars` are resolvable; if missing, `ok:false` degrade (no crash).
5. Checks whether the attachment ctx is injected (runner assembly); if not injected, `ok:false`.
6. `resolveMediaFields` for the media fields: `att_id → data URI → normalizeImageDataUri`.
7. `runEndpoint`: build the request body → HTTP POST → parse the response (sync / async polling) → optimistic preview `onUpdate`.
8. `persistPicked`: write the output to the attachment store to obtain `att_<id>`; **zero outputs** (the provider returns an empty url) → report failure rather than a misleading success (`run-image-tool.ts:437`).
9. Assemble the result: text description + `![name](signedDisplayUrl)` markdown + `details.assets`, from which the frontend renderer renders an `<img>`.

---

## Vision Tools

Once a generation/editing output is persisted, all that remains in the LLM context is the `[attachment id=att_… …]` text marker—**the id is readable, the pixels are not**. `image_vision` supplies the "look back" step: it sends an image already present in the session into a model that supports image input and gets back a textual conclusion.

### image_vision tool (LLM-driven)

Parameters (`vision/tools/image-vision.ts:24`):

```jsonc
{
  "image": "att_abc123",   // optional: att_ reference; omit to look at the "most recent image" in the session
  "question": "这张图里有几个人？",  // required; keep the user's original language, do not translate
  "model": "openai/gpt-4o"  // optional: provider/modelId; omit to pop a picker or degrade to the default
}
```

The kernel `createVisionRunner` (`vision/run-vision-tool.ts:77`) never throws—it always returns the discriminated union `VisionResult` (`vision/types.ts:63`), and a failure result **never carries image bytes**. Orchestration order:

1. Attachment capability availability check (seam not wired → `attachment_unavailable`);
2. Fetch the image (`att_` resolution or the most recent one; not found → `no_image` / `attachment_not_found` / `not_an_image`);
3. Choose the model (`ctx.modelRegistry` + `PI_WEB_VISION_MODEL` default + interactive picker);
4. **Explicitly resolve credentials**: `ctx.modelRegistry.getApiKeyAndHeaders(model)`—the target provider's key exists only in `~/.pi/agent/models.json`, and `completeSimple` internally only falls back to environment variables, so you must fetch the credentials first and pass them in explicitly (`run-vision-tool.ts:116`); copying auto-title verbatim yields a 401;
5. Call the model, extract the textual conclusion; the result `content` holds only text, while `details` carries the full `VisionResult`.

> **Model format trap**: the `model` for `image_vision` is **`provider/modelId`** (e.g. `openai/gpt-4o`), which differs from the AIGC generation models' **bare route key** (e.g. `gpt-image-2`); they are not interchangeable.

### /img_vision command (user-initiated)

`vision/command.ts:37` registers `/img_vision`. The command argument (a bare string) is used in full as the question; when empty it uses the default question "Describe the content of this image." The image always follows the "most recent image" default rule and **does not accept an `att_` id** (to avoid users hand-copying a nanoid; to target a specific image use the `image_vision` tool).

The command handler **returns no value**; the conclusion is surfaced only through `ctx.ui.notify` (success=info, failure=error, user cancel/abort=info). On the frontend, commands with `source === "extension"` are **fire-and-forget**: no bubble, no message history, no busy lock (see [10 · Extensions & Skills](./10-extensions-and-skills.md) for extension-command execution semantics).

---

## The Canvas Prompt-Bar "Read" Button

The Canvas workbench prompt bar embeds a "Read" button: it assembles the **current working image + question + optional vision model** into an `image_vision` `SurfaceOp` (`tool: image_vision`), which via `bridge.submitOp → renderSurfaceOp` renders as a **user message** submitted into the conversation stream, on which the LLM then calls `image_vision`. The conclusion therefore naturally flows back into the conversation record—replayable, follow-up-able, and part of the LLM context.

The payload builder `buildVisionOp` (`packages/canvas-ui/src/vision-op.ts:63`) is a pure function: the `params` order is always `image → question → model?`; when `model` is empty it **produces no parameter line**, handing the "whether to pop a picker layer" decision fully back to the tool (the tool pops the layer when it receives no model). As in the previous section's trap, this `model` is also `provider/modelId` and is not interchangeable with the bare id used by the prompt bar's "generation model" picker.

Canvas is built on top of the Surface authoritative-surface stack (`domain=canvas` CQRS single-writer communication): the "Read" button's conversation flow-back travels exactly this channel. For the architectural overview see [04 · Surface Authoritative Stack](./04-surface-stack.md), and for the workbench interactions see [16 · Canvas Workbench](./16-canvas-workbench.md).

---

## Read-Only Model Enumeration Endpoints

For the settings UI and the Canvas picker to enumerate models; **any fetch failure degrades to 200 + an empty list** rather than leaking a 500 to the frontend:

| Endpoint | Purpose | Implementation |
|---|---|---|
| `GET /api/vision/models` | Lists the vision models that are "credentialed and support image input" as `{value,label,provider}`, for the Canvas "Read" picker; `value` is `provider/modelId` and can be dropped straight into `image_vision`'s `model` | `packages/server/src/vision-settings/vision-models-routes.ts:29` |
| `GET /api/aigc/models` | Lists the AIGC image-model display catalog `{model,label,provider}`, for the "model toggles" widget in `/settings`; the data source is the main-entry pure constant `AIGC_MODEL_CATALOG` | `packages/server/src/aigc-settings/aigc-models-routes.ts:14` |

Both routes are mounted into `createPiWebHandler` through the `routes:` injection seam (`lib/app/pi-handler.ts:497,502`); the host forwards the entire API surface with a single `app.all("/api/*")` (after Next.js was removed, per-segment forwarders are no longer needed). For the full endpoint reference see [24 · HTTP/SSE API Reference](./24-http-api-reference.md).

The frontend can reuse `fetchVisionModels` (`vision-op.ts:92`) to pull `GET /vision/models`: any failure (no baseUrl / non-2xx / parse error / shape mismatch) returns an empty array, and the Read feature remains usable.

---

## The AIGC Config Domain (aigc.json)

User-controllable AIGC settings land in `~/.pi/agent/aigc.json`; the schema is at `packages/protocol/src/config/domains/aigc.ts:18`:

| Field | Default | Description |
|---|---|---|
| `disabledModels` | `[]` | List of disabled image-model ids, toggled through the custom widget `aigcModelToggles`. Disabled models are removed at the same source from both the LLM-visible enum and the pushed-down list, taking effect on the next session/reload |
| `enablePromptOptimization` | `false` | Whether to enable tool prompt optimization (a no-rewrite placeholder seam for this iteration) |

At assembly time `aigcExtension` reads this setting (`resolveAigcToolSettings`) and feeds it to the two tool registration functions so the list is filtered at the same source (`extension.ts:76-79`). For the settings UI (schema-driven + the `aigcModelToggles` widget) see [13 · Config UI](./13-config-ui.md).

### promptToolbar Quick Settings

At assembly time `aigcExtension` also writes the "generation ∪ editing" model union + label/provider mapping + size tiers + prompt-optimization toggle into the session shared state (keys like `aigc.models`, `extension.ts:35-68`), so the AIGC quick-settings picker in the prompt bar's tool rail (the `promptToolbar` slot) can render dynamically—the single source of truth is the tool `ROUTES`, and a newly added provider shows up automatically. `promptToolbar` is a declared web-ext SlotKey; see [12 · Web UI Extension](./12-web-ui-extension.md).

---

## Provider Endpoint Differences Quick Reference

Endpoint and request-body shape differences across providers (`buildBody`/`pickResult`/`detectError` each encapsulated separately):

- **NewAPI (`gpt-image-2`, default)**: `POST https://www.apiservices.top/v1/images/generations` and `/images/edits` (multipart); OpenAI-compatible request body; `Authorization: Bearer ${NEWAPI_API_KEY}`.
- **sufy (`*-sufy`)**: base `https://openai.sufy.com/v1` (the Qiniu Cloud AIGC gateway, **not** `api.sufy.com`—NXDOMAIN); isomorphic to NewAPI, reusing the generic factory in `providers/openai-compat.ts`; the `response_format` parameter is rejected by sufy (400), so the sufy config sets `omitResponseFormat`; the real model id must carry the `openai/` prefix (without it you get 502), and the route distinguishes it via `providerModel`.
- **OpenRouter (gemini/gpt-5 family)**: `POST https://openrouter.ai/api/v1/chat/completions` (**not** OpenAI `/images`); request body `{ model, modalities:["image","text"], messages }`; the response image is at `choices[].message.images[].image_url.url`; `negative_prompt` is effective, while `size`/`background`/`quality`/`moderation`/`mask` are silently ignored; optional `${OPENROUTER_PROXY}`.
- **DashScope official (`wan2.7-image-pro` / `qwen-image-edit-max`)**: `POST https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation`; DashScope **native** `input/parameters` format; `size` uses `width*height` (asterisk, e.g. `1024*1024`), converted automatically at runtime.
- **Aliyun Bailian token plan (`*-bailian`)**: same DashScope native format, with the base overridden via the `${DASHSCOPE_TOKENPLAN_BASE_URL:-…}` placeholder; **do not** use the `compatible-mode/aigc` path (it raises a URL error)—the correct path is `.../services/aigc/multimodal-generation`.

> To wire in another OpenAI `/images`-compatible gateway with the least effort: copy a thin wrapper following `providers/sufy.ts`, change only the two constants `baseUrl` + `apiKeyVar`, and reuse the generic factory; env variables flow into the subprocess wholesale as part of `runner.ts`'s `env: process.env`, no allowlist injection needed. For a heterogeneous provider (like the DashScope native shape), refer to `providers/dashscope.ts` returning an `ImageRoute`.

---

## Extending: Adding a New Provider

Just append a new route item to the `ROUTES` array in `image-generation.ts` (`:44`); it does not affect other tools' execution paths:

```ts
import { createNewApiImage } from "../providers/newapi.js";

// append to ROUTES:
createNewApiImage(
  {
    model: "my-custom-model",
    label: "My Model · NewAPI",
    description: "Custom model via NewAPI. Needs NEWAPI_API_KEY.",
  },
  { pricing: { amount: 0.05, currency: "USD", unit: "image" } },
),
```

The new route's `model` automatically enters the LLM-visible enum built by `optionalModelEnum`, the `"$models"` sentinel expansion, the assembly-time pushed-down list, and the `GET /aigc/models` catalog all update accordingly—single source of truth.

---

## Complete Example: aigc-agent

`examples/aigc-agent/index.ts` demonstrates the full chain from loading via `extensions:[aigcExtension, visionExtension]` to "generate → look back".

**Conversation example**:

```
User: Generate a snowy mountain under the aurora with a film-grain feel
Assistant: [calls image_generation { prompt: "极光下的雪山，胶片质感", size: "1024x1024" }]
      Generated successfully: 1 image saved (att_abc123).
      ![image_generation_0](https://.../api/attachments/att_abc123/display?sig=...)

User: /img_vision Is this image day or night?
Assistant: [/img_vision command → image_vision kernel recognizes the most recent image]
      → ctx.ui.notify: This is a night scene, with an aurora visible in the sky… (no message history, no bubble)
```

**Hot reload**: after editing `examples/aigc-agent/index.ts`, add `--watch` to auto-reload the session.

---

## Related

- [04 · Surface Authoritative Stack](./04-surface-stack.md) — the communication plane through which the Canvas "Read" button flows back into the conversation
- [06 · Configuration](./06-configuration.md) — environment variables and config directories (incl. AIGC provider keys, `PI_WEB_VISION_MODEL`)
- [07 · Providers & Models](./07-providers-and-models.md) — text-conversation model integration (image/vision models use their own route tables, not the ModelRegistry)
- [08 · Custom Agent Development](./08-agent-development.md) — `defineAgent` and loading `extensions`
- [09 · Attachment System](./09-attachment-system.md) — how tool outputs are persisted and the `att_<id>` reference mechanism
- [10 · Extensions & Skills](./10-extensions-and-skills.md) — extension loading and the fire-and-forget semantics of extension commands
- [12 · Web UI Extension](./12-web-ui-extension.md) — the `promptToolbar` slot and AIGC quick settings
- [13 · Config UI](./13-config-ui.md) — the `aigcModelToggles` widget for `aigc.json`
- [16 · Canvas Workbench](./16-canvas-workbench.md) — the derivative canvas editor and the full "Read" button interaction
- [24 · HTTP/SSE API Reference](./24-http-api-reference.md) — the `GET /vision/models`, `GET /aigc/models` endpoints
- [23 · Troubleshooting FAQ](./23-troubleshooting-faq.md#4-provider--model-issues) — 401 / "channel does not exist", iPhone multi-picture JPEG errors
