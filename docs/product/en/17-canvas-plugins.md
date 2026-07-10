# 17 · Canvas Plugin Development

> Add **layers, tools, and generation actions** to the Canvas workbench with a single extension — no host source changes required. This chapter is written for **plugin authors**. It follows the canonical example [`examples/canvas-plugin-stickers`](../../examples/canvas-plugin-stickers/) as its main thread, walking through the `defineCanvasLayer` / `defineCanvasTool` / `defineCanvasAction` trio, the namespace prefixing and topological validation of `registerPluginBundles`, wiring across the frontend and agent ends, and the disabled-state semantics when a dependency is missing.

The Canvas workbench itself — from the perspective of **users and integrators** (editor interactions, the six generation actions, the gallery, the `NEXT_PUBLIC_PI_WEB_CANVAS` gate) — is covered in [16 Canvas Workbench](./16-canvas-workbench.md). This chapter is strictly about "how to write plugins for it."

## 17.1 Mental Model: One Extension, Two Plugin Lanes

Canvas's extensibility surface is carried by an independently published L2 developer-facing package, **`@blksails/pi-web-canvas-kit`**. Its public exports expose only the declarative API and types; the L1 interaction kernel (stage/pointer/history/layers/tool-runtime under `kernel/`) is deliberately **not exported** (see the export-discipline comment at `packages/canvas-kit/src/index.ts:5-13`). As a plugin author, you only ever deal with the trio + plugin bundle + the assembly facade.

A Canvas plugin typically spans two ends:

| End | What it contributes | Declaration entry point |
| --- | --- | --- |
| **Frontend plugin bundle** | Layers (how to render/bake/edit), tools (tool-rail button + click-to-place), actions (generation decision candidates) | `defineWebExtension({ canvasPlugins:[bundle] })` |
| **Agent-side command** | The handler an action targets when it runs over the "command channel" + a capability allowlist entry | `makeCanvasSurfaceExtension({ commandDeps.extraCommands, extraActions })` |

A pure-frontend plugin (such as an emoji sticker layer) can contribute the frontend bundle alone and never touch the agent. But an action like "style transfer" that needs to persist to the store and call a generation model declares the action on the frontend while the agent side provides the command implementation — executed over Canvas's **command channel**, **bypassing the LLM**. The command channel is built on top of [04 Surface Authoritative Stack](./04-surface-stack.md) (`domain = canvas`); this chapter treats it as existing infrastructure and references it as such.

## 17.2 The Trio Contract

All three declarative definition functions are **identity functions + type narrowing** — they exist only so TypeScript can annotate your intent; they have zero runtime side effects. All are imported from `@blksails/pi-web-canvas-kit`:

```ts
import { defineCanvasLayer, defineCanvasTool, defineCanvasAction } from "@blksails/pi-web-canvas-kit";
import type { ActionInput, CanvasPluginBundle } from "@blksails/pi-web-canvas-kit";
```

### 17.2.1 Layers: `defineCanvasLayer<D>`

Declares a custom layer type: how it renders, how it bakes, and how it is edited in the inspector. The signature is at `packages/canvas-kit/src/layers-plugin.ts:36-51`.

```ts
// from examples/canvas-plugin-stickers/.pi/web/stickers.tsx:39
const stickerLayer = defineCanvasLayer<StickerData>({
  type: "sticker",                                   // after prefixing = "canvas-plugin-stickers:sticker"
  Render: ({ layer, scale }) => (                    // rendered on the stage at the layer's position, scaled by viewport scale
    <span style={{ fontSize: `${data.size * scale}px` }}>{data.emoji}</span>
  ),
  bake: (ctx2d, layer, size) => {                    // on flatten, bake the content into the 2D context (may be async, e.g. font loading)
    ctx2d.font = `${data.size}px serif`;
    ctx2d.fillText(data.emoji, 0, size.h);
  },
  Inspector: ({ layer, update }) => (                // edit while selected; update takes the [complete new data object] into the unified undo stack
    <input type="range" onChange={(e) => update({ ...data, size: Number(e.target.value) })} />
  ),
});
```

The contract for the three members (`layers-plugin.ts:39-47`):

- **`Render({ layer, scale })`** — a React component type, rendered on the stage and scaled by the viewport `scale`.
- **`bake(ctx2d, layer, size)`** — the flatten callback that bakes the layer's content into the 2D context; returns `void | Promise<void>`, so it may be async.
- **`Inspector?({ layer, update })`** — an optional inspector component; `update` receives the **complete new data object**, so a single edit is a single undo-stack entry.

