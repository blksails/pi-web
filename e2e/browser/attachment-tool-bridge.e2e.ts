import { test, expect } from "@playwright/test";

/**
 * attachment-tool-bridge browser e2e — full chain (task 6.2; Req 7.2, 10.2,
 * 10.3, 10.4).
 *
 * Drives the FULL closed loop against the REAL Next server in the isolated e2e
 * build (NEXT_DIST_DIR=.next-e2e) + external-server mode, with a deterministic,
 * LLM-free stub fixture (PI_WEB_STUB_AGENT_PATH → attachment-tool-bridge-stub.mjs)
 * that runs the GENUINE attachment tool-execution chain (subprocess store
 * resolve → transform → putOutput → reference reflow → real afterToolCall base64
 * gate). See that fixture's header for why a dedicated stub is required:
 * AgentDefinition is purely declarative, so a custom agent cannot deterministi-
 * cally emit a tool call without an LLM — this is task 6.2's documented fallback.
 *
 * Covers (requirements.md):
 *  - 10.2 — 上传 → 发消息(引用)→ tool 以公开 id resolve → 执行 → 产出落库 →
 *           引用回流 → 前端经分发 URL 展示 的完整浏览器链路。
 *  - 7.2  — 产出附件的公开 id 与上传 id 同一空间,可被下一轮消息再次引用(回环 B)。
 *  - 10.3 — 在隔离构建产物(.next-e2e)下运行,不污染开发态 .next。
 *  - 10.4 — 以新鲜运行证据证明。
 *
 * Assertions:
 *  - the tool result reaching the UI carries NO inline base64 (Req 6 / 9 — the
 *    real afterToolCall gate stripped the returnImage:true image to a text ref);
 *  - the produced `att_out` display URL responds 200 with an image content-type;
 *  - the produced id can be referenced again in the NEXT turn and yields a NEW,
 *    distinct `att_out2` id (cross-turn 回环 B closed, Req 7.2).
 *
 * CONCERNS — the user-facing UI send path:
 *  The real client transport (attachment-store's `PiTransport.sendMessages`)
 *  forwards only message+images to `client.prompt`; it does NOT forward
 *  `body.attachmentIds` (which `pi-chat.tsx` does collect). So on a pure UI send
 *  the server-side `injectAttachmentRefs` (task 5.2) receives no ids. This spec
 *  therefore carries the att id in the message TEXT (delivered verbatim by the
 *  UI) and the deterministic fixture parses it — keeping the full UI render +
 *  real subprocess tool chain + distribution-URL display end-to-end. The
 *  client-transport attachmentIds forwarding gap is outside this task's boundary
 *  (client files belong to attachment-store; task 5.2 is server-side only).
 */

// Used for session metadata realism only; actual behavior comes from
// PI_WEB_STUB_AGENT_PATH (stub mode discards the resolved spawn spec).
const SOURCE = "./examples/attachment-tool-agent";

/** A 1x1 transparent PNG (no disk fixture dependency). */
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC";

async function startSession(
  page: import("@playwright/test").Page,
): Promise<string> {
  await page.goto("/");
  await expect(page.locator("[data-agent-source-picker]")).toBeVisible();
  await page.locator("[data-agent-source-input]").fill(SOURCE);
  await page.locator("[data-agent-source-submit]").click();
  await expect(page.locator("[data-session-active]")).toBeVisible();
  await expect(page.locator("[data-pi-input-textarea]")).toBeVisible();
  const text = await page.locator("[data-session-id]").textContent();
  const id = (text ?? "").replace("session: ", "").trim();
  expect(id.length).toBeGreaterThan(0);
  return id;
}

