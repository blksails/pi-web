# 11 · AIGC Image Tools

`@blksails/pi-web-tool-kit` ships two built-in AIGC image tools: `image_generation` (text-to-image) and `image_edit` (image editing). An agent mounts them as `customTools`, the LLM drives them through tool parameters, and their outputs land in the attachment store automatically and flow back into the conversation as signed URLs.

---

## Tool Overview

| Tool name | Function | Required params | Default model |
|---|---|---|---|
| `image_generation` | Text-to-image | `prompt` | `gpt-image-2` |
| `image_edit` | Image editing (inpaint / whole-image rewrite) | `image`, `prompt` | `gpt-image-2` |

Both tools are declared under `packages/tool-kit/src/aigc/tools/` (`imageGeneration` at `image-generation.ts:31`, `imageEdit` at `image-edit.ts:28`; their ToolSpec `name` values are `image_generation` and `image_edit` respectively). The aggregation entry is `packages/tool-kit/src/aigc/index.ts:17` (the `AIGC_TOOLS` constant + the `buildAigcTools()` factory).

---

## Integration

> The fastest path to follow along: the repo ships `examples/aigc-agent/` (just a single `index.ts`, resolving dependencies through the monorepo workspace), which you can run directly with `pi-web ./examples/aigc-agent --open` (see the "Complete Example" section at the end). The three steps below are what to do when integrating from scratch into **your own** agent package.

### 1. Install dependencies

This step is only needed when you create a standalone agent package (outside this monorepo) — add the following to the `dependencies` of that package's `package.json`:

```jsonc
{
  "dependencies": {
    "@blksails/pi-web-tool-kit": "workspace:*",
    "@blksails/pi-web-agent-kit": "workspace:*"
  }
}
```

> The in-monorepo `examples/aigc-agent` does not need this step: it has no `package.json`, and `@blksails/*` is resolved directly by the workspace.

### 2. Mount the tools in the agent

```ts
// examples/aigc-agent/index.ts
import { defineAgent } from "@blksails/pi-web-agent-kit";
import { buildAigcTools } from "@blksails/pi-web-tool-kit/runtime";  // note: use the /runtime sub-entry

export default defineAgent({
  systemPrompt: [
    "You are aigc-agent, a pi-web example exposing AIGC generation tools.",
    "- Use `image_generation` to generate one or more images from a text prompt.",
    "- Use `image_edit` to edit an uploaded image: copy the public id from the",
    "  [attachment id=att_… …] marker verbatim into the tool's `image` parameter.",
    "Each tool persists its output as an attachment and returns a reference; report the",
    "produced attachment id back to the user. Keep replies concise.",
  ].join("\n"),
  customTools: buildAigcTools(),
  noTools: "builtin",    // turn off built-in tools, expose only the AIGC tools
  skills: ({ diagnostics }) => ({ skills: [], diagnostics }),
});
```

> **Important**: `buildAigcTools` must be imported from the `@blksails/pi-web-tool-kit/runtime` sub-entry. That entry contains pi SDK value imports and is loaded only inside the runner (jiti) subprocess — it **must not** enter the Next.js webpack frontend bundle. The main entry `@blksails/pi-web-tool-kit` exports only engine types and the pure-data `ToolSpec` declarations (`AIGC_TOOLS` / `imageGeneration` / `imageEdit`), with no top-level import of the pi SDK / undici, so it is safe for the frontend bundle.

### 3. Configure environment variables

Tools check `requiredVars` at startup; when a variable is missing they return `ok:false` and degrade gracefully instead of crashing the subprocess.

| Variable | Purpose | When required |
|---|---|---|
| `NEWAPI_API_KEY` | NewAPI gateway (the default `gpt-image-2` route) | Required when using gpt-image-2 |
| `DASHSCOPE_API_KEY` | The official DashScope route and the token plan route **read the key from the same variable name** | Required when using DashScope / token plan models |
| `DASHSCOPE_TOKENPLAN_BASE_URL` | The token plan endpoint base (optional, defaults to `https://token-plan.cn-beijing.maas.aliyuncs.com/api/v1`) | Set it to override the token plan domain |