The generic `D` is a purely declaration-time documentary parameter (phantom): at the contract boundary the `update` payload is typed `unknown`, and it's narrowed by the plugin itself at runtime (`layers-plugin.ts:16-20`). Existing image layers (a `WorkLayer` with no `kind`) behave identically — a layer with no registered type declaration renders/bakes exactly as before.

### 17.2.2 Tools: `defineCanvasTool`

Declares a tool-rail button and its gesture behavior. The signature and full list of optional fields are at `packages/canvas-kit/src/registry.ts:121-160`. The sticker tool uses only the "click-to-place" declarative seam:

```ts
// from stickers.tsx:101
const stickerTool = defineCanvasTool({
  id: "sticker",                                     // after prefixing = "canvas-plugin-stickers:sticker"
  label: "Sticker",
  icon: "🌟",
  overlayInteractive: true,                          // the gesture surface takes over overlay hit-testing
  createLayer: { kind: "sticker", data: { emoji: "🌟", size: 64 } },
});
```

`createLayer` (`registry.ts:134-141`) is the declarative "click-to-place": while the tool is active, a press on the stage places a plugin layer of that `kind` (with `data` as the initial private data). **Key encapsulation line**: the tool context `ctx.layers` is a **read-only** surface (`registry.ts:113`, `CanvasToolContext.layers: LayersReadApi`); the placement write path belongs to the assembly layer — **do not** call `ctx.layers.add` from inside a tool. `createLayer` is the intent-passing channel from tool → assembly layer.

Tools that need to draw their own gestures can additionally implement `onDown/onMove/onUp` (which receive a semantic `ToolGestureEvent` already converted to base-image pixels, `registry.ts:81-95`), `rasterizeDraft` (live overlay preview), and `optionsBar` / `overlayReact` (options bar / DOM overlay). Tools do zero DOM listening, zero viewport math, and zero stack management — those capabilities are handed off by the L1 kernel through the context.

### 17.2.3 Actions: `defineCanvasAction`

Actions participate in the **scored decision** of the Canvas generation bar: when they apply (`match`), how their arguments are built (`buildArgs`), and which execution channel they take (`execution`). The signature is at `packages/canvas-kit/src/actions.ts:59-72`.

```ts
// from stickers.tsx:114
const styleTransferAction = defineCanvasAction({
  id: "style-transfer",                              // after prefixing = "canvas-plugin-stickers:style-transfer"
  label: "Style Transfer",
  match: (input: ActionInput) =>
    input.referenceIds.length === 1 &&
    input.prompt.startsWith("style:") &&
    input.capability.actions.includes("style_transfer")   // allowlist yielding (degradation-safe)
      ? 85
      : false,
  buildArgs: (input) => ({
    image: input.imageId,
    style_ref: input.referenceIds[0],
    ...(input.model !== "" ? { model: input.model } : {}),
  }),
  execution: { via: "command", command: "style_transfer" },   // the command name is [NOT] prefixed
});
```

Key contract points:

- **`match(input): number | false`** — a pure function; `false` means "does not apply," a higher number means higher priority, and ties go to the earlier-registered action (`actions.ts:62-63`). The `ActionInput` fields are at `actions.ts:40-50` (imageId/prompt/model/size/variants/hasMask/hasExpand/referenceIds/capability).
- **`buildArgs(input)`** — a pure function that builds the command/op arguments; it carries no binaries — the `att_` assets are appended by the caller during orchestration.
- **`execution`** — one of two:
  - `{ via: "prompt", buildOp(args, input) }` — assemble an op that runs over the conversation stream (prompt) channel;
  - `{ via: "command", command }` — run over the command channel; the `command` name **must appear in the `capability.actions` allowlist**, otherwise the `resolveAction` decision maker excludes it upfront (`actions.ts:100-123`: an action with `via:"command"` whose `command ∉ input.capability.actions` is culled before `match` is even called, `actions.ts:110`).

The example uses `capability.actions.includes("style_transfer")` to yield explicitly inside `match`: for any source that isn't this example (and hasn't declared the action), the capability allowlist has no `style_transfer`, the action drops out of the decision, and Canvas degrades as usual. This is the plugin's **degradation-safe** pattern.

