# 16 · Canvas Workbench

**The Canvas Workbench aggregates the AIGC-generated images that would otherwise be scattered across tool cards in the conversation stream into a single rich-interaction application surface — a "gallery + re-creation canvas editor".** It is built on top of the [04 Surface Authoritative Surface Stack](./04-surface-stack.md) — a CQRS projection with `domain="canvas"`: the authoritative gallery state lives in the agent subprocess (the gallery is a materialized view of the attachment store), while the frontend does nothing but read a thin projection of the snapshot and send commands upstream. This chapter is for **users and integrators** (wiring Canvas into your own agent source); the plugin-author perspective (custom layers/tools/actions) lives in [17 Canvas Plugin Development](./17-canvas-plugins.md).

Canvas is provided by the independently published `@blksails/pi-web-canvas-ui` (the component layer) plus `@blksails/pi-web-canvas-kit` (the interaction kernel, see chapter 17); both are registered in [05 Layered Packages](./05-packages.md).

---

## What it solves

When you generate images with an AIGC agent, the images land one by one in the conversation stream as tool cards — so wanting to revisit the third image, re-create from it, or compare two variants all means scrolling up and down through the chat history. The Canvas Workbench **aggregates these images into a persistent creation surface**:

- **Gallery** (`CanvasGallery`): collects every image attachment in the current session into a grid, with density switching, pagination, time/lineage grouping, and streaming preview of the current turn (blurry-to-sharp as it generates).
- **Workbench** (`CanvasWorkbench`): open an image to enter the canvas editor — stage zoom/pan, mask/annotation overlays, a version rail, a bottom prompt bar; kick off one of six generation actions with a single click, do local crop/rotate/collage, or let the LLM "read" the current image.

The key design point: **most of the user's re-creation operations never disturb the LLM**. Parameters like masks, reference images, and aspect ratio are forwarded through the Surface command channel directly to the image tool inside the subprocess for execution (Track A), or done purely in the browser via Canvas 2D (Track B). The conversation stream stays clean.

---

## Off by default, and how to turn it on

**Canvas does not appear by default.** It is not a feature lit up by a global switch, but rather **driven by agent source declaration**: Canvas appears only when a source mounts `CanvasLauncher` / `CanvasPanel` into the `launcherRail` / `panelRight` named slots (see the slot model in [12 Web UI Extensions](./12-web-ui-extension.md)) inside its `.pi/web/web.config.tsx`. An ordinary agent source declares neither slot, so Canvas is naturally absent — independence is guaranteed by "declaring absence", not by some env falling back to disable it (`packages/canvas-ui/src/canvas-launcher.tsx:1-15`).

So "how to turn it on" = **switch to a source that declares the Canvas slots**; the easiest is the bundled `examples/aigc-canvas-agent` (`examples/aigc-canvas-agent/.pi/web/web.config.tsx:22-29`).

### About `NEXT_PUBLIC_PI_WEB_CANVAS`

Historically Canvas was gated by the frontend environment variable `NEXT_PUBLIC_PI_WEB_CANVAS`, off by default, turned on with `1` / `true`. This gate still lingers in the bootstrap path: the server reads this env in `GET /api/bootstrap` (`server/bootstrap.ts:93`, `lib/app/runtime-features.ts:55`) and emits it as the runtime feature `canvas` (default `false`), which the frontend injects via `setRuntimeFeatures()` (`src/bootstrap.tsx:140`).

> ⚠ But the component-level path where `isCanvasEnabled()` reads this env is **already `@deprecated`** (`packages/canvas-ui/src/canvas-launcher.tsx:29-37`): the `enabled` prop of `CanvasLauncher` / `CanvasPanel` now **defaults to `true`** (`canvas-launcher.tsx:48,143`), and whether they show is decided by "whether they are declared and mounted". This env is kept only for backward compatibility / forced override (e.g. passing `enabled={false}` explicitly to force it off). The example README still writes `NEXT_PUBLIC_PI_WEB_CANVAS=1`, which can be set as a compatibility-layer setting, but **what really decides whether Canvas appears is the source declaration**.