> **Note**: The official `dashscope.aliyuncs.com` route (`wan2.7-image-pro` / `qwen-image-edit-max`) and the token plan route (`*-bailian`) both read their key from the same `DASHSCOPE_API_KEY`, but the two sets of keys are **not interchangeable** — a token plan key hits the official endpoint and returns 401, and vice versa. Within a single process, `DASHSCOPE_API_KEY` can only hold one value, so it is one or the other: either use the official route with an official key, or use the `*-bailian` route with a token plan key. When you hit a 401 or "channel does not exist", troubleshoot in this order first; for detailed countermeasures see [23 · Troubleshooting FAQ §2.1](./23-troubleshooting-faq.md#21-custom-provider-auth-401).

```bash
# .env.local example
NEWAPI_API_KEY=sk-xxxxxxxx
DASHSCOPE_API_KEY=sk-xxxxxxxx
# token plan endpoint (built in by default, usually no need to configure)
# DASHSCOPE_TOKENPLAN_BASE_URL=https://token-plan.cn-beijing.maas.aliyuncs.com/api/v1
```

---

## Tool Parameters in Detail

### image_generation

```jsonc
{
  "prompt": "极光下的雪山，胶片质感",   // required; do not translate into English
  "n": 1,                                // number of images 1–10, some models support only 1
  "size": "1024x1024",                   // or 1536x1024 / 1024x1536 / auto
  "negative_prompt": "模糊, 水印",       // effective for DashScope/OpenRouter
  "background": "transparent",           // gpt-image only
  "quality": "high",                     // OpenAI only
  "moderation": "low",                   // gpt-image only
  "model": "gpt-image-2"                 // omit to use defaultModel
}
```

### image_edit

```jsonc
{
  "image": "att_abc123",    // attachment id (att_ prefix) or https URL; required
  "prompt": "把背景换成夕阳下的海滩",  // edit instruction; required
  "mask": "att_def456",     // optional B/W mask: white areas are repainted
  "reference_images": ["att_xyz"],  // optional reference images; total of main image + mask + reference images ≤ 3 (dashscope.ts:155 IMAGE_EDIT_MAX_IMAGES, throws on overflow)
  "n": 1,
  "size": "1024x1024",
  "model": "gpt-image-2"
}
```

`att_`-prefixed ids are automatically resolved by the compiler into data URIs before the call (after passing the attachment store permission check); the LLM only needs to pass through the attachment reference shown in the conversation verbatim.

---

## Available Model Routes

### image_generation available models

| model id | Label | provider | Endpoint | Reference price |
|---|---|---|---|---|
| `gpt-image-2` (default) | GPT Image 2 · NewAPI | NewAPI gateway | `POST /v1/images/generations` | $0.04/image |
| `wan2.7-image-pro` | Wan 2.7 Image Pro | DashScope official | `POST /api/v1/services/aigc/multimodal-generation/generation` (sync) | ¥0.5/image |
| `wan2.7-image-pro-bailian` | Wan 2.7 Image Pro · token plan | Aliyun Bailian token plan | Same DashScope path, base switched to the token plan domain | ¥0.2/image |

### image_edit available models

| model id | Label | provider | Characteristics |
|---|---|---|---|
| `gpt-image-2` (default) | GPT Image 2 · NewAPI | NewAPI gateway | Whole-image rewrite; multipart FormData |
| `qwen-image-edit-max` | Qwen Image Edit Max · sync | DashScope official | Highest fidelity; supports mask-based local repaint |
| `wan2.7-image-edit-bailian` | Wan 2.7 Image Edit · token plan | Aliyun Bailian token plan | DashScope-native messages/content; supports image-conditioned editing |

---

## Interactive Parameter Completion (aigc-tools-interactive-params)

The three parameters `model`, `size`, and `prompt` are critical to output quality, yet they are not declared in `inputSchema.required` — so if the LLM omits one, it is not blocked by parameter validation. Instead, the tool execution layer prompts the user to fill it in via the extension context's `ext.ui` (`ExtensionContext.ui`, distinct from the attachment `ctx` responsible for persisting attachments).

**Completion logic** (declared in `ToolSpec.requiredParams`, see `image-generation.ts:92` / `image-edit.ts:98`; implemented in `resolveRequiredParams` at `packages/tool-kit/src/engine/compile-tool.ts:288`, invoked by `runExecute` at `compile-tool.ts:342` before routing and the provider call):

1. A non-empty value already exists (`cur !== undefined && cur !== null && cur !== ""`) → skip directly, no prompt (the normal flow is undisturbed)
2. An interactive UI is available (`ext?.hasUI === true && ext.ui != null`):
   - `via: "select"` → call `ext.ui.select(title, options)` to pop a picker
   - `via: "input"` → call `ext.ui.input(title, placeholder)` to pop a text box
   - User cancels (returns `undefined` or an empty string) → return `ok:false`, no provider call is made
3. When no interactive UI is available:
   - A `fallback` is declared → continue with the fallback value
   - `param === "model"` → fall back to `defaultModel`
   - `prompt` has no fallback → return `ok:false`

The sentinel value `"$models"` in `options` is automatically expanded at runtime by `expandOptions` (`compile-tool.ts:275`) into all `model` route keys of that tool's `models[]`.

---

## Image Normalization: the iPhone Multi-Picture JPEG Problem

**Problem**: JPEGs taken by an iPhone contain an `APP2/MPF` (Multi-Picture Format) index plus an HDR gain map appended after the main image's `EOI`. Sending these to the NewAPI gateway triggers a misleading error: "no available channel exists / This token has no access to model (with an empty model name)".

**Solution**: pure-JS lossless normalization, implemented in `packages/tool-kit/src/engine/normalize-image.ts`, exporting `normalizeImageDataUri(input: string): string`.

**Processing strategy**:
- Only process `data:image/jpeg` format (other formats are returned as-is)
- Locate and skip the `APP2/MPF` segment (identified by the magic number `4d 50 46 00`, distinct from the ICC_PROFILE APP2 that must be preserved)
- Truncate at the main image's first `EOI` (`FF D9`), discarding the appended gain map
- Zero re-encoding, zero resizing, preserving EXIF orientation and other metadata
- On parse failure or when there is no MPF content, return as-is without blocking the tool call

The compiler's `resolveMediaFields` (`compile-tool.ts:217`) walks `inputSchema.properties` and resolves every `mediaKind: "image"` field (including array types such as `reference_images`) through `resolveAndNormalizeImage` (`compile-tool.ts:256`): an `att_` prefix → `resolveInputToDataUri` converts to a data URI → then feed into `normalizeImageDataUri`; an https URL that is neither `att_` nor `data:` is passed through as-is. The whole chain completes before `buildBody`, so tool authors do not need to handle it manually.

> Still hitting "empty model name / channel does not exist" and confirmed it is an iPhone multi-picture photo? See [23 · Troubleshooting FAQ §2.2](./23-troubleshooting-faq.md#22-iphone-multi-image-jpeg-upload-causes-the-gateway-to-report-empty-model-name-or-channel-does-not-exist), which includes a temporary ImageMagick workaround command for manually extracting the main image.

---

## Provider Endpoint Differences Quick Reference

When using different providers, note the following endpoint and parameter-shape differences:

### NewAPI (gpt-image-2, default)

- Text-to-image endpoint: `POST https://www.apiservices.top/v1/images/generations`
- Image editing endpoint: `POST https://www.apiservices.top/v1/images/edits` (multipart FormData)
- Request body: OpenAI-compatible format (`{ model, prompt, n, size, ... }`)
- Key: `Authorization: Bearer ${NEWAPI_API_KEY}`

### DashScope official (wan2.7-image-pro / qwen-image-edit-max)

- Endpoint: `POST https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation`
- Request body: DashScope **native** `input/parameters` format (not the OpenAI `/images` format)
  ```json
  {
    "model": "wan2.7-image-pro",
    "input": { "messages": [{ "role": "user", "content": [{ "text": "..." }] }] },
    "parameters": { "size": "1024*1024", "n": 1 }
  }
  ```
- `size` format: `width*height` (asterisk-separated, e.g. `1024*1024`), not OpenAI's `1024x1024`; converted automatically in the implementation
- Key: `Authorization: Bearer ${DASHSCOPE_API_KEY}`
- **Note**: `DASHSCOPE_API_KEY` (a token plan key) is invalid against the official `dashscope.aliyuncs.com` endpoint (returns 401); the two sets of keys are not interchangeable

### Aliyun Bailian token plan (wan2.7-image-pro-bailian / wan2.7-image-edit-bailian)

- Endpoint: `https://token-plan.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation`. The URL is hard-coded in the tool declaration as the placeholder constant `${DASHSCOPE_TOKENPLAN_BASE_URL:-https://token-plan.cn-beijing.maas.aliyuncs.com/api/v1}/services/aigc/multimodal-generation/generation` (`image-generation.ts:28` / `image-edit.ts:25`); the `${VAR:-default}` default syntax is expanded by `var-resolver.ts:20` at `runEndpoint` time — set `DASHSCOPE_TOKENPLAN_BASE_URL` to override the base, otherwise it falls back to the token plan default domain
- The request body format is the same as DashScope native (reusing the `createDashscopeSyncT2I` / `createDashscopeImageEdit` factories, overriding only the base URL via `extras.url`)
- **Pitfall**: do not use the `compatible-mode/aigc` path, which raises a URL error; the correct path is `maas/**api/v1/services/aigc/multimodal-generation**`
- The token plan routes are distinguished by `*-bailian`-suffixed model ids (`wan2.7-image-pro-bailian` goes to image_generation, `wan2.7-image-edit-bailian` goes to image_edit); their underlying `providerModel` is the same `DASHSCOPE_MODELS.wan27ImagePro` — the token plan in fact only enables a single model, Wan 2.7 Image Pro (text-to-image + image-conditioned editing unified), and generation/editing are merely split into two separate route keys. The `*-bailian` ids are the token-plan-specific routes; the suffix-less `wan2.7-image-pro` / `qwen-image-edit-max` are the DashScope official routes

---

## Declarative Engine Structure

The tools use a two-layer declarative design that makes it cheap to add new tools or new providers:

```
ToolSpec (tools/image-generation.ts)
  ├── inputSchema          — LLM-visible parameter schema (excludes model)
  ├── defaultModel         — fallback when model is omitted
  ├── requiredParams[]     — interactive-completion declarations for business-required options
  └── models[]             — ModelRoute routing table
        ├── model          — LLM-visible route key (also the enum value)
        ├── url            — endpoint URL (supports ${VAR} placeholders)
        ├── headers        — request headers (support ${VAR} placeholders, expanded at runtime)
        ├── buildBody      — request body builder function
        ├── pickResult     — response parser function
        ├── detectError    — business-error detection function
        ├── async?         — async-polling declaration (omit for sync)
        └── requiredVars[] — required environment variables (degrades if missing)
```

`compileTool` (`packages/tool-kit/src/engine/compile-tool.ts`) compiles a `ToolSpec` into a pi `ToolDefinition` at runtime, automatically injecting the `model` enum parameter.

---

## Execution Flow

A successful image generation call goes through the following steps:

1. The LLM invokes the tool, passing `prompt` (and optional parameters); `model` is stripped out as the route key and does not enter `buildBody`
2. `resolveRequiredParams` checks `requiredParams` and triggers interactive completion for missing items (user cancels → `ok:false`)
3. `selectModelRoute` routes to the corresponding `ModelRoute` by the `model` parameter (or `defaultModel`, then falling back to `models[0]`)
4. `checkRequiredVars` checks whether `requiredVars` are resolvable; if missing, returns `ok:false` and degrades (no crash)
5. Checks whether the attachment ctx is injected (`ctx.available`, assembled by the runner); if not injected, `ok:false` degrade
6. `resolveMediaFields` for `mediaKind: "image"` fields: `att_id → data URI → normalizeImageDataUri`
7. Calls `runEndpoint`: build the request body → HTTP POST → parse the response (sync / async polling)
8. `persistPicked`: write the image output to the attachment store and obtain an `att_<id>` reference; **zero outputs** (the provider returns a raw/empty url) → report `ok:false` failure rather than a misleading success (`compile-tool.ts:394`)
9. Assemble the tool result: a text description + `![name](signedDisplayUrl)` markdown (displayUrl travels with the content, and the frontend renderer renders an `<img>` from it) + `details.assets`

---

## Complete Example: aigc-agent

`examples/aigc-agent/index.ts` provides a complete runnable example, demonstrating the full chain from `buildAigcTools()` assembly to generation.

**How to start**:

```bash
# configure the key
export NEWAPI_API_KEY=sk-xxxxxxxx

# start pi-web with aigc-agent as the agent source (source is a positional argument, not an --agent flag)
pi-web ./examples/aigc-agent --open

# edit examples/aigc-agent/index.ts and the session reloads automatically
pi-web ./examples/aigc-agent --watch
```

**Conversation example**:

```
User: Generate a snowy mountain under the aurora with a film-grain feel
Assistant: [calls image_generation { prompt: "极光下的雪山，胶片质感", model: "gpt-image-2", size: "1024x1024" }]
      Generated successfully: 1 image saved (att_abc123).
      ![image_generation_0](https://pi-web.local/api/attachments/att_abc123/display?sig=...)

User: [uploads an image, the conversation shows [attachment id=att_def456 ...]]
User: Replace the background of this image with a beach at sunset
Assistant: [calls image_edit { image: "att_def456", prompt: "把背景换成夕阳下的海滩" }]
      Generated successfully: 1 image saved (att_ghi789).
```

---

## Extension: Adding a New Provider

Just append a new route item to the `models` array in `packages/tool-kit/src/aigc/tools/image-generation.ts`; it does not affect other tools' execution paths:

```ts
import { createNewApiImage } from "../providers/newapi.js";

// append to imageGeneration.models:
createNewApiImage(
  {
    model: "my-custom-model",
    label: "My Model · NewAPI",
    description: "Custom model via NewAPI. Needs NEWAPI_API_KEY.",
  },
  { pricing: { amount: 0.05, currency: "USD", unit: "image" } },
),
```

If you need a new provider type, refer to the factory function implementations in `dashscope.ts` and `newapi.ts` under `packages/tool-kit/src/aigc/providers/`, returning a `ModelRoute`.

---

## Next Steps / Related

- [09 · Attachment System](./09-attachment-system.md) — how tool outputs are persisted and the `att_<id>` reference mechanism
- [10 · Extensions and Skills](./10-extensions-and-skills.md) — how to assemble tools and extensions in an agent
- [06 · Configuration](./06-configuration.md) — environment variable configuration notes
- [07 · Providers and Models](./07-providers-and-models.md) — NewAPI / DashScope provider integration
- [08 · Agent Development](./08-agent-development.md) — `defineAgent` and `customTools` usage
- [23 · Troubleshooting FAQ](./23-troubleshooting-faq.md#2-provider--model-issues) — 401 / "channel does not exist" ([§2.1](./23-troubleshooting-faq.md#21-custom-provider-auth-401)), iPhone multi-picture JPEG errors ([§2.2](./23-troubleshooting-faq.md#22-iphone-multi-image-jpeg-upload-causes-the-gateway-to-report-empty-model-name-or-channel-does-not-exist))
```