## 17.3 Plugin Bundle: `CanvasPluginBundle`

Once the trio is declared, it's packed into a single plugin bundle and registered together. The bundle structure is at `packages/canvas-kit/src/layers-plugin.ts:70-76`:

```ts
// from stickers.tsx:135
export const stickersBundle: CanvasPluginBundle = {
  id: "stickers",
  requires: ["canvas-plugin-stickers:sticker"],   // dependency names use the [already-prefixed] global name (the author writes the full name)
  tools: [stickerTool],
  layers: [stickerLayer],
  actions: [styleTransferAction],
};
```

- **`id`** — the bundle identifier, used for diagnostic attribution.
- **`requires?`** — the layer types / op kinds this bundle depends on, written as the **already-prefixed global name** (it is not auto-prefixed, `layers-plugin.ts:72`). The example declares a dependency on its own bundled `canvas-plugin-stickers:sticker` layer type.
- **`tools` / `layers` / `actions`** — the trio collections.

## 17.4 `registerPluginBundles`: Namespace Prefixing + Topological Validation

The assembly layer uses `registerPluginBundles(registry, bundles, { namespace })` to wire bundles into the per-instance registry. The implementation is at `packages/canvas-kit/src/layers-plugin.ts:95-167`. As a plugin author you don't call it yourself (assembly is handled for you by the Canvas workbench, see 17.5), but you must understand its two rules:

### Namespace Prefixing

When `namespace` is present, the `id` / `type` of the bundle's `tools` / `layers` / `actions`, as well as `createLayer.kind`, all get a uniform `<namespace>:` prefix (`layers-plugin.ts:100-128`). **You write the local name, the system adds the prefix**:

| What you write in the bundle | After prefixing (namespace = `canvas-plugin-stickers`) |
| --- | --- |
| layer `type: "sticker"` | `canvas-plugin-stickers:sticker` |
| tool `id: "sticker"` + `createLayer.kind: "sticker"` | both become `canvas-plugin-stickers:sticker`, matching consistently |
| action `id: "style-transfer"` | `canvas-plugin-stickers:style-transfer` |

Two **exceptions** where the author must write the global/original name:

1. **`requires`** — not prefixed; write the already-prefixed global name (hence the example writes `"canvas-plugin-stickers:sticker"`).
2. **`execution.command`** — the command name is not prefixed (`layers-plugin.ts:105-106` and the example's comment); it must be **byte-for-byte identical** to the agent-side `extraCommands` key and the `capability.actions` allowlist entry (all three are `"style_transfer"` in the example).

### `requires` Topological Validation and Disabled-State Semantics

The registration order is: first register all bundles' `layers`, then build the available dependency set (= registered layer types ∪ built-in op kinds `stroke`/`anno` ∪ each bundle's own layers' types, `layers-plugin.ts:138-140`), then validate each bundle's `requires` in turn (`layers-plugin.ts:143-158`):

- **All dependencies satisfied** → register that bundle's `tools` and `actions` (wired in normally).
- **A dependency is missing** → the bundle's `tools` are **still registered into the tool rail but recorded as disabled** (`registerDisabledPluginTool`, `registry.ts:295-299`): grayed out in the UI + a tooltip showing the missing item; its `actions` are **not registered** (they don't participate in the decision); its `layers` were already registered in the previous step (the render contract exists, only the tool that creates it is missing). A `kind:"plugin"` diagnostic is appended at the same time.

In other words, **a missing dependency doesn't make the plugin vanish or crash — it degrades gracefully to a grayed-out tool + a diagnostic**. Conflicts on the same `id`/`type` are rejected by the underlying `registerTool`/`registerLayer`/`registerAction` (the first registrant wins, the later one is rejected with a diagnostic, `registry.ts:235-294`), and built-ins are never overwritten.

## 17.5 Wiring Across Both Ends

### Frontend: Lane ① `canvasPlugins`

The frontend plugin bundle is declared through the `canvasPlugins` field of `defineWebExtension` (`packages/web-kit/src/define-web-extension.ts:112`). The example's UI extension config:

