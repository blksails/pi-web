# 07 · Providers and Models

This chapter explains how pi-web discovers **text conversation models**, how to connect built-in providers and custom OpenAI-compatible gateways, and the data source and filtering mechanism behind the dropdowns on the settings page.

> **Scope boundary (read first)**: The `models.json` / `ModelRegistry` covered in this chapter governs only **text conversation models**—the LLM the agent uses to generate replies within a session. The models for the AIGC image tools (`image_generation` / `image_edit`) and the vision tool (`image_vision`) do **not** go through `ModelRegistry`; they are driven by their own module-level routing tables instead (the `ROUTES` in `run-image-tool.ts`, `openrouter-models.ts`, and `image_vision` picking a vision model via `ctx.modelRegistry`). Configuring a provider in `models.json` has no effect on the image/vision models—for how those are wired up, see [11-aigc-and-vision-tools.md](./11-aigc-and-vision-tools.md).

---

## 1. Model Sources: Two Kinds of Providers

| Type | Credential storage | Typical providers |
|---|---|---|
| **Built-in provider** | `~/.pi/agent/auth.json` (written by `pi` login) | anthropic, openai, google, etc. |
| **Custom provider** | `~/.pi/agent/models.json` (hand-authored) | NewAPI gateway, local inference services, DashScope, etc. |

Both kinds of providers are managed uniformly by the pi SDK's `ModelRegistry`. `ModelRegistry.getAvailable()` returns only the models that **have credentials**—built-in provider credentials come from `auth.json`, while custom provider credentials are embedded in the `apiKey` field of `models.json`.

Relevant entry point: `packages/server/src/config/model-options.ts:listModelOptions`

```ts
const authStorage = AuthStorage.create(join(agentDir, "auth.json"));
const registry = ModelRegistry.create(authStorage, join(agentDir, "models.json"));
const models = registry.getAvailable();
```

---

## 2. Connecting Built-in Providers (`auth.json`)

Log in once and the credentials are persisted—no extra configuration needed:

```bash
pi          # follow the prompts to complete OAuth / API key setup
```

After login, `~/.pi/agent/auth.json` is maintained by the pi SDK; pi-web reads it at runtime, with no need to set env variables.

To inject credentials non-interactively on a different machine or in a container, you can also pass them through via env variables (see [06-configuration.md](./06-configuration.md) for the relevant variables):

```bash
ANTHROPIC_API_KEY=sk-ant-...  pnpm dev
OPENAI_API_KEY=sk-...         pnpm dev
```

The env variables and `auth.json` take effect additively; precedence follows the pi SDK's internal logic.

---

## 3. Custom OpenAI-compatible Gateway (`models.json`)

Custom providers **must** be written in `~/.pi/agent/models.json`, never in `auth.json`.

> The agent config directory defaults to `~/.pi/agent` and can be overridden via the env `PI_CODING_AGENT_DIR` (see `lib/app/config.ts:resolveAgentDir`); after overriding, `models.json` must be placed in the corresponding directory.

### 3.1 Minimal Configuration

```json
{
  "providers": {
    "my-gateway": {
      "name": "My Gateway",
      "baseUrl": "https://example.com/v1",
      "apiKey": "sk-...",
      "api": "openai-completions",
      "models": [
        {
          "id": "some-model",
          "name": "Some Model",
          "input": ["text"],
          "contextWindow": 131072,
          "maxTokens": 16384,
          "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 }
        }
      ]
    }
  }
}
```

Required fields:

| Field | Description |
|---|---|
| `baseUrl` | OpenAI-compatible endpoint prefix (up to `/v1`, not including `/chat/completions`) |
| `apiKey` | Gateway authentication token |
| `api` | Connection protocol identifier; for OpenAI-compatible chat completions gateways, set `"openai-completions"` (can be specified at the provider level or per individual model) |
| `models` | At least one model description; `id` is the model name used when calling |

The optional fields (`cost`, `contextWindow`, `maxTokens`) are recommended for the pi SDK's cost estimation; when omitted, the SDK uses 0 or default values.

### 3.2 Multi-provider Example