---

## Quick trial run

The following steps get the gallery running with the bundled example, and each step is independently verifiable.

1. **Start the dev environment** (see [01 Quickstart](./01-quickstart.md)):

   ```bash
   pnpm dev   # dev-all: Vite frontend http://localhost:5173 (/api proxied to 3000)
   ```

   Expected: the terminal brings up both processes at once — the API (:3000) and Vite (:5173).

2. **Open `http://localhost:5173` in the browser**, and on the source-picker page select (or create a new session pointing at) the `examples/aigc-canvas-agent` source.

   Expected: the launcher rail on the left (launcherRail) shows a "🖼️ Canvas Gallery" entry button (`canvas-launcher.tsx:52-62`, DOM anchor `data-canvas-launcher`). If you switch to an ordinary source that does **not** declare the Canvas slots, this button does not appear — that is "off by default".

3. **Click the "Canvas Gallery" entry**: the right panel (panelRight) expands the gallery grid (`data-canvas-panel`).

   Expected: the image attachments already in the session (empty state if none) are shown in a grid. Have the agent generate an image (e.g. type `/img-gen a cat`), and at the end of the turn the gallery automatically reconciles the new image.

4. **Click any cell in the gallery**: you enter the `CanvasWorkbench` canvas editor; click "Back to gallery" at the top left (`data-canvas-workbench-close`) to return.

### Command-line verification (no UI needed)

The Canvas gallery state can be read directly through the agent route declared by this example, which is convenient for script/CI verification. First create a session pointing at this source to get a `sessionId`, then call `gallery-stats`:

```bash
# 1) Create a session (adjust the port to your actual dev/CLI)
curl -s -X POST http://localhost:3000/api/sessions \
  -H 'content-type: application/json' \
  -d '{"source":"'"$PWD"'/examples/aigc-canvas-agent"}'
# → {"sessionId":"…","protocolVersion":"0.1.0"}

# 2) Read gallery stats
curl -s http://localhost:3000/api/sessions/<sessionId>/agent-routes/gallery-stats
```

Expected response for an empty gallery (`examples/aigc-canvas-agent/README.md:106-114`):

```json
{ "domain": "canvas", "assets": 0, "byOrigin": { "upload": 0, "tool-output": 0 }, "generating": false }
```

`generating: true` means a generation command is currently streaming out an image. This route's handler reads the same snapshot from the in-process `getSessionState()` under the key `"surface:canvas"` — exactly the one the Canvas UI mirrors. The declarative route mechanism is covered in [08 Agent Development](./08-agent-development.md), and the call contract in [24 HTTP/SSE API Reference](./24-http-api-reference.md).

---

## Gallery: a materialized view of the attachment store

`CanvasGallery` mirrors the `surface:canvas` snapshot through the host-injected `surface` (`WebExtSurfaceAccess`, equivalent to `useSurface("canvas")` on the slot side) (`packages/canvas-ui/src/canvas-gallery.tsx:1-13,25-27`):

- **`available === true`** (the source registered a `surface:canvas` probe) → the full gallery: grid by default + density switching (overview / masonry / focus) + client-side pagination + lineage / time grouping; thumbnails use a signed `displayUrl` (a binary bypass that does not go through the command channel); an idle edge at the end of the turn (a change in `syncSignal`) triggers `run("sync")` to reconcile (`canvas-gallery.tsx:7-8`).
- **`available === false`** (a non-AIGC source, no probe) → **graceful degradation** to a read-only image library, sourced from the host-injected message-history images `historyImages`, with Track A generation disabled, no commands sent, and no errors (Track B local editing is still available on the workbench side, `canvas-gallery.tsx:9-10`).