```tsx
// examples/canvas-plugin-stickers/.pi/web/web.config.tsx:16
import { defineWebExtension } from "@blksails/pi-web-kit";
import { CanvasLauncher, CanvasPanel, AigcQuickSettings } from "@blksails/pi-web-canvas-ui";
import { stickersBundle } from "./stickers";

export default defineWebExtension({
  manifestId: "canvas-plugin-stickers",
  capabilities: ["slots"],
  config: { panelRatio: "4:6", logsPanelPosition: "bottom" },
  slots: {
    launcherRail: CanvasLauncher as never,
    panelRight: CanvasPanel as never,
    promptToolbar: AigcQuickSettings as never,
  },
  canvasPlugins: [stickersBundle],   // lane ①: the source ships its own canvas plugin bundle
});
```

The wiring path (the host is Canvas-domain-neutral — it only conveys, never parses):

1. The host (pi-chat) hands the entire loaded-extension descriptor to `CanvasPanel` via SlotHost.
2. `collectCanvasPluginBundles(extensions)` (`packages/canvas-ui/src/plugin-aggregation.ts:38-51`) extracts each extension's `canvasPlugins`, attaching its source namespace `namespace = manifestId`; extensions with no declaration or an empty array are dropped.
3. After registering the built-in tools/actions, `CanvasWorkbench` calls `registerPluginBundles(k.registry, bundles, { namespace })` per source (`packages/canvas-ui/src/canvas-workbench.tsx:643-644`), applying the prefix + topological validation.

So your `manifestId` is the namespace — the example's `manifestId: "canvas-plugin-stickers"` determines the prefix `canvas-plugin-stickers:`.

> Beyond lane ① (source-bundled), installed webext packages are consumed over the same path in the same `defineWebExtension` shape (lane ②), with no difference in how the plugin author writes them.

### Agent Side: The Command-Channel Handler

When an action runs over `via:"command"`, the agent side must provide a same-named command implementation and add the command name to the capability allowlist. Use `makeCanvasSurfaceExtension`'s `commandDeps.extraCommands` and `extraActions` (`packages/tool-kit/src/aigc/canvas/extension.ts:62-84`):

```ts
// examples/canvas-plugin-stickers/index.ts:99
import { aigcExtension, makeCanvasSurfaceExtension } from "@blksails/pi-web-tool-kit/runtime";

extensions: [
  aigcExtension,
  (pi) => {
    makeCanvasSurfaceExtension({
      commandDeps: { extraCommands: { style_transfer: styleTransfer } },  // command handler
      extraActions: ["style_transfer"],                                    // merged into the capability.actions allowlist
    })(pi);
  },
],
```

- `extraCommands` (`commands.ts:54`) injects the command handler, merged with the six built-in Tier-A commands (`commands.ts:252`).
- `extraActions` (`capability.ts:57,74-77`) is merged into the capability's `actions` allowlist in first-seen order (after the six Tier-A commands, deduplicated and order-preserving). The frontend `resolveAction` relies on exactly this allowlist to admit or yield command actions, forming a **two-ended, consistent allowlist loop**.

The example's `style_transfer` command doesn't reinvent lineage/persistence orchestration — it **reuses the built-in `reference` command** (`createCanvasCommands()`) to run `runImageTool` and persist (`index.ts:52,72-84`). Plugin authors should prefer reusing built-in commands over rewriting the generation/persistence chain.

## 17.6 Getting Started: Running the Sticker Plugin

The example is a directly selectable agent source. Prerequisite: dependencies installed per [01 Quickstart](./01-quickstart.md).

1. **Enable the Canvas gate** (off by default). The Canvas workbench is gated by `NEXT_PUBLIC_PI_WEB_CANVAS`; set it to `true`/`1` to enable:

   ```bash
   NEXT_PUBLIC_PI_WEB_CANVAS=1 pnpm dev
   ```

   `pnpm dev` concurrently brings up the API (`:3000`) and the Vite dev server (`:5173`). **Expected**: the terminal shows both processes ready. Gate details are in [16 Canvas Workbench](./16-canvas-workbench.md) and [06 Configuration](./06-configuration.md).

2. **Open the frontend and pick a source**. Open `http://localhost:5173` in the browser (`/api` is proxied by Vite to 3000), and on the source-picker page select **"Canvas Plugin · Stickers"** (the `pi-web.title` in `examples/canvas-plugin-stickers/package.json`). **Expected**: you enter the conversation/Canvas split layout (default 40% conversation / 60% Canvas).

