# 10 · Web UI Extensions (agent-web-extension)

Every agent source can ship a **WebExtension** (ESM bundle + manifest) under its `.pi/web` directory. The host loads it dynamically when a session for that source becomes active, customizing layout, rendering, interaction, and isolated surfaces—without touching the host's document, session, or security boundaries.

---

## The Five-Tier Model (Tier 1–5)

| Tier | Name | Capability | Bundle required |
|------|------|------------|-----------------|
| 1 | **Region slots** | Fill 19 named slots (`background`, `header`, `panelRight`, `logs`, etc.) | Yes |
| 2 | **Renderer registry** | Replace tool/data-part card rendering, per-session namespace | Yes |
| 3 | **Contributions + RPC** | slash, @mention, autocomplete, keybindings, routed back to the agent over the `ui-rpc` bus | Yes |
| 4 | **Artifact iframe** | Sandboxed iframe (`sandbox="allow-scripts"`), no same-origin credentials, postMessage communication | Yes (artifact HTML) |
| 5 | **Pure declarative config** | theme tokens, layout presets, `empty` state copy—zero bundle, read straight from `manifest.json` | No |

The host follows **Model A**: the host always owns the page root, session, transport, and security boundaries; extensions can only fill the named slots the host yields, register contribution points, or render freely inside an iframe.

---

## End to End: Running an Extension from Scratch

The host has two loading lanes: **build-time integration** (whitelisted in-repo sources statically `import` `.pi/web/web.config`, see `lib/app/webext-registry.ts:68`) and **standalone prebuilt + import map** (external git sources go through `.pi/web/dist` + SRI + signature verification). Below is the shortest runnable path using the build-time lane and a Tier 1 region slot (each step can be verified independently):

1. **Try the ready-made example (fastest)** — experience the in-repo `examples/webext-layout-agent` directly, no need to write your own:
   ```bash
   pnpm dev   # http://localhost:3000
   ```
   Once the page opens, in the agent source input (`data-agent-source-input`, placeholder text `./examples/hello-agent or https://github.com/org/repo`) enter `./examples/webext-layout-agent` and submit.
2. **Verify it took effect** — after entering the session you should see the `headerCenter` text and the right-side `panelRight` panel, carrying `data-pi-ext-header` and `data-pi-chat-aside` respectively in the DOM.
3. **Write your own extension** — under your own agent source, create `.pi/web/web.config.tsx` with `export default defineWebExtension({...})` (see "Minimal Tier 1 Example" below).
4. **Install the SDK and build** — run from the root of that agent source:
   ```bash
   pnpm add -D @blksails/pi-web-kit
   pnpm pi-web build --id <extId> --api "^0.1.0" --dir .pi/web --out .pi/web/dist
   ```
   On success the terminal prints `[pi-web build] <extId> → … (integrity=sha384-…)` and generates `web-extension.mjs` + `manifest.json` in `.pi/web/dist/`. That `dist/` artifact is what the "standalone prebuilt" lane (external sources) loads and verifies.
5. **Point at your source** — after `pnpm dev`, enter the local path or git URL of your agent source in the source input.
6. **Not working?** — most often a signature/version/gating issue; cross-reference [18 · Troubleshooting FAQ](./18-troubleshooting-faq.md), section 3 "Web Extension / UI Issues", or "FAQ" at the end of this chapter.

> Tier 5 pure-declarative extensions can skip the build in step 4: hand-write `manifest.json` (with `config`, no `entry`) and the host synthesizes the descriptor directly.

---

## Directory Contract and manifest

### `.pi/web` Directory Structure

```
<agent-source>/
└── .pi/
    └── web/
        ├── web.config.tsx        # entry (defaultExport = defineWebExtension(…))
        ├── styles.css            # optional, auto-scoped at build time
        ├── artifact.html         # for Tier 4, loaded from a separate origin
        └── dist/                 # pi-web build output
            ├── web-extension.mjs
            ├── ext.css           # optional
            └── manifest.json
```

The entry file is auto-detected in the order `web.config.tsx` → `web.config.ts` → `index.tsx` → `index.ts`.

### manifest.json Structure

Produced automatically by `pi-web build`, or hand-written (the Tier 5 pure-declarative case):

```json
{
  "id": "webext-contrib",
  "targetApiVersion": "^0.1.0",
  "entry": "web-extension.mjs",
  "integrity": "sha384-…",
  "capabilities": ["contributions"]
}
```