The reason the gallery is a "materialized view" rather than independent state: its data is not in the frontend but in the authoritative snapshot maintained on the agent-subprocess side by `canvasSurfaceExtension` via `hydrate()` (enumerating the current session's image attachments + reading lineage meta to reconstruct) plus `sync` reconciliation, mirrored downstream via the `control:"state"` frame (`key="surface:canvas"`) (`examples/aigc-canvas-agent/index.ts:9-11`). This is precisely the single-writer model of Surface CQRS.

In addition, `CanvasPanel` attaches a document-level delegated listener: clicking an image carrying `data-att-id` in a conversation-stream tool card automatically opens the panel and switches the workbench to that att_id (`canvas-launcher.tsx:158-177`), realizing "click an image in chat → enter Canvas editing".

---

## Workbench editor interactions

`CanvasWorkbench` is the M2 canvas editor (`packages/canvas-ui/src/canvas-workbench.tsx:1-18`), laid out as "full-bleed canvas + a floating control layer over the stage":

| Region | Interaction | DOM anchor |
| --- | --- | --- |
| **Stage** | scroll to zoom; the "move" tool drags to pan | `data-canvas-stage` (`:1501`) |
| **Right tool rail** | move / draw line / arrow / text / mask brush / erase / undo / redo | `data-canvas-tool-rail` (`:1395`), `data-canvas-tool="move\|line\|…"` (`:1417`), `data-canvas-undo` / `data-canvas-redo` (`:1436,1439`) |
| **Overlay canvas** | mask strokes (pink) + annotations (red) | `data-canvas-mask-overlay` (`:1632`) |
| **Bottom prompt bar** | `@` multi-image references + aspect ratio / variant parameter cluster + "Generate" button | floating layer inside `data-canvas-stage` |
| **Left version rail** | history versions arranged vertically, click to switch / add as a layer | `data-canvas-version-rail` (`:1335`), `data-canvas-version-item` (`:1354`) |

The tools in the tool rail (brush/line/arrow/text) are all labeled "annotation as instruction" (`canvas-workbench.tsx:123-129`) — the annotations you draw on the image get flattened into an annotated reference image handed to the generation action, which is equivalent to giving instructions visually. The mask brush, in turn, rasterizes strokes into a standard alpha mask PNG (transparent holes = edit regions).

Pointer events go through a single entry point, `PointerRouter`, with hit-testing dispatched entirely by the `data-*` marks in the DOM (`canvas-workbench.tsx:1082`), not scattered across separate handlers.

---

## The six built-in generation actions (Track A)

The bottom "Generate" button is not a fixed action, but **automatically decides which kind of generation to send based on the stage's current state**. The decision is score-based (`decideGenerate` → `resolveAction`, `canvas-workbench.tsx:283-297`), and the six built-in actions are declared with `defineCanvasAction<SurfaceOp>` and win by score (`packages/canvas-ui/src/generate-actions.ts:67-135`):

| Action | Trigger condition | Score | Semantics |
| --- | --- | --- | --- |
| **Outpaint** `outpaint` | drag the frame outward (`hasExpand`) | 100 | generate and fill the new outward region |
| **Inpaint** `inpaint` | a mask was painted (`hasMask`) | 90 | repaint the masked region |
| **Reference blend** `reference` | `@` referenced a reference image | 80 | blend with the reference image (variants ≥ 2 attach `n`) |
| **Generate variants** `variants` | variant count ≥ 2 | 70 | produce multiple images at once |
| **Reframe** `reframe` | empty prompt + an aspect ratio specified | 60 | reframe by the new ratio only |
| **Generate** `edit` | always the fallback | 10 | whole-image instruction edit |

Once an action is hit, `buildSurfaceOp` assembles it into a channel-agnostic `SurfaceOp` (`execution.via: "prompt"`, `generate-actions.ts:76`), whose `args` **contain only `att_` references + text, no binary** — both image and mask are passed by attachment id. Generation goes through the Surface command channel → `wireSurfaceBridge` → a direct call to the image tool inside the subprocess (picking up `models.json`/provider/key, **without going through the LLM**, `examples/aigc-canvas-agent/README.md:22-23`).

> These six are **built-in actions**, i.e. Canvas's behavioral baseline. Plugin authors can append custom actions to the scoring via the same `defineCanvasAction` contract — that is the subject of [17 Canvas Plugin Development](./17-canvas-plugins.md).

### Track B: pure local editing

Masks / annotations / rotation / paste-back compositing are all done in the browser via Canvas 2D, and the products are uploaded through the upload seam to land as a new `att_`, then `run("register", …)` back to the authoritative gallery (`canvas-workbench.tsx:13-14`, anchors such as `data-canvas-b-rotate`). When `available === false`, Track B is still usable locally, it just does not register.

### Bring into the conversation

By default re-creation is **not injected into the conversation**. When needed, click the explicit action (`data-canvas-bring-to-conversation`, `:1322`), which injects the `att_id` into a user message through the Prompt channel, bringing an image back into the chat context.

---

## Vision "read" flowing back into the conversation

At the top of the workbench there is a "👁 Read" button: it asks a question about the current working image and lets the LLM **actually see** this image and answer. This solves a concrete problem — to the LLM, an image in the gallery is merely the text marker `[attachment id=att_… …]`; it can read the id but not the pixels.

"Read" is sent through **the same conversation channel as generation** (`canvas-workbench.tsx:869-887`): `buildVisionOp` assembles "current working image + question + optional vision model" into a `SurfaceOp` with `tool: image_vision` (`packages/canvas-ui/src/vision-op.ts:63-82`), which `bridge.submitOp` renders via `renderSurfaceOp` into a **user message** sent into the conversation stream, and the LLM accordingly invokes the `image_vision` tool (fetch bytes → delegate to a model that supports image input → return a textual conclusion). So the conclusion **naturally flows back into the conversation record**: it can be replayed, followed up on, and enters the LLM context — instead of popping up an isolated floating layer.

Two pitfalls:

- The **vision model selector** is fetched from `GET /api/vision/models` (`canvas-launcher.tsx:66-92`, `vision-op.ts:92-112`); any failure (no baseUrl / network / non-2xx / parse exception) collapses into an empty list, and in that case **Read still works** — the payload carries no `model`, and the `image_vision` tool's popover falls back.
- The `model` value for Read is **`provider/modelId`** (aligned with the tool's `model` parameter), ⚠ which differs from the **bare id** format of the prompt bar's "generation model" selector and must not be mixed (`vision-op.ts:16-18`).

The `image_vision` tool itself, the `/img_vision` command, and the `GET /vision/models` endpoint are covered in [11 AIGC and Vision Tools](./11-aigc-and-vision-tools.md).

---

## Architecture: built on the Surface stack

Canvas is the **reference consumer** of the [04 Surface Authoritative Surface Stack](./04-surface-stack.md), with `domain="canvas"`:

```
┌─ agent subprocess ───────────────────────────┐
│ canvasSurfaceExtension (createSurface)        │  ← single writer: state authority
│   hydrate() enumerates attachments → snapshot  │
│   Track A command → runImageTool (no LLM)      │
└───────────────┬───────────────────────────────┘
   control:"state" (key="surface:canvas") │ ▲ ui-rpc command upstream
   mirror snapshot downstream             ▼ │
┌─ browser ──────────────────────────────────────┐
│ CanvasPanel (panelRight, injected surface)      │
│   ├ CanvasGallery  read snapshot (thin projection) │
│   └ CanvasWorkbench send commands (run/submitOp)   │
└────────────────────────────────────────────────┘
```

- **State downstream**: on every `set`, the subprocess `createSurface` writes the `GalleryState` snapshot to `key="surface:canvas"`, mirrored to the frontend via the `control:"state"` sticky frame (`examples/aigc-canvas-agent/index.ts:9-11`).
- **Command upstream**: the workbench's `run("register")` / `run("sync")` / Track A generation go through `useSurface` → ui-rpc forwarding → dispatch inside the subprocess by `wireSurfaceBridge`. Generation uses `submitOp` (Prompt channel), while local-edit registration uses `run` (command channel).
- **Three degradation states**: `bridge.opChannel` is one of `prompt` (normal) / `command` (command-only) / `unavailable` (probe missing), and the UI renders accordingly (`canvas-workbench.tsx:1818-1826`).

A real-subprocess integration test covers the whole path (fd1 backflow + `setState` downstream + gallery materialized-view hydrate + Track A re-creation); see chapter 04.

---

## Integrators: wiring Canvas into your own source

In your agent source, Canvas is two wiring points (`examples/aigc-canvas-agent/index.ts` + `.pi/web/web.config.tsx`):

**1. Agent side** — load three extensions (`examples/aigc-canvas-agent/index.ts:47-48`):

```ts
import { aigcExtension, canvasSurfaceExtension, visionExtension }
  from "@blksails/pi-web-tool-kit/runtime";

export default defineAgent({
  extensions: [aigcExtension, visionExtension, canvasSurfaceExtension],
  // …
});
```

- `aigcExtension`: `image_generation` / `image_edit` (generated images land as `att_`, triggering gallery aggregation);
- `visionExtension`: the `image_vision` tool + the `/img_vision` command (backing "Read");
- `canvasSurfaceExtension`: the authoritative surface with `domain="canvas"` (gallery materialized view + Track A re-creation commands).

**2. UI side** — declare the slots in `.pi/web/web.config.tsx` (`examples/aigc-canvas-agent/.pi/web/web.config.tsx:22-29`):

```tsx
import { CanvasLauncher, CanvasPanel, AigcQuickSettings }
  from "@blksails/pi-web-canvas-ui";

export default defineWebExtension({
  manifestId: "aigc-canvas",
  capabilities: ["slots"],
  config: { panelRatio: "4:6", logsPanelPosition: "bottom" },
  slots: {
    launcherRail: CanvasLauncher as never,  // entry button
    panelRight: CanvasPanel as never,        // gallery/workbench (host injects surface)
    promptToolbar: AigcQuickSettings as never, // input-area model/size quick settings
  },
});
```

The `launcherRail` slot does not receive a surface (it only handles open/close); the interactive gallery/workbench lands in `panelRight`, which has a surface injected (`canvas-launcher.tsx:1-15`). The two slots are linked through a module-level `canvasOpenStore`. If your source has no `surface:canvas` probe (has not loaded `canvasSurfaceExtension`), the gallery automatically degrades to a read-only image library — see the `examples/aigc-canvas-nosurface-agent` sample.

> **Scope note**: Canvas's canvas editor, the six built-in actions, the gallery, and Read are all on main (`packages/canvas-ui`), the code is merged and backed by integration tests. This chapter involves no capability that is not merged into main.

---

## Next steps / Related

- The second communication plane Canvas depends on (`createSurface` / `useSurface` / CQRS single writer) → [04 Surface Authoritative Surface Stack](./04-surface-stack.md)
- The packages that house the Canvas components (`@blksails/pi-web-canvas-ui` / `-canvas-kit`) and the dependency graph → [05 Layered Packages](./05-packages.md)
- The `NEXT_PUBLIC_PI_WEB_CANVAS` gate and configuration directories → [06 Configuration Reference](./06-configuration.md)
- The `image_vision` tool, the `/img_vision` command, AIGC image tools, and `GET /vision/models` → [11 AIGC and Vision Tools](./11-aigc-and-vision-tools.md)
- The `launcherRail` / `panelRight` / `promptToolbar` slot model and the 5-tier mount mechanism → [12 Web UI Extensions](./12-web-ui-extension.md)
- Custom layers/tools/actions and the `defineCanvasAction` trio (plugin-author perspective) → [17 Canvas Plugin Development](./17-canvas-plugins.md)
- The declarative HTTP route used by `gallery-stats` and the `getSessionState()` author perspective → [08 Agent Development](./08-agent-development.md)
- The `agent-routes` call contract, the `control:"state"` frame, and `GET /api/vision/models` → [24 HTTP/SSE API Reference](./24-http-api-reference.md)
- The five-minute run-through and `pnpm dev` dual-process orchestration → [01 Quickstart](./01-quickstart.md)
