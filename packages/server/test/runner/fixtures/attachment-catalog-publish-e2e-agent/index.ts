// Real-subprocess fixture (agent-attachment-catalog spec, task 7.2): declares a minimal
// in-memory attachmentCatalog (list-during-busy assertion target) PLUS a `publish-demo`
// agent-declared-route that calls the runner-injected AttachmentToolContext's `publish`
// (attachment-profile-e2e-agent / attachment-catalog-agent example same globalThis seam
// convention), so the integration test can synchronously trigger a subprocess-side
// publish event without needing an LLM.
const ATTACHMENT_CTX_KEY = "__piWebAttachmentToolContext__";

interface AttachmentToolContextLike {
  readonly available: boolean;
  publish(input: {
    bytes: Uint8Array;
    name: string;
    mimeType: string;
  }): Promise<{ attachmentId: string }>;
}

interface CatalogEntry {
  readonly id: string;
  readonly name: string;
  readonly version?: string;
}

const ENTRIES: readonly CatalogEntry[] = [{ id: "entry-1", name: "Report", version: "v1" }];

async function publishDemoHandler(): Promise<unknown> {
  const ctx = (globalThis as Record<string, unknown>)[
    ATTACHMENT_CTX_KEY
  ] as AttachmentToolContextLike | undefined;
  if (ctx === undefined || !ctx.available) {
    return { ok: false, error: "attachment capability unavailable" };
  }
  const ref = await ctx.publish({
    bytes: new TextEncoder().encode("pushed\n"),
    name: "pushed.txt",
    mimeType: "text/plain",
  });
  return { ok: true, attachmentId: ref.attachmentId };
}

export default {
  systemPrompt: "attachment-catalog-publish-e2e-agent (real-subprocess fixture)",
  attachmentCatalog: {
    list(query: string): CatalogEntry[] {
      const q = query.toLowerCase();
      return ENTRIES.filter((e) => q === "" || e.name.toLowerCase().includes(q));
    },
    resolve(entryId: string) {
      const entry = ENTRIES.find((e) => e.id === entryId);
      if (entry === undefined) throw new Error(`catalog entry not found: ${entryId}`);
      return {
        bytes: new TextEncoder().encode(`catalog content for ${entry.id}\n`),
        name: "report.txt",
        mimeType: "text/plain",
      };
    },
  },
  routes: [
    {
      name: "publish-demo",
      methods: ["POST"],
      handler: publishDemoHandler,
    },
  ],
};
