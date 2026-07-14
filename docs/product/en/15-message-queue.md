# 15 · Message Queue

A pi coding agent is "busy" while it processes a turn. During that time, if the user wants to keep steering the task, there is no need to wait — subsequent messages can be **queued**: a `steering` (interjection) message is delivered in the gaps between the current assistant turn's tool calls, while a `follow-up` message is delivered after the agent has finished all of its work. The user can also **retrieve** not-yet-delivered queued messages back into the editor to keep editing them or to withdraw them.

This chapter describes how pi-web wires pi's message queue capability into the Web frontend: queuing by delivery semantics while busy, visualizing the pending-delivery queue and the pending count, and retrieving queued messages back into the editor. This interaction aligns with pi's native TUI. See the spec at `.kiro/specs/message-queue-ui/`.

---

## 1. What It Solves / Capability Boundary

**The problem it solves**: while the agent processes a long task, the user previously could only wait. Submitting directly while busy would also trigger the pi SDK's low-level error "missing `streamingBehavior` while streaming". This feature makes busy-time submissions queue according to the "interject / follow-up" intent, eliminates that error, and completes the "retrieve" round-trip.

**The authoritative source of the queue lives in the agent subprocess.** The pi SDK decides the queuing and delivery policy (`steeringMode` / `followUpMode`, `one-at-a-time` / `all`); pi-web only **consumes** the queue snapshots it emits and **triggers** retrieval — it does not change the delivery algorithm.

**Capability boundary (In / Out of scope)**:

| Capability | Status | Notes |
|---|---|---|
| Busy-time Enter to interject / Alt+Enter to follow-up (queue) | ✅ | Derives the delivery intent; always carries a queuing behavior |
| Queue visualization + pending count | ✅ | `PiQueuePanel`; an empty queue takes no layout space |
| Esc / Alt+↑ to retrieve into the editor | ✅ | Backfill an empty box / append to a non-empty one |
| Queuing coexists with abort (Stop/abort) | ✅ | While busy the main button is still Stop; queuing goes through the keyboard |
| Busy-time queuing carrying `att_…` referenced attachments | ❌ | The `steer`/`follow_up` endpoints only accept `message` + inline images; a busy-time referenced attachment → queuing is blocked with a prompt |
| Deleting / reordering a single item within the queue | ❌ | The snapshot is only a string array, with no stable item id |
| Switching `steeringMode` / `followUpMode` | ❌ | The pi subprocess is authoritative; the frontend does not intervene |