/** Upload a PNG to the session upload endpoint; returns the public id. */
async function uploadPng(
  page: import("@playwright/test").Page,
  sessionId: string,
  name: string,
): Promise<string> {
  const result = await page.evaluate(
    async (args: { sessionId: string; b64: string; name: string }) => {
      const bin = atob(args.b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const form = new FormData();
      form.append("file", new Blob([bytes], { type: "image/png" }), args.name);
      const res = await fetch(`/api/sessions/${args.sessionId}/attachments`, {
        method: "POST",
        body: form,
      });
      const json = (await res.json()) as { attachment?: { id?: string } };
      return { status: res.status, id: json.attachment?.id ?? "" };
    },
    { sessionId, b64: PNG_BASE64, name },
  );
  expect(result.status).toBe(200);
  expect(result.id.startsWith("att_")).toBe(true);
  return result.id;
}

/**
 * Send a message referencing an attachment id and wait for its tool card to
 * reach the completed (end) phase. Returns the tool card locator.
 */
async function sendReferencing(
  page: import("@playwright/test").Page,
  attachmentId: string,
  cardIndex: number,
): Promise<import("@playwright/test").Locator> {
  const input = page.locator("[data-pi-input-textarea]");
  await input.fill(`Please edit the attached image ${attachmentId}.`);
  await page.locator('[data-pi-submit-state="send"]').click();

  const card = page.locator("[data-pi-tool]").nth(cardIndex);
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute("data-pi-tool-phase", "end", {
    timeout: 25_000,
  });
  return card;
}

/** Extract the produced att_out id + /raw display URL from a tool card. */
async function readProduced(
  card: import("@playwright/test").Locator,
): Promise<{ outId: string; rawUrl: string; cardText: string }> {
  // Completed tool cards default-expand their detail region.
  await expect(card.locator("[data-pi-tool-detail]")).toHaveCount(1);
  const cardText = (await card.textContent()) ?? "";

  const idMatch = cardText.match(/id=(att_[A-Za-z0-9_-]+)/);
  expect(
    idMatch,
    `tool card should surface a produced att_ id: ${cardText}`,
  ).not.toBeNull();
  const outId = idMatch![1]!;

  const urlMatch = cardText.match(/url=(\/attachments\/[^\s"'<>]+)/);
  expect(
    urlMatch,
    `tool card should surface a /raw display url: ${cardText}`,
  ).not.toBeNull();
  const rawUrl = urlMatch![1]!;
  return { outId, rawUrl, cardText };
}

/**
 * Fetch a produced /raw display URL in page context; returns status +
 * content-type + size.
 *
 * The store signs root-relative display URLs (`/attachments/:id/raw?…`); the app
 * mounts the distribution endpoint under `/api`. The frontend (`use-attachments`)
 * prepends its `baseUrl` (`/api`) before display — so we apply the same prefix
 * here to fetch exactly what the UI would render (the `/api` prefix is display-
 * only and not part of the HMAC signature).
 */
async function probeRaw(
  page: import("@playwright/test").Page,
  displayUrl: string,
): Promise<{ status: number; contentType: string; bytes: number }> {
  const url = displayUrl.startsWith("/api") ? displayUrl : `/api${displayUrl}`;
  return page.evaluate(async (u: string) => {
    const res = await fetch(u, { method: "GET" });
    return {
      status: res.status,
      contentType: res.headers.get("content-type") ?? "",
      bytes: (await res.arrayBuffer()).byteLength,
    };
  }, url);
}

test("attachment-tool-bridge: 上传→引用→tool resolve+处理+落库→引用回流→分发 URL 展示;无 base64;跨轮再引用 (Req 7.2/10.2/10.3/10.4)", async ({
  page,
}) => {
  const sessionId = await startSession(page);

  // ── Turn 1: upload att_in → reference → edit_image → produced att_out ──────
  const attIn = await uploadPng(page, sessionId, "input.png");
  const card1 = await sendReferencing(page, attIn, 0);
  const produced1 = await readProduced(card1);

  // The tool result reaching the UI must NOT contain inline base64 (Req 6 / 9 —
  // the real afterToolCall gate stripped the returnImage:true image). A bare
  // base64 PNG body starts with the magic prefix `iVBOR`.
  expect(produced1.cardText).not.toContain("data:image");
  expect(produced1.cardText).not.toContain("iVBOR");
  // The stripped image becomes a `[attachment …]` / `[image stripped]` text ref
  // (proves the gate actually ran — not that the image was simply never there).
  expect(produced1.cardText).toMatch(/\[(attachment|image stripped)/);

  // Produced id is a fresh public id, distinct from input (先落库后引用).
  expect(produced1.outId.startsWith("att_")).toBe(true);
  expect(produced1.outId).not.toBe(attIn);

  // The produced display URL is reachable: GET /raw → 200 image bytes (Req 10.2).
  const probe1 = await probeRaw(page, produced1.rawUrl);
  expect(probe1.status).toBe(200);
  expect(probe1.contentType).toContain("image/");
  expect(probe1.bytes).toBeGreaterThan(0);

  // ── Turn 2 (回环 B): reference the PRODUCED att_out → a NEW att_out2 ───────
  // The produced id shares the upload id space, so it can be edited again.
  const card2 = await sendReferencing(page, produced1.outId, 1);
  const produced2 = await readProduced(card2);

  // Cross-turn loop closed: a NEW produced id distinct from turn 1's output and
  // from the input (Req 7.2 — same id space, re-referenceable).
  expect(produced2.outId.startsWith("att_")).toBe(true);
  expect(produced2.outId).not.toBe(produced1.outId);
  expect(produced2.outId).not.toBe(attIn);

  // Still base64-free in the UI, and its display URL is also reachable (200).
  expect(produced2.cardText).not.toContain("data:image");
  expect(produced2.cardText).not.toContain("iVBOR");
  const probe2 = await probeRaw(page, produced2.rawUrl);
  expect(probe2.status).toBe(200);
});
