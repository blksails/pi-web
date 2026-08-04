// Shape (b) factory whose `attachmentCatalog` value is injected via globalThis,
// so a single fixture can drive the whole validation matrix (valid / missing
// handler / non-function / omitted) from the test file (agent-attachment-catalog
// spec, task 1.2).
export default () => ({
  systemPrompt: "attachment-catalog-from-global agent",
  attachmentCatalog: (globalThis as { __attachmentCatalogFixture?: unknown })
    .__attachmentCatalogFixture,
});
