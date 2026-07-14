// Real-subprocess fixture (agent-attachment-catalog spec, task 7.1): declares a minimal
// in-memory attachmentCatalog with one entry, used to drive the full main-process list →
// materialize → signed-readback chain and idempotency without an LLM (session.requestCatalog
// is a non-LLM synchronous RPC channel, same technique as agent-declared-routes).
interface CatalogEntry {
  readonly id: string;
  readonly name: string;
  readonly version?: string;
}

const ENTRIES: readonly CatalogEntry[] = [{ id: "entry-1", name: "Report", version: "v1" }];

export default {
  systemPrompt: "attachment-catalog-e2e-agent (real-subprocess fixture)",
  attachmentCatalog: {
    list(query: string): CatalogEntry[] {
      const q = query.toLowerCase();
      return ENTRIES.filter((e) => q === "" || e.name.toLowerCase().includes(q));
    },
    resolve(entryId: string) {
      const entry = ENTRIES.find((e) => e.id === entryId);
      if (entry === undefined) {
        throw new Error(`catalog entry not found: ${entryId}`);
      }
      return {
        bytes: new TextEncoder().encode(`catalog content for ${entry.id}\n`),
        name: "report.txt",
        mimeType: "text/plain",
      };
    },
  },
};