3. **Verify the frontend plugin bundle is live**. Expand the Canvas workbench's tool rail. **Expected**: beyond the built-in drawing tools, a 🌟 "Sticker" tool appears. Select it and press on the stage — a placed emoji sticker layer appears; select that layer and the right-side inspector shows an emoji palette + a size slider (DOM anchors `data-sticker-emoji-pick` / `data-sticker-size-range`, see `stickers.tsx:74,86`).

4. **Verify the command-channel action (both ends)**. First have the agent generate or upload an image into the gallery, then drag in a reference image; in the generation bar type a prompt starting with `style:`. **Expected**: because the agent side declared `extraActions:["style_transfer"]`, the capability allowlist contains the action, so with exactly one reference image the "Style Transfer" action matches at 85 points, executes over the command channel (bypassing the LLM), and the result is persisted. If you switch to a source that hasn't declared `style_transfer`, the action drops out of the decision and Canvas degrades as usual (degradation-safe).

5. **Verify the disabled-state semantics (optional)**. If you change `stickersBundle.requires` to a nonexistent type (e.g. `["canvas-plugin-stickers:missing"]`) and rerun, the sticker tool still appears in the tool rail but is **grayed out**, with a tooltip showing the missing dependency; the sticker action is not registered. This is exactly the degradation path described in 17.4.

## 17.7 The L1 Interaction Kernel (`createCanvasKernel`)

The plugin-author surface above is **L2**. Beneath it is the **L1 interaction kernel**: the per-instance assembly of the stage viewport / pointer routing / edit history / layer tree / tool runtime, funneled by `createCanvasKernel(env)` into a **single assembly API** (`packages/canvas-kit/src/kernel-facade.ts:146`). The `CanvasKernel` it returns exposes `stage` / `history` / `opBehaviors` / `layers` / `registry` / `prefs` / `tools` / `pointer` / `renderOverlay` (`kernel-facade.ts:113-143`).

The Canvas workbench itself is assembled exactly this way (`canvas-workbench.tsx:624-645`): `createCanvasKernel({...})` → `registerBuiltinTools(k.registry)` → `registerBuiltinGenerateActions(k.registry)` → `registerPluginBundles` per source. **Multiple canvas instances don't interfere with each other** — both the registry and the kernel are per-instance (`registry.ts:223`, `kernel-facade.ts:113`).

As a plugin author, you normally **don't call `createCanvasKernel` directly** — it's the assembly facade for integrators/hosts. It's called out here to make the encapsulation discipline explicit:

> The internal parts under `kernel/` (stage/pointer/history/layers/tool-runtime) are **not in the public exports** (`packages/canvas-kit/src/index.ts:5-13`). L1 can be freely refactored without constituting a breaking change; plugins depend only on the semver-committed surface of L2's `define*` / types / the `createCanvasKernel` facade. Reverse dependencies are forbidden (canvas-kit has zero `@blksails/*` runtime dependencies).

Only when you want to **embed a canvas independent of the Canvas workbench** (building your own host rather than writing a source plugin) will you consume `createCanvasKernel` directly. In that case you inject a `CanvasKernelEnv` (`getRect` / `getNaturalSize` / `capturePointer` / `initialPrefs`, `kernel-facade.ts:76-93`), implementing the DOM-measurement and pointer-capture seams yourself; the kernel itself has zero DOM dependencies.

## Related

- [16 Canvas Workbench](./16-canvas-workbench.md) — the user/integrator view: editor interactions, the six generation actions, the gallery, and the `NEXT_PUBLIC_PI_WEB_CANVAS` gate.
- [04 Surface Authoritative Stack](./04-surface-stack.md) — the CQRS communication infrastructure the command channel (`domain = canvas`) is built on.
- [12 Web UI Extension](./12-web-ui-extension.md) — `defineWebExtension`, the slot model, and the host mechanics of the `canvasPlugins` lane.
- [05 Packages](./05-packages.md) — where `@blksails/pi-web-canvas-kit` / `-canvas-ui` sit in the 11-package system and their dependency direction.
- [06 Configuration](./06-configuration.md) — the `NEXT_PUBLIC_PI_WEB_CANVAS` gate and related environment variables.
- [11 AIGC and Vision Tools](./11-aigc-and-vision-tools.md) — the built-in `reference` and other generation commands and `runImageTool` (the persistence chain plugin commands commonly reuse).
- Hit a snag? See [23 Troubleshooting / FAQ](./23-troubleshooting-faq.md).