**Tier 5 pure-declarative** example (no `entry` field, zero bundle):

```json
{
  "id": "webext-declarative",
  "targetApiVersion": "^0.1.0",
  "capabilities": ["config"],
  "config": {
    "documentTitle": "Declarative · pi-web",
    "theme": { "--primary": "262 83% 58%" },
    "layout": "wide",
    "empty": {
      "title": "Pure Declarative Extension · Zero Code",
      "subtitle": "theme/layout/copy come from manifest.json, carrying no bundle.",
      "starters": [{ "id": "q1", "label": "Help", "value": "…", "mode": "fill" }],
      "mergeCommands": "prepend"
    }
  }
}
```

---

## Writing an Extension

### Install the Author-Side SDK

```bash
pnpm add -D @blksails/pi-web-kit
```

### Minimal Tier 1 Example (Region Slots)

Below is a trimmed-down version of the in-repo `examples/webext-layout-agent/.pi/web/web.config.tsx`—it fills the `headerCenter` and `panelRight` slots, and uses a Tier 5 declaration of `panelRatio` to yield the right-side panel proportion:

```tsx
// .pi/web/web.config.tsx
import * as React from "react";
import { defineWebExtension } from "@blksails/pi-web-kit";

function InfoPanel(): React.JSX.Element {
  return (
    <div data-testid="layout-panel" style={{ padding: 12 }}>
      <h3>Domain Inspection Panel</h3>
      <p>The panelRight filled by webext-layout-agent.</p>
    </div>
  );
}

export default defineWebExtension({
  manifestId: "webext-layout",
  capabilities: ["slots", "config"],
  config: { panelRatio: "3:7" }, // chat 30% / panel 70%; requires slots.panelRight
  slots: {
    headerCenter: <span data-testid="layout-header">Layout Agent</span>,
    panelRight: <InfoPanel />,
  },
});
```

### Build

```bash
# Run from the agent source root (@blksails/pi-web-kit's bin name is pi-web → build/cli.ts)
pnpm pi-web build \
  --id my-agent-ext \
  --api "^0.1.0" \
  --dir .pi/web \
  --out .pi/web/dist
  # optional: --sign <hmac-secret> to write a signature into the manifest
```

> Note that the flags are `--api`/`--dir`/`--out` (see `packages/web-kit/build/cli.ts:32`), not `--target-api-version`/`--entry-dir`/`--out-dir`. The in-repo examples are instead built uniformly via `scripts/build-webext-examples.ts`, which calls the programmatic API `buildWebExtension({...})` (`node --import jiti/register scripts/build-webext-examples.ts`).

The output is written to `.pi/web/dist/`: `web-extension.mjs`, `manifest.json` (with SRI), and—when `styles.css` is present—an additional `ext.css`.

---

## Tier 1: Region Slots