The underlying plumbing (the protocol's `streamingBehavior` / `control:queue` / `data-pi-queue` / `queue_update`, the server's `/steer` `/follow_up` routes, react's `steer`/`followUp`) was already in place; this feature completes the frontend wiring and the `clearQueue` retrieval endpoint.

---

## 2. Queuing Interaction (Busy-Time Submission)

The delivery intent is derived from a single point, `(isBusy, altKey)`:

| Session state | Submit key | Delivery intent |
|---|---|---|
| idle | Enter / Alt+Enter | Regular `prompt` (no queuing; the existing path is entirely unchanged) |
| busy | Enter | `steer` (interject) |
| busy | Alt+Enter | `follow-up` |

The keys are parsed in `handleKeyDown` in `packages/ui/src/elements/prompt-input.tsx`: a plain Enter surfaces the regular intent, `Alt+Enter` surfaces `{ followUp: true }`, and `Shift+Enter` is still a newline. When a completion / command popover captures input (`suppressEnterSubmit`), Enter yields to the popover.

The derivation and guards live in `PiChat.doSend` (`packages/ui/src/chat/pi-chat.tsx`):

- **idle** → goes through the existing `sendMessage` / prompt path (including attachments and `@` completion parsing), with byte-level zero regression.
- **busy** → `opts.followUp ? controls.followUp(req) : controls.steer(req)`, with a request body of `{ message }` (plus `images` when there are inline images); the input box is cleared after a successful delivery.
- **busy-time with `att_…` referenced attachments** → queuing is blocked with the prompt `chat.queue.attachmentUnsupported` (not silently dropped).
- **delivery failure** → prompts `chat.queue.enqueueFailed` and **does not clear the input** (no loss of the user's input).

`canSubmit` is no longer blocked by busy — as long as `transport && sessionReady && has content`, submission is allowed (the not-ready session gate is **not** relaxed). While busy the main button is still Stop; queuing and abort coexist.

---

## 3. The control:queue Protocol and the Sticky Frame

### 3.1 Downlink of the Queue Snapshot (Dual Frames)

The agent subprocess emits a `queue_update` event on every queue change (`packages/protocol/src/rpc/event.ts`, containing `steering: string[]` and `followUp: string[]`). The server's `translateEvent` (`packages/server/src/session/translate/translate-event.ts`) translates it into **two frames**:

| Frame | Channel | Purpose |
|---|---|---|
| `data-pi-queue` | Into the message stream (uiMessageChunk) | History / render compatibility |
| `control:"queue"` | Side-band control frame | **Authoritative snapshot**, feeding control-store's `queue` → `usePiControls().queue` → the queue panel |

The `control:queue` frame structure (`packages/protocol/src/transport/sse-frame.ts`):

```
{ control: "queue", steering: string[], followUp: string[] }
```

The frontend control-store (`packages/react/src/sse/control-store.ts`) writes `{ steering, followUp }` into an immutable snapshot in the `case "queue"` branch; `usePiControls` purely projects out a read-only `queue` (falling back to empty when there is no connection / no frame).

### 3.2 Why It Is Registered as a Sticky Frame (Reconnection Convergence)

`control:queue` is registered as a **sticky frame**, symmetric with `session-state`. See `packages/server/src/session/pi-session.ts`: on each frame broadcast, if `frame.payload.control === "queue"` it writes into the `StickyFrameRegistry` under the `"queue"` key; a new subscriber (including a **reconnect / late subscription**) gets the latest frame for that key replayed once via `sticky.replayInto(...)` on subscribe.

**Why it must be sticky**: if it is not sticky while busy, after the user reconnects the SSE subscribes from scratch, `busy` is replayed as a sticky state of `true`, but `queue` is **empty** because there is no replay — the queue panel disappears, `canRetrieve` is false, and the retrieval round-trip is silently unavailable. Making it sticky lets a reconnect immediately obtain the current queue snapshot, converging to the latest last-value.

`StickyFrameRegistry` (`packages/server/src/session/sticky-registry.ts`) only carries **last-value** semantics (multiple writes to the same key keep only the latest); the ring-buffer history semantics of `logs` are not merged into this table.

**Sticky frames are per-session**: each `PiSession` holds its own `StickyFrameRegistry` (`packages/server/src/session/pi-session.ts:188`), and the `"queue"` key is only valid within that session. When the frontend switches to another session from the [sessions list](./14-sessions-list.md), the SSE subscription points at the new session's stream, and what gets replayed is the **new session's** `control:queue` (usually empty); the old session's queue snapshot never bleeds into the current panel — the queue view is naturally isolated across session switches.

---

## 4. The clearQueue Round-Trip (Retrieval)

### 4.1 Why It Goes Through a state-bridge-Style Custom Frame Rather Than pi RPC

pi's `AgentSession.clearQueue()` is **not in pi's RPC command set**. To keep pi upstream zero-change, `clearQueue` reuses the **state-injection-bridge** seam — "a second stdin reader + a custom stdout line" — closing the loop inside pi-web. This is a **request / response** channel (with a correlating `id`), not the one-way downlink of the state bridge.

> The state-injection-bridge is a bidirectional seam pi-web builds itself at the pi subprocess boundary (a self-built shared KV inside the subprocess, plus three edges: the downlink mirror frame, the write-back endpoint, and the internal custom line). Its concept and author-facing usage are covered in [04 Surface Authoritative Stack](./04-surface-stack.md); `clearQueue` is one application of its "request / response" variant, and understanding the bridge's seam model helps in reading this section.

The contract is defined in `packages/protocol/src/web-ext/queue-line.ts`, with two internal lines:

| Line type | Direction | Fields |
|---|---|---|
| `piweb_clear_queue` | server → runner (via stdin) | `id` |
| `piweb_clear_queue_result` | runner → server (via stdout) | `id` + `steering: string[]` + `followUp: string[]` |

The REST response contract `ClearQueueResponse` (`packages/protocol/src/transport/rest-dto.ts`): `{ steering: string[], followUp: string[] }`.

### 4.2 End-to-End Flow

```
PiChat(Esc/Alt+↑)
  → usePiControls().clearQueue()
  → PiClient.clearQueue(id)  POST /sessions/:id/clear_queue (empty body)
  → makeClearQueueHandler → PiSession.clearQueue()
      · assertActive → generate an isolated reqId → register pendingClearQueue[reqId]
      · channel.send  {"type":"piweb_clear_queue","id":reqId}   ← via stdin
  → runner wireClearQueueBridge second stdin reader intercepts
      · runtime.session.clearQueue()  ← evaluated to get the currently bound session
      · fs.writeSync(1, {"type":"piweb_clear_queue_result",id,steering,followUp}\n)
  → PiSession.handleRawLine pairs pending by id → resolve
  → 200 ClearQueueResponse (synchronous response body)
  → PiChat backfills the editor
```

Key implementation points:

- **The result line must be written directly to fd1** (`fs.writeSync(1, …)`). See `packages/server/src/runner/clear-queue-wiring.ts`: pi's `runRpcMode` will `takeOverStdout()` and redirect `process.stdout.write` to stderr; RPC frames are written out via the raw fd1, and the server reads that same subprocess fd1, so this bridge must also write directly to fd1 and cannot use `process.stdout.write`.
- **Assemble before `runRpcMode(runtime)`** (`packages/server/src/runner/runner.ts`), and hook into the `cleanup()` of SIGTERM/SIGINT/beforeExit.
- **`runtime.session` is evaluated at call time**, to cover the case where an in-process `new_session` / `switchSession` / `fork` swaps the session.
- **The correlating id is isolated** in `PiRpcProcess`'s RPC pending map (a separate `pendingClearQueue`). pi's own stdin reader will also see the `piweb_clear_queue` request line and reply with a harmless `Unknown command` (the id does not match the server-side RPC pending → discarded), which does not affect this path.
- **A synchronous HTTP response body** returns the cleared text (not an SSE idle control stream), avoiding a repeat of the prompt-stream conflict, aligned with the unified-command-result-layer decision.
- **Timeout fallback**: `CLEAR_QUEUE_TIMEOUT_MS = 5000` (5s); if the subprocess does not write back, it rejects; a late result line is safely discarded because the pending was already deleted (`handleRawLine` ignores an unknown id outright, placed before the active gate). On session teardown, all in-flight requests are immediately rejected.
- **Graceful degradation**: if `wireClearQueueBridge` fails to assemble → it logs to stderr, degrades the capability, and **does not throw** (the session still starts); when `runtime.session.clearQueue()` throws, it returns an **empty result line** (without swallowing the queue semantics; the UI-side editor is unchanged and the panel is preserved).

### 4.3 Endpoint Error Codes

| Scenario | Status code |
|---|---|
| No session | 404 (`SessionNotFoundError`) |
| Session already stopped | 409 (`SessionStoppedError`) |
| Bridge timeout (subprocess did not write back) | 500 |
| General failure | 500 |

Normalized via the existing `mapEngineError` (`packages/server/src/http/error-map.ts`). Note: `PiSession.clearQueue`'s timeout rejects with a plain `Error("clear_queue timed out")`, which falls into `mapEngineError`'s **unknown branch and maps to 500** — unlike agent-declared-routes, which goes through a dedicated `AgentRouteTimeoutError` → 504, the retrieval bridge currently has **no** separate 504 mapping. For any error code the frontend uniformly does "prompt + do not modify the editor's existing content".

### 4.4 Manually Verifying the Retrieval Endpoint (curl)

The retrieval endpoint is a standard POST and can be hit directly, decoupled from the frontend. In dev the API server sits at `127.0.0.1:3000`, and the `/api/*` prefix is served by the Hono host (`app.all('/api/*')` in `server/index.ts`). Steps:

1. Start a session with an observable subprocess (an offline stub is enough and consumes no real model quota):

   ```bash
   PI_WEB_STUB_AGENT=1 pnpm dev
   # dev-all: Vite frontend at http://localhost:5173 (/api proxied to 3000)
   ```

2. Open `http://localhost:5173` in a browser, create a new session and grab the `sessionId` (visible in the URL or in the response body of `POST /api/sessions` under DevTools Network). While the agent is busy, press Enter / Alt+Enter to queue a few interject / follow-up messages, and confirm the panel's `data-pi-queue-count` is non-zero.

3. Hit the retrieval endpoint directly (empty request body) to pull all currently queued text back at once:

   ```bash
   curl -s -X POST \
     http://localhost:3000/api/sessions/<sessionId>/clear_queue \
     -H 'content-type: application/json' -d '{}'
   ```

   **Expected result**: HTTP 200, with a `ClearQueueResponse` body — the two groups of cleared text (order is always steering first, then followUp):

   ```json
   { "steering": ["run unit tests first", "check lint while at it"], "followUp": ["write a summary at the end"] }
   ```

   At the same time the agent queue is cleared, a fresh `control:queue` (empty snapshot) is sent downstream, the frontend panel hides, and `data-pi-queue-count` resets to zero.

> In e2e the equivalent assertion reads the DOM markers: after queuing, assert `[data-pi-queue-count]` text > 0; after triggering retrieval, assert it resets to zero and the `[data-pi-queue]` panel is `toBeHidden`. See the marker list in §5.1.

### 4.5 Idempotent Semantics of Concurrent Retrieval (Multi-Tab / Multi-Subscriber)

A single session may have multiple frontend subscribers (multiple tabs, multiple devices). If two subscribers trigger retrieval almost simultaneously, the same batch of text is not retrieved twice:

- Each `clearQueue` generates an **isolated correlating `id`** registered into `pendingClearQueue` (`packages/server/src/session/pi-session.ts:931-948`), each pairing with its own result line independently, with no crossed ids.
- On receiving the request line, the runtime bridge calls `clearQueue()` on the **currently bound session** (`packages/server/src/runner/clear-queue-wiring.ts:96`); that call returns the queue contents **at that moment** and atomically clears them. **The first to arrive retrieves all the text, the later one gets empty arrays** (`{ steering: [], followUp: [] }`) — there is no way for two editors to be backfilled with the same block of text.
- After retrieval the empty `control:queue` the agent emits is a sticky last-value, so all subscribers converge to the same "queue is now empty" view.

Retrieval is therefore **naturally idempotent**: repeatedly hitting `/clear_queue` returns content only the first time and empty thereafter — safe to retry.

---

## 5. Frontend Panel and Retrieval

### 5.1 PiQueuePanel (Queue Visualization)

`packages/ui/src/chat/pi-queue-panel.tsx` is a **pure props presentational component** (it introduces no data source); `PiChat` injects the `queue` snapshot, and it mounts above the editor. Behavior:

- Renders `steering` (interject) and `follow-up` **grouped** pending-delivery items, plus the pending **total** count.
- Total of 0 → returns `null`, taking **no layout space** (no blank placeholder appears).
- The queue snapshot is only a string array with no stable item id; order is stable, and index is used as the key.

Stable `data-*` markers (for e2e / acceptance assertions):

| Marker | Meaning |
|---|---|
| `data-pi-queue` | Panel container |
| `data-pi-queue-count` | Pending total count (value is a numeric string) |
| `data-pi-queue-group="steering"｜"followUp"` | Group |
| `data-pi-queue-item="steering"｜"followUp"` | Single item |

Copy goes through i18n: `chat.queue.title` / `chat.queue.steering` / `chat.queue.followUp` (see `packages/ui/src/i18n/messages.ts`, bilingual zh/en).

### 5.2 Retrieval (Esc / Alt+↑)

The retrieval entry is in `PromptInput.handleKeyDown`: when the queue is non-empty (`canRetrieve`) and there is no completion popover (`!suppressEnterSubmit`), `Escape` or `Alt+ArrowUp` triggers `onRequestRetrieve`. When the queue is empty or a popover is open, Esc keeps its existing default behavior (such as closing the completion popover) — no accidental retrieval trigger.

`PiChat.onRequestRetrieve` calls `controls.clearQueue()`, and after getting the cleared text back, backfills it:

- **Order**: `steering` first, then `followUp`, each preserving its original order, joined by a newline `\n`.
- **Empty box** → backfill directly; **existing unsubmitted text** → append (newline-separated), without overwriting / discarding what the user already typed.
- Endpoint failure → prompts `chat.queue.retrieveFailed` and does not change the editor.

After retrieval the agent queue is cleared → a new `control:queue` frame arrives → the panel hides as the snapshot empties, and `data-pi-queue-count` goes to zero.

`usePiControls` (`packages/react/src/hooks/use-pi-controls.ts`) surfaces a read-only `queue` and the `clearQueue` action; `PiClient.clearQueue` (`packages/react/src/client/pi-client.ts`) POSTs `/sessions/:id/clear_queue` and parses the response body (not just an ack).

---

## 6. Configuration / Environment Variables

This feature has **no dedicated environment variable or feature flag** — queuing and retrieval are available by default with `PiChat`. Its behavior depends on two existing capabilities:

- **Session-readiness handshake** (session-readiness): submission is still subject to the readiness gate (see [02 Core Concepts](./02-core-concepts.md)).
- **busy authoritative snapshot** (session-snapshot-authority): the busy / idle decision comes from the `control:session-state` sticky snapshot.

The underlying queuing policy (`steeringMode` / `followUpMode`) is decided by the pi subprocess; pi-web exposes no toggle entry.

---

## 7. Troubleshooting

- **Busy-time submission does nothing / reports "streaming missing streamingBehavior"**: confirm the frontend has wired this feature (busy-time should go through `steer` / `followUp` rather than a bare prompt). If dev was started before this feature was merged, the handler singleton may be the old logic — restart dev.
- **After reconnect the queue panel disappears and retrieval is unavailable**: check whether `control:queue` is registered as a sticky frame (`sticky.set("queue", …)` in `pi-session.ts`). If after a busy-time reconnect `busy` is replayed as true but `queue` is empty, the sticky registration is missing.
- **The retrieval request returns 500 (bridge timeout)**: `wireClearQueueBridge` was not assembled or the subprocess did not write back the result line; `clearQueue` rejects after 5s and is mapped to 500 by `mapEngineError` (the retrieval bridge has no dedicated 504 mapping — see §4.3). Confirm the bridge is assembled before `runRpcMode`; the bridge does not take effect in non-custom runner mode (such as a `pi --mode rpc` fallback) — the current bootstrap path is custom runner only, and if a fallback is introduced the retrieval entry needs a gated degradation.
- **Retrieved text is not backfilled / is garbled**: the result line must be validated by `ClearQueueResultLineSchema`; the order is always steering first then followUp. If the result line was written to stderr instead of fd1, it means `process.stdout.write` was mistakenly used (hijacked by `takeOverStdout`) — it must be `fs.writeSync(1, …)`.
- **Busy-time attachment queuing is blocked**: this is **expected behavior** (`chat.queue.attachmentUnsupported`) — the `steer`/`follow_up` endpoints do not accept `att_…` referenced attachments; send them while the session is idle.
- **A stub cannot exercise the bridge behavior**: the direct write to fd1 of the custom stdout line can only be caught by a **real subprocess integration test**; a stub cannot catch it (the same known pitfall as the state bridge).

---

## Next Steps / Related

- The `/steer` `/follow_up` `/clear_queue` endpoints and SSE frames → [24 HTTP/SSE API Reference](./24-http-api-reference.md)
- The session-readiness handshake and busy authoritative snapshot → [02 Core Concepts](./02-core-concepts.md)
- Queuing / retrieval happen within a session, and the queue snapshot is isolated across session switches → [14 Sessions List](./14-sessions-list.md)
- state-injection-bridge (the same-origin paradigm of the custom-frame seam), concept and author-facing usage → [04 Surface Authoritative Stack](./04-surface-stack.md)
- The responsibilities of the layered `@blksails/*` packages → [05 Packages](./05-packages.md)