```json
{
  "providers": {
    "newapi": {
      "name": "NewAPI Gateway",
      "baseUrl": "https://newapi.example.com/v1",
      "apiKey": "sk-newapi-...",
      "api": "openai-completions",
      "models": [
        {
          "id": "gpt-4o",
          "name": "GPT-4o (via NewAPI)",
          "input": ["text", "image"],
          "contextWindow": 128000,
          "maxTokens": 16384,
          "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 }
        }
      ]
    },
    "local-llm": {
      "name": "Local Ollama",
      "baseUrl": "http://localhost:11434/v1",
      "apiKey": "ollama",
      "api": "openai-completions",
      "models": [
        {
          "id": "llama3.2",
          "name": "Llama 3.2",
          "input": ["text"],
          "contextWindow": 32768,
          "maxTokens": 4096,
          "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 }
        }
      ]
    }
  }
}
```

### 3.3 Verifying the Configuration Took Effect

```bash
pi --list-models
```

If the output includes the models under `my-gateway`, the configuration succeeded. This command reads the same `ModelRegistry` data that pi-web reads, making it the most direct way to verify.

> **Don't see your custom model?** It's usually because the config is in the wrong location or a required field is missing—see the troubleshooting checklist at [23-troubleshooting-faq.md · 4.1 Custom provider auth 401](./23-troubleshooting-faq.md#41-custom-provider-auth-401).

---

## 4. Model Dropdown on the Settings Page: Data Source and Filtering

### 4.1 Endpoint

The searchable provider/model dropdown on the settings page is driven by the frontend calling the following endpoint:

```
GET /api/config/models
```

Response format:

```json
{
  "providers": ["anthropic", "openai", "my-gateway"],
  "models": [
    { "provider": "anthropic", "id": "claude-opus-4-5", "name": "Claude Opus 4.5" },
    { "provider": "my-gateway", "id": "some-model", "name": "Some Model" }
  ]
}
```

The server mounts this route in `packages/server/src/config/config-routes.ts` (the path `/config/models` must come before `/config/:domain` so it isn't treated as an unknown domain).

The data comes from `listModelOptions(agentDir)` (`packages/server/src/config/model-options.ts`), i.e. an in-process call to `ModelRegistry.getAvailable()`—**only models with configured credentials appear in the dropdown**.

### 4.2 Hiding Specific Providers

Use the env variable `PI_WEB_HIDE_PROVIDERS` to remove providers you don't want to expose from the dropdown:

```bash
PI_WEB_HIDE_PROVIDERS=anthropic,openai  pnpm dev
```

The filtering logic lives in `packages/server/src/config/model-options-filter.ts:33` (`excludeProviders`), matching provider names exactly (case-sensitive) and removing them from both the `providers` list and the `models` list. When `PI_WEB_HIDE_PROVIDERS` is empty, no filtering is applied (zero-copy fast path). The call site on the `/config/models` route is at `lib/app/pi-handler.ts:447` (reading the env inside the `listModelOptions` seam and then applying `excludeProviders`).

The in-session `get_available_models` RPC (`GET /sessions/:id/models`) applies the same switch—filtered via the sibling function `excludeProviderModels` (`model-options-filter.ts:49`), with the call site at `packages/server/src/http/routes/query-routes.ts:126`, ensuring the dropdown and the runtime selectable set stay consistent.

### 4.3 Which Provider/Model a New Session Selects by Default

The initial selection of the provider/model dropdown on the settings page comes from two env variables:

| Variable | Effect |
|---|---|
| `PI_WEB_DEFAULT_PROVIDER` | The provider initially selected for a new session |
| `PI_WEB_DEFAULT_MODEL` | The model id initially selected for a new session |

Both are read in by `resolveConfig` (`lib/app/config.ts:92-93`) and pushed to the frontend dropdown as the defaults for the `settings` domain's `defaultProvider` / `defaultModel`. They only affect the **initial selection**, not the selectable set—the selected provider/model must still genuinely exist in the list returned by `getAvailable()`, otherwise the dropdown falls back to the first available option. See [06-configuration.md](./06-configuration.md) for the full variable reference.

---

## 5. Real-world Cases and Common Pitfalls

### 5.1 NewAPI Gateway

NewAPI is a typical OpenAI-compatible aggregation gateway. The `api` field is fixed to `"openai-completions"`, and `baseUrl` should be set to the `/v1` prefix (the gateway then routes internally to each upstream):

```json
{
  "providers": {
    "newapi": {
      "name": "NewAPI",
      "baseUrl": "https://your-newapi-host/v1",
      "apiKey": "sk-...",
      "api": "openai-completions",
      "models": [ ... ]
    }
  }
}
```

### 5.2 The DashScope Key-Endpoint Binding Pitfall

DashScope's (Alibaba Cloud Bailian) image generation has its **key tightly bound to the service endpoint**: using the wrong key for an endpoint results in a direct 401. This pitfall was discovered through real-world testing of the AIGC image tools; see the endpoint constant at `packages/tool-kit/src/aigc/tools/image-generation.ts:40`.

- The image API uses the native DashScope protocol (`input`/`parameters` structure), **not** the OpenAI-compatible `/images` endpoint.
- The synchronous image endpoint path is `/api/v1/services/aigc/multimodal-generation/generation` (the base defaults to the token plan domain `https://token-plan.cn-beijing.maas.aliyuncs.com/api/v1`, configurable via the env `DASHSCOPE_TOKENPLAN_BASE_URL`).
- Symptom: the image generation request returns **401**, with an error message that may contain "channel does not exist" or an empty model name.

Cause: the token plan key (`DASHSCOPE_API_KEY`) is invalid against the official domain `dashscope.aliyuncs.com` and must hit the token plan endpoint; conversely, a MAAS token from the official console hitting the token plan endpoint also returns 401.

**Solution**:

1. Confirm the key pairs with the endpoint: token plan key with token plan base, official key with official domain—never mix them.
2. The base/endpoint of the custom provider (or the AIGC tool's env) must match the service endpoint corresponding to the key in use.
3. We recommend splitting text chat and image generation into two separate provider entries, each configured with its corresponding key.

> **Note**: The keys used by the AIGC and vision tools go beyond the `auth.json` / `models.json` paths. `NEWAPI_API_KEY`, `SUFY_API_KEY`, `DASHSCOPE_API_KEY`, the endpoint override `DASHSCOPE_TOKENPLAN_BASE_URL`, and the default vision model `PI_WEB_VISION_MODEL` (format `provider/modelId`) are all env variables dedicated to AIGC/vision, expanded by the tool-kit at runtime and injected into the spawn environment—an independent system from the text-model wiring in this chapter. See [06-configuration.md](./06-configuration.md) for the list and [11-aigc-and-vision-tools.md](./11-aigc-and-vision-tools.md) for the semantics.

> See [11-aigc-and-vision-tools.md](./11-aigc-and-vision-tools.md) for the full explanation of endpoints and keys; see [23-troubleshooting-faq.md · 4.1 Custom provider auth 401](./23-troubleshooting-faq.md#41-custom-provider-auth-401) for the troubleshooting steps on the 401 symptom.

---

## 6. Full Connection Steps

1. **Confirm pi is logged in** (built-in providers):
   ```bash
   pi --list-models   # you should see built-in models such as anthropic/openai
   ```

2. **Author `~/.pi/agent/models.json`** (custom provider; see the examples in Section 3).

3. **Verify the model appears in the list**:
   ```bash
   pi --list-models   # the custom provider's models should appear
   ```

4. **Start pi-web** (development mode):
   ```bash
   pnpm dev           # dev-all.mjs: Vite frontend on :5173 + API on :3000 (/api proxied to 3000)
   ```

5. **Confirm the dropdown on the settings page**: open <http://localhost:5173> in the browser → Settings → model dropdown → the models under the custom provider should be searchable.

6. **(Optional) Hide providers you don't want to expose**:
   ```bash
   PI_WEB_HIDE_PROVIDERS=anthropic  pnpm dev
   ```

> If any step fails (401, model not showing up, empty dropdown), first cross-reference [23-troubleshooting-faq.md · 4. Provider / Model Issues](./23-troubleshooting-faq.md#4-provider--model-issues).

---

## Related Links

- [06-configuration.md](./06-configuration.md) — Full env variable table, including `PI_WEB_DEFAULT_PROVIDER` / `PI_WEB_DEFAULT_MODEL`
- [13-config-ui.md](./13-config-ui.md) — Frontend implementation of the searchable provider/model dropdown on the settings page
- [11-aigc-and-vision-tools.md](./11-aigc-and-vision-tools.md) — AIGC image tools, with detailed explanation of DashScope endpoints and keys
- [24-http-api-reference.md](./24-http-api-reference.md) — Complete API documentation for the `GET /api/config/models` endpoint
- [23-troubleshooting-faq.md](./23-troubleshooting-faq.md) — Troubleshooting for provider auth 401, models not showing up, and other common issues