> **Matching runnable examples**: this tier has three concrete examples—`examples/webext-layout-agent` (`panelRight` domain-inspection panel + `headerCenter`, see `examples/webext-layout-agent/.pi/web/web.config.tsx:1`), `examples/webext-slots-agent` (an 18-region-slot fixture, i.e. the full set of the protocol's 19 slots except `logs`, each slot a visible component with a `data-testid`, see `examples/webext-slots-agent/.pi/web/web.config.tsx:1`), and `examples/webext-background-agent` (the `background` region slot with a custom animated aurora background, self-namespaced class names, see `examples/webext-background-agent/.pi/web/web.config.tsx:1`).

### The 19 Protocol-Reserved Slots

| SlotKey | Position | data attribute |
|---------|----------|----------------|
| `background` | Absolutely full, `-z-10`, beneath the message layer | `data-pi-chat-background` |
| `headerLeft` / `headerCenter` / `headerRight` | The three header zones | `data-pi-ext-header` |
| `sidebarLeft` | Left sidebar | `data-pi-ext-sidebar-left` |
| `panelRight` | Right-side domain-inspection panel (lg breakpoint) | `data-pi-chat-aside` |
| `empty` | Empty-state screen | `data-pi-ext-empty` |
| `footer` | Footer | — |
| `promptInput` | Prompt input decoration layer | `data-pi-ext-prompt-input` |
| `accessoryAboveEditor` / `accessoryBelowEditor` | Above/below the prompt input | `data-pi-ext-accessory-above/below` |
| `accessoryInlineLeft` / `accessoryInlineRight` | Inline left/right of the prompt input | `data-pi-ext-accessory-inline-left/right` |
| `toolbar` | Toolbar | `data-pi-ext-toolbar` |
| `notifications` | Notifications layer | `data-pi-ext-notifications` |
| `statusBar` | Status bar | `data-pi-ext-status-bar` |
| `artifactSurface` | Artifact standalone surface | `data-pi-ext-artifact-surface` |
| `dialogLayer` | Dialog layer (`z-[60]`, does not intercept kernel interaction) | `data-pi-ext-dialog-layer` |
| `logs` | Logs panel surface (introduced by the logging system) | `data-pi-ext-logs` |
| `launcherRail` | Contribution slot inside the sidebar launcher rail (introduced by sidebar-launcher-rail; host renders it via `SlotHost` with `ExtErrorBoundary` isolation) | `data-launcher-webext-slot` |

**Slot semantics**: extension content is mounted additively, not replacing kernel surfaces. When the host has not declared the corresponding slot, it is ignored without error (Req 2.3). `launcherRail` is reachable only when the sidebar launcher rail is enabled (`NEXT_PUBLIC_PI_WEB_LAUNCHER_RAIL=1`); when no extension contributes, the rail does not reserve space for the slot.

### The isolate Pitfall of the background Slot

`background` renders at `absolute inset-0 -z-10`. The host uses Tailwind `isolate` to establish an independent stacking context for the chat main column (`packages/ui/src/chat/pi-chat.tsx:940`), confining the negative z-index within this column—**rather than escaping to the root context and being covered by the app-shell's opaque base**.

```tsx
// pi-chat.tsx:940 (host implementation detail, extension authors need not change it)
<div className="relative isolate flex min-w-0 flex-1 flex-col">
  {backgroundLayer}
  …
</div>
```

---

## Tier 2: Custom Renderers (per-session Registry)

> **Matching runnable example**: `examples/webext-renderer-agent`—registers both an `echo` tool-card renderer (`EchoToolRenderer`) and a `data-metric` data-part renderer (`MetricRenderer`), and registers a companion `echo` customTool in the agent's `index.ts` to drive the trigger (see `examples/webext-renderer-agent/.pi/web/web.config.tsx:1`).

The renderer registry is instantiated per-session, with the extension ID as a namespace prefix, so multiple extensions never override each other.

### Registering a Renderer

```tsx
export default defineWebExtension({
  manifestId: "webext-renderer",
  capabilities: ["renderers"],
  renderers: {
    tools: {
      // replaces the default tool card when a `tool-echo` part is matched
      echo: EchoToolRenderer,
    },
    dataParts: {
      // triggered when a `data-metric` data-part is matched
      "data-metric": MetricRenderer,
    },
  },
});
```

The renderer props are isomorphic with the host registry:

```typescript
type ToolRenderer = ComponentType<{ part: AnyPart; message: UIMessage }>;
type DataPartRenderer = ComponentType<{ part: AnyPart; message: UIMessage }>;
```

### Triggering During Development

In a real dev environment (without `PI_WEB_STUB_AGENT=1`), the host will **not** automatically emit `echo` or `data-metric` parts—the LLM has to actually call the corresponding tool (or you use stub mode) to trigger the custom renderer.

- **stub trigger**: with `PI_WEB_STUB_AGENT=1`, the offline stub agent emits an `echo` tool call every turn, letting you verify the renderer without an LLM.
- **real LLM trigger**: the agent's `index.ts` registers an `echo` customTool, requiring the LLM to call it when the user requests an echo.

---

## Tier 3: Contribution Points and UI↔Agent RPC

> **Matching runnable example**: `examples/webext-contrib-agent`—the full set of slash command, @mention, autocomplete, inlineComplete, and keybindings contribution points, all routed back to the agent over the `ui-rpc` bus for handling (see `examples/webext-contrib-agent/.pi/web/web.config.tsx:1`).

### RPC Bus Architecture

```
Browser extension
  │  rpc.request({ point: "slash", action: "list", payload: { query } })
  ▼
UiRpcBus (packages/react/src/web-ext/ui-rpc-bus.ts)
  │  POST /sessions/:id/ui-rpc  → { correlationId, point, action, payload, protocolVersion }
  ▼
server command-routes.ts → session.uiRpc()
  │  → agent process handles it → returns result
  ▼
SSE control frame: { control: "ui-rpc", response: { correlationId, ok, result } }
  │
UiRpcBus pairs by correlationId → resolves the Promise
```

The timeout defaults to **15000 ms** and supports cancellation via `AbortSignal`. Failures are returned as `{ ok: false, error }`—they neither throw nor crash the session.

### Registering Contribution Points

```tsx
import { defineWebExtension, type UiRpcClient } from "@blksails/pi-web-kit";

export default defineWebExtension({
  manifestId: "webext-contrib",
  capabilities: ["contributions"],
  contributions: {
    slash: {
      async list(query: string, rpc: UiRpcClient) {
        const res = await rpc.request({ point: "slash", action: "list", payload: { query } });
        return (res.ok ? res.result : []) as Array<{ id: string; title: string }>;
      },
      async execute(id: string, rpc: UiRpcClient) {
        await rpc.request({ point: "slash", action: "execute", payload: { id } });
      },
    },
    mention: {
      trigger: "@",
      async query(q: string, rpc: UiRpcClient) {
        const res = await rpc.request({ point: "mention", action: "resolve", payload: { q } });
        return (res.ok ? res.result : []) as Array<{ id: string; label: string }>;
      },
    },
    keybindings: [{ combo: "Mod+k", commandId: "deploy" }],
  },
});
```

### Idle Control Stream (openControlOnlyStream)

**Key behavior**: when a contribution point routes back to the agent over ui-rpc, it needs to receive the SSE `control` downstream frame to pair the response. But the per-prompt message stream only opens when the user sends a message. Therefore:

- When an extension declares `contributions` (`hasContributions = true`) **and the session is idle** (`!isBusy`), the host automatically opens an `openControlOnlyStream` connection dedicated to receiving ui-rpc responses.
- It is opened only when `hasContributions && !isBusy` both hold; it is closed during prompt-stream transmission (the per-prompt stream handles control frames), **avoiding concurrency conflicts** (`packages/ui/src/chat/pi-chat.tsx:406-410`).

```typescript
// pi-chat.tsx:400-410 (host logic)
const hasContributions = extension?.contributions !== undefined;
const hasArtifactRpc =
  extension?.artifact !== undefined && extensionBaseUrl !== undefined;
const needsIdleControl = hasContributions || hasArtifactRpc;
React.useEffect(() => {
  if (connection === undefined || isBusy || !needsIdleControl) return;
  return connection.openControlOnlyStream();
}, [connection, isBusy, needsIdleControl]);
```

---

## Tier 4: Artifact Isolated Surface

> **Matching runnable example**: `examples/webext-artifact-agent`—declares `artifact.entry`, and the host loads `artifact.html` in a `sandbox="allow-scripts"` iframe, completing bidirectional resize / rpc communication over postMessage (see `examples/webext-artifact-agent/.pi/web/web.config.tsx:1`). Running it requires setting `NEXT_PUBLIC_PI_EXTENSION_BASE_URL`; see the "Gating" subsection below.

### How It Works

1. The extension declares `artifact.entry` in its descriptor (a path relative to `.pi/web/dist/`).
2. The host loads it with `<ArtifactSurface src="…" sandbox="allow-scripts">` (**without** `allow-same-origin`); the iframe gets an opaque origin and cannot access the host's cookies/DOM/credentials.
3. Bidirectional communication goes over postMessage, with the message structure constrained by the `ArtifactMessage` type from `@blksails/pi-web-protocol`:

```typescript
type ArtifactMessage =
  | { kind: "ready"; manifestId: string }
  | { kind: "resize"; height: number }
  | { kind: "rpc"; request: UiRpcRequest }   // artifact → host relays back to agent
  | { kind: "event"; name: string; data: unknown }; // host → artifact push
```

Messages from an illegal origin or with an illegal structure are **dropped outright** (Req 5.4).

### Configuring the artifact (web.config.tsx)

```tsx
export default defineWebExtension({
  manifestId: "webext-artifact",
  capabilities: ["artifact"],
  artifact: {
    entry: "artifact.html",
    initialHeight: 240,
  },
});
```

### Gating: NEXT_PUBLIC_PI_EXTENSION_BASE_URL

The `src` of `ArtifactSurface` is composed of `extensionBaseUrl + artifact.entry`. **If the `NEXT_PUBLIC_PI_EXTENSION_BASE_URL` environment variable is not configured, `ArtifactSurface` will not mount**—this is correct gating behavior, not a bug (`components/chat-app.tsx:375-377`).

```bash
# .env.local
# dev: when the webext and the main app are same-origin, just use the dev address
NEXT_PUBLIC_PI_EXTENSION_BASE_URL=http://localhost:3000
# prod: point at the origin that independently hosts the artifact assets (consistent with the troubleshooting steps, see ./18-troubleshooting-faq.md section 3.1)
# NEXT_PUBLIC_PI_EXTENSION_BASE_URL=https://ext.example.com
```

After setting it, restart dev (`NEXT_PUBLIC_*` is injected at build/startup time; editing `.env.local` at runtime does not hot-reload). If the iframe still does not appear, verify against [18 · Troubleshooting FAQ](./18-troubleshooting-faq.md) section 3.1.

---

## Tier 5: Pure Declarative Config

> **Matching runnable example**: `examples/webext-declarative-agent`—zero code, zero bundle, just a single hand-written `.pi/web/manifest.json` (a purple `theme` token + `layout: "wide"` + `empty` state copy and starters); the host synthesizes the descriptor directly (see `examples/webext-declarative-agent/.pi/web/manifest.json:1`).

No bundle is needed—declare it directly in the `config` field of `manifest.json`:

| Field | Type | Description |
|-------|------|-------------|
| `documentTitle` | string | Syncs `document.title` after loading this source; restored when switching sources |
| `layout` | `"centered"` \| `"wide"` \| `"full"` \| `"split"` | Layout preset (host `LayoutPreset`, see `packages/ui/src/customization/layout.ts:8`) |
| `panelRatio` | `"centered"` \| `"2:1"` \| `"3:7"` | Initial right-panel ratio, a closed enum (`packages/protocol/src/web-ext/config.ts:23`, requires `slots.panelRight`) |
| `theme` | `Record<string, string>` | CSS variable overrides (host token prefix) |
| `empty.title/subtitle` | string | Empty-state screen copy |
| `empty.starters` | array | List of suggestion items |
| `empty.mergeCommands` | `"prepend"` \| `"append"` \| `"replace"` | Merge strategy with the agent's slash commands |

**Note on `config.layout="split"`**: when the `split` layout is declared but no content is provided in `slots.panelRight`, the host does not render an empty `<aside>` placeholder, gracefully degrading to a centered layout (`pi-chat.tsx:1058-1062`). An earlier version used to leave a 384px blank side region; this has been fixed.

---

## Security Fences

### Gating Flow

1. **SRI integrity**: recompute the sha384 of the entry bytes and compare against `manifest.integrity`.
2. **Signature allowlist**: verify with HMAC-SHA256 using the keys in `PI_WEB_EXT_WHITELIST` (a single match means trusted).
3. **Version compatibility**: `manifest.targetApiVersion` (a semver range) must be compatible with the host's `PI_WEB_KIT_VERSION` (default `0.1.0`).

Any verification failure → loading is rejected, the UI falls back to default, and an audit log is recorded.

### Related Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PI_WEB_EXT_WHITELIST` | Comma-separated trusted HMAC keys | `""` |
| `PI_WEB_EXT_REQUIRE_SIGNATURE` | Whether to enforce signatures (`"false"` disables) | `"true"` |
| `PI_WEB_KIT_VERSION` | Host web-kit version, used for version-compatibility judgment | `"0.1.0"` |
| `NEXT_PUBLIC_PI_EXTENSION_BASE_URL` | Base URL for the artifact surface (absent → no mount) | — |

### CSS Scoping

`pi-web build` rewrites all class selectors to `.pw-<extId>-<original class name>` (`packages/web-kit/build/css-scope-plugin.ts`), rejects global selectors such as `*`/`html`/`body`/`:root`/top-level bare tags, Tailwind preflight, and `@layer base`, namespaces `@keyframes`/`@font-face`, and requires custom CSS variables to start with `--pw-<extId>-` (host tokens are read-only and cannot be overridden), preventing style cross-contamination between extensions.

---

## Loading Flow (Runtime)

```
Selected agent source → host reads .pi/web/dist/manifest.json
  │
  ├─ isDeclarativeOnly(manifest)?
  │    yes → verify version only, synthesize descriptor from manifest.config (Tier 5, zero bundle)
  │    no  → fetch entry bytes → SRI + signature + version verification
  │            ↓ passed
  │         inject import map (react/react-dom/@blksails/pi-web-kit → host singleton URL)
  │         dynamic import(entryUrl) → take the default export WebExtension descriptor
  │
  ▼
applyExtension: merge slots / per-session registry / contributions / config
  │
  ▼
PiChat renders: slots mount, renderers take effect, contributions register, artifact iframe mounts
```

The import map is injected statically into `<head>`, ensuring that a bare `import "react"` inside an extension resolves to the host's already-loaded singleton, avoiding hook conflicts.

---

## Example Index (examples/)

Every tier of the five-tier model has a directly runnable example. The table below is a quick lookup by **Tier → example**; for how the host loads them, see "End to End: Running an Extension from Scratch" above:

| Tier | Capability | Matching example |
|------|------------|------------------|
| Tier 1 | Region slots | `examples/webext-layout-agent`, `examples/webext-slots-agent`, `examples/webext-background-agent` |
| Tier 2 | Custom renderers | `examples/webext-renderer-agent` |
| Tier 3 | Contributions + RPC | `examples/webext-contrib-agent` |
| Tier 4 | Artifact iframe | `examples/webext-artifact-agent` |
| Tier 5 | Pure declarative config | `examples/webext-declarative-agent` |

Details for each example:

| Directory | Tier | Description |
|-----------|------|-------------|
| `examples/webext-declarative-agent/` | Tier 5 | Purple theme, wide layout, empty-state copy, pure `manifest.json`, zero bundle |
| `examples/webext-layout-agent/` | Tier 1 | `panelRight` (domain-inspection panel) + the three header zones + `panelRatio: "3:7"` |
| `examples/webext-background-agent/` | Tier 1 | `background` slot, animated aurora background, self-namespaced class names |
| `examples/webext-slots-agent/` | Tier 1+5 | 18-region-slot fixture (the full set of the protocol's 19 slots except `logs`) + empty-state declarative-config acceptance |
| `examples/webext-renderer-agent/` | Tier 2 | Custom `echo` tool card (`EchoToolRenderer`) + `data-metric` data-part renderer |
| `examples/webext-contrib-agent/` | Tier 3 | Full set of slash command, @mention, autocomplete, inlineComplete, keybindings, routed back to the agent over ui-rpc |
| `examples/webext-artifact-agent/` | Tier 4 | `artifact.html` sandbox iframe, postMessage resize/rpc communication |

> For the full index of all examples (including non-webext ones), see [`examples/README.md`](https://github.com/blksails/pi-web/blob/main/examples/README.md).

E2E test entry points: `e2e/browser/webext.e2e.ts`, `webext-full.e2e.ts`, `webext-document-title.e2e.ts` (all use the offline stub via `PI_WEB_STUB_AGENT=1`).

---

## FAQ

**Q: Why doesn't the Artifact iframe appear?**
A: Check whether `NEXT_PUBLIC_PI_EXTENSION_BASE_URL` is set. When it is not, the host does not mount `ArtifactSurface`—this is correct gating, not a bug (`components/chat-app.tsx:375`).

**Q: The renderer isn't triggering?**
A: In a real dev environment, the host only invokes a custom renderer when it receives a matching tool/data-part. Start with `PI_WEB_STUB_AGENT=1` to drive the `echo` tool trigger, or have the LLM agent actually call the corresponding tool.

**Q: `config.layout="split"` but the right side is blank?**
A: `split` only declares layout intent; you must also provide an actual component in `slots.panelRight`. Otherwise the host does not render the aside container and automatically degrades to a centered layout (`pi-chat.tsx:1058`).

**Q: No response after triggering slash/mention?**
A: Confirm that the extension declares `capabilities: ["contributions"]` and that the session is **idle** (`!isBusy`)—during prompt sending the per-prompt stream takes over and the idle control stream is paused.

---

## Next Steps / Related Chapters

- Extension and skill installation management → [09 · Extensions & Skills](./09-extensions-and-skills.md)
- Declarative Config UI and dynamic widgets → [12 · Config UI](./12-config-ui.md)
- AIGC image generation tools (used together with the artifact surface) → [11 · AIGC Tools](./11-aigc-tools.md)
- Running the browser e2e isolated build → [17 · Development & Testing](./17-development-and-testing.md)
- The `POST /sessions/:id/ui-rpc` endpoint → [13 · HTTP API Reference](./13-http-api-reference.md)
